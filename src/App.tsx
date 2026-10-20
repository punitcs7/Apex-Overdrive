/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { GameCanvas, VirtualControlsState } from './components/GameCanvas';
import { HudOverlay } from './components/HudOverlay';
import { LobbyOverlay } from './components/LobbyOverlay';
import { StatusModal } from './components/StatusModal';
import { ActiveRoomSummary, TitleOverlay } from './components/TitleOverlay';
import { ClusterEventPayload, RoomClusterBridge } from './game/clusterSync';
import {
  canStartRoomRace,
  extractRoomCode,
  joinPlayerToRoom,
  mergeRoomStates,
  removePlayerFromRoom,
  sanitizeRoomCode,
  setRoomBotCount,
} from './game/multiplayerRules';
import { sound } from './game/sound';
import {
  GameState,
  HudTelemetry,
  RemoteCarTelemetry,
  RoomStatePayload,
  RunSnapshot,
  TrackId,
} from './game/types';

const INITIAL_TELEMETRY: HudTelemetry = {
  speedKmh: 0,
  topSpeedCapKmh: 185,
  overdriveStage: 1,
  overdriveCharge: 0,
  speedRampPct: 0,
  nitroFuel: 75,
  lap: 1,
  totalLaps: 3,
  position: 1,
  totalCars: 4,
  currentLapTimeMs: 0,
  bestLapTimeMs: null,
  totalTimeMs: 0,
  peakSpeedKmh: 0,
  isBoosting: false,
  isDrifting: false,
  isOffTrack: false,
  statusBanner: null,
  minimapCars: [],
};

function getOrCreatePlayerId(): string {
  if (typeof window === 'undefined') return 'player_local';
  try {
    const existing = window.sessionStorage.getItem('apex_player_id');
    if (existing) return existing;
    const generated = `drv_${Math.random().toString(36).slice(2, 9)}`;
    window.sessionStorage.setItem('apex_player_id', generated);
    return generated;
  } catch {
    return `drv_${Math.random().toString(36).slice(2, 9)}`;
  }
}

function getRoomCodeFromWindowUrl(): string {
  if (typeof window === 'undefined') return '';
  const searchRoom = new URLSearchParams(window.location.search).get('room');
  if (searchRoom) return sanitizeRoomCode(searchRoom);
  if (window.location.hash) {
    const hashCode = extractRoomCode(window.location.hash);
    if (hashCode.length >= 3) return hashCode;
  }
  return '';
}

