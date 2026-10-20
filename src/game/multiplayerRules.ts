import {
  CarState,
  MultiplayerPlayerInfo,
  RivalPolicy,
  RoomStatePayload,
  TrackDefinition,
  TrackId,
} from './types';

export const MIN_ROOM_PLAYERS = 2;
export const MAX_ROOM_PLAYERS = 22;
export const MAX_GRID_CARS = 22;

export const CAR_LIVERIES: Array<{ color: string; secondaryColor: string; label: string }> = [
  { color: '#10b981', secondaryColor: '#f8fafc', label: 'Emerald Works' },
  { color: '#ef4444', secondaryColor: '#fecaca', label: 'Crimson Scuderia' },
  { color: '#f59e0b', secondaryColor: '#fde68a', label: 'Papaya McLaren' },
  { color: '#06b6d4', secondaryColor: '#cffafe', label: 'Silver-Cyan AMG' },
  { color: '#3b82f6', secondaryColor: '#dbeafe', label: 'Cobalt Alpine' },
  { color: '#a855f7', secondaryColor: '#f3e8ff', label: 'Violet Phantom' },
  { color: '#ec4899', secondaryColor: '#fce7f3', label: 'Magenta BWT' },
  { color: '#84cc16', secondaryColor: '#ecfccb', label: 'Lime Sauber' },
  { color: '#14b8a6', secondaryColor: '#ccfbf1', label: 'Aston Teal' },
  { color: '#f97316', secondaryColor: '#ffedd5', label: 'Sakhir Sun' },
  { color: '#eab308', secondaryColor: '#fef9c3', label: 'Gold Lotus' },
  { color: '#6366f1', secondaryColor: '#e0e7ff', label: 'Indigo RB' },
  { color: '#22c55e', secondaryColor: '#dcfce7', label: 'Buddh Green' },
  { color: '#f43f5e', secondaryColor: '#ffe4e6', label: 'Haas Crimson' },
  { color: '#0ea5e9', secondaryColor: '#e0f2fe', label: 'Williams Gulf' },
  { color: '#d946ef', secondaryColor: '#fae8ff', label: 'Fuchsia Surge' },
  { color: '#fb923c', secondaryColor: '#ffedd5', label: 'Copper Force' },
  { color: '#38bdf8', secondaryColor: '#bae6fd', label: 'Aero Sky' },
  { color: '#4ade80', secondaryColor: '#bbf7d0', label: 'Neon Mint' },
  { color: '#facc15', secondaryColor: '#fef08a', label: 'Renault Yellow' },
  { color: '#c084fc', secondaryColor: '#f3e8ff', label: 'Ultraviolet GT' },
  { color: '#94a3b8', secondaryColor: '#f8fafc', label: 'Titanium Arrows' },
];

export const BOT_CALLSIGNS: Array<{ name: string; policy: RivalPolicy }> = [
  { name: 'VEX-7 [BOT]', policy: 'apex' },
  { name: 'KRONOS [BOT]', policy: 'blocker' },
  { name: 'VOLT-9 [BOT]', policy: 'sprinter' },
  { name: 'NOVA-4 [BOT]', policy: 'apex' },
  { name: 'TITAN-2 [BOT]', policy: 'blocker' },
  { name: 'PULSE-8 [BOT]', policy: 'sprinter' },
  { name: 'ZERO-5 [BOT]', policy: 'apex' },
  { name: 'SAKHI-1 [BOT]', policy: 'sprinter' },
  { name: 'BUDDH-3 [BOT]', policy: 'apex' },
  { name: 'VALKYRIE [BOT]', policy: 'blocker' },
  { name: 'ORION-11 [BOT]', policy: 'sprinter' },
  { name: 'SOLARIS [BOT]', policy: 'apex' },
  { name: 'SPECTRE [BOT]', policy: 'blocker' },
  { name: 'VORTEX [BOT]', policy: 'sprinter' },
  { name: 'FALCON-6 [BOT]', policy: 'apex' },
  { name: 'ECLIPSE [BOT]', policy: 'blocker' },
  { name: 'ZENITH [BOT]', policy: 'sprinter' },
  { name: 'PHANTOM [BOT]', policy: 'apex' },
  { name: 'TEMPEST [BOT]', policy: 'blocker' },
  { name: 'ASTRAL [BOT]', policy: 'sprinter' },
  { name: 'OMEGA-22 [BOT]', policy: 'apex' },
];

