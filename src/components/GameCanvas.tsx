import React, { useEffect, useRef } from 'react';
import { createMultiplayerCars } from '../game/multiplayerRules';
import {
  calculateEffectiveTopSpeed,
  computeRivalInput,
  createInitialCars,
  getOverdriveParams,
  resolveCarCollisions,
  SPEED_TO_KMH,
  stepCarPhysics,
  updateRaceStandings,
} from '../game/rules';
import { sound } from '../game/sound';
import { TRACKS } from '../game/tracks';
import {
  CarInput,
  CarState,
  GameState,
  HudTelemetry,
  RemoteCarTelemetry,
  RoomStatePayload,
  RunSnapshot,
  TrackDefinition,
  TrackId,
} from '../game/types';

interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

interface SkidMark {
  active: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  alpha: number;
}

interface FloatingPopup {
  active: boolean;
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

export interface VirtualControlsState {
  left: boolean;
  right: boolean;
  throttle: boolean;
  brake: boolean;
  boost: boolean;
}

interface GameCanvasProps {
  gameState: GameState;
  trackId: TrackId;
  raceResetToken: number;
  isMultiplayer: boolean;
  localPlayerId: string;
  multiplayerRoom: RoomStatePayload | null;
  remoteTelemetryRef: React.MutableRefObject<Map<string, RemoteCarTelemetry>>;
  virtualInputRef: React.MutableRefObject<VirtualControlsState>;
  onTelemetryUpdate: (telemetry: HudTelemetry) => void;
  onNetworkSyncEmit?: (
    localCar: RemoteCarTelemetry,
    botCars: RemoteCarTelemetry[]
  ) => void;
  onRaceFinish: (snapshot: RunSnapshot) => void;
  onTogglePause: () => void;
  onResetCar: () => void;
}

const PARTICLE_POOL_SIZE = 260;
const SKID_POOL_SIZE = 360;
const POPUP_POOL_SIZE = 16;

export const GameCanvas: React.FC<GameCanvasProps> = ({
  gameState,
  trackId,
  raceResetToken,
  isMultiplayer,
  localPlayerId,
  multiplayerRoom,
  remoteTelemetryRef,
  virtualInputRef,
  onTelemetryUpdate,
  onNetworkSyncEmit,
  onRaceFinish,
  onTogglePause,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Store latest props/callbacks in refs so the 60Hz loop never tears down
  const gameStateRef = useRef<GameState>(gameState);
  const trackIdRef = useRef<TrackId>(trackId);
  const isMultiplayerRef = useRef<boolean>(isMultiplayer);
  const localPlayerIdRef = useRef<string>(localPlayerId);
  const multiplayerRoomRef = useRef<RoomStatePayload | null>(multiplayerRoom);
  const onTelemetryRef = useRef(onTelemetryUpdate);
  const onNetworkSyncRef = useRef(onNetworkSyncEmit);
  const onRaceFinishRef = useRef(onRaceFinish);
  const onTogglePauseRef = useRef(onTogglePause);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    trackIdRef.current = trackId;
  }, [trackId]);

  useEffect(() => {
    isMultiplayerRef.current = isMultiplayer;
    localPlayerIdRef.current = localPlayerId;
    multiplayerRoomRef.current = multiplayerRoom;
  }, [isMultiplayer, localPlayerId, multiplayerRoom]);

  useEffect(() => {
    onTelemetryRef.current = onTelemetryUpdate;
    onNetworkSyncRef.current = onNetworkSyncEmit;
    onRaceFinishRef.current = onRaceFinish;
    onTogglePauseRef.current = onTogglePause;
  }, [onTelemetryUpdate, onNetworkSyncEmit, onRaceFinish, onTogglePause]);

  // Mutable simulation state inside ref
  const simRef = useRef<{
    track: TrackDefinition;
    cars: CarState[];
    particles: Particle[];
    particleCursor: number;
    skids: SkidMark[];
    skidCursor: number;
    popups: FloatingPopup[];
    popupCursor: number;
    camX: number;
    camY: number;
    camZoom: number;
    trauma: number;
    hitstopTimer: number;
    titleTourAngle: number;
    statusBanner: string | null;
    statusBannerTimer: number;
    finishDelayTimer: number;
    pendingSnapshot: RunSnapshot | null;
    maxOverdriveReached: number;
    resetSimulation: (newTrackId: TrackId) => void;
    resetPlayerToTrack: () => void;
  } | null>(null);