export default function App() {
  const [localPlayerId] = useState<string>(getOrCreatePlayerId);
  const [playerName, setPlayerName] = useState<string>(() => {
    const suffix = Math.floor(10 + Math.random() * 89);
    return `RACER-${suffix}`;
  });

  const [gameState, setGameState] = useState<GameState>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('autostart') === '1') {
        document.body.dataset.state = 'playing';
        return 'playing';
      }
      if (getRoomCodeFromWindowUrl()) {
        document.body.dataset.state = 'lobby';
        return 'lobby';
      }
    }
    if (typeof document !== 'undefined') {
      document.body.dataset.state = 'title';
    }
    return 'title';
  });

  const [trackId, setTrackId] = useState<TrackId>('sunset_gp');
  const [raceResetToken, setRaceResetToken] = useState(0);
  const [telemetry, setTelemetry] = useState<HudTelemetry>(INITIAL_TELEMETRY);
  const [runSnapshot, setRunSnapshot] = useState<RunSnapshot | null>(null);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  // Online Multiplayer State
  const [isMultiplayer, setIsMultiplayer] = useState<boolean>(() => {
    return Boolean(getRoomCodeFromWindowUrl());
  });
  const [multiplayerRoom, setMultiplayerRoom] = useState<RoomStatePayload | null>(null);
  const [openRooms, setOpenRooms] = useState<ActiveRoomSummary[]>([]);
  const [lobbyError, setLobbyError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const clusterBridgeRef = useRef<RoomClusterBridge | null>(null);
  const remoteTelemetryRef = useRef<Map<string, RemoteCarTelemetry>>(new Map());
  const deletedRoomIdsRef = useRef<Set<string>>(new Set());
  const knownRoomsRef = useRef<Map<string, RoomStatePayload>>(new Map());
  const activeRoomIdRef = useRef<string | null>(getRoomCodeFromWindowUrl() || null);
  const nameSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playerNameRef = useRef<string>(playerName);
  playerNameRef.current = playerName;

  const virtualInputRef = useRef<VirtualControlsState>({
    left: false,
    right: false,
    throttle: false,
    brake: false,
    boost: false,
  });

  // Synchronize document.body.dataset.state immediately on state transitions
  useEffect(() => {
    document.body.dataset.state = gameState;
    if (gameState === 'playing') {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      const canvas = document.querySelector('canvas');
      if (canvas instanceof HTMLElement) {
        canvas.focus();
      }
    }
  }, [gameState]);

  const cacheKnownRoomSummary = useCallback((room: RoomStatePayload) => {
    const code = sanitizeRoomCode(room.roomId);
    if (!code || deletedRoomIdsRef.current.has(code)) return;

    const existing = knownRoomsRef.current.get(code);
    const merged = existing ? mergeRoomStates(existing, room) : room;
    knownRoomsRef.current.set(code, merged);

    const host = merged.players.find((p) => p.id === merged.hostId);
    const summary: ActiveRoomSummary = {
      roomId: code,
      hostId: merged.hostId,
      hostName: host?.name || 'HOST',
      trackId: merged.trackId,
      playerCount: merged.players.length,
      maxPlayers: merged.maxPlayers,
      status: merged.status,
      room: merged,
    };

    setOpenRooms((prev) => {
      const idx = prev.findIndex((r) => sanitizeRoomCode(r.roomId) === code);
      if (idx === -1) return [summary, ...prev];
      const next = [...prev];
      next[idx] = summary;
      return next;
    });
  }, []);

  const reconcileIncomingRoomState = useCallback(
    (incomingRoom: RoomStatePayload, publishBackIfJoined = true) => {
      const incomingCode = sanitizeRoomCode(incomingRoom.roomId);
      if (!incomingCode || deletedRoomIdsRef.current.has(incomingCode)) {
        return;
      }

      cacheKnownRoomSummary(incomingRoom);
      activeRoomIdRef.current = incomingCode;
      setLobbyError(null);
      setIsMultiplayer(true);

      setMultiplayerRoom((prev) => {
        const wasInIncoming = incomingRoom.players.some((p) => p.id === localPlayerId);

        let next =
          prev && prev.roomId === incomingRoom.roomId
            ? mergeRoomStates(prev, incomingRoom)
            : {
                ...incomingRoom,
                players: incomingRoom.players.map((p) => ({ ...p })),
              };

        // Ensure the local player is enrolled in the room grid (e.g. when joining via Live Room
        // or shared link and receiving the Host's room state)
        const alreadyInGrid = next.players.some((p) => p.id === localPlayerId);
        if (!alreadyInGrid) {
          const joinRes = joinPlayerToRoom(
            next,
            localPlayerId,
            playerNameRef.current.trim() || 'DRIVER'
          );
          if (joinRes.ok) {
            next = joinRes.room;
          }
        }

        // Always keep the local player's own callsign authoritative so network echoes never flicker
        const localCleanName = playerNameRef.current.trim().slice(0, 16);
        if (localCleanName) {
          next = {
            ...next,
            players: next.players.map((p) =>
              p.id === localPlayerId ? { ...p, name: localCleanName } : p
            ),
          };
        }

        knownRoomsRef.current.set(incomingCode, next);
        setTrackId(next.trackId);
        clusterBridgeRef.current?.setRoom(next.roomId);

        // Publish back whenever our local player wasn't in incomingRoom yet, or host reconciled,
        // or when we are the Host so cross-container peers immediately see the updated roster.
        const hostChanged = prev ? prev.hostId !== next.hostId : false;
        const countIncreased = next.players.length > incomingRoom.players.length;
        if (
          publishBackIfJoined &&
          (!wasInIncoming || hostChanged || countIncreased || next.hostId === localPlayerId)
        ) {
          clusterBridgeRef.current?.publishRoomState(next);
        }

        const nextUrl = `${window.location.pathname}?room=${next.roomId}`;
        window.history.replaceState({}, '', nextUrl);

        if (next.status === 'lobby') {
          document.body.dataset.state = 'lobby';
          setGameState('lobby');
        } else if (next.status === 'racing') {
          document.body.dataset.state = 'playing';
          setGameState((prevGs) => {
            if (prevGs !== 'playing') {
              setRaceResetToken((t) => t + 1);
            }
            return 'playing';
          });
        }

        return next;
      });
    },
    [cacheKnownRoomSummary, localPlayerId]
  );

  // Initialize browser-level cross-container RoomClusterBridge (bridges ais-dev and ais-pre directly)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const bridge = new RoomClusterBridge(`cli_${localPlayerId}`, (ev: ClusterEventPayload) => {
      if (ev.type === 'room:state' && ev.room) {
        const incomingCode = sanitizeRoomCode(ev.room.roomId);
        if (!incomingCode || deletedRoomIdsRef.current.has(incomingCode)) return;

        // Always cache the room state for Title Screen Live Rooms so clicking Join has the real Host state
        cacheKnownRoomSummary(ev.room);

        // Reconcile into active lobby/race only if the user is currently in or joining this room
        if (
          activeRoomIdRef.current === incomingCode ||
          activeRoomIdRef.current === '*'
        ) {
          reconcileIncomingRoomState(ev.room, true);
        }
      } else if (ev.type === 'room:join_request') {
        const reqCode = sanitizeRoomCode(ev.roomId);
        setMultiplayerRoom((prev) => {
          if (!prev || prev.roomId !== reqCode) return prev;
          const clone: RoomStatePayload = {
            ...prev,
            players: prev.players.map((p) => ({ ...p })),
          };
          const res = joinPlayerToRoom(clone, ev.playerId, ev.playerName);
          if (res.ok) {
            knownRoomsRef.current.set(reqCode, clone);
            bridge.publishRoomState(clone);
            return clone;
          }
          return prev;
        });
      } else if (ev.type === 'room:configure') {
        setMultiplayerRoom((prev) => {
          if (!prev || prev.roomId !== sanitizeRoomCode(ev.roomId)) return prev;
          if (prev.hostId !== ev.playerId) return prev;
          const clone: RoomStatePayload = {
            ...prev,
            players: prev.players.map((p) => ({ ...p })),
          };
          if (ev.trackId === 'sunset_gp' || ev.trackId === 'harbor_sprint') {
            clone.trackId = ev.trackId;
            setTrackId(ev.trackId);
          }
          if (typeof ev.botCount === 'number') {
            setRoomBotCount(clone, ev.botCount);
          }
          clone.version = (clone.version || 1) + 1;
          return clone;
        });
      } else if (ev.type === 'room:update_name') {
        // Ignore echoes of our own callsign changes so typing never flickers
        if (ev.playerId === localPlayerId) return;
        setMultiplayerRoom((prev) => {
          if (!prev || prev.roomId !== sanitizeRoomCode(ev.roomId)) return prev;
          const clone: RoomStatePayload = {
            ...prev,
            players: prev.players.map((p) =>
              p.id === ev.playerId
                ? { ...p, name: ev.playerName.trim().slice(0, 16) }
                : { ...p }
            ),
            version: (prev.version || 1) + 1,
          };
          return clone;
        });
      } else if (ev.type === 'room:start' && ev.room) {
        const startCode = sanitizeRoomCode(ev.room.roomId);
        if (activeRoomIdRef.current !== startCode) return;
        remoteTelemetryRef.current.clear();
        setRunSnapshot(null);
        reconcileIncomingRoomState(
          {
            ...ev.room,
            status: 'racing',
          },
          false
        );
      } else if (ev.type === 'room:return_lobby' && ev.room) {
        const retCode = sanitizeRoomCode(ev.room.roomId);
        if (activeRoomIdRef.current !== retCode) return;
        setRunSnapshot(null);
        reconcileIncomingRoomState(
          {
            ...ev.room,
            status: 'lobby',
            raceStartTime: null,
          },
          false
        );
      } else if (ev.type === 'room:delete') {
        const delCode = sanitizeRoomCode(ev.roomId);
        if (!delCode) return;
        deletedRoomIdsRef.current.add(delCode);
        knownRoomsRef.current.delete(delCode);
        setOpenRooms((prev) => prev.filter((r) => sanitizeRoomCode(r.roomId) !== delCode));
        setMultiplayerRoom((prev) => {
          if (prev && prev.roomId === delCode) {
            activeRoomIdRef.current = null;
            bridge.setRoom(null);
            setIsMultiplayer(false);
            window.history.replaceState({}, '', window.location.pathname);
            document.body.dataset.state = 'title';
            setGameState('title');
            return null;
          }
          return prev;
        });
      } else if (ev.type === 'room:leave') {
        setMultiplayerRoom((prev) => {
          if (!prev || prev.roomId !== sanitizeRoomCode(ev.roomId)) return prev;
          const clone: RoomStatePayload = {
            ...prev,
            players: prev.players.map((p) => ({ ...p })),
          };
          const rem = removePlayerFromRoom(clone, ev.playerId);
          if (rem.shouldDeleteRoom) {
            deletedRoomIdsRef.current.add(clone.roomId);
            knownRoomsRef.current.delete(clone.roomId);
            setOpenRooms((list) => list.filter((r) => sanitizeRoomCode(r.roomId) !== clone.roomId));
            return null;
          }
          return clone;
        });
      } else if (ev.type === 'room:telemetry' && Array.isArray(ev.cars)) {
        for (const c of ev.cars) {
          if (c && c.id && c.id !== localPlayerId) {
            const existing = remoteTelemetryRef.current.get(c.id);
            if (existing?.seq && c.seq && c.seq <= existing.seq) {
              continue;
            }
            remoteTelemetryRef.current.set(c.id, { ...c });
          }
        }
      }
    });

    clusterBridgeRef.current = bridge;

    const initialUrlRoom = getRoomCodeFromWindowUrl();
    if (initialUrlRoom) {
      activeRoomIdRef.current = initialUrlRoom;
      bridge.setRoom(initialUrlRoom);
      bridge.publishEvent(initialUrlRoom, {
        type: 'room:join_request',
        roomId: initialUrlRoom,
        playerId: localPlayerId,
        playerName: playerNameRef.current,
        trackId: 'sunset_gp',
        senderId: `cli_${localPlayerId}`,
      });
    }

    return () => {
      bridge.destroy();
      clusterBridgeRef.current = null;
    };
  }, [cacheKnownRoomSummary, localPlayerId, reconcileIncomingRoomState]);

  const applyServerMessage = useCallback(
    (msg: Record<string, unknown>) => {
      if (msg.type === 'room:state' && msg.room) {
        const room = msg.room as RoomStatePayload;
        reconcileIncomingRoomState(room, true);
      } else if (msg.type === 'race:started' && msg.room) {
        const room = msg.room as RoomStatePayload;
        remoteTelemetryRef.current.clear();
        setRunSnapshot(null);
        reconcileIncomingRoomState({ ...room, status: 'racing' }, true);
      } else if (msg.type === 'room:deleted' && typeof msg.roomId === 'string') {
        const delCode = sanitizeRoomCode(msg.roomId);
        if (delCode) {
          deletedRoomIdsRef.current.add(delCode);
          knownRoomsRef.current.delete(delCode);
          setOpenRooms((prev) => prev.filter((r) => sanitizeRoomCode(r.roomId) !== delCode));
          setMultiplayerRoom((prev) => {
            if (prev && prev.roomId === delCode) {
              activeRoomIdRef.current = null;
              clusterBridgeRef.current?.setRoom(null);
              setIsMultiplayer(false);
              window.history.replaceState({}, '', window.location.pathname);
              document.body.dataset.state = 'title';
              setGameState('title');
              return null;
            }
            return prev;
          });
        }
      } else if (msg.type === 'rooms:cleared') {
        knownRoomsRef.current.clear();
        setOpenRooms([]);
      } else if (msg.type === 'room:telemetry' && Array.isArray(msg.cars)) {
        for (const c of msg.cars as RemoteCarTelemetry[]) {
          if (c && c.id && c.id !== localPlayerId) {
            const existing = remoteTelemetryRef.current.get(c.id);
            if (existing?.seq && c.seq && c.seq <= existing.seq) {
              continue;
            }
            remoteTelemetryRef.current.set(c.id, { ...c });
          }
        }
      } else if (msg.type === 'room:error') {
        setLobbyError(String(msg.message || 'Multiplayer error'));
      }
    },
    [localPlayerId, reconcileIncomingRoomState]
  );

  const sendHttpRoomAction = useCallback(
    async (payload: Record<string, unknown>) => {
      try {
        const res = await fetch('/api/rooms/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            playerId: payload.playerId || localPlayerId,
            roomId: payload.roomId || multiplayerRoom?.roomId || activeRoomIdRef.current,
          }),
        });
        const data = await res.json();
        if (data && typeof data === 'object') {
          applyServerMessage(data);
        }
      } catch {
        // Ignore transient network errors
      }
    },
    [applyServerMessage, localPlayerId, multiplayerRoom?.roomId]
  );

  const sendWsMessage = useCallback(
    (payload: Record<string, unknown>) => {
      const enriched = {
        ...payload,
        playerId: payload.playerId || localPlayerId,
        roomId: payload.roomId || multiplayerRoom?.roomId || activeRoomIdRef.current,
      };
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(enriched));
      } else {
        void sendHttpRoomAction(enriched);
      }
    },
    [localPlayerId, multiplayerRoom?.roomId, sendHttpRoomAction]
  );

  // Poll active open rooms while on Title Screen so friends can join in 1 click
  useEffect(() => {
    if (gameState !== 'title') return;
    let active = true;

    const fetchOpenRooms = async () => {
      try {
        const res = await fetch('/api/rooms');
        if (!res.ok) return;
        const data = await res.json();
        if (active && Array.isArray(data.rooms)) {
          const incomingList = data.rooms as ActiveRoomSummary[];
          for (const item of incomingList) {
            const code = sanitizeRoomCode(item.roomId);
            if (code && !deletedRoomIdsRef.current.has(code) && item.room) {
              const prevKnown = knownRoomsRef.current.get(code);
              knownRoomsRef.current.set(
                code,
                prevKnown ? mergeRoomStates(prevKnown, item.room) : item.room
              );
            }
          }
          const filtered = incomingList
            .filter((r) => !deletedRoomIdsRef.current.has(sanitizeRoomCode(r.roomId)))
            .map((r) => {
              const code = sanitizeRoomCode(r.roomId);
              const cached = knownRoomsRef.current.get(code);
              if (cached) {
                const host = cached.players.find((p) => p.id === cached.hostId);
                return {
                  ...r,
                  roomId: code,
                  hostId: cached.hostId,
                  hostName: host?.name || r.hostName,
                  playerCount: cached.players.length,
                  room: cached,
                };
              }
              return r;
            });
          setOpenRooms(filtered);
        }
      } catch {
        // Ignore
      }
    };

    void fetchOpenRooms();
    const timer = setInterval(fetchOpenRooms, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [gameState]);

  // Continuous Lobby Sync Heartbeat so Host and joining Friends stay 100% in sync across containers
  useEffect(() => {
    if (gameState !== 'lobby' || !isMultiplayer || !multiplayerRoom) return;

    const syncInterval = setInterval(() => {
      const code = sanitizeRoomCode(multiplayerRoom.roomId);
      if (!code || deletedRoomIdsRef.current.has(code)) return;

      const syncPayload = {
        type: 'room:sync',
        roomId: code,
        playerId: localPlayerId,
        playerName: playerNameRef.current.trim() || 'DRIVER',
        room: multiplayerRoom,
      };

      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(syncPayload));
      } else {
        void sendHttpRoomAction(syncPayload);
      }

      if (multiplayerRoom.hostId === localPlayerId) {
        clusterBridgeRef.current?.publishRoomState(multiplayerRoom);
      }
    }, 1500);

    return () => clearInterval(syncInterval);
  }, [gameState, isMultiplayer, localPlayerId, multiplayerRoom, sendHttpRoomAction]);

  // Establish WebSocket connection with automatic reconnect
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let isUnmounted = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (isUnmounted) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws-race`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        const currentRoomCode =
          activeRoomIdRef.current && activeRoomIdRef.current !== '*'
            ? activeRoomIdRef.current
            : getRoomCodeFromWindowUrl();

        if (currentRoomCode && !deletedRoomIdsRef.current.has(currentRoomCode)) {
          const cachedRoom = knownRoomsRef.current.get(currentRoomCode);
          ws.send(
            JSON.stringify({
              type: 'room:join',
              roomId: currentRoomCode,
              playerId: localPlayerId,
              playerName: playerNameRef.current,
              trackId,
              knownRoom: cachedRoom,
            })
          );
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          applyServerMessage(msg);
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (!isUnmounted) {
          reconnectTimer = setTimeout(connect, 1500);
        }
      };
    };

    connect();

    return () => {
      isUnmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [applyServerMessage, localPlayerId]);

  const handleStartSoloRace = useCallback(() => {
    activeRoomIdRef.current = null;
    setIsMultiplayer(false);
    setMultiplayerRoom(null);
    clusterBridgeRef.current?.setRoom(null);
    window.history.replaceState({}, '', window.location.pathname);
    document.body.dataset.state = 'playing';
    setRunSnapshot(null);
    setRaceResetToken((prev) => prev + 1);
    setGameState('playing');
  }, []);

  const handleCreateOnlineRoom = useCallback(() => {
    activeRoomIdRef.current = '*';
    setLobbyError(null);
    setIsMultiplayer(true);
    sendWsMessage({
      type: 'room:create',
      playerId: localPlayerId,
      playerName: playerName.trim() || 'DRIVER-1',
      trackId,
    });
  }, [localPlayerId, playerName, trackId, sendWsMessage]);

  const handleJoinOnlineRoom = useCallback(
    (roomCode: string, explicitKnownRoom?: RoomStatePayload) => {
      const code = extractRoomCode(roomCode);
      if (!code) return;
      deletedRoomIdsRef.current.delete(code);
      activeRoomIdRef.current = code;
      setLobbyError(null);
      setIsMultiplayer(true);

      // Look up known Host room snapshot from Live Rooms bar or cluster cache
      const knownRoom =
        explicitKnownRoom ||
        knownRoomsRef.current.get(code) ||
        openRooms.find((r) => sanitizeRoomCode(r.roomId) === code)?.room;

      if (knownRoom && sanitizeRoomCode(knownRoom.roomId) === code) {
        reconcileIncomingRoomState(knownRoom, true);
      }

      clusterBridgeRef.current?.setRoom(code);
      clusterBridgeRef.current?.publishEvent(code, {
        type: 'room:join_request',
        roomId: code,
        playerId: localPlayerId,
        playerName: playerName.trim() || 'DRIVER',
        trackId,
        senderId: `cli_${localPlayerId}`,
      });

      const joinPayload = {
        type: 'room:join',
        roomId: code,
        playerId: localPlayerId,
        playerName: playerName.trim() || 'DRIVER',
        trackId,
        knownRoom: knownRoomsRef.current.get(code) || knownRoom,
      };

      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(joinPayload));
      }
      // Also send over HTTP so multi-instance Cloud Run containers immediately sync the join
      void sendHttpRoomAction(joinPayload);
    },
    [localPlayerId, openRooms, playerName, reconcileIncomingRoomState, sendHttpRoomAction, trackId]
  );

  const handleUpdatePlayerName = useCallback(
    (nextName: string) => {
      setPlayerName(nextName);
      playerNameRef.current = nextName;

      const clean = nextName.trim().slice(0, 16);

      // Update local multiplayer room grid slot synchronously so there is zero input/grid flicker
      if (isMultiplayer && clean) {
        setMultiplayerRoom((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            players: prev.players.map((p) =>
              p.id === localPlayerId ? { ...p, name: clean } : p
            ),
          };
        });
      }

      if (nameSyncTimerRef.current) {
        clearTimeout(nameSyncTimerRef.current);
      }

      if (isMultiplayer && multiplayerRoom && clean) {
        const activeRoomId = multiplayerRoom.roomId;
        nameSyncTimerRef.current = setTimeout(() => {
          sendWsMessage({
            type: 'room:update_name',
            roomId: activeRoomId,
            playerId: localPlayerId,
            playerName: clean,
          });
          clusterBridgeRef.current?.publishEvent(activeRoomId, {
            type: 'room:update_name',
            roomId: activeRoomId,
            playerId: localPlayerId,
            playerName: clean,
            senderId: `cli_${localPlayerId}`,
          });
        }, 120);
      }
    },
    [isMultiplayer, localPlayerId, multiplayerRoom, sendWsMessage]
  );

  const handleLobbySelectTrack = useCallback(
    (nextTrackId: TrackId) => {
      setTrackId(nextTrackId);
      if (isMultiplayer && multiplayerRoom) {
        sendWsMessage({
          type: 'room:configure',
          roomId: multiplayerRoom.roomId,
          playerId: localPlayerId,
          trackId: nextTrackId,
        });
        clusterBridgeRef.current?.publishEvent(multiplayerRoom.roomId, {
          type: 'room:configure',
          roomId: multiplayerRoom.roomId,
          playerId: localPlayerId,
          trackId: nextTrackId,
          senderId: `cli_${localPlayerId}`,
        });
      }
    },
    [isMultiplayer, localPlayerId, multiplayerRoom, sendWsMessage]
  );

  const handleLobbyChangeBotCount = useCallback(
    (botCount: number) => {
      if (isMultiplayer && multiplayerRoom) {
        sendWsMessage({
          type: 'room:configure',
          roomId: multiplayerRoom.roomId,
          playerId: localPlayerId,
          botCount,
        });
        clusterBridgeRef.current?.publishEvent(multiplayerRoom.roomId, {
          type: 'room:configure',
          roomId: multiplayerRoom.roomId,
          playerId: localPlayerId,
          botCount,
          senderId: `cli_${localPlayerId}`,
        });
      }
    },
    [isMultiplayer, localPlayerId, multiplayerRoom, sendWsMessage]
  );

  const handleStartMultiplayerRace = useCallback(() => {
    if (!multiplayerRoom) return;
    const check = canStartRoomRace(multiplayerRoom);
    if (!check.allowed) {
      setLobbyError(check.reason || 'Minimum 2 players required.');
      return;
    }
    sendWsMessage({
      type: 'room:start',
      roomId: multiplayerRoom.roomId,
      playerId: localPlayerId,
    });
    const startedRoom: RoomStatePayload = {
      ...multiplayerRoom,
      status: 'racing',
      raceStartTime: Date.now(),
      version: (multiplayerRoom.version || 1) + 1,
    };
    clusterBridgeRef.current?.publishRoomState(startedRoom);
    clusterBridgeRef.current?.publishEvent(multiplayerRoom.roomId, {
      type: 'room:start',
      roomId: multiplayerRoom.roomId,
      room: startedRoom,
      senderId: `cli_${localPlayerId}`,
    });
  }, [localPlayerId, multiplayerRoom, sendWsMessage]);

  const handleDeleteOnlineRoom = useCallback(
    (roomCode: string) => {
      const code = sanitizeRoomCode(roomCode);
      if (!code) return;
      deletedRoomIdsRef.current.add(code);
      knownRoomsRef.current.delete(code);
      setOpenRooms((prev) => prev.filter((r) => sanitizeRoomCode(r.roomId) !== code));
      clusterBridgeRef.current?.clearRoomState(code);

      sendWsMessage({
        type: 'room:delete',
        roomId: code,
        playerId: localPlayerId,
      });
      void fetch(`/api/rooms/${code}`, { method: 'DELETE' }).catch(() => {});

      if (multiplayerRoom?.roomId === code || activeRoomIdRef.current === code || isMultiplayer) {
        activeRoomIdRef.current = null;
        clusterBridgeRef.current?.setRoom(null);
        setIsMultiplayer(false);
        setMultiplayerRoom(null);
        setLobbyError(null);
        window.history.replaceState({}, '', window.location.pathname);
        document.body.dataset.state = 'title';
        setGameState('title');
      }
    },
    [isMultiplayer, localPlayerId, multiplayerRoom?.roomId, sendWsMessage]
  );

  const handleClearAllOnlineRooms = useCallback(() => {
    for (const r of openRooms) {
      const code = sanitizeRoomCode(r.roomId);
      if (code) {
        deletedRoomIdsRef.current.add(code);
        knownRoomsRef.current.delete(code);
        clusterBridgeRef.current?.clearRoomState(code);
      }
    }
    knownRoomsRef.current.clear();
    setOpenRooms([]);
    sendWsMessage({
      type: 'room:delete_all',
      playerId: localPlayerId,
    });
    void fetch('/api/rooms', { method: 'DELETE' }).catch(() => {});
  }, [localPlayerId, openRooms, sendWsMessage]);

  const handleLeaveLobby = useCallback(() => {
    const activeRoom = multiplayerRoom;
    const fallbackUrlRoom = getRoomCodeFromWindowUrl();
    const targetRoomId = activeRoom?.roomId || activeRoomIdRef.current || fallbackUrlRoom;

    if (targetRoomId && targetRoomId !== '*') {
      const isHostOrSolo =
        !activeRoom ||
        activeRoom.hostId === localPlayerId ||
        activeRoom.players.filter((p) => !p.isBot).length <= 1;

      if (isHostOrSolo) {
        deletedRoomIdsRef.current.add(targetRoomId);
        knownRoomsRef.current.delete(targetRoomId);
        setOpenRooms((prev) => prev.filter((r) => sanitizeRoomCode(r.roomId) !== targetRoomId));
        clusterBridgeRef.current?.clearRoomState(targetRoomId);
        sendWsMessage({
          type: 'room:delete',
          roomId: targetRoomId,
          playerId: localPlayerId,
        });
        void fetch(`/api/rooms/${targetRoomId}`, { method: 'DELETE' }).catch(() => {});
      } else {
        clusterBridgeRef.current?.publishEvent(targetRoomId, {
          type: 'room:leave',
          roomId: targetRoomId,
          playerId: localPlayerId,
          senderId: `cli_${localPlayerId}`,
        });
        sendWsMessage({
          type: 'room:leave',
          roomId: targetRoomId,
          playerId: localPlayerId,
        });
        void sendHttpRoomAction({
          type: 'room:leave',
          roomId: targetRoomId,
          playerId: localPlayerId,
        });
      }
    }

    activeRoomIdRef.current = null;
    clusterBridgeRef.current?.setRoom(null);
    setIsMultiplayer(false);
    setMultiplayerRoom(null);
    setLobbyError(null);
    window.history.replaceState({}, '', window.location.pathname);
    document.body.dataset.state = 'title';
    setGameState('title');
  }, [localPlayerId, multiplayerRoom, sendHttpRoomAction, sendWsMessage]);

  const handleNetworkSyncEmit = useCallback(
    (localCar: RemoteCarTelemetry, botCars: RemoteCarTelemetry[]) => {
      sendWsMessage({
        type: 'player:telemetry',
        telemetry: localCar,
        botTelemetry: botCars,
      });
      if (multiplayerRoom) {
        clusterBridgeRef.current?.publishTelemetry(multiplayerRoom.roomId, [
          localCar,
          ...botCars,
        ]);
      }
    },
    [multiplayerRoom, sendWsMessage]
  );

  const handleTogglePause = useCallback(() => {
    setGameState((prev) => {
      if (prev === 'playing') {
        document.body.dataset.state = 'paused';
        return 'paused';
      }
      if (prev === 'paused') {
        document.body.dataset.state = 'playing';
        return 'playing';
      }
      return prev;
    });
  }, []);

  const handleResume = useCallback(() => {
    document.body.dataset.state = 'playing';
    setGameState('playing');
  }, []);

  const handleRestartRace = useCallback(() => {
    if (isMultiplayer && multiplayerRoom) {
      sendWsMessage({
        type: 'room:return_lobby',
        roomId: multiplayerRoom.roomId,
        playerId: localPlayerId,
      });
      const lobbyRoom: RoomStatePayload = {
        ...multiplayerRoom,
        status: 'lobby',
        raceStartTime: null,
        version: (multiplayerRoom.version || 1) + 1,
      };
      clusterBridgeRef.current?.publishRoomState(lobbyRoom);
      clusterBridgeRef.current?.publishEvent(multiplayerRoom.roomId, {
        type: 'room:return_lobby',
        roomId: multiplayerRoom.roomId,
        room: lobbyRoom,
        senderId: `cli_${localPlayerId}`,
      });
      document.body.dataset.state = 'lobby';
      setRunSnapshot(null);
      setGameState('lobby');
      return;
    }
    document.body.dataset.state = 'playing';
    setRunSnapshot(null);
    setRaceResetToken((prev) => prev + 1);
    setGameState('playing');
  }, [isMultiplayer, localPlayerId, multiplayerRoom, sendWsMessage]);

  const handleReturnToTitle = useCallback(() => {
    if (isMultiplayer) {
      handleLeaveLobby();
      setRunSnapshot(null);
      setRaceResetToken((prev) => prev + 1);
      return;
    }
    document.body.dataset.state = 'title';
    setRunSnapshot(null);
    setRaceResetToken((prev) => prev + 1);
    setGameState('title');
  }, [handleLeaveLobby, isMultiplayer]);

  const handleRaceFinish = useCallback((snapshot: RunSnapshot) => {
    document.body.dataset.state = 'gameover';
    setRunSnapshot(snapshot);
    setGameState('gameover');
  }, []);

  const handleToggleMute = useCallback(() => {
    const nextMuted = sound.toggleMute();
    setIsMuted(nextMuted);
  }, []);

  // Global [M] key shortcut for Mute toggle
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
      if (e.code === 'KeyM') {
        e.preventDefault();
        handleToggleMute();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleToggleMute]);

  return (
    <main className="relative w-full h-full overflow-hidden select-none bg-[#090d14]">
      {/* Isolated 60fps HTML5 Canvas2D Simulation & Renderer */}
      <GameCanvas
        gameState={gameState}
        trackId={trackId}
        raceResetToken={raceResetToken}
        isMultiplayer={isMultiplayer}
        localPlayerId={localPlayerId}
        multiplayerRoom={multiplayerRoom}
        remoteTelemetryRef={remoteTelemetryRef}
        virtualInputRef={virtualInputRef}
        onTelemetryUpdate={setTelemetry}
        onNetworkSyncEmit={handleNetworkSyncEmit}
        onRaceFinish={handleRaceFinish}
        onTogglePause={handleTogglePause}
        onResetCar={handleRestartRace}
      />

      {/* Title Screen Stage Overlay */}
      {gameState === 'title' && (
        <TitleOverlay
          selectedTrackId={trackId}
          playerName={playerName}
          openRooms={openRooms}
          onUpdatePlayerName={handleUpdatePlayerName}
          onSelectTrack={setTrackId}
          onStartSoloRace={handleStartSoloRace}
          onCreateOnlineRoom={handleCreateOnlineRoom}
          onJoinOnlineRoom={handleJoinOnlineRoom}
          onDeleteOnlineRoom={handleDeleteOnlineRoom}
          onClearAllOnlineRooms={handleClearAllOnlineRooms}
        />
      )}

      {/* Online Multiplayer 2-22 Player Paddock Lobby */}
      {gameState === 'lobby' && multiplayerRoom && (
        <LobbyOverlay
          room={multiplayerRoom}
          localPlayerId={localPlayerId}
          playerName={playerName}
          errorBanner={lobbyError}
          onUpdatePlayerName={handleUpdatePlayerName}
          onSelectTrack={handleLobbySelectTrack}
          onChangeBotCount={handleLobbyChangeBotCount}
          onStartMultiplayerRace={handleStartMultiplayerRace}
          onLeaveLobby={handleLeaveLobby}
          onDeleteRoom={() => handleDeleteOnlineRoom(multiplayerRoom.roomId)}
        />
      )}

      {gameState === 'lobby' && !multiplayerRoom && (
        <div className="fixed inset-0 z-20 flex items-center justify-center p-6 bg-[#06090e]/90">
          <div className="px-6 py-5 rounded-xl border border-slate-800 bg-[#0b111d] text-center flex flex-col items-center gap-3">
            <span className="text-xs font-mono-tabular uppercase tracking-wider text-emerald-400">
              CONNECTING TO PADDOCK
            </span>
            <p className="font-display font-bold text-xl text-slate-100">
              Syncing Room {getRoomCodeFromWindowUrl() || '...'}
            </p>
            <button
              type="button"
              onClick={handleLeaveLobby}
              className="mt-1 px-4 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs font-mono-tabular text-slate-300 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Active Gameplay Perimeter Telemetry HUD */}
      {gameState !== 'title' && gameState !== 'lobby' && (
        <HudOverlay
          telemetry={telemetry}
          trackId={trackId}
          isMuted={isMuted}
          virtualInputRef={virtualInputRef}
          onToggleMute={handleToggleMute}
          onTogglePause={handleTogglePause}
          onRestartRace={handleRestartRace}
        />
      )}

      {/* Pause & Race Complete Status Modal */}
      <StatusModal
        gameState={gameState}
        telemetry={telemetry}
        runSnapshot={runSnapshot}
        onResume={handleResume}
        onRestart={handleRestartRace}
        onReturnToTitle={handleReturnToTitle}
      />
    </main>
  );
}
