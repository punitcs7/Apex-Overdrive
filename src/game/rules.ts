import { getClosestTrackSample } from './tracks';
import {
  CarInput,
  CarState,
  RivalPolicy,
  TrackDefinition,
} from './types';

export const MAX_OVERDRIVE_STAGE = 5;

/**
 * World-units to KM/H display conversion factor.
 * At Stage 1 base speed (370 u/s) -> 185 KM/H.
 * At Stage 5 + Speed Ramp + Boost -> up to 360+ KM/H!
 */
export const SPEED_TO_KMH = 0.5;

export interface OverdriveStageParams {
  stage: number;
  baseTopSpeed: number; // world units / sec
  maxSpeedRampBonus: number; // extra top speed earned by sustained driving
  acceleration: number; // world units / sec^2
  turnRate: number; // rad / sec
  label: string;
}

export const OVERDRIVE_STAGES: Record<number, OverdriveStageParams> = {
  1: {
    stage: 1,
    baseTopSpeed: 370, // 185 KM/H
    maxSpeedRampBonus: 50, // up to 210 KM/H sustained
    acceleration: 290,
    turnRate: 3.15,
    label: 'STAGE 1 · STREET SPEC',
  },
  2: {
    stage: 2,
    baseTopSpeed: 420, // 210 KM/H
    maxSpeedRampBonus: 65, // up to 242 KM/H
    acceleration: 335,
    turnRate: 3.25,
    label: 'STAGE 2 · TUNED SPORT',
  },
  3: {
    stage: 3,
    baseTopSpeed: 470, // 235 KM/H
    maxSpeedRampBonus: 80, // up to 275 KM/H
    acceleration: 380,
    turnRate: 3.35,
    label: 'STAGE 3 · GT TURBO',
  },
  4: {
    stage: 4,
    baseTopSpeed: 525, // 262 KM/H
    maxSpeedRampBonus: 95, // up to 310 KM/H
    acceleration: 430,
    turnRate: 3.45,
    label: 'STAGE 4 · PROTOTYPE',
  },
  5: {
    stage: 5,
    baseTopSpeed: 580, // 290 KM/H
    maxSpeedRampBonus: 120, // up to 350 KM/H (+ Nitro reaches 410 KM/H)
    acceleration: 485,
    turnRate: 3.55,
    label: 'STAGE 5 · MAX OVERDRIVE',
  },
};

export function getOverdriveParams(stage: number): OverdriveStageParams {
  const clamped = Math.max(1, Math.min(MAX_OVERDRIVE_STAGE, Math.round(stage)));
  return OVERDRIVE_STAGES[clamped];
}

export function calculateEffectiveTopSpeed(car: Pick<
  CarState,
  'overdriveStage' | 'speedRampBonus' | 'isBoosting' | 'boostPadTimer' | 'isOffTrack'
>): number {
  const params = getOverdriveParams(car.overdriveStage);
  let topSpeed = params.baseTopSpeed + car.speedRampBonus;

  if (car.isBoosting) {
    topSpeed += 110;
  }
  if (car.boostPadTimer > 0) {
    topSpeed += 130;
  }

  return topSpeed;
}

export interface StepCarEvents {
  leveledUpOverdrive: boolean;
  newOverdriveStage: number;
  hitBoostPad: boolean;
  hitOilSlick: boolean;
  hitBarrierHard: boolean;
  checkpointCleared: boolean;
  lapCompleted: boolean;
  raceFinished: boolean;
}

export const DEFAULT_SOLO_GRID_CARS = 22;