  // Re-initialize cars when trackId or raceResetToken changes
  useEffect(() => {
    if (simRef.current) {
      simRef.current.resetSimulation(trackId);
    }
  }, [trackId, raceResetToken]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Pre-allocate zero-GC pools
    const particles: Particle[] = Array.from({ length: PARTICLE_POOL_SIZE }, () => ({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 1,
      size: 4,
      color: '#ffffff',
    }));

    const skids: SkidMark[] = Array.from({ length: SKID_POOL_SIZE }, () => ({
      active: false,
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 0,
      alpha: 0,
    }));

    const popups: FloatingPopup[] = Array.from({ length: POPUP_POOL_SIZE }, () => ({
      active: false,
      x: 0,
      y: 0,
      text: '',
      color: '#10b981',
      life: 0,
      maxLife: 1,
    }));

    const initialTrack = TRACKS[trackIdRef.current];
    const initialCars = createInitialCars(initialTrack);

    const sim = {
      track: initialTrack,
      cars: initialCars,
      particles,
      particleCursor: 0,
      skids,
      skidCursor: 0,
      popups,
      popupCursor: 0,
      camX: initialCars[0].x,
      camY: initialCars[0].y,
      camZoom: 0.92,
      trauma: 0,
      hitstopTimer: 0,
      titleTourAngle: 0,
      statusBanner: null as string | null,
      statusBannerTimer: 0,
      finishDelayTimer: 0,
      pendingSnapshot: null as RunSnapshot | null,
      maxOverdriveReached: 1,
      resetSimulation(newTrackId: TrackId) {
        const nextTrack = TRACKS[newTrackId];
        this.track = nextTrack;

        if (
          isMultiplayerRef.current &&
          multiplayerRoomRef.current &&
          multiplayerRoomRef.current.players.length >= 2
        ) {
          this.cars = createMultiplayerCars(
            nextTrack,
            multiplayerRoomRef.current.players,
            localPlayerIdRef.current
          );
        } else {
          this.cars = createInitialCars(nextTrack);
        }

        for (let i = 0; i < PARTICLE_POOL_SIZE; i++) this.particles[i].active = false;
        for (let i = 0; i < SKID_POOL_SIZE; i++) this.skids[i].active = false;
        for (let i = 0; i < POPUP_POOL_SIZE; i++) this.popups[i].active = false;

        const myCar = this.cars.find((c) => c.isPlayer) || this.cars[0];
        this.camX = myCar.x;
        this.camY = myCar.y;
        this.camZoom = 0.92;
        this.trauma = 0;
        this.hitstopTimer = 0;
        this.statusBanner = isMultiplayerRef.current
          ? `ONLINE GRID (${this.cars.length} PLAYERS) · HOLD W TO BUILD OVERDRIVE SPEED`
          : 'STAGE 1 READY · HOLD W TO BUILD OVERDRIVE SPEED';
        this.statusBannerTimer = 2.6;
        this.finishDelayTimer = 0;
        this.pendingSnapshot = null;
        this.maxOverdriveReached = 1;
      },
      resetPlayerToTrack() {
        const player = this.cars.find((c) => c.isPlayer) || this.cars[0];
        if (!player) return;
        const cpIdx =
          (player.nextCheckpointIdx - 1 + this.track.checkpointIndices.length) %
          this.track.checkpointIndices.length;
        const sampleIdx = this.track.checkpointIndices[cpIdx];
        const sample = this.track.samples[sampleIdx];
        player.x = sample.x;
        player.y = sample.y;
        player.vx = 0;
        player.vy = 0;
        player.speed = 0;
        player.angle = Math.atan2(sample.ty, sample.tx);
        player.oilSlipTimer = 0;
        this.statusBanner = 'CAR RECOVERED TO TRACK';
        this.statusBannerTimer = 1.4;
      },
    };

    simRef.current = sim;

    function spawnParticle(
      x: number,
      y: number,
      vx: number,
      vy: number,
      life: number,
      size: number,
      color: string
    ) {
      const p = sim.particles[sim.particleCursor];
      sim.particleCursor = (sim.particleCursor + 1) % PARTICLE_POOL_SIZE;
      p.active = true;
      p.x = x;
      p.y = y;
      p.vx = vx;
      p.vy = vy;
      p.life = life;
      p.maxLife = life;
      p.size = size;
      p.color = color;
    }

    function addSkidMark(x1: number, y1: number, x2: number, y2: number, alpha = 0.35) {
      const s = sim.skids[sim.skidCursor];
      sim.skidCursor = (sim.skidCursor + 1) % SKID_POOL_SIZE;
      s.active = true;
      s.x1 = x1;
      s.y1 = y1;
      s.x2 = x2;
      s.y2 = y2;
      s.alpha = alpha;
    }

    function spawnPopup(x: number, y: number, text: string, color: string) {
      const pop = sim.popups[sim.popupCursor];
      sim.popupCursor = (sim.popupCursor + 1) % POPUP_POOL_SIZE;
      pop.active = true;
      pop.x = x;
      pop.y = y;
      pop.text = text;
      pop.color = color;
      pop.life = 1.15;
      pop.maxLife = 1.15;
    }

    // Unified Input Hub (held + edge-triggered justPressed)
    const keysHeld = new Set<string>();
    const keysJustPressed = new Set<string>();

    const handleKeyDown = (e: KeyboardEvent) => {
      const code = e.code;
      if (
        code === 'ArrowUp' ||
        code === 'ArrowDown' ||
        code === 'ArrowLeft' ||
        code === 'ArrowRight' ||
        code === 'Space'
      ) {
        if (gameStateRef.current === 'playing') {
          e.preventDefault();
        }
      }

      if (!keysHeld.has(code)) {
        keysJustPressed.add(code);
      }
      keysHeld.add(code);

      if (code === 'Escape' || code === 'KeyP') {
        if (gameStateRef.current === 'playing' || gameStateRef.current === 'paused') {
          e.preventDefault();
          onTogglePauseRef.current();
        }
      } else if (code === 'KeyR' && gameStateRef.current === 'playing') {
        e.preventDefault();
        sim.resetPlayerToTrack();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysHeld.delete(e.code);
    };

    const clearHeldInputs = () => {
      keysHeld.clear();
      keysJustPressed.clear();
      if (virtualInputRef.current) {
        virtualInputRef.current.left = false;
        virtualInputRef.current.right = false;
        virtualInputRef.current.throttle = false;
        virtualInputRef.current.brake = false;
        virtualInputRef.current.boost = false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearHeldInputs();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', clearHeldInputs);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // ResizeObserver for crisp full-viewport Canvas2D
    let viewWidth = container.clientWidth || window.innerWidth;
    let viewHeight = container.clientHeight || window.innerHeight;

    const updateCanvasSize = () => {
      if (!container || !canvas) return;
      const rect = container.getBoundingClientRect();
      viewWidth = Math.max(320, Math.floor(rect.width));
      viewHeight = Math.max(320, Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = viewWidth * dpr;
      canvas.height = viewHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    updateCanvasSize();
    const resizeObserver = new ResizeObserver(updateCanvasSize);
    resizeObserver.observe(container);

    let lastHudEmitTime = 0;
    let lastNetworkEmitTime = 0;
    let telemetrySeq = 0;
    let lastFrameTime = performance.now();
    let rafId = 0;

    const round1 = (n: number) => Math.round(n * 10) / 10;
    const round3 = (n: number) => Math.round(n * 1000) / 1000;

    const toRemoteTelemetry = (
      c: CarState,
      seq: number,
      input?: CarInput
    ): RemoteCarTelemetry => ({
      id: c.id,
      name: c.name,
      seq,
      x: round1(c.x),
      y: round1(c.y),
      vx: round1(c.vx),
      vy: round1(c.vy),
      angle: round3(c.angle),
      speed: round1(c.speed),
      steerAngle: round3(c.steerAngle),
      throttle: input ? input.throttle : c.speed > 20 ? 1 : 0,
      brake: input ? input.brake : 0,
      steer: input ? round3(input.steer) : 0,
      boostHeld: input ? input.boostHeld : c.isBoosting,
      overdriveStage: c.overdriveStage,
      isBoosting: c.isBoosting || c.boostPadTimer > 0,
      isDrifting: c.isDrifting,
      lap: c.lap,
      totalRaceProgress: round3(c.totalRaceProgress),
      finished: c.finished,
      finishPosition: c.finishPosition,
      totalRaceTime: round3(c.totalRaceTime),
      bestLapTime: c.bestLapTime !== null ? round3(c.bestLapTime) : null,
      peakSpeedKmh: Math.round(c.peakSpeedKmh),
    });

    const tick = (now: number) => {
      rafId = requestAnimationFrame(tick);

      const rawDt = (now - lastFrameTime) / 1000;
      lastFrameTime = now;
      const dt = Math.min(Math.max(rawDt, 0.001), 0.05);

      const state = gameStateRef.current;
      const track = sim.track;
      const player = sim.cars.find((c) => c.isPlayer) || sim.cars[0];

      // Decay camera shake trauma in real dt
      sim.trauma = Math.max(0, sim.trauma - dt * 1.9);
      if (sim.statusBannerTimer > 0) {
        sim.statusBannerTimer = Math.max(0, sim.statusBannerTimer - dt);
        if (sim.statusBannerTimer === 0) {
          sim.statusBanner = null;
        }
      }

      // Tick particles and popups in real dt
      for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
        const p = sim.particles[i];
        if (!p.active) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.active = false;
        } else {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vx *= 0.94;
          p.vy *= 0.94;
        }
      }

      for (let i = 0; i < POPUP_POOL_SIZE; i++) {
        const pop = sim.popups[i];
        if (!pop.active) continue;
        pop.life -= dt;
        if (pop.life <= 0) {
          pop.active = false;
        } else {
          pop.y -= 28 * dt;
        }
      }

      // Simulation step
      if (state === 'title' || state === 'lobby') {
        // Live World Camera Tour / Demo Race on Title & Lobby Screens
        sim.titleTourAngle += dt * 0.28;
        for (let i = 1; i < sim.cars.length; i++) {
          const rival = sim.cars[i];
          const aiInput = computeRivalInput(rival, player, track, dt);
          stepCarPhysics(rival, aiInput, track, dt);
        }
        resolveCarCollisions(sim.cars);

        const leadRival = sim.cars[1] || player;
        const targetX = leadRival.x - 190;
        const targetY = leadRival.y;
        sim.camX += (targetX - sim.camX) * Math.min(1, dt * 2.5);
        sim.camY += (targetY - sim.camY) * Math.min(1, dt * 2.5);
        sim.camZoom += (0.72 - sim.camZoom) * Math.min(1, dt * 3);
      } else if (state === 'playing') {
        if (sim.hitstopTimer > 0) {
          sim.hitstopTimer = Math.max(0, sim.hitstopTimer - dt);
        } else {
          // Read unified player input (WASD + Arrow keys + Virtual touch pads)
          const vInput = virtualInputRef.current;
          const throttle =
            keysHeld.has('KeyW') || keysHeld.has('ArrowUp') || vInput.throttle ? 1 : 0;
          const brake =
            keysHeld.has('KeyS') || keysHeld.has('ArrowDown') || vInput.brake ? 1 : 0;
          const left =
            keysHeld.has('KeyA') || keysHeld.has('ArrowLeft') || vInput.left ? 1 : 0;
          const right =
            keysHeld.has('KeyD') || keysHeld.has('ArrowRight') || vInput.right ? 1 : 0;
          const boostHeld =
            keysHeld.has('Space') ||
            keysHeld.has('ShiftLeft') ||
            keysHeld.has('ShiftRight') ||
            vInput.boost;
          const boostJustPressed =
            keysJustPressed.has('Space') ||
            keysJustPressed.has('ShiftLeft') ||
            keysJustPressed.has('ShiftRight');

          const playerInput: CarInput = {
            throttle,
            brake,
            steer: right - left,
            boostHeld,
            boostJustPressed,
          };

          if (boostJustPressed && player.nitroFuel > 8) {
            sound.playBoost();
            sim.trauma = Math.min(1, sim.trauma + 0.22);
          }

          const prevX = player.x;
          const prevY = player.y;
          const playerEvents = stepCarPhysics(player, playerInput, track, dt);

          if (player.overdriveStage > sim.maxOverdriveReached) {
            sim.maxOverdriveReached = player.overdriveStage;
          }

          if (playerEvents.leveledUpOverdrive) {
            sound.playOverdriveLevelUp(playerEvents.newOverdriveStage);
            const stg = getOverdriveParams(playerEvents.newOverdriveStage);
            sim.statusBanner = `OVERDRIVE ${stg.label} UNLOCKED! TOP SPEED INCREASED`;
            sim.statusBannerTimer = 2.4;
            spawnPopup(
              player.x,
              player.y - 24,
              `OVERDRIVE STAGE ${playerEvents.newOverdriveStage}!`,
              '#10b981'
            );
            for (let k = 0; k < 18; k++) {
              const a = (Math.PI * 2 * k) / 18;
              spawnParticle(
                player.x,
                player.y,
                Math.cos(a) * 140,
                Math.sin(a) * 140,
                0.45,
                5,
                '#10b981'
              );
            }
          }

          if (playerEvents.hitBoostPad) {
            sound.playBoost();
            sim.trauma = Math.min(1, sim.trauma + 0.25);
            spawnPopup(player.x, player.y - 20, 'SPEED BOOST +OVERDRIVE!', '#06b6d4');
            for (let k = 0; k < 12; k++) {
              const spread = (Math.random() - 0.5) * 0.9;
              const backAngle = player.angle + Math.PI + spread;
              spawnParticle(
                player.x,
                player.y,
                Math.cos(backAngle) * (150 + Math.random() * 90),
                Math.sin(backAngle) * (150 + Math.random() * 90),
                0.35,
                4.5,
                '#06b6d4'
              );
            }
          }

          if (playerEvents.hitOilSlick) {
            spawnPopup(player.x, player.y - 20, 'OIL SLICK! GRIP REDUCED', '#f59e0b');
          }

          if (playerEvents.hitBarrierHard) {
            sound.playImpact();
            sim.hitstopTimer = 0.04;
            sim.trauma = Math.min(1, sim.trauma + 0.45);
            for (let k = 0; k < 16; k++) {
              const a = Math.random() * Math.PI * 2;
              spawnParticle(
                player.x,
                player.y,
                Math.cos(a) * (90 + Math.random() * 130),
                Math.sin(a) * (90 + Math.random() * 130),
                0.38,
                3.8,
                '#f59e0b'
              );
            }
          }

          if (playerEvents.lapCompleted) {
            if (playerEvents.raceFinished) {
              sound.playVictory();
              sim.statusBanner = 'CHECKERED FLAG! RACE COMPLETE';
              sim.statusBannerTimer = 3.0;
            } else {
              sound.playLapComplete();
              sim.statusBanner = `LAP ${player.lap} / ${track.totalLaps} · OVERDRIVE SPEED UP!`;
              sim.statusBannerTimer = 2.4;
              spawnPopup(player.x, player.y - 28, `LAP ${player.lap}/${track.totalLaps}`, '#f8fafc');
            }
          } else if (playerEvents.checkpointCleared) {
            sound.playCheckpoint();
          }

          if (player.isDrifting || player.oilSlipTimer > 0) {
            const rx = -Math.sin(player.angle) * 10;
            const ry = Math.cos(player.angle) * 10;
            addSkidMark(prevX + rx, prevY + ry, player.x + rx, player.y + ry, 0.36);
            addSkidMark(prevX - rx, prevY - ry, player.x - rx, player.y - ry, 0.36);

            if (Math.random() < 0.65) {
              spawnParticle(
                player.x - Math.cos(player.angle) * 16 + (Math.random() - 0.5) * 12,
                player.y - Math.sin(player.angle) * 16 + (Math.random() - 0.5) * 12,
                (Math.random() - 0.5) * 35,
                (Math.random() - 0.5) * 35,
                0.42,
                6,
                'rgba(203, 213, 225, 0.45)'
              );
            }
          }

          if (player.isBoosting || player.boostPadTimer > 0) {
            const backX = player.x - Math.cos(player.angle) * 20;
            const backY = player.y - Math.sin(player.angle) * 20;
            spawnParticle(
              backX + (Math.random() - 0.5) * 6,
              backY + (Math.random() - 0.5) * 6,
              -Math.cos(player.angle) * 140 + (Math.random() - 0.5) * 40,
              -Math.sin(player.angle) * 140 + (Math.random() - 0.5) * 40,
              0.22,
              5,
              player.boostPadTimer > 0 ? '#06b6d4' : '#f59e0b'
            );
          }

          // Step other cars (Remote online friends OR AI bots)
          const isHost =
            !isMultiplayerRef.current ||
            multiplayerRoomRef.current?.hostId === localPlayerIdRef.current;

          for (let i = 0; i < sim.cars.length; i++) {
            const other = sim.cars[i];
            if (other.isPlayer) continue;

            const remoteState = remoteTelemetryRef.current.get(other.id);
            if (isMultiplayerRef.current && (!other.policy || !isHost) && remoteState) {
              const rPrevX = other.x;
              const rPrevY = other.y;

              // 1. Dead-reckon the remote target forward every 60fps frame so it never freezes between packets
              remoteState.x += remoteState.vx * dt;
              remoteState.y += remoteState.vy * dt;

              // 2. Step local physics prediction using the remote car's latest control inputs
              const predictedInput: CarInput = {
                throttle: remoteState.throttle ?? (remoteState.speed > 20 ? 1 : 0),
                brake: remoteState.brake ?? 0,
                steer: remoteState.steer ?? 0,
                boostHeld: Boolean(remoteState.boostHeld),
                boostJustPressed: false,
              };
              other.overdriveStage = remoteState.overdriveStage;
              stepCarPhysics(other, predictedInput, track, dt);

              // 3. Reconcile predicted position/velocity/heading smoothly toward dead-reckoned target
              const errX = remoteState.x - other.x;
              const errY = remoteState.y - other.y;
              const errDist = Math.hypot(errX, errY);

              if (errDist > 240) {
                other.x = remoteState.x;
                other.y = remoteState.y;
                other.vx = remoteState.vx;
                other.vy = remoteState.vy;
                other.angle = remoteState.angle;
              } else {
                const posBlend = Math.min(1, dt * 10);
                const velBlend = Math.min(1, dt * 14);
                other.x += errX * posBlend;
                other.y += errY * posBlend;
                other.vx += (remoteState.vx - other.vx) * velBlend;
                other.vy += (remoteState.vy - other.vy) * velBlend;

                let aDiff = remoteState.angle - other.angle;
                while (aDiff > Math.PI) aDiff -= Math.PI * 2;
                while (aDiff < -Math.PI) aDiff += Math.PI * 2;
                other.angle += aDiff * Math.min(1, dt * 12);
              }

              other.speed = Math.hypot(other.vx, other.vy);
              other.steerAngle = remoteState.steerAngle;
              other.isBoosting = remoteState.isBoosting;
              other.isDrifting = remoteState.isDrifting;
              other.lap = remoteState.lap;
              other.totalRaceProgress = remoteState.totalRaceProgress;
              other.finished = remoteState.finished;
              other.totalRaceTime = remoteState.totalRaceTime;
              other.bestLapTime = remoteState.bestLapTime;
              other.peakSpeedKmh = remoteState.peakSpeedKmh;

              if (other.isDrifting && Math.hypot(other.x - sim.camX, other.y - sim.camY) < 950) {
                const rx = -Math.sin(other.angle) * 10;
                const ry = Math.cos(other.angle) * 10;
                addSkidMark(rPrevX + rx, rPrevY + ry, other.x + rx, other.y + ry, 0.25);
                addSkidMark(rPrevX - rx, rPrevY - ry, other.x - rx, other.y - ry, 0.25);
              }
            } else if (other.policy && !other.finished) {
              // Local or Host-authoritative AI bot
              const rPrevX = other.x;
              const rPrevY = other.y;
              const aiInput = computeRivalInput(other, player, track, dt);
              stepCarPhysics(other, aiInput, track, dt);

              if (other.isDrifting && Math.hypot(other.x - sim.camX, other.y - sim.camY) < 950) {
                const rx = -Math.sin(other.angle) * 10;
                const ry = Math.cos(other.angle) * 10;
                addSkidMark(rPrevX + rx, rPrevY + ry, other.x + rx, other.y + ry, 0.25);
                addSkidMark(rPrevX - rx, rPrevY - ry, other.x - rx, other.y - ry, 0.25);
              }
            }
          }

          const heavyCarCollision = resolveCarCollisions(sim.cars);
          if (heavyCarCollision) {
            sound.playImpact();
            sim.hitstopTimer = 0.035;
            sim.trauma = Math.min(1, sim.trauma + 0.35);
            for (let k = 0; k < 14; k++) {
              const a = Math.random() * Math.PI * 2;
              spawnParticle(
                player.x,
                player.y,
                Math.cos(a) * 120,
                Math.sin(a) * 120,
                0.3,
                3.5,
                '#fde047'
              );
            }
          }

          updateRaceStandings(sim.cars);

          // Broadcast local player & round-robin host-bot telemetry at ~25Hz with monotonic seq
          if (
            isMultiplayerRef.current &&
            onNetworkSyncRef.current &&
            now - lastNetworkEmitTime > 40
          ) {
            lastNetworkEmitTime = now;
            const nextSeq = ++telemetrySeq;
            let botTelemetries: RemoteCarTelemetry[] = [];
            if (isHost) {
              const allBots = sim.cars.filter((c) => !c.isPlayer && Boolean(c.policy));
              if (allBots.length > 0) {
                // Send up to 2 bots per packet in round-robin order to keep packets tiny even with 22 cars
                const batchSize = Math.min(2, allBots.length);
                for (let b = 0; b < batchSize; b++) {
                  const bot = allBots[(nextSeq * batchSize + b) % allBots.length];
                  botTelemetries.push(toRemoteTelemetry(bot, nextSeq));
                }
              }
            }
            onNetworkSyncRef.current(
              toRemoteTelemetry(player, nextSeq, playerInput),
              botTelemetries
            );
          }

          // Check if player finished all laps -> brief 0.5s beat before showing Victory/Result modal
          if (player.finished && !sim.pendingSnapshot) {
            sim.pendingSnapshot = {
              trackName: track.name,
              finishPosition: player.finishPosition,
              totalCars: sim.cars.length,
              totalTimeMs: Math.round(player.totalRaceTime * 1000),
              bestLapTimeMs:
                player.bestLapTime !== null ? Math.round(player.bestLapTime * 1000) : null,
              peakSpeedKmh: player.peakSpeedKmh,
              maxOverdriveStage: sim.maxOverdriveReached,
              completedAllLaps: true,
            };
            sim.finishDelayTimer = 0.55;
          }

          if (sim.pendingSnapshot && sim.finishDelayTimer > 0) {
            sim.finishDelayTimer -= dt;
            if (sim.finishDelayTimer <= 0) {
              const snap = sim.pendingSnapshot;
              sim.pendingSnapshot = null;
              onRaceFinishRef.current(snap);
            }
          }
        }

        // Smooth camera chase with velocity look-ahead and dynamic high-speed zoom-out for wide 22-car F1 road
        const lookAheadX = player.vx * 0.22;
        const lookAheadY = player.vy * 0.22;
        const targetCamX = player.x + lookAheadX;
        const targetCamY = player.y + lookAheadY;
        sim.camX += (targetCamX - sim.camX) * Math.min(1, dt * 7.5);
        sim.camY += (targetCamY - sim.camY) * Math.min(1, dt * 7.5);

        const speedRatio = Math.min(1, Math.abs(player.speed) / 560);
        const targetZoom = 0.84 - speedRatio * 0.16;
        sim.camZoom += (targetZoom - sim.camZoom) * Math.min(1, dt * 4.5);

        keysJustPressed.clear();
      }

      // Emit HUD telemetry at ~16Hz
      if (now - lastHudEmitTime > 60) {
        lastHudEmitTime = now;
        const stageParams = getOverdriveParams(player.overdriveStage);
        const effTop = calculateEffectiveTopSpeed(player);
        onTelemetryRef.current({
          speedKmh: Math.round(Math.max(0, player.speed) * SPEED_TO_KMH),
          topSpeedCapKmh: Math.round(effTop * SPEED_TO_KMH),
          overdriveStage: player.overdriveStage,
          overdriveCharge: Math.round(player.overdriveCharge),
          speedRampPct: Math.round(
            (player.speedRampBonus / stageParams.maxSpeedRampBonus) * 100
          ),
          nitroFuel: Math.round(player.nitroFuel),
          lap: Math.min(player.lap, track.totalLaps),
          totalLaps: track.totalLaps,
          position: player.finishPosition || 1,
          totalCars: sim.cars.length,
          currentLapTimeMs: Math.round(player.currentLapTime * 1000),
          bestLapTimeMs:
            player.bestLapTime !== null ? Math.round(player.bestLapTime * 1000) : null,
          totalTimeMs: Math.round(player.totalRaceTime * 1000),
          peakSpeedKmh: player.peakSpeedKmh,
          isBoosting: player.isBoosting || player.boostPadTimer > 0,
          isDrifting: player.isDrifting,
          isOffTrack: player.isOffTrack,
          statusBanner: sim.statusBanner,
          minimapCars: sim.cars.map((c) => ({
            id: c.id,
            x: c.x,
            y: c.y,
            color: c.color,
            isPlayer: c.isPlayer,
          })),
        });
      }

      // =======================================================================
      // RENDER WORLD TO CANVAS
      // =======================================================================
      ctx.save();
      ctx.fillStyle = track.theme.grassOuter;
      ctx.fillRect(0, 0, viewWidth, viewHeight);

      const shakeMag = sim.trauma * sim.trauma * 14;
      const shakeX = (Math.random() - 0.5) * 2 * shakeMag;
      const shakeY = (Math.random() - 0.5) * 2 * shakeMag;

      ctx.translate(viewWidth * 0.5 + shakeX, viewHeight * 0.5 + shakeY);
      ctx.scale(sim.camZoom, sim.camZoom);
      ctx.translate(-sim.camX, -sim.camY);

      // 1. Subtle world ground grid
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
      ctx.lineWidth = 2;
      const gridStep = 140;
      const startGX = Math.floor((sim.camX - viewWidth) / gridStep) * gridStep;
      const endGX = sim.camX + viewWidth;
      const startGY = Math.floor((sim.camY - viewHeight) / gridStep) * gridStep;
      const endGY = sim.camY + viewHeight;

      ctx.beginPath();
      for (let gx = startGX; gx <= endGX; gx += gridStep) {
        ctx.moveTo(gx, startGY);
        ctx.lineTo(gx, endGY);
      }
      for (let gy = startGY; gy <= endGY; gy += gridStep) {
        ctx.moveTo(startGX, gy);
        ctx.lineTo(endGX, gy);
      }
      ctx.stroke();

      // 2. Track Outer Safety Barrier & Gravel Apron
      const traceTrackLoop = () => {
        ctx.beginPath();
        const pts = track.samples;
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.closePath();
      };

      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      traceTrackLoop();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.lineWidth = track.roadWidth + 46;
      ctx.stroke();

      traceTrackLoop();
      ctx.strokeStyle = track.theme.curbSecondary;
      ctx.lineWidth = track.roadWidth + 18;
      ctx.stroke();

      ctx.save();
      traceTrackLoop();
      ctx.strokeStyle = track.theme.curbPrimary;
      ctx.lineWidth = track.roadWidth + 18;
      ctx.setLineDash([28, 28]);
      ctx.stroke();
      ctx.restore();

      // 3. Main Wide F1 Asphalt Surface (22-Car Capacity)
      traceTrackLoop();
      ctx.strokeStyle = track.theme.asphalt;
      ctx.lineWidth = track.roadWidth;
      ctx.stroke();

      ctx.save();
      traceTrackLoop();
      ctx.strokeStyle = 'rgba(248, 250, 252, 0.14)';
      ctx.lineWidth = 3;
      ctx.setLineDash([26, 34]);
      ctx.stroke();
      ctx.restore();

      // 3b. Official 22-Car Formula 1 Starting Grid Boxes along Pit Straightaway
      const startSample = track.samples[0];
      const startHeading = Math.atan2(startSample.ty, startSample.tx);
      ctx.save();
      ctx.strokeStyle = 'rgba(248, 250, 252, 0.35)';
      ctx.lineWidth = 2;
      for (let slotIdx = 0; slotIdx < 22; slotIdx++) {
        const row = Math.floor(slotIdx / 2);
        const col = slotIdx % 2;
        const backOffset = -row * 54 - col * 22;
        const lateralOffset = col === 0 ? -48 : 48;
        const gx =
          startSample.x +
          startSample.tx * backOffset +
          startSample.nx * lateralOffset;
        const gy =
          startSample.y +
          startSample.ty * backOffset +
          startSample.ny * lateralOffset;

        ctx.save();
        ctx.translate(gx, gy);
        ctx.rotate(startHeading);
        // Paint F1 front/side starting bracket
        ctx.beginPath();
        ctx.moveTo(6, -16);
        ctx.lineTo(24, -16);
        ctx.lineTo(24, 16);
        ctx.lineTo(6, 16);
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();

      // 4. Checkpoint sector lines & Start/Finish Checkered Gantry
      track.checkpointIndices.forEach((sIdx, cpOrder) => {
        const s = track.samples[sIdx];
        const half = track.roadWidth * 0.5;
        const x1 = s.x - s.nx * half;
        const y1 = s.y - s.ny * half;
        const x2 = s.x + s.nx * half;
        const y2 = s.y + s.ny * half;

        if (cpOrder === 0) {
          const squares = 14;
          for (let q = 0; q < squares; q++) {
            const t0 = q / squares;
            const t1 = (q + 1) / squares;
            const sx = x1 + (x2 - x1) * t0;
            const sy = y1 + (y2 - y1) * t0;
            const ex = x1 + (x2 - x1) * t1;
            const ey = y1 + (y2 - y1) * t1;

            ctx.strokeStyle = q % 2 === 0 ? '#f8fafc' : '#0f172a';
            ctx.lineWidth = 14;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(ex, ey);
            ctx.stroke();
          }
        } else {
          ctx.strokeStyle =
            cpOrder === player.nextCheckpointIdx
              ? 'rgba(16, 185, 129, 0.38)'
              : 'rgba(255, 255, 255, 0.07)';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      });

      // 5. Speed Boost Pads
      const pulse = 0.75 + 0.25 * Math.sin(now * 0.008);
      for (const pad of track.boostPads) {
        ctx.save();
        ctx.translate(pad.x, pad.y);
        ctx.rotate(pad.angle);

        ctx.fillStyle = 'rgba(6, 182, 212, 0.18)';
        ctx.strokeStyle = `rgba(6, 182, 212, ${0.55 * pulse})`;
        ctx.lineWidth = 2;
        ctx.fillRect(-pad.length * 0.5, -pad.width * 0.5, pad.length, pad.width);
        ctx.strokeRect(-pad.length * 0.5, -pad.width * 0.5, pad.length, pad.width);

        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 4;
        for (let c = -1; c <= 1; c++) {
          const cx = c * 18 + ((now * 0.06) % 18) - 9;
          ctx.beginPath();
          ctx.moveTo(cx - 8, -pad.width * 0.32);
          ctx.lineTo(cx + 6, 0);
          ctx.lineTo(cx - 8, pad.width * 0.32);
          ctx.stroke();
        }
        ctx.restore();
      }

      // 6. Hazard Zones
      for (const hazard of track.hazards) {
        ctx.save();
        ctx.translate(hazard.x, hazard.y);

        ctx.strokeStyle = `rgba(245, 158, 11, ${0.45 + 0.25 * Math.sin(now * 0.006)})`;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.arc(0, 0, hazard.radius + 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#090d16';
        ctx.beginPath();
        ctx.arc(0, 0, hazard.radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(245, 158, 11, 0.22)';
        ctx.beginPath();
        ctx.arc(-5, -4, hazard.radius * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 7. Tire Skid Marks
      ctx.lineWidth = 3.5;
      for (let i = 0; i < SKID_POOL_SIZE; i++) {
        const s = sim.skids[i];
        if (!s.active) continue;
        ctx.strokeStyle = `rgba(10, 14, 22, ${s.alpha})`;
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();
      }

      // 8. Pooled Particles
      for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
        const p = sim.particles[i];
        if (!p.active) continue;
        const alpha = Math.max(0, p.life / p.maxLife);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.5 + 0.5 * alpha), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // 9. Render Cars (2 to 8 Cars)
      for (const car of sim.cars) {
        ctx.save();
        ctx.translate(car.x, car.y);

        if (!car.isPlayer && car.surgeWindupTimer > 0) {
          ctx.strokeStyle = '#22d3ee';
          ctx.lineWidth = 3;
          const r = 28 + Math.sin(now * 0.03) * 5;
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.stroke();
        }

        if (car.isPlayer && car.overdriveStage >= 2) {
          ctx.strokeStyle =
            car.overdriveStage >= 4
              ? 'rgba(245, 158, 11, 0.45)'
              : 'rgba(16, 185, 129, 0.35)';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(0, 0, 26 + car.overdriveStage * 1.5, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.rotate(car.angle);

        ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
        ctx.beginPath();
        ctx.roundRect(-21, -11, 42, 26, 6);
        ctx.fill();

        const drawWheel = (wx: number, wy: number, steer: number) => {
          ctx.save();
          ctx.translate(wx, wy);
          ctx.rotate(steer);
          ctx.fillStyle = '#090d14';
          ctx.fillRect(-5, -3, 10, 6);
          ctx.restore();
        };
        drawWheel(12, -12, car.steerAngle);
        drawWheel(12, 12, car.steerAngle);
        drawWheel(-12, -12, 0);
        drawWheel(-12, 12, 0);

        if (car.isBoosting || car.boostPadTimer > 0 || car.surgeActiveTimer > 0) {
          const flameLen = 16 + Math.random() * 14;
          ctx.fillStyle = car.boostPadTimer > 0 ? '#22d3ee' : '#f59e0b';
          ctx.beginPath();
          ctx.moveTo(-20, -6);
          ctx.lineTo(-20 - flameLen, 0);
          ctx.lineTo(-20, 6);
          ctx.closePath();
          ctx.fill();
        }

        ctx.fillStyle = car.hitFlashTimer > 0 ? '#ffffff' : car.color;
        ctx.beginPath();
        ctx.roundRect(-20, -11, 40, 22, 6);
        ctx.fill();

        ctx.fillStyle = car.secondaryColor;
        ctx.fillRect(-16, -2.5, 32, 5);

        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.roundRect(-6, -8, 16, 16, 3);
        ctx.fill();

        ctx.fillStyle = '#0f172a';
        ctx.fillRect(-21, -11, 4, 22);

        ctx.fillStyle = 'rgba(248, 250, 252, 0.85)';
        ctx.fillRect(17, -9, 3, 4);
        ctx.fillRect(17, 5, 3, 4);

        ctx.restore();

        if (state === 'playing') {
          const isHumanPeer = !car.isPlayer && !car.policy;
          const isImportant =
            car.isPlayer ||
            isHumanPeer ||
            car.surgeWindupTimer > 0 ||
            car.finishPosition === 1;

          if (isImportant) {
            ctx.save();
            ctx.font = '700 11px "Chakra Petch", sans-serif';
            ctx.textAlign = 'center';
            ctx.strokeStyle = 'rgba(6, 9, 14, 0.85)';
            ctx.lineWidth = 3;
            ctx.fillStyle = car.isPlayer
              ? '#10b981'
              : car.surgeWindupTimer > 0
                ? '#22d3ee'
                : isHumanPeer
                  ? '#fbbf24'
                  : '#f8fafc';
            const posTag = car.finishPosition ? `P${car.finishPosition} ` : '';
            const label = car.isPlayer
              ? `YOU (${posTag.trim()}) · STG ${car.overdriveStage}`
              : car.surgeWindupTimer > 0
                ? '⚡ SURGING!'
                : `${posTag}${car.name.split(' ')[0]} · STG ${car.overdriveStage}`;
            ctx.strokeText(label, car.x, car.y - 24);
            ctx.fillText(label, car.x, car.y - 24);
            ctx.restore();
          }
        }
      }

      // 10. Floating World-Space Popups
      for (let i = 0; i < POPUP_POOL_SIZE; i++) {
        const pop = sim.popups[i];
        if (!pop.active) continue;
        const alpha = Math.min(1, pop.life / (pop.maxLife * 0.4));
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = '700 15px "Chakra Petch", sans-serif';
        ctx.textAlign = 'center';
        ctx.strokeStyle = '#06090e';
        ctx.lineWidth = 4;
        ctx.strokeText(pop.text, pop.x, pop.y);
        ctx.fillStyle = pop.color;
        ctx.fillText(pop.text, pop.x, pop.y);
        ctx.restore();
      }

      ctx.restore();
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', clearHeldInputs);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [virtualInputRef, remoteTelemetryRef]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 w-full h-full overflow-hidden bg-[#090d14]"
      data-testid="game-canvas-container"
    >
      <canvas
        ref={canvasRef}
        data-testid="racing-canvas"
        tabIndex={0}
        aria-label="Apex Overdrive Racing Track Canvas"
        className="block w-full h-full outline-none"
      />
    </div>
  );
};
