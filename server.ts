import express from 'express';
import fs from 'fs';
import http from 'http';
import mqtt, { MqttClient } from 'mqtt';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import { ClusterEventPayload } from './src/game/clusterSync';
import {
  canStartRoomRace,
  createRoomState,
  extractRoomCode,
  generateRoomCode,
  joinPlayerToRoom,
  mergeRoomStates,
  removePlayerFromRoom,
  sanitizeRoomCode,
  setRoomBotCount,
} from './src/game/multiplayerRules';
import {
  MultiplayerPlayerInfo,
  RemoteCarTelemetry,
  RoomStatePayload,
  TrackId,
} from './src/game/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLUSTER_PREFIX = 'apex_overdrive_d68490d9_v3';
const SERVER_INSTANCE_ID = `srv_${Math.random().toString(36).slice(2, 9)}`;
const BROKER_URLS = ['wss://broker.emqx.io:8084/mqtt'];

interface RoomSession {
  state: RoomStatePayload;
  clients: Map<string, WebSocket>;
  telemetry: Map<string, RemoteCarTelemetry>;
  updatedAt: number;
}

const rooms = new Map<string, RoomSession>();
const deletedRoomCodes = new Map<string, number>();
const clusterClients: MqttClient[] = [];

function broadcastToLocalRoom(roomId: string, message: unknown, excludePlayerId?: string) {
  const session = rooms.get(roomId);
  if (!session) return;
  const payload = JSON.stringify(message);
  for (const [pid, client] of session.clients.entries()) {
    if (excludePlayerId && pid === excludePlayerId) continue;
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function publishClusterState(room: RoomStatePayload) {
  const code = sanitizeRoomCode(room.roomId);
  if (!code || deletedRoomCodes.has(code)) return;
  const payload: ClusterEventPayload = {
    type: 'room:state',
    room,
    senderId: SERVER_INSTANCE_ID,
  };
  const raw = JSON.stringify(payload);
  for (const c of clusterClients) {
    if (c.connected) {
      c.publish(`${CLUSTER_PREFIX}/room/${code}/state`, raw, {
        qos: 1,
        retain: true,
      });
    }
  }
}

function clearClusterRoomState(roomId: string) {
  const code = sanitizeRoomCode(roomId);
  if (!code) return;
  const delEvent = JSON.stringify({
    type: 'room:delete',
    roomId: code,
    senderId: SERVER_INSTANCE_ID,
  });
  for (const c of clusterClients) {
    if (c.connected) {
      c.publish(`${CLUSTER_PREFIX}/room/${code}/state`, '', {
        qos: 1,
        retain: true,
      });
      c.publish(`${CLUSTER_PREFIX}/room/${code}/event`, delEvent, { qos: 1 });
    }
  }
}

function deleteRoomSession(roomId: string, broadcastCluster = true) {
  const code = sanitizeRoomCode(roomId);
  if (!code) return;
  deletedRoomCodes.set(code, Date.now());
  broadcastToLocalRoom(code, { type: 'room:deleted', roomId: code });
  rooms.delete(code);
  if (broadcastCluster) {
    clearClusterRoomState(code);
  }
}

function publishClusterEvent(roomId: string, event: ClusterEventPayload) {
  const code = sanitizeRoomCode(roomId);
  if (!code) return;
  const raw = JSON.stringify({ ...event, senderId: SERVER_INSTANCE_ID });
  for (const c of clusterClients) {
    if (c.connected) {
      c.publish(`${CLUSTER_PREFIX}/room/${code}/event`, raw, { qos: 1 });
    }
  }
}

function initServerClusterBridge() {
  for (const url of BROKER_URLS) {
    try {
      const client = mqtt.connect(url, {
        clientId: `apex_srv_${SERVER_INSTANCE_ID}_${Math.random().toString(36).slice(2, 6)}`,
        clean: true,
        connectTimeout: 4000,
        reconnectPeriod: 2000,
      });

      client.on('connect', () => {
        client.subscribe(`${CLUSTER_PREFIX}/room/+/state`, { qos: 1 });
        client.subscribe(`${CLUSTER_PREFIX}/room/+/event`, { qos: 1 });
        client.subscribe(`${CLUSTER_PREFIX}/room/+/telemetry`, { qos: 0 });
      });

      client.on('message', (_topic, buf) => {
        try {
          const str = buf.toString().trim();
          if (!str) return;
          const ev = JSON.parse(str) as ClusterEventPayload;
          if (!ev || ev.senderId === SERVER_INSTANCE_ID) return;

          if (ev.type === 'room:state' && ev.room) {
            const code = sanitizeRoomCode(ev.room.roomId);
            if (!code || deletedRoomCodes.has(code)) return;
            const hasHuman = ev.room.players?.some((p) => !p.isBot);
            if (!hasHuman) {
              deleteRoomSession(code, true);
              return;
            }
            const existing = rooms.get(code);
            if (!existing) {
              rooms.set(code, {
                state: ev.room,
                clients: new Map(),
                telemetry: new Map(),
                updatedAt: Date.now(),
              });
            } else {
              const prevHost = existing.state.hostId;
              const prevStatus = existing.state.status;
              const prevCount = existing.state.players.length;
              existing.state = mergeRoomStates(existing.state, ev.room);
              existing.updatedAt = Date.now();

              if (existing.state.status === 'racing' && prevStatus !== 'racing') {
                broadcastToLocalRoom(code, {
                  type: 'race:started',
                  room: existing.state,
                });
              } else {
                broadcastToLocalRoom(code, {
                  type: 'room:state',
                  room: existing.state,
                });
              }

              // Re-publish if host reconciliation or player roster merge added players not in ev.room
              if (
                existing.state.hostId !== prevHost ||
                existing.state.hostId !== ev.room.hostId ||
                existing.state.players.length > ev.room.players.length ||
                existing.state.players.length !== prevCount
              ) {
                publishClusterState(existing.state);
              }
            }
          } else if (ev.type === 'room:join_request') {
            const code = sanitizeRoomCode(ev.roomId);
            if (!code || deletedRoomCodes.has(code)) return;
            const session = rooms.get(code);
            if (!session) return;
            const joinRes = joinPlayerToRoom(session.state, ev.playerId, ev.playerName);
            if (joinRes.ok) {
              session.updatedAt = Date.now();
              broadcastToLocalRoom(code, { type: 'room:state', room: session.state });
              publishClusterState(session.state);
            }
          } else if (ev.type === 'room:configure') {
            const code = sanitizeRoomCode(ev.roomId);
            const session = rooms.get(code);
            if (!session || session.state.hostId !== ev.playerId) return;
            if (ev.trackId === 'sunset_gp' || ev.trackId === 'harbor_sprint') {
              session.state.trackId = ev.trackId;
            }
            if (typeof ev.botCount === 'number') {
              setRoomBotCount(session.state, ev.botCount);
            }
            session.state.version = (session.state.version || 1) + 1;
            session.updatedAt = Date.now();
            broadcastToLocalRoom(code, { type: 'room:state', room: session.state });
          } else if (ev.type === 'room:update_name') {
            const code = sanitizeRoomCode(ev.roomId);
            const session = rooms.get(code);
            if (!session) return;
            const p = session.state.players.find((pl) => pl.id === ev.playerId);
            if (p && typeof ev.playerName === 'string' && ev.playerName.trim()) {
              const nextClean = ev.playerName.trim().slice(0, 16);
              if (p.name !== nextClean) {
                p.name = nextClean;
                session.state.version = (session.state.version || 1) + 1;
                session.updatedAt = Date.now();
                broadcastToLocalRoom(
                  code,
                  { type: 'room:state', room: session.state },
                  ev.playerId
                );
              }
            }
          } else if (ev.type === 'room:start' && ev.room) {
            const code = sanitizeRoomCode(ev.roomId);
            const session = rooms.get(code);
            if (session) {
              session.state = mergeRoomStates(session.state, ev.room);
              session.state.status = 'racing';
              session.state.raceStartTime = ev.room.raceStartTime || Date.now();
              session.telemetry.clear();
              session.updatedAt = Date.now();
              broadcastToLocalRoom(code, {
                type: 'race:started',
                room: session.state,
              });
            }
          } else if (ev.type === 'room:return_lobby' && ev.room) {
            const code = sanitizeRoomCode(ev.roomId);
            const session = rooms.get(code);
            if (session) {
              session.state.status = 'lobby';
              session.state.raceStartTime = null;
              session.telemetry.clear();
              session.updatedAt = Date.now();
              broadcastToLocalRoom(code, {
                type: 'room:state',
                room: session.state,
              });
            }
          } else if (ev.type === 'room:delete') {
            const code = sanitizeRoomCode(ev.roomId);
            if (!code) return;
            deleteRoomSession(code, false);
          } else if (ev.type === 'room:leave') {
            const code = sanitizeRoomCode(ev.roomId);
            const session = rooms.get(code);
            if (!session) return;
            const wasHost = session.state.hostId === ev.playerId;
            session.clients.delete(ev.playerId);
            session.telemetry.delete(ev.playerId);
            const rem = removePlayerFromRoom(session.state, ev.playerId);
            if (rem.shouldDeleteRoom || wasHost) {
              deleteRoomSession(code, true);
            } else {
              broadcastToLocalRoom(code, { type: 'room:state', room: session.state });
            }
          } else if (ev.type === 'room:telemetry' && Array.isArray(ev.cars)) {
            const code = sanitizeRoomCode(ev.roomId);
            const session = rooms.get(code);
            if (!session) return;
            const freshCars: RemoteCarTelemetry[] = [];
            for (const c of ev.cars) {
              if (c && c.id) {
                const prev = session.telemetry.get(c.id);
                if (prev?.seq && c.seq && c.seq <= prev.seq) continue;
                session.telemetry.set(c.id, c);
                freshCars.push(c);
              }
            }
            if (freshCars.length > 0) {
              broadcastToLocalRoom(code, {
                type: 'room:telemetry',
                cars: freshCars,
              });
            }
          }
        } catch {
          // Ignore malformed cluster packets
        }
      });

      client.on('error', () => {
        // Automatic reconnect handled by mqtt client
      });

      clusterClients.push(client);
    } catch {
      // Ignore connection setup error
    }
  }
}

function getActiveRoomsSummary() {
  const list: Array<{
    roomId: string;
    hostId: string;
    hostName: string;
    trackId: TrackId;
    playerCount: number;
    maxPlayers: number;
    status: 'lobby' | 'racing' | 'finished';
    room: RoomStatePayload;
  }> = [];

  for (const session of rooms.values()) {
    const host = session.state.players.find((p) => p.id === session.state.hostId);
    list.push({
      roomId: session.state.roomId,
      hostId: session.state.hostId,
      hostName: host?.name || 'HOST',
      trackId: session.state.trackId,
      playerCount: session.state.players.length,
      maxPlayers: session.state.maxPlayers,
      status: session.state.status,
      room: session.state,
    });
  }
  return list;
}

function isValidRoomSnapshot(candidate: unknown): candidate is RoomStatePayload {
  if (!candidate || typeof candidate !== 'object') return false;
  const r = candidate as RoomStatePayload;
  return (
    typeof r.roomId === 'string' &&
    typeof r.hostId === 'string' &&
    Array.isArray(r.players) &&
    r.players.length > 0
  );
}

/**
 * Joins an existing room or seeds from `knownRoom` / requests the room state across
 * the cluster bridge before falling back to a provisional state (marked with a future
 * createdAt timestamp so the real Host's state always wins in mergeRoomStates).
 */
async function joinOrAwaitCrossContainerRoom(
  code: string,
  playerId: string,
  playerName: string,
  trackId: TrackId,
  wsClient?: WebSocket,
  knownRoom?: unknown
): Promise<{ ok: boolean; error?: string; session?: RoomSession }> {
  // Always broadcast join_request across cluster so if the Host is on ais-dev and
  // the friend is on ais-pre, the Host container immediately adds the friend as P2!
  publishClusterEvent(code, {
    type: 'room:join_request',
    roomId: code,
    playerId,
    playerName,
    trackId,
    senderId: SERVER_INSTANCE_ID,
  });

  let session = rooms.get(code);

  // If the joining client clicked a Live Room chip and passed the known Host room snapshot,
  // immediately seed or merge that snapshot so the joining friend NEVER becomes solo Host!
  if (isValidRoomSnapshot(knownRoom) && sanitizeRoomCode(knownRoom.roomId) === code) {
    if (!session) {
      session = {
        state: {
          ...knownRoom,
          players: knownRoom.players.map((p) => ({ ...p })),
        },
        clients: new Map(),
        telemetry: new Map(),
        updatedAt: Date.now(),
      };
      rooms.set(code, session);
    } else {
      session.state = mergeRoomStates(session.state, knownRoom);
    }
  }

  if (!session) {
    // Wait up to 900ms for the Host container / retained MQTT state to respond
    for (let i = 0; i < 18; i++) {
      await new Promise((r) => setTimeout(r, 50));
      session = rooms.get(code);
      if (session) break;
    }
  }

  if (!session) {
    // Create a provisional state with a future createdAt (+24h) so that as soon as
    // the true Host's state arrives (which has createdAt = Date.now()), mergeRoomStates
    // preserves the true Host in P1 and places this joining player in P2.
    const provisionalCreatedAt = Date.now() + 86_400_000;
    const state = createRoomState(code, playerId, playerName, trackId, provisionalCreatedAt);
    session = {
      state,
      clients: new Map(),
      telemetry: new Map(),
      updatedAt: Date.now(),
    };
    if (wsClient) {
      session.clients.set(playerId, wsClient);
    }
    rooms.set(code, session);
    publishClusterState(session.state);
    return { ok: true, session };
  }

  const joinRes = joinPlayerToRoom(session.state, playerId, playerName);
  if (!joinRes.ok) {
    return { ok: false, error: joinRes.error || 'Unable to join room.' };
  }

  if (wsClient) {
    session.clients.set(playerId, wsClient);
  }
  session.updatedAt = Date.now();
  publishClusterState(session.state);
  return { ok: true, session };
}

async function startServer() {
  initServerClusterBridge();

  const app = express();
  const server = http.createServer(app);
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      activeRooms: rooms.size,
      rooms: getActiveRoomsSummary(),
    });
  });

  app.get('/api/rooms', (_req, res) => {
    res.json({ rooms: getActiveRoomsSummary() });
  });

  app.delete('/api/rooms/:roomId', (req, res) => {
    const code = sanitizeRoomCode(req.params.roomId);
    if (code) {
      deleteRoomSession(code, true);
    }
    res.json({ ok: true, roomId: code, rooms: getActiveRoomsSummary() });
  });

  app.delete('/api/rooms', (_req, res) => {
    for (const code of Array.from(rooms.keys())) {
      deleteRoomSession(code, true);
    }
    res.json({ ok: true, rooms: [] });
  });

  app.get('/api/rooms/:roomId', (req, res) => {
    const code = sanitizeRoomCode(req.params.roomId);
    const session = rooms.get(code);
    if (!session) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }
    res.json({
      room: session.state,
      cars: Array.from(session.telemetry.values()),
    });
  });

  app.post('/api/rooms/action', async (req, res) => {
    try {
      const msg = req.body || {};
      const type = String(msg.type || '');
      const playerId = String(msg.playerId || `p_${Date.now()}`);
      const playerName = String(msg.playerName || 'DRIVER');
      const trackId: TrackId =
        msg.trackId === 'harbor_sprint' ? 'harbor_sprint' : 'sunset_gp';

      if (type === 'room:create') {
        let code = generateRoomCode();
        while (rooms.has(code) || deletedRoomCodes.has(code)) {
          code = generateRoomCode();
        }
        const state = createRoomState(code, playerId, playerName, trackId, Date.now());
        const session: RoomSession = {
          state,
          clients: new Map(),
          telemetry: new Map(),
          updatedAt: Date.now(),
        };
        rooms.set(code, session);
        publishClusterState(state);
        res.json({ type: 'room:state', room: state });
        return;
      }

      if (type === 'room:delete_all') {
        for (const c of Array.from(rooms.keys())) {
          deleteRoomSession(c, true);
        }
        res.json({ type: 'rooms:cleared', rooms: [] });
        return;
      }

      const code = extractRoomCode(String(msg.roomId || ''));
      if (!code) {
        res.status(400).json({ type: 'room:error', message: 'Invalid room code.' });
        return;
      }

      if (type === 'room:delete') {
        deleteRoomSession(code, true);
        res.json({
          type: 'room:deleted',
          roomId: code,
          rooms: getActiveRoomsSummary(),
        });
        return;
      }

      if (type === 'room:leave') {
        const session = rooms.get(code);
        publishClusterEvent(code, {
          type: 'room:leave',
          roomId: code,
          playerId,
          senderId: SERVER_INSTANCE_ID,
        });
        if (session) {
          const wasHost = session.state.hostId === playerId;
          session.clients.delete(playerId);
          session.telemetry.delete(playerId);
          const leaveRes = removePlayerFromRoom(session.state, playerId);
          if (leaveRes.shouldDeleteRoom || wasHost) {
            deleteRoomSession(code, true);
          } else {
            broadcastToLocalRoom(code, { type: 'room:state', room: session.state });
            publishClusterState(session.state);
          }
        } else {
          deleteRoomSession(code, true);
        }
        res.json({ ok: true, rooms: getActiveRoomsSummary() });
        return;
      }

      if (type === 'room:join') {
        deletedRoomCodes.delete(code);
        const result = await joinOrAwaitCrossContainerRoom(
          code,
          playerId,
          playerName,
          trackId,
          undefined,
          msg.knownRoom
        );
        if (!result.ok || !result.session) {
          res.status(400).json({
            type: 'room:error',
            message: result.error || 'Unable to join room.',
          });
          return;
        }
        broadcastToLocalRoom(code, { type: 'room:state', room: result.session.state });
        res.json({ type: 'room:state', room: result.session.state });
        return;
      }

      if (type === 'room:sync') {
        if (deletedRoomCodes.has(code)) {
          res.json({ type: 'room:deleted', roomId: code });
          return;
        }
        let session = rooms.get(code);
        if (!session && isValidRoomSnapshot(msg.room)) {
          session = {
            state: {
              ...msg.room,
              players: msg.room.players.map((p: MultiplayerPlayerInfo) => ({ ...p })),
            },
            clients: new Map(),
            telemetry: new Map(),
            updatedAt: Date.now(),
          };
          rooms.set(code, session);
        }
        if (!session) {
          res.status(404).json({ type: 'room:error', message: 'Room not found.' });
          return;
        }
        const prevCount = session.state.players.length;
        const prevHost = session.state.hostId;
        if (isValidRoomSnapshot(msg.room)) {
          session.state = mergeRoomStates(session.state, msg.room);
        }
        joinPlayerToRoom(session.state, playerId, playerName);
        session.updatedAt = Date.now();
        if (
          session.state.players.length !== prevCount ||
          session.state.hostId !== prevHost
        ) {
          broadcastToLocalRoom(code, { type: 'room:state', room: session.state });
          publishClusterState(session.state);
        }
        res.json({ type: 'room:state', room: session.state });
        return;
      }

      const session = rooms.get(code);
      if (!session) {
        res.status(404).json({ type: 'room:error', message: 'Room not found.' });
        return;
      }

      if (type === 'room:configure') {
        if (session.state.hostId === playerId) {
          if (msg.trackId === 'sunset_gp' || msg.trackId === 'harbor_sprint') {
            session.state.trackId = msg.trackId;
          }
          if (typeof msg.botCount === 'number') {
            setRoomBotCount(session.state, msg.botCount);
          }
          session.state.version = (session.state.version || 1) + 1;
          session.updatedAt = Date.now();
          broadcastToLocalRoom(code, { type: 'room:state', room: session.state });
          publishClusterState(session.state);
        }
        res.json({ type: 'room:state', room: session.state });
        return;
      }

      if (type === 'room:update_name') {
        const p = session.state.players.find((pl) => pl.id === playerId);
        if (p && typeof msg.playerName === 'string' && msg.playerName.trim()) {
          const nextClean = msg.playerName.trim().slice(0, 16);
          if (p.name !== nextClean) {
            p.name = nextClean;
            session.state.version = (session.state.version || 1) + 1;
            session.updatedAt = Date.now();
            broadcastToLocalRoom(code, { type: 'room:state', room: session.state }, playerId);
            publishClusterState(session.state);
            publishClusterEvent(code, {
              type: 'room:update_name',
              roomId: code,
              playerId,
              playerName: p.name,
              senderId: SERVER_INSTANCE_ID,
            });
          }
        }
        res.json({ ok: true });
        return;
      }

      if (type === 'room:start') {
        if (session.state.hostId !== playerId) {
          res.status(403).json({ type: 'room:error', message: 'Only the host can start.' });
          return;
        }
        const check = canStartRoomRace(session.state);
        if (!check.allowed) {
          res.status(400).json({
            type: 'room:error',
            message: check.reason || 'Minimum 2 players required.',
          });
          return;
        }
        session.state.status = 'racing';
        session.state.raceStartTime = Date.now();
        session.state.version = (session.state.version || 1) + 1;
        session.telemetry.clear();
        session.updatedAt = Date.now();
        broadcastToLocalRoom(code, { type: 'race:started', room: session.state });
        publishClusterState(session.state);
        publishClusterEvent(code, {
          type: 'room:start',
          roomId: code,
          room: session.state,
          senderId: SERVER_INSTANCE_ID,
        });
        res.json({ type: 'race:started', room: session.state });
        return;
      }

      if (type === 'player:telemetry') {
        const data = msg.telemetry as RemoteCarTelemetry;
        if (data && typeof data.x === 'number' && typeof data.y === 'number') {
          const prev = session.telemetry.get(data.id || playerId);
          if (!prev?.seq || !data.seq || data.seq > prev.seq) {
            session.telemetry.set(data.id || playerId, data);
          }
          const outgoing: RemoteCarTelemetry[] = [data];
          if (Array.isArray(msg.botTelemetry) && session.state.hostId === playerId) {
            for (const bt of msg.botTelemetry as RemoteCarTelemetry[]) {
              if (bt && bt.id) {
                session.telemetry.set(bt.id, bt);
                outgoing.push(bt);
              }
            }
          }
          session.updatedAt = Date.now();
          broadcastToLocalRoom(
            code,
            {
              type: 'room:telemetry',
              cars: outgoing,
            },
            playerId
          );
        }
        res.json({
          type: 'room:telemetry',
          room: session.state,
          cars: Array.from(session.telemetry.values()),
        });
        return;
      }

      if (type === 'room:return_lobby') {
        session.state.status = 'lobby';
        session.state.raceStartTime = null;
        session.state.version = (session.state.version || 1) + 1;
        session.telemetry.clear();
        session.updatedAt = Date.now();
        broadcastToLocalRoom(code, { type: 'room:state', room: session.state });
        publishClusterState(session.state);
        publishClusterEvent(code, {
          type: 'room:return_lobby',
          roomId: code,
          room: session.state,
          senderId: SERVER_INSTANCE_ID,
        });
        res.json({ type: 'room:state', room: session.state });
        return;
      }

      res.status(400).json({ type: 'room:error', message: 'Unknown action.' });
    } catch {
      res.status(500).json({ type: 'room:error', message: 'Server error.' });
    }
  });

  app.get(['/join/:roomId', '/room/:roomId'], (req, res) => {
    const code = sanitizeRoomCode(req.params.roomId);
    res.redirect(`/?room=${code}`);
  });

  // Attach WebSocketServer on dedicated /ws-race path
  const wss = new WebSocketServer({ server, path: '/ws-race' });

  wss.on('connection', (ws: WebSocket) => {
    let boundRoomId: string | null = null;
    let boundPlayerId: string | null = null;

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const type = msg.type as string;

        if (type === 'room:create') {
          const playerId = String(msg.playerId || `p_${Date.now()}`);
          const playerName = String(msg.playerName || 'DRIVER-1');
          const trackId: TrackId =
            msg.trackId === 'harbor_sprint' ? 'harbor_sprint' : 'sunset_gp';

          let code = generateRoomCode();
          while (rooms.has(code) || deletedRoomCodes.has(code)) {
            code = generateRoomCode();
          }

          const state = createRoomState(code, playerId, playerName, trackId, Date.now());
          const session: RoomSession = {
            state,
            clients: new Map([[playerId, ws]]),
            telemetry: new Map(),
            updatedAt: Date.now(),
          };
          rooms.set(code, session);
          boundRoomId = code;
          boundPlayerId = playerId;

          publishClusterState(state);
          ws.send(JSON.stringify({ type: 'room:state', room: state }));
        } else if (type === 'room:join') {
          const code = extractRoomCode(String(msg.roomId || ''));
          const playerId = String(msg.playerId || `p_${Date.now()}`);
          const playerName = String(msg.playerName || 'DRIVER');
          const trackId: TrackId =
            msg.trackId === 'harbor_sprint' ? 'harbor_sprint' : 'sunset_gp';

          if (!code) {
            ws.send(JSON.stringify({ type: 'room:error', message: 'Invalid room code.' }));
            return;
          }

          deletedRoomCodes.delete(code);
          boundRoomId = code;
          boundPlayerId = playerId;

          const result = await joinOrAwaitCrossContainerRoom(
            code,
            playerId,
            playerName,
            trackId,
            ws,
            msg.knownRoom
          );
          if (!result.ok || !result.session) {
            ws.send(
              JSON.stringify({
                type: 'room:error',
                message: result.error || 'Unable to join room.',
              })
            );
            return;
          }

          broadcastToLocalRoom(code, { type: 'room:state', room: result.session.state });
        } else if (type === 'room:sync') {
          const code = extractRoomCode(String(msg.roomId || boundRoomId || ''));
          const playerId = String(msg.playerId || boundPlayerId || '');
          const playerName = String(msg.playerName || 'DRIVER');
          if (!code || !playerId) return;
          if (deletedRoomCodes.has(code)) {
            ws.send(JSON.stringify({ type: 'room:deleted', roomId: code }));
            return;
          }
          boundRoomId = code;
          boundPlayerId = playerId;
          let session = rooms.get(code);
          if (!session && isValidRoomSnapshot(msg.room)) {
            session = {
              state: {
                ...msg.room,
                players: msg.room.players.map((p: MultiplayerPlayerInfo) => ({ ...p })),
              },
              clients: new Map([[playerId, ws]]),
              telemetry: new Map(),
              updatedAt: Date.now(),
            };
            rooms.set(code, session);
          }
          if (!session) return;
          session.clients.set(playerId, ws);
          const prevCount = session.state.players.length;
          const prevHost = session.state.hostId;
          if (isValidRoomSnapshot(msg.room)) {
            session.state = mergeRoomStates(session.state, msg.room);
          }
          joinPlayerToRoom(session.state, playerId, playerName);
          session.updatedAt = Date.now();
          if (
            session.state.players.length !== prevCount ||
            session.state.hostId !== prevHost
          ) {
            broadcastToLocalRoom(code, { type: 'room:state', room: session.state });
            publishClusterState(session.state);
          } else {
            ws.send(JSON.stringify({ type: 'room:state', room: session.state }));
          }
        } else if (type === 'room:configure') {
          const targetRoomId = extractRoomCode(String(msg.roomId || boundRoomId || ''));
          const targetPlayerId = String(msg.playerId || boundPlayerId || '');
          if (!targetRoomId || !targetPlayerId) return;
          const session = rooms.get(targetRoomId);
          if (!session || session.state.hostId !== targetPlayerId) return;

          if (msg.trackId === 'sunset_gp' || msg.trackId === 'harbor_sprint') {
            session.state.trackId = msg.trackId;
          }
          if (typeof msg.botCount === 'number') {
            setRoomBotCount(session.state, msg.botCount);
          }
          if (typeof msg.playerName === 'string' && msg.playerName.trim()) {
            const p = session.state.players.find((pl) => pl.id === targetPlayerId);
            if (p) p.name = msg.playerName.trim().slice(0, 16);
          }

          session.state.version = (session.state.version || 1) + 1;
          session.updatedAt = Date.now();
          broadcastToLocalRoom(targetRoomId, { type: 'room:state', room: session.state });
          publishClusterState(session.state);
        } else if (type === 'room:update_name') {
          const targetRoomId = extractRoomCode(String(msg.roomId || boundRoomId || ''));
          const targetPlayerId = String(msg.playerId || boundPlayerId || '');
          if (!targetRoomId || !targetPlayerId) return;
          const session = rooms.get(targetRoomId);
          if (!session) return;
          const p = session.state.players.find((pl) => pl.id === targetPlayerId);
          if (p && typeof msg.playerName === 'string' && msg.playerName.trim()) {
            const nextClean = msg.playerName.trim().slice(0, 16);
            if (p.name !== nextClean) {
              p.name = nextClean;
              session.state.version = (session.state.version || 1) + 1;
              session.updatedAt = Date.now();
              // Broadcast to peers in the room without echoing stale keystrokes back to sender
              broadcastToLocalRoom(
                targetRoomId,
                { type: 'room:state', room: session.state },
                targetPlayerId
              );
              publishClusterState(session.state);
              publishClusterEvent(targetRoomId, {
                type: 'room:update_name',
                roomId: targetRoomId,
                playerId: targetPlayerId,
                playerName: p.name,
                senderId: SERVER_INSTANCE_ID,
              });
            }
          }
        } else if (type === 'room:start') {
          const targetRoomId = extractRoomCode(String(msg.roomId || boundRoomId || ''));
          const targetPlayerId = String(msg.playerId || boundPlayerId || '');
          if (!targetRoomId || !targetPlayerId) return;
          const session = rooms.get(targetRoomId);
          if (!session || session.state.hostId !== targetPlayerId) return;

          const check = canStartRoomRace(session.state);
          if (!check.allowed) {
            ws.send(
              JSON.stringify({
                type: 'room:error',
                message: check.reason || 'Minimum 2 players required.',
              })
            );
            return;
          }

          session.state.status = 'racing';
          session.state.raceStartTime = Date.now();
          session.state.version = (session.state.version || 1) + 1;
          session.telemetry.clear();
          session.updatedAt = Date.now();

          broadcastToLocalRoom(targetRoomId, {
            type: 'race:started',
            room: session.state,
          });
          publishClusterState(session.state);
          publishClusterEvent(targetRoomId, {
            type: 'room:start',
            roomId: targetRoomId,
            room: session.state,
            senderId: SERVER_INSTANCE_ID,
          });
        } else if (type === 'player:telemetry') {
          const targetRoomId = extractRoomCode(String(msg.roomId || boundRoomId || ''));
          const targetPlayerId = String(msg.playerId || boundPlayerId || '');
          if (!targetRoomId || !targetPlayerId) return;
          const session = rooms.get(targetRoomId);
          if (!session) return;

          const data = msg.telemetry as RemoteCarTelemetry;
          if (data && typeof data.x === 'number' && typeof data.y === 'number') {
            const prev = session.telemetry.get(data.id || targetPlayerId);
            if (!prev?.seq || !data.seq || data.seq > prev.seq) {
              session.telemetry.set(data.id || targetPlayerId, data);
            }
            const outgoing: RemoteCarTelemetry[] = [data];

            if (Array.isArray(msg.botTelemetry) && session.state.hostId === targetPlayerId) {
              for (const bt of msg.botTelemetry as RemoteCarTelemetry[]) {
                if (bt && bt.id) {
                  session.telemetry.set(bt.id, bt);
                  outgoing.push(bt);
                }
              }
            }

            session.updatedAt = Date.now();
            broadcastToLocalRoom(
              targetRoomId,
              {
                type: 'room:telemetry',
                cars: outgoing,
              },
              targetPlayerId
            );
          }
        } else if (type === 'room:return_lobby') {
          const targetRoomId = extractRoomCode(String(msg.roomId || boundRoomId || ''));
          if (!targetRoomId) return;
          const session = rooms.get(targetRoomId);
          if (!session) return;
          session.state.status = 'lobby';
          session.state.raceStartTime = null;
          session.state.version = (session.state.version || 1) + 1;
          session.telemetry.clear();
          session.updatedAt = Date.now();
          broadcastToLocalRoom(targetRoomId, { type: 'room:state', room: session.state });
          publishClusterState(session.state);
          publishClusterEvent(targetRoomId, {
            type: 'room:return_lobby',
            roomId: targetRoomId,
            room: session.state,
            senderId: SERVER_INSTANCE_ID,
          });
        } else if (type === 'room:delete') {
          const targetRoomId = extractRoomCode(String(msg.roomId || boundRoomId || ''));
          if (targetRoomId) {
            deleteRoomSession(targetRoomId, true);
          }
          if (boundRoomId === targetRoomId) {
            boundRoomId = null;
          }
        } else if (type === 'room:delete_all') {
          for (const c of Array.from(rooms.keys())) {
            deleteRoomSession(c, true);
          }
          boundRoomId = null;
        } else if (type === 'room:leave') {
          const targetRoomId = extractRoomCode(String(msg.roomId || boundRoomId || ''));
          const targetPlayerId = String(msg.playerId || boundPlayerId || '');
          if (targetRoomId) {
            const session = rooms.get(targetRoomId);
            publishClusterEvent(targetRoomId, {
              type: 'room:leave',
              roomId: targetRoomId,
              playerId: targetPlayerId,
              senderId: SERVER_INSTANCE_ID,
            });
            if (session) {
              const wasHost = session.state.hostId === targetPlayerId;
              session.clients.delete(targetPlayerId);
              session.telemetry.delete(targetPlayerId);
              const res = removePlayerFromRoom(session.state, targetPlayerId);
              if (res.shouldDeleteRoom || wasHost) {
                deleteRoomSession(targetRoomId, true);
              } else {
                broadcastToLocalRoom(targetRoomId, { type: 'room:state', room: session.state });
                publishClusterState(session.state);
              }
            } else {
              deleteRoomSession(targetRoomId, true);
            }
          }
          boundRoomId = null;
          boundPlayerId = null;
        }
      } catch {
        // Ignore malformed packets
      }
    });

    ws.on('close', () => {
      // Only detach the closed WebSocket reference; do NOT delete the room or kick the Host
      // on transient proxy/tab WebSocket disconnects. Explicit Leave/Delete actions handle cleanup.
      if (boundRoomId && boundPlayerId) {
        const session = rooms.get(boundRoomId);
        if (session && session.clients.get(boundPlayerId) === ws) {
          session.clients.delete(boundPlayerId);
        }
      }
    });
  });

  // Keep WebSocket connections warm across Cloud Run / reverse proxies
  setInterval(() => {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.ping();
      }
    });
  }, 20_000);

  const distPath = path.join(__dirname, 'dist');
  const hasDistIndex = fs.existsSync(path.join(distPath, 'index.html'));

  if (process.env.NODE_ENV !== 'production' || !hasDistIndex) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Apex Overdrive Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