const SOLO_F1_RIVALS: Array<{
  id: string;
  name: string;
  color: string;
  secondaryColor: string;
  policy: RivalPolicy;
}> = [
  { id: 'rival_apex', name: 'VEX-7 (APEX)', color: '#ef4444', secondaryColor: '#fecaca', policy: 'apex' },
  { id: 'rival_blocker', name: 'KRONOS (DEFEND)', color: '#f59e0b', secondaryColor: '#fde68a', policy: 'blocker' },
  { id: 'rival_sprinter', name: 'VOLT-9 (SURGE)', color: '#06b6d4', secondaryColor: '#cffafe', policy: 'sprinter' },
  { id: 'rival_4', name: 'NOVA-4 (SCUDERIA)', color: '#3b82f6', secondaryColor: '#dbeafe', policy: 'apex' },
  { id: 'rival_5', name: 'TITAN-2 (AERO)', color: '#a855f7', secondaryColor: '#f3e8ff', policy: 'blocker' },
  { id: 'rival_6', name: 'PULSE-8 (DRS)', color: '#ec4899', secondaryColor: '#fce7f3', policy: 'sprinter' },
  { id: 'rival_7', name: 'ZERO-5 (WORKS)', color: '#84cc16', secondaryColor: '#ecfccb', policy: 'apex' },
  { id: 'rival_8', name: 'SAKHIR-8 (GP)', color: '#14b8a6', secondaryColor: '#ccfbf1', policy: 'sprinter' },
  { id: 'rival_9', name: 'BUDDH-9 (FORCE)', color: '#f97316', secondaryColor: '#ffedd5', policy: 'apex' },
  { id: 'rival_10', name: 'VALKYRIE (GT)', color: '#eab308', secondaryColor: '#fef9c3', policy: 'blocker' },
  { id: 'rival_11', name: 'ORION-11 (TURBO)', color: '#6366f1', secondaryColor: '#e0e7ff', policy: 'sprinter' },
  { id: 'rival_12', name: 'SOLARIS (APEX)', color: '#22c55e', secondaryColor: '#dcfce7', policy: 'apex' },
  { id: 'rival_13', name: 'SPECTRE (GUARD)', color: '#f43f5e', secondaryColor: '#ffe4e6', policy: 'blocker' },
  { id: 'rival_14', name: 'VORTEX (SURGE)', color: '#0ea5e9', secondaryColor: '#e0f2fe', policy: 'sprinter' },
  { id: 'rival_15', name: 'FALCON-15 (PRO)', color: '#d946ef', secondaryColor: '#fae8ff', policy: 'apex' },
  { id: 'rival_16', name: 'ECLIPSE (LINE)', color: '#fb923c', secondaryColor: '#ffedd5', policy: 'blocker' },
  { id: 'rival_17', name: 'ZENITH (BOOST)', color: '#38bdf8', secondaryColor: '#bae6fd', policy: 'sprinter' },
  { id: 'rival_18', name: 'PHANTOM (F1)', color: '#4ade80', secondaryColor: '#bbf7d0', policy: 'apex' },
  { id: 'rival_19', name: 'TEMPEST (DEF)', color: '#facc15', secondaryColor: '#fef08a', policy: 'blocker' },
  { id: 'rival_20', name: 'ASTRAL (NITRO)', color: '#c084fc', secondaryColor: '#f3e8ff', policy: 'sprinter' },
  { id: 'rival_21', name: 'OMEGA-22 (APEX)', color: '#94a3b8', secondaryColor: '#f8fafc', policy: 'apex' },
];

export function createInitialCars(
  track: TrackDefinition,
  totalCars: number = DEFAULT_SOLO_GRID_CARS
): CarState[] {
  const startSampleIdx = 0;
  const startSample = track.samples[startSampleIdx];
  const baseAngle = Math.atan2(startSample.ty, startSample.tx);
  const clampedCount = Math.max(2, Math.min(22, totalCars));

  // Spread lateral lane targets across the wide 264-unit F1 track so 22 cars race multi-wide
  const laneSpreadFactors = [-0.34, 0.34, -0.21, 0.21, -0.09, 0.09, -0.28, 0.28];

  const cars: CarState[] = [];
  for (let idx = 0; idx < clampedCount; idx++) {
    const isPlayer = idx === 0;
    const rivalSpec = !isPlayer ? SOLO_F1_RIVALS[(idx - 1) % SOLO_F1_RIVALS.length] : null;

    // 11 rows x 2 columns staggered Formula 1 starting grid along the flat pit straightaway
    const row = Math.floor(idx / 2); // 0..10
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

    const initialLaneOffset =
      track.roadWidth * laneSpreadFactors[idx % laneSpreadFactors.length];

    cars.push({
      id: isPlayer ? 'player' : rivalSpec!.id,
      name: isPlayer ? 'YOU (APEX-01)' : rivalSpec!.name,
      isPlayer,
      color: isPlayer ? '#10b981' : rivalSpec!.color,
      secondaryColor: isPlayer ? '#f8fafc' : rivalSpec!.secondaryColor,
      policy: isPlayer ? undefined : rivalSpec!.policy,
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
      aiTargetOffset: initialLaneOffset,
      surgeWindupTimer: 0,
      surgeActiveTimer: 0,
      surgeCooldownTimer: 2.5 + (idx % 6) * 0.65,
      lap: 1,
      nextCheckpointIdx: 1,
      checkpointsPassedInLap: 0,
      trackProgress: 0,
      totalRaceProgress: 1 - idx * 0.0005,
      currentLapTime: 0,
      bestLapTime: null,
      totalRaceTime: 0,
      finished: false,
      finishPosition: idx + 1,
      peakSpeedKmh: 0,
      isDrifting: false,
      isOffTrack: false,
    });
  }

  return cars;
}