export function sanitizeRoomCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

/**
 * Extracts a 6-character room code from either a raw code ("AB12CD")
 * or a full invite URL ("https://.../?room=AB12CD" or "#room=AB12CD").
 */
export function extractRoomCode(raw: string): string {
  const trimmed = (raw || '').trim();
  const urlMatch = trimmed.match(/[?&#]room=([A-Za-z0-9]{3,8})/i);
  if (urlMatch && urlMatch[1]) {
    return sanitizeRoomCode(urlMatch[1]);
  }
  return sanitizeRoomCode(trimmed);
}

/**
 * Converts AI Studio private developer origins (https://ais-dev-*)
 * to the public shared preview origin (https://ais-pre-*) so friends
 * do not hit Google's 404 "Page not found" error on private dev links.
 */
export function getPublicShareOrigin(origin: string): string {
  const cleaned = (origin || '').trim().replace(/\/+$/, '');
  return cleaned.replace(/^https:\/\/ais-dev-/i, 'https://ais-pre-');
}

export function buildShareInviteUrl(
  origin: string,
  pathname: string,
  roomId: string
): string {
  const publicOrigin = getPublicShareOrigin(origin);
  const cleanPath = pathname && pathname.startsWith('/') ? pathname : '/';
  const code = sanitizeRoomCode(roomId);
  return `${publicOrigin}${cleanPath}?room=${code}`;
}

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function createRoomState(
  roomId: string,
  hostId: string,
  hostName: string,
  trackId: TrackId = 'sunset_gp',
  createdAt: number = Date.now()
): RoomStatePayload {
  const livery = CAR_LIVERIES[0];
  return {
    roomId: sanitizeRoomCode(roomId) || 'APEX01',
    hostId,
    trackId,
    status: 'lobby',
    minPlayers: MIN_ROOM_PLAYERS,
    maxPlayers: MAX_ROOM_PLAYERS,
    raceStartTime: null,
    createdAt,
    version: 1,
    players: [
      {
        id: hostId,
        name: (hostName || 'DRIVER-1').trim().slice(0, 16),
        color: livery.color,
        secondaryColor: livery.secondaryColor,
        slotIndex: 0,
        isHost: true,
        isBot: false,
        ready: true,
      },
    ],
  };
}

export function reassignSlotsAndColors(room: RoomStatePayload): void {
  room.players.forEach((p, idx) => {
    const livery = CAR_LIVERIES[idx % CAR_LIVERIES.length];
    p.slotIndex = idx;
    p.color = livery.color;
    p.secondaryColor = livery.secondaryColor;
    p.isHost = p.id === room.hostId;
  });
}

export function joinPlayerToRoom(
  room: RoomStatePayload,
  playerId: string,
  playerName: string
): { ok: boolean; error?: string; room: RoomStatePayload } {
  // Idempotency: if player already in room, update name and return ok
  const existing = room.players.find((p) => p.id === playerId);
  if (existing) {
    if (playerName.trim() && existing.name !== playerName.trim().slice(0, 16)) {
      existing.name = playerName.trim().slice(0, 16);
      room.version = (room.version || 1) + 1;
    }
    return { ok: true, room };
  }

  // If room has bots and a human joins while at max slots, replace a bot so human friends can join!
  const humanPlayers = room.players.filter((p) => !p.isBot);
  if (humanPlayers.length >= MAX_ROOM_PLAYERS) {
    return {
      ok: false,
      error: `Room is full (maximum ${MAX_ROOM_PLAYERS} cars on grid).`,
      room,
    };
  }

  if (room.players.length >= MAX_ROOM_PLAYERS) {
    const botIdx = room.players.findIndex((p) => p.isBot);
    if (botIdx !== -1) {
      room.players.splice(botIdx, 1);
    } else {
      return {
        ok: false,
        error: `Room is full (maximum ${MAX_ROOM_PLAYERS} cars on grid).`,
        room,
      };
    }
  }

  const nextSlot = room.players.length;
  const livery = CAR_LIVERIES[nextSlot % CAR_LIVERIES.length];

  // Insert human before any bots
  const firstBotIdx = room.players.findIndex((p) => p.isBot);
  const newPlayer: MultiplayerPlayerInfo = {
    id: playerId,
    name: (playerName || `DRIVER-${nextSlot + 1}`).trim().slice(0, 16),
    color: livery.color,
    secondaryColor: livery.secondaryColor,
    slotIndex: nextSlot,
    isHost: false,
    isBot: false,
    ready: true,
  };

  if (firstBotIdx === -1) {
    room.players.push(newPlayer);
  } else {
    room.players.splice(firstBotIdx, 0, newPlayer);
  }

  reassignSlotsAndColors(room);
  room.version = (room.version || 1) + 1;
  return { ok: true, room };
}

export function removePlayerFromRoom(
  room: RoomStatePayload,
  playerId: string
): { shouldDeleteRoom: boolean; room: RoomStatePayload } {
  room.players = room.players.filter((p) => p.id !== playerId);
  const remainingHumans = room.players.filter((p) => !p.isBot);

  if (remainingHumans.length === 0) {
    return { shouldDeleteRoom: true, room };
  }

  if (room.hostId === playerId) {
    room.hostId = remainingHumans[0].id;
  }

  reassignSlotsAndColors(room);
  room.version = (room.version || 1) + 1;
  return { shouldDeleteRoom: false, room };
}

export function setRoomBotCount(
  room: RoomStatePayload,
  desiredBotCount: number
): RoomStatePayload {
  const humans = room.players.filter((p) => !p.isBot);
  const maxAllowedBots = Math.max(0, MAX_ROOM_PLAYERS - humans.length);
  const clampedBots = Math.max(0, Math.min(maxAllowedBots, Math.round(desiredBotCount)));

  const bots: MultiplayerPlayerInfo[] = [];
  for (let i = 0; i < clampedBots; i++) {
    const spec = BOT_CALLSIGNS[i % BOT_CALLSIGNS.length];
    bots.push({
      id: `bot_${i + 1}`,
      name: spec.name,
      color: '#ef4444',
      secondaryColor: '#fecaca',
      slotIndex: humans.length + i,
      isHost: false,
      isBot: true,
      policy: spec.policy,
      ready: true,
    });
  }

  room.players = [...humans, ...bots];
  reassignSlotsAndColors(room);
  room.version = (room.version || 1) + 1;
  return room;
}

/**
 * Reconciles two RoomStatePayload snapshots for the same roomId across distributed
 * containers (e.g., ais-dev and ais-pre). The earliest-created room retains hostId,
 * while any new human players from either snapshot are merged into the grid.
 */
export function mergeRoomStates(
  stateA: RoomStatePayload,
  stateB: RoomStatePayload
): RoomStatePayload {
  const verA = stateA.version || 1;
  const verB = stateB.version || 1;

  // Case 1: Same host room — higher version is authoritative for existing player names, bots, and track,
  // while any newly joined human players from either snapshot are always preserved in the grid.
  if (stateA.hostId === stateB.hostId) {
    const [latest, stale] = verB >= verA ? [stateB, stateA] : [stateA, stateB];
    const merged: RoomStatePayload = {
      ...latest,
      createdAt: Math.min(
        stateA.createdAt ?? Number.MAX_SAFE_INTEGER,
        stateB.createdAt ?? Number.MAX_SAFE_INTEGER
      ),
      maxPlayers: MAX_ROOM_PLAYERS,
      players: latest.players.map((p) => ({ ...p })),
      version: Math.max(verA, verB),
    };

    if (stale.status === 'racing' && merged.status !== 'racing') {
      merged.status = 'racing';
      merged.raceStartTime = stale.raceStartTime;
    }

    // Always merge any human player who joined in `stale` and is not yet in `merged`.
    // Because we check `!merged.players.some(ep => ep.id === p.id)`, existing player names
    // in `latest` are never overwritten by stale snapshots.
    for (const p of stale.players) {
      if (!p.isBot && !merged.players.some((ep) => ep.id === p.id)) {
        const prevVersion = merged.version;
        joinPlayerToRoom(merged, p.id, p.name);
        merged.version = prevVersion;
      }
    }

    reassignSlotsAndColors(merged);
    return merged;
  }

  // Case 2: Cross-container provisional host reconciliation (earliest createdAt is true Host)
  const timeA = stateA.createdAt ?? Number.MAX_SAFE_INTEGER;
  const timeB = stateB.createdAt ?? Number.MAX_SAFE_INTEGER;
  const [trueHostState, provisionalState] =
    timeA <= timeB ? [stateA, stateB] : [stateB, stateA];

  const merged: RoomStatePayload = {
    ...trueHostState,
    maxPlayers: MAX_ROOM_PLAYERS,
    players: trueHostState.players.map((p) => ({ ...p })),
    version: Math.max(verA, verB),
  };

  if (provisionalState.status === 'racing' && merged.status !== 'racing') {
    merged.status = 'racing';
    merged.raceStartTime = provisionalState.raceStartTime;
  }

  // Add human players from provisionalState who are not yet in trueHostState
  for (const p of provisionalState.players) {
    if (!p.isBot && !merged.players.some((ep) => ep.id === p.id)) {
      joinPlayerToRoom(merged, p.id, p.name);
    }
  }

  const hostBotCount = trueHostState.players.filter((p) => p.isBot).length;
  const provBotCount = provisionalState.players.filter((p) => p.isBot).length;
  const targetBots = Math.max(hostBotCount, provBotCount);

  if (targetBots > 0 || merged.players.some((p) => p.isBot)) {
    const prevVersion = merged.version;
    setRoomBotCount(merged, targetBots);
    merged.version = prevVersion;
  }

  reassignSlotsAndColors(merged);
  return merged;
}

export function canStartRoomRace(room: RoomStatePayload): {
  allowed: boolean;
  reason?: string;
} {
  const count = room.players.length;
  if (count < MIN_ROOM_PLAYERS) {
    return {
      allowed: false,
      reason: `Minimum ${MIN_ROOM_PLAYERS} racers required to start (currently ${count}/${MAX_ROOM_PLAYERS}). Share the invite link or add F1 AI grid cars.`,
    };
  }
  if (count > MAX_ROOM_PLAYERS) {
    return {
      allowed: false,
      reason: `Maximum ${MAX_ROOM_PLAYERS} cars allowed on the F1 grid.`,
    };
  }
  return { allowed: true };
}

/**
 * Spawns 2 to 22 cars in an 11-row × 2-column staggered Formula 1 starting grid
 * along the wide pit straightaway facing clear road ahead.
 */
export function createMultiplayerCars(
  track: TrackDefinition,
  players: MultiplayerPlayerInfo[],
  localPlayerId: string
): CarState[] {
  const startSample = track.samples[0];
  const baseAngle = Math.atan2(startSample.ty, startSample.tx);

  // Spread lateral lane targets across the wide 264-unit F1 track
  const laneSpreadFactors = [-0.34, 0.34, -0.2, 0.2, -0.08, 0.08, -0.28, 0.28];

  return players.slice(0, MAX_ROOM_PLAYERS).map((p, idx) => {
    const row = Math.floor(idx / 2); // 0..10 (11 rows for 22 cars)
    const col = idx % 2; // 0 = left F1 grid box, 1 = right F1 grid box
    const backOffset = -row * 54 - col * 22;
    const lateralOffset = col === 0 ? -48 : 48;

    const x =
      startSample.x +
      startSample.tx * backOffset +
      startSample.nx * lateralOffset;
    const y =
      startSample.y +
      startSample.ty * backOffset +
      startSample.ny * lateralOffset;

    const initialLaneTarget =
      track.roadWidth * laneSpreadFactors[idx % laneSpreadFactors.length];

    return {
      id: p.id,
      name: p.name,
      isPlayer: p.id === localPlayerId,
      color: p.color,
      secondaryColor: p.secondaryColor,
      policy: p.isBot ? p.policy || 'apex' : undefined,
      x,
      y,
      vx: 0,
      vy: 0,
      angle: baseAngle,
      angularVelocity: 0,
      speed: 0,
      steerAngle: 0,
      overdriveStage: 1,
      overdriveCharge: 0,
      speedRampBonus: 0,
      nitroFuel: 75,
      isBoosting: false,
      boostPadTimer: 0,
      oilSlipTimer: 0,
      hitFlashTimer: 0,
      aiTargetOffset: initialLaneTarget,
      surgeWindupTimer: 0,
      surgeActiveTimer: 0,
      surgeCooldownTimer: 2.5 + (idx % 5) * 0.7,
      lap: 1,
      nextCheckpointIdx: 1,
      checkpointsPassedInLap: 0,
      trackProgress: 0,
      totalRaceProgress: 1,
      currentLapTime: 0,
      bestLapTime: null,
      totalRaceTime: 0,
      finished: false,
      finishPosition: idx + 1,
      peakSpeedKmh: 0,
      isDrifting: false,
      isOffTrack: false,
    };
  });
}
