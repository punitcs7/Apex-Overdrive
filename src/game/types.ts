export type GameState = 'title' | 'lobby' | 'playing' | 'paused' | 'gameover';

export type TrackId = 'sunset_gp' | 'harbor_sprint';

export type RivalPolicy = 'apex' | 'blocker' | 'sprinter';

export interface MultiplayerPlayerInfo {
  id: string;
  name: string;
  color: string;
  secondaryColor: string;
  slotIndex: number; // 0..7
  isHost: boolean;
  isBot: boolean;
  policy?: RivalPolicy;
  ready: boolean;
}

export interface RemoteCarTelemetry {
  id: string;
  name: string;
  seq?: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  speed: number;
  steerAngle: number;
  throttle?: number;
  brake?: number;
  steer?: number;
  boostHeld?: boolean;
  overdriveStage: number;
  isBoosting: boolean;
  isDrifting: boolean;
  lap: number;
  totalRaceProgress: number;
  finished: boolean;
  finishPosition: number;
  totalRaceTime: number;
  bestLapTime: number | null;
  peakSpeedKmh: number;
}

export interface RoomStatePayload {
  roomId: string;
  hostId: string;
  trackId: TrackId;
  status: 'lobby' | 'racing' | 'finished';
  players: MultiplayerPlayerInfo[];
  minPlayers: number;
  maxPlayers: number;
  raceStartTime: number | null;
  createdAt?: number;
  version?: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface BoostPad {
  id: string;
  x: number;
  y: number;
  angle: number;
  length: number;
  width: number;
}

export interface HazardZone {
  id: string;
  x: number;
  y: number;
  radius: number;
  type: 'oil_slick';
}

export interface TrackSample {
  x: number;
  y: number;
  tx: number; // unit tangent x
  ty: number; // unit tangent y
  nx: number; // unit normal x
  ny: number; // unit normal y
  dist: number; // cumulative distance along loop
  curvature: number; // signed curvature
}

export interface CircuitMapsPlaceLink {
  title: string;
  uri: string;
  reviewSnippets?: string[];
}

export interface CircuitMapsIntel {
  trackId: TrackId;
  summaryMarkdown: string;
  places: CircuitMapsPlaceLink[];
}

export interface TrackDefinition {
  id: TrackId;
  name: string;
  realCircuitName: string;
  locationName: string;
  circuitLengthKm: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  subtitle: string;
  difficultyLabel: string;
  totalLaps: number;
  roadWidth: number;
  arenaWidth: number;
  arenaHeight: number;
  theme: {
    grassOuter: string;
    grassInner: string;
    asphalt: string;
    asphaltEdge: string;
    curbPrimary: string;
    curbSecondary: string;
    accentColor: string;
  };
  controlPoints: Vec2[];
  samples: TrackSample[];
  totalLength: number;
  checkpointIndices: number[]; // indices into samples
  boostPads: BoostPad[];
  hazards: HazardZone[];
}

export interface CarInput {
  throttle: number; // 0..1 (W / Up)
  brake: number; // 0..1 (S / Down)
  steer: number; // -1..1 (A/Left = -1, D/Right = +1)
  boostHeld: boolean; // Space / Shift held
  boostJustPressed: boolean;
}

export interface CarState {
  id: string;
  name: string;
  isPlayer: boolean;
  color: string;
  secondaryColor: string;
  policy?: RivalPolicy;

  // Spatial physics
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number; // radians
  angularVelocity: number;
  speed: number; // signed forward speed (world units / sec)
  steerAngle: number; // visual wheel steer angle

  // Increasing Speed Mechanic (Overdrive System)
  overdriveStage: number; // 1 to 5
  overdriveCharge: number; // 0 to 100 (fills to level up stage)
  speedRampBonus: number; // 0 to 110 world units/sec continuous straight-line momentum bonus
  nitroFuel: number; // 0 to 100 (consumed by Space boost)
  isBoosting: boolean;
  boostPadTimer: number; // remaining seconds of boost pad surge
  oilSlipTimer: number; // remaining seconds of reduced grip on oil slick
  hitFlashTimer: number; // visual white flash on heavy bump

  // Rival AI state
  aiTargetOffset: number; // lateral offset from track centerline
  surgeWindupTimer: number; // >0 when sprinter is winding up boost telegraph
  surgeActiveTimer: number; // >0 when sprinter is surging
  surgeCooldownTimer: number;

  // Lap & Checkpoint progression
  lap: number; // 1..totalLaps (completed when > totalLaps)
  nextCheckpointIdx: number; // 0..checkpointIndices.length - 1
  checkpointsPassedInLap: number;
  trackProgress: number; // 0..1 along current lap spline
  totalRaceProgress: number; // lap + trackProgress for live standings
  currentLapTime: number;
  bestLapTime: number | null;
  totalRaceTime: number;
  finished: boolean;
  finishPosition: number;
  peakSpeedKmh: number;
  isDrifting: boolean;
   isOffTrack: boolean;
}

export interface HudTelemetry {
  speedKmh: number;
  topSpeedCapKmh: number;
  overdriveStage: number;
  overdriveCharge: number; // 0..100
  speedRampPct: number; // 0..100
  nitroFuel: number; // 0..100
  lap: number;
  totalLaps: number;
  position: number;
  totalCars: number;
  currentLapTimeMs: number;
  bestLapTimeMs: number | null;
  totalTimeMs: number;
  peakSpeedKmh: number;
  isBoosting: boolean;
  isDrifting: boolean;
  isOffTrack: boolean;
  statusBanner: string | null;
  minimapCars: Array<{
    id: string;
    x: number;
    y: number;
    color: string;
    isPlayer: boolean;
  }>;
}

export interface RunSnapshot {
  trackName: string;
  finishPosition: number;
  totalCars: number;
  totalTimeMs: number;
  bestLapTimeMs: number | null;
  peakSpeedKmh: number;
  maxOverdriveStage: number;
  completedAllLaps: boolean;
}