/**
 * Advances the Increasing Speed Mechanic (Overdrive Stage + Continuous Speed Ramp)
 * for a car during active gameplay.
 */
export function updateOverdriveState(
  car: CarState,
  input: CarInput,
  dt: number
): { leveledUp: boolean; newStage: number } {
  const params = getOverdriveParams(car.overdriveStage);
  let leveledUp = false;

  // 1. Continuous Speed-Ramp Bonus: holding throttle steadily builds extra top speed
  const speedRatio = Math.min(1.2, Math.abs(car.speed) / params.baseTopSpeed);
  if (input.throttle > 0 && car.speed > 100) {
    const rampRate = 22 + car.overdriveStage * 4.5; // units/sec^2 of top speed expansion
    car.speedRampBonus = Math.min(
      params.maxSpeedRampBonus,
      car.speedRampBonus + rampRate * dt
    );
  } else {
    const decayRate = car.isOffTrack ? 24 : 12;
    car.speedRampBonus = Math.max(0, car.speedRampBonus - decayRate * dt);
  }

  // 2. Overdrive Charge Meter: driving above 35% base speed fills the Overdrive bar
  if (car.overdriveStage < MAX_OVERDRIVE_STAGE && speedRatio > 0.35) {
    const chargeGainRate =
      (20 + speedRatio * 22) * (car.isDrifting ? 1.35 : 1.0) * (car.isBoosting ? 1.5 : 1.0);
    car.overdriveCharge += chargeGainRate * dt;

    if (car.overdriveCharge >= 100) {
      car.overdriveStage = Math.min(MAX_OVERDRIVE_STAGE, car.overdriveStage + 1);
      car.overdriveCharge =
        car.overdriveStage >= MAX_OVERDRIVE_STAGE ? 100 : car.overdriveCharge - 100;
      car.nitroFuel = Math.min(100, car.nitroFuel + 30);
      leveledUp = true;
    }
  } else if (car.overdriveStage >= MAX_OVERDRIVE_STAGE) {
    car.overdriveCharge = 100;
  }

  return { leveledUp, newStage: car.overdriveStage };
}

/**
 * Steps a single car's 2D arcade physics, drift grip, increasing speed mechanics,
 * track collisions, boost pads, and lap/checkpoint progression.
 */
export function stepCarPhysics(
  car: CarState,
  input: CarInput,
  track: TrackDefinition,
  rawDt: number
): StepCarEvents {
  const dt = Math.min(Math.max(rawDt, 0), 0.05);

  const events: StepCarEvents = {
    leveledUpOverdrive: false,
    newOverdriveStage: car.overdriveStage,
    hitBoostPad: false,
    hitOilSlick: false,
    hitBarrierHard: false,
    checkpointCleared: false,
    lapCompleted: false,
    raceFinished: false,
  };

  if (dt <= 0) return events;

  // Tick timers
  if (car.boostPadTimer > 0) car.boostPadTimer = Math.max(0, car.boostPadTimer - dt);
  if (car.oilSlipTimer > 0) car.oilSlipTimer = Math.max(0, car.oilSlipTimer - dt);
  if (car.hitFlashTimer > 0) car.hitFlashTimer = Math.max(0, car.hitFlashTimer - dt);

  if (!car.finished) {
    car.currentLapTime += dt;
    car.totalRaceTime += dt;
  }

  // Handle Nitro Boost activation & fuel drain/recharge
  if (input.boostHeld && car.nitroFuel > 2) {
    car.isBoosting = true;
    car.nitroFuel = Math.max(0, car.nitroFuel - 32 * dt);
  } else {
    car.isBoosting = false;
    // Passive recharge from high-speed driving & drifting
    const passiveRecharge = (Math.abs(car.speed) > 140 ? 9.0 : 4.5) + (car.isDrifting ? 10 : 0);
    car.nitroFuel = Math.min(100, car.nitroFuel + passiveRecharge * dt);
  }

  // Update Increasing Speed Mechanic (Overdrive Stage + Speed Ramp)
  const odResult = updateOverdriveState(car, input, dt);
  if (odResult.leveledUp) {
    events.leveledUpOverdrive = true;
    events.newOverdriveStage = odResult.newStage;
  }

  const params = getOverdriveParams(car.overdriveStage);
  const effectiveTopSpeed = calculateEffectiveTopSpeed(car);

  // Forward unit vector & Right normal unit vector
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  const rx = -fy;
  const ry = fx;

  // Decompose current world velocity into forward and lateral components
  let vForward = car.vx * fx + car.vy * fy;
  let vLateral = car.vx * rx + car.vy * ry;

  // Steering authority scales nicely with movement speed
  const speedMag = Math.hypot(car.vx, car.vy);
  const steerFactor =
    speedMag < 10 ? 0 : Math.min(1, 0.42 + (speedMag / 200) * 0.58);
  const reverseSign = vForward < -10 ? -1 : 1;
  const oilSteerPenalty = car.oilSlipTimer > 0 ? 1.2 : 1.0;

  car.steerAngle = input.steer * 0.48;
  car.angularVelocity =
    input.steer * params.turnRate * steerFactor * reverseSign * oilSteerPenalty;
  car.angle += car.angularVelocity * dt;

  // Recompute forward/right vectors after rotation
  let nfx = Math.cos(car.angle);
  let nfy = Math.sin(car.angle);
  const nrx = -nfy;
  const nry = nfx;

  // Throttle & Brake forces
  let accelForce = 0;
  if (input.throttle > 0) {
    accelForce += input.throttle * params.acceleration;
  }
  if (car.isBoosting) {
    accelForce += 250;
  }
  if (car.boostPadTimer > 0) {
    accelForce += 290;
  }

  if (input.brake > 0) {
    if (vForward > 25) {
      // Strong disc braking
      accelForce -= input.brake * 560;
    } else {
      // Reverse gear
      accelForce -= input.brake * 220;
    }
  }

  vForward += accelForce * dt;

  // Natural rolling resistance / aerodynamic drag
  if (input.throttle === 0 && input.brake === 0 && !car.isBoosting && car.boostPadTimer <= 0) {
    vForward *= Math.exp(-1.5 * dt);
  }

  // Clamp forward speed to effective top speed (smoothly decelerate if over cap)
  if (vForward > effectiveTopSpeed) {
    vForward = effectiveTopSpeed + (vForward - effectiveTopSpeed) * Math.exp(-4.5 * dt);
  }
  const maxReverseSpeed = -145;
  if (vForward < maxReverseSpeed) {
    vForward = maxReverseSpeed;
  }

  // Lateral tire grip (arcade drift model: turning hard at speed allows controlled sideways slip)
  const isTurningHard = Math.abs(input.steer) > 0.4 && vForward > 210;
  const lateralGripRate =
    car.oilSlipTimer > 0
      ? 2.4
      : isTurningHard
        ? 6.6
        : 11.2;
  vLateral *= Math.exp(-lateralGripRate * dt);

  car.isDrifting = Math.abs(vLateral) > 40 && vForward > 170;

  // Reconstruct world velocity and advance position
  car.vx = nfx * vForward + nrx * vLateral;
  car.vy = nfy * vForward + nry * vLateral;
  car.x += car.vx * dt;
  car.y += car.vy * dt;
  car.speed = vForward;

  const currentKmh = Math.round(Math.max(0, car.speed) * SPEED_TO_KMH);
  if (currentKmh > car.peakSpeedKmh) {
    car.peakSpeedKmh = currentKmh;
  }

  // Check Boost Pads
  for (const pad of track.boostPads) {
    const dist = Math.hypot(car.x - pad.x, car.y - pad.y);
    if (dist < pad.width * 0.9) {
      const wasActive = car.boostPadTimer > 0.45;
      car.boostPadTimer = 0.8;
      car.nitroFuel = Math.min(100, car.nitroFuel + 24);
      // Hitting a boost pad also feeds the Increasing Speed Mechanic!
      if (car.overdriveStage < MAX_OVERDRIVE_STAGE && !wasActive) {
        car.overdriveCharge += 36;
        if (car.overdriveCharge >= 100) {
          car.overdriveStage = Math.min(MAX_OVERDRIVE_STAGE, car.overdriveStage + 1);
          car.overdriveCharge =
            car.overdriveStage >= MAX_OVERDRIVE_STAGE ? 100 : car.overdriveCharge - 100;
          events.leveledUpOverdrive = true;
          events.newOverdriveStage = car.overdriveStage;
        }
      }
      car.speedRampBonus = Math.min(params.maxSpeedRampBonus, car.speedRampBonus + 24);
      if (!wasActive) {
        events.hitBoostPad = true;
      }
    }
  }

  // Check Hazard Zones (Oil Slicks)
  for (const hazard of track.hazards) {
    const dist = Math.hypot(car.x - hazard.x, car.y - hazard.y);
    if (dist < hazard.radius + 10) {
      if (car.oilSlipTimer <= 0.1) {
        events.hitOilSlick = true;
        // Slight angular wiggle on oil slick
        car.angularVelocity += (car.id.charCodeAt(0) % 2 === 0 ? 1 : -1) * 1.4;
      }
      car.oilSlipTimer = 0.55;
    }
  }

  // Track boundary check & smooth arcade curb-gliding barrier
  const closest = getClosestTrackSample(track, car.x, car.y);
  const halfRoad = track.roadWidth * 0.5;
  const maxBarrierDist = halfRoad + 6;

  car.isOffTrack = closest.distance > halfRoad - 6;

  if (closest.distance > maxBarrierDist) {
    // Keep car right on the outer rumble curb and glide along the upcoming track tangent
    const sign = closest.signedLateral >= 0 ? 1 : -1;
    car.x = closest.sample.x + closest.sample.nx * sign * (maxBarrierDist - 1.5);
    car.y = closest.sample.y + closest.sample.ny * sign * (maxBarrierDist - 1.5);

    const normalOutX = closest.sample.nx * sign;
    const normalOutY = closest.sample.ny * sign;
    const velDotNormal = car.vx * normalOutX + car.vy * normalOutY;

    const aheadSample = track.samples[(closest.index + 6) % track.samples.length];
    const currentSpeedMag = Math.hypot(car.vx, car.vy);
    const preservedSpeed = Math.max(165, currentSpeedMag * 0.94);

    if (velDotNormal > -10) {
      const tangentAngle = Math.atan2(aheadSample.ty, aheadSample.tx);
      let angleDelta = tangentAngle - car.angle;
      while (angleDelta > Math.PI) angleDelta -= Math.PI * 2;
      while (angleDelta < -Math.PI) angleDelta += Math.PI * 2;
      car.angle += angleDelta * Math.min(1, dt * 16);

      nfx = Math.cos(car.angle);
      nfy = Math.sin(car.angle);
      car.vx = nfx * preservedSpeed - normalOutX * 18;
      car.vy = nfy * preservedSpeed - normalOutY * 18;
      car.speed = preservedSpeed;

      if (velDotNormal > 145) {
        events.hitBarrierHard = true;
        car.hitFlashTimer = 0.06;
      }
    }
  }

  // Checkpoint & Lap Progression
  const numSamples = track.samples.length;
  const checkpointSampleIdx = track.checkpointIndices[car.nextCheckpointIdx];
  const cpSample = track.samples[checkpointSampleIdx];
  const distToCp = Math.hypot(car.x - cpSample.x, car.y - cpSample.y);

  if (distToCp < track.roadWidth * 0.95) {
    car.checkpointsPassedInLap += 1;
    events.checkpointCleared = true;

    // Crossing the Start/Finish line (checkpoint 0) after passing all checkpoints in the lap
    if (
      car.nextCheckpointIdx === 0 &&
      car.checkpointsPassedInLap >= track.checkpointIndices.length
    ) {
      events.lapCompleted = true;

      if (car.bestLapTime === null || car.currentLapTime < car.bestLapTime) {
        car.bestLapTime = car.currentLapTime;
      }
      car.currentLapTime = 0;
      car.checkpointsPassedInLap = 0;

      // Completing a lap grants an automatic Overdrive Stage boost!
      if (car.overdriveStage < MAX_OVERDRIVE_STAGE) {
        car.overdriveStage = Math.min(MAX_OVERDRIVE_STAGE, car.overdriveStage + 1);
        car.overdriveCharge =
          car.overdriveStage >= MAX_OVERDRIVE_STAGE ? 100 : car.overdriveCharge * 0.5;
        events.leveledUpOverdrive = true;
        events.newOverdriveStage = car.overdriveStage;
      }
      car.nitroFuel = Math.min(100, car.nitroFuel + 40);

      if (car.lap >= track.totalLaps) {
        car.finished = true;
        events.raceFinished = true;
      } else {
        car.lap += 1;
      }
    }

    car.nextCheckpointIdx = (car.nextCheckpointIdx + 1) % track.checkpointIndices.length;
  }

  // Compute continuous race progress for live standings
  const rawFraction = closest.index / numSamples;
  const checkpointFraction =
    car.checkpointsPassedInLap / track.checkpointIndices.length;
  // Blend checkpoint count and spline index so progress is monotonic around the loop
  const monotonicProgress =
    rawFraction < 0.18 && checkpointFraction > 0.75 ? rawFraction + 1 : rawFraction;
  car.trackProgress = Math.max(0, Math.min(0.999, monotonicProgress));
  car.totalRaceProgress =
    (car.finished ? track.totalLaps + 1 : car.lap) + car.trackProgress;

  return events;
}

/**
 * Resolves car-to-car elastic collisions so cars bump and jostle realistically.
 */
export function resolveCarCollisions(cars: CarState[]): boolean {
  const carRadius = 18;
  const minDist = carRadius * 2;
  let heavyBumpOccurred = false;

  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i];
      const b = cars[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);

      if (dist > 0 && dist < minDist) {
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = (minDist - dist) * 0.5;

        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;

        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const velAlongNormal = rvx * nx + rvy * ny;

        if (velAlongNormal < 0) {
          const impulse = -0.85 * velAlongNormal;
          a.vx -= impulse * nx;
          a.vy -= impulse * ny;
          b.vx += impulse * nx;
          b.vy += impulse * ny;

          if (Math.abs(velAlongNormal) > 85 && (a.isPlayer || b.isPlayer)) {
            heavyBumpOccurred = true;
            a.hitFlashTimer = 0.05;
            b.hitFlashTimer = 0.05;
          }
        }
      }
    }
  }

  return heavyBumpOccurred;
}

/**
 * Computes AI control inputs for a rival car using 3 distinct policies:
 * 1. 'apex': Computes upcoming corner curvature and brakes cleanly while hugging the geometric apex.
 * 2. 'blocker': Defends the inside line when the player approaches from behind and drifts wide.
 * 3. 'sprinter': Steers toward upcoming Boost Pads and triggers periodic Overdrive Surges with a 0.45s telegraph.
 */
export function computeRivalInput(
  car: CarState,
  player: CarState,
  track: TrackDefinition,
  dt: number
): CarInput {
  const closest = getClosestTrackSample(track, car.x, car.y);
  const numSamples = track.samples.length;
  const policy: RivalPolicy = car.policy || 'apex';

  // Lookahead distance scales with policy
  const lookaheadSteps = policy === 'apex' ? 14 : policy === 'blocker' ? 11 : 16;
  const targetSampleIdx = (closest.index + lookaheadSteps) % numSamples;
  const farSampleIdx = (closest.index + lookaheadSteps * 2) % numSamples;
  const targetSample = track.samples[targetSampleIdx];
  const farSample = track.samples[farSampleIdx];

  // Deterministic per-driver lane bias (-0.28..+0.28 of roadWidth) so 22 cars spread across the wide F1 road
  let idHash = 0;
  for (let c = 0; c < car.id.length; c++) {
    idHash = (idHash * 31 + car.id.charCodeAt(c)) & 0xffff;
  }
  const laneSlot = ((idHash % 9) - 4) / 4; // -1.0 to +1.0
  const personalLaneBias = laneSlot * track.roadWidth * 0.27;

  let desiredLateral = car.aiTargetOffset;
  let throttle = 0.94;
  let brake = 0;
  let boostHeld = false;

  if (policy === 'apex') {
    // Hug the inside of the upcoming corner blended with personal lane bias
    const upcomingCurvature = farSample.curvature;
    desiredLateral = Math.max(
      -track.roadWidth * 0.36,
      Math.min(
        track.roadWidth * 0.36,
        -upcomingCurvature * 1150 + personalLaneBias * 0.55
      )
    );
    car.aiTargetOffset += (desiredLateral - car.aiTargetOffset) * Math.min(1, dt * 4);

    // Brake smoothly before high-curvature hairpins
    if (Math.abs(upcomingCurvature) > 0.032 && car.speed > 310) {
      throttle = 0.45;
      brake = 0.35;
    } else {
      throttle = 0.96;
    }
  } else if (policy === 'blocker') {
    // Check if player is nearby behind or alongside; shift lane to defend
    const distToPlayer = Math.hypot(player.x - car.x, player.y - car.y);
    if (distToPlayer < 250) {
      const playerClosest = getClosestTrackSample(track, player.x, player.y);
      desiredLateral = Math.max(
        -track.roadWidth * 0.36,
        Math.min(track.roadWidth * 0.36, playerClosest.signedLateral)
      );
    } else {
      desiredLateral =
        personalLaneBias * 0.75 +
        Math.sin(closest.index * 0.08 + idHash) * (track.roadWidth * 0.16);
    }
    car.aiTargetOffset += (desiredLateral - car.aiTargetOffset) * Math.min(1, dt * 5.5);
    throttle = 0.93;
  } else if (policy === 'sprinter') {
    // Scan ahead for a nearby BoostPad and align lateral offset with it
    let foundPad = false;
    for (const pad of track.boostPads) {
      const d = Math.hypot(pad.x - targetSample.x, pad.y - targetSample.y);
      if (d < 180) {
        const padClosest = getClosestTrackSample(track, pad.x, pad.y);
        desiredLateral = padClosest.signedLateral;
        foundPad = true;
        break;
      }
    }
    if (!foundPad) {
      desiredLateral = personalLaneBias * 0.8;
    }
    car.aiTargetOffset += (desiredLateral - car.aiTargetOffset) * Math.min(1, dt * 4.5);

    // Periodic Overdrive Surge with visible 0.45s windup telegraph
    if (car.surgeActiveTimer > 0) {
      car.surgeActiveTimer = Math.max(0, car.surgeActiveTimer - dt);
      boostHeld = true;
      throttle = 1.0;
    } else if (car.surgeWindupTimer > 0) {
      car.surgeWindupTimer = Math.max(0, car.surgeWindupTimer - dt);
      if (car.surgeWindupTimer === 0) {
        car.surgeActiveTimer = 1.15;
      }
    } else {
      car.surgeCooldownTimer = Math.max(0, car.surgeCooldownTimer - dt);
      if (car.surgeCooldownTimer === 0 && Math.abs(farSample.curvature) < 0.025) {
        car.surgeWindupTimer = 0.45; // 450ms visual & audio windup telegraph
        car.surgeCooldownTimer = 5.0;
      }
    }
  }

  const aimX = targetSample.x + targetSample.nx * car.aiTargetOffset;
  const aimY = targetSample.y + targetSample.ny * car.aiTargetOffset;

  const desiredAngle = Math.atan2(aimY - car.y, aimX - car.x);
  let angleDiff = desiredAngle - car.angle;
  while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

  const steer = Math.max(-1, Math.min(1, angleDiff * 2.4));

  return {
    throttle,
    brake,
    steer,
    boostHeld,
    boostJustPressed: false,
  };
}

/**
 * Sorts cars by race progression and updates their 1-indexed standings.
 */
export function updateRaceStandings(cars: CarState[]): CarState[] {
  const sorted = [...cars].sort((a, b) => {
    if (a.finished && b.finished) {
      return a.totalRaceTime - b.totalRaceTime;
    }
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.totalRaceProgress - a.totalRaceProgress;
  });

  sorted.forEach((car, idx) => {
    if (!car.finished || car.finishPosition === 0) {
      car.finishPosition = idx + 1;
    }
  });

  return sorted;
}

export function formatTimeMs(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  const minutes = Math.floor(safeMs / 60000);
  const seconds = Math.floor((safeMs % 60000) / 1000);
  const tenths = Math.floor((safeMs % 1000) / 100);
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${tenths}`;
}
