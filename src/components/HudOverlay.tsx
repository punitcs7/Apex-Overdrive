import React from 'react';
import { formatTimeMs, getOverdriveParams, MAX_OVERDRIVE_STAGE } from '../game/rules';
import { TRACKS } from '../game/tracks';
import { HudTelemetry, TrackId } from '../game/types';
import { VirtualControlsState } from './GameCanvas';

interface HudOverlayProps {
  telemetry: HudTelemetry;
  trackId: TrackId;
  isMuted: boolean;
  virtualInputRef: React.MutableRefObject<VirtualControlsState>;
  onToggleMute: () => void;
  onTogglePause: () => void;
  onRestartRace: () => void;
}

export const HudOverlay: React.FC<HudOverlayProps> = ({
  telemetry,
  trackId,
  isMuted,
  virtualInputRef,
  onToggleMute,
  onTogglePause,
  onRestartRace,
}) => {
  const track = TRACKS[trackId];
  const stageParams = getOverdriveParams(telemetry.overdriveStage);

  // Build SVG path for real navigable track spline on the corner minimap
  const minimapPath = React.useMemo(() => {
    const pts = track.samples;
    if (!pts.length) return '';
    let d = `M ${pts[0].x.toFixed(0)} ${pts[0].y.toFixed(0)}`;
    for (let i = 3; i < pts.length; i += 3) {
      d += ` L ${pts[i].x.toFixed(0)} ${pts[i].y.toFixed(0)}`;
    }
    return d + ' Z';
  }, [track]);

  return (
    <div
      className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-3 sm:p-5"
      aria-label="Race Telemetry HUD"
    >
      {/* TOP PERIMETER ROW: Top-Left Race Standings/Lap + Top-Right Utility Controls & Minimap */}
      <div className="flex items-start justify-between gap-4">
        {/* Cluster 1 (Top-Left): Position, Lap Counter & Lap Timers */}
        <div
          className="px-4 py-2.5 rounded-lg border border-slate-800/90 flex items-center gap-5 shadow-lg"
          style={{ backgroundColor: 'rgba(9, 13, 20, 0.9)' }}
        >
          {/* Position Readout */}
          <div className="flex flex-col">
            <span className="text-[10px] font-mono-tabular uppercase tracking-wider text-slate-400">
              POS
            </span>
            <div className="flex items-baseline gap-1 font-display font-bold tabular-nums">
              <span className="text-2xl sm:text-3xl text-amber-400 hud-stroke leading-none">
                {telemetry.position}
              </span>
              <span className="text-xs text-slate-400">/{telemetry.totalCars}</span>
            </div>
          </div>

          <div className="w-px h-8 bg-slate-800" />

          {/* Lap Readout */}
          <div className="flex flex-col">
            <span className="text-[10px] font-mono-tabular uppercase tracking-wider text-slate-400">
              LAP
            </span>
            <div className="flex items-baseline gap-1 font-display font-bold tabular-nums">
              <span className="text-2xl sm:text-3xl text-slate-100 hud-stroke leading-none">
                {telemetry.lap}
              </span>
              <span className="text-xs text-slate-400">/{telemetry.totalLaps}</span>
            </div>
          </div>

          <div className="w-px h-8 bg-slate-800 hidden sm:block" />

          {/* Race & Best Lap Clock */}
          <div className="hidden sm:flex flex-col font-mono-tabular text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-400">TIME</span>
              <span className="text-slate-100 font-bold">
                {formatTimeMs(telemetry.totalTimeMs)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 mt-0.5">
              <span className="text-slate-400">BEST</span>
              <span className="text-emerald-400 font-bold">
                {telemetry.bestLapTimeMs !== null
                  ? formatTimeMs(telemetry.bestLapTimeMs)
                  : '--:--.-'}
              </span>
            </div>
          </div>
        </div>

        {/* Center Status Callout Banner (Transient Event Feedback) */}
        {telemetry.statusBanner && (
          <div
            className="hidden md:flex items-center px-4 py-1.5 rounded border border-emerald-500/50 text-emerald-300 font-display font-bold text-sm tracking-wider uppercase shadow-md"
            style={{ backgroundColor: 'rgba(9, 13, 20, 0.92)' }}
          >
            {telemetry.statusBanner}
          </div>
        )}

        {/* Cluster 2 (Top-Right): Utility SVG Buttons + Live Track Minimap */}
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2 pointer-events-auto">
            {/* Mute [M] Button */}
            <button
              type="button"
              tabIndex={-1}
              aria-label={isMuted ? 'Unmute Audio [M]' : 'Mute Audio [M]'}
              title={isMuted ? 'Unmute Audio [M]' : 'Mute Audio [M]'}
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleMute();
              }}
              className="w-10 h-10 rounded-lg border border-slate-800 hover:border-slate-600 flex items-center justify-center text-slate-200 transition-colors cursor-pointer"
              style={{ backgroundColor: 'rgba(9, 13, 20, 0.9)' }}
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
                {isMuted ? (
                  <>
                    <path d="M11 5L6 9H2v6h4l5 4V5z" fill="#1e293b" />
                    <line x1="23" y1="9" x2="17" y2="15" stroke="#ef4444" />
                    <line x1="17" y1="9" x2="23" y2="15" stroke="#ef4444" />
                  </>
                ) : (
                  <>
                    <path d="M11 5L6 9H2v6h4l5 4V5z" fill="#10b981" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke="#10b981" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" stroke="#34d399" />
                  </>
                )}
              </svg>
            </button>

            {/* Restart [R] Button */}
            <button
              type="button"
              tabIndex={-1}
              aria-label="Restart Race"
              title="Restart Race"
              onClick={(e) => {
                e.currentTarget.blur();
                onRestartRace();
              }}
              className="w-10 h-10 rounded-lg border border-slate-800 hover:border-slate-600 flex items-center justify-center text-slate-200 transition-colors cursor-pointer"
              style={{ backgroundColor: 'rgba(9, 13, 20, 0.9)' }}
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </button>

            {/* Pause [P / Esc] Button */}
            <button
              type="button"
              tabIndex={-1}
              aria-label="Pause Game [P]"
              title="Pause Game [P]"
              onClick={(e) => {
                e.currentTarget.blur();
                onTogglePause();
              }}
              className="w-10 h-10 rounded-lg border border-slate-800 hover:border-slate-600 flex items-center justify-center text-slate-200 transition-colors cursor-pointer"
              style={{ backgroundColor: 'rgba(9, 13, 20, 0.9)' }}
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            </button>
          </div>

          {/* Live Vector Track Minimap */}
          <div
            className="hidden sm:block w-36 h-24 rounded-lg border border-slate-800/90 p-1.5"
            style={{ backgroundColor: 'rgba(9, 13, 20, 0.88)' }}
          >
            <svg
              viewBox={`0 0 ${track.arenaWidth} ${track.arenaHeight}`}
              className="w-full h-full overflow-visible"
              aria-label="Circuit Minimap"
            >
              <path
                d={minimapPath}
                fill="none"
                stroke="#334155"
                strokeWidth="90"
                strokeLinejoin="round"
              />
              {telemetry.minimapCars.map((mc) => (
                <circle
                  key={mc.id}
                  cx={mc.x}
                  cy={mc.y}
                  r={mc.isPlayer ? 68 : 48}
                  fill={mc.color}
                  stroke="#06090e"
                  strokeWidth="22"
                />
              ))}
            </svg>
          </div>
        </div>
      </div>

      {/* BOTTOM PERIMETER ROW: Mobile Touch Pads + Telemetry Speedometer & Overdrive Cluster */}
      <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-end justify-between gap-2.5 sm:gap-4">
        {/* Touch Controls for Mobile / Small Viewports */}
        <div className="grid grid-cols-4 sm:hidden items-center gap-2 pointer-events-auto w-full">
          <button
            type="button"
            aria-label="Steer Left"
            onPointerDown={() => {
              virtualInputRef.current.left = true;
            }}
            onPointerUp={() => {
              virtualInputRef.current.left = false;
            }}
            onPointerLeave={() => {
              virtualInputRef.current.left = false;
            }}
            className="h-12 rounded-lg border border-slate-700 bg-[#0d131f] active:bg-slate-800 text-slate-100 font-display font-bold text-lg flex items-center justify-center"
          >
            ◀
          </button>
          <button
            type="button"
            aria-label="Steer Right"
            onPointerDown={() => {
              virtualInputRef.current.right = true;
            }}
            onPointerUp={() => {
              virtualInputRef.current.right = false;
            }}
            onPointerLeave={() => {
              virtualInputRef.current.right = false;
            }}
            className="h-12 rounded-lg border border-slate-700 bg-[#0d131f] active:bg-slate-800 text-slate-100 font-display font-bold text-lg flex items-center justify-center"
          >
            ▶
          </button>
          <button
            type="button"
            aria-label="Accelerate"
            onPointerDown={() => {
              virtualInputRef.current.throttle = true;
            }}
            onPointerUp={() => {
              virtualInputRef.current.throttle = false;
            }}
            onPointerLeave={() => {
              virtualInputRef.current.throttle = false;
            }}
            className="h-12 rounded-lg border border-emerald-500/70 bg-emerald-950/90 active:bg-emerald-800 text-emerald-300 font-display font-bold text-xs uppercase tracking-wider flex items-center justify-center whitespace-nowrap"
          >
            GAS [W]
          </button>
          <button
            type="button"
            aria-label="Nitro Boost"
            onPointerDown={() => {
              virtualInputRef.current.boost = true;
            }}
            onPointerUp={() => {
              virtualInputRef.current.boost = false;
            }}
            onPointerLeave={() => {
              virtualInputRef.current.boost = false;
            }}
            className="h-12 rounded-lg border border-amber-500/70 bg-amber-950/90 active:bg-amber-800 text-amber-300 font-display font-bold text-xs uppercase tracking-wider flex items-center justify-center whitespace-nowrap"
          >
            NITRO
          </button>
        </div>

        {/* Cluster 3 (Bottom-Right): Speedometer, Overdrive Increasing Speed Stage & Nitro Meter */}
        <div
          className="w-full sm:w-auto sm:ml-auto px-3.5 py-2.5 sm:px-4 sm:py-3 rounded-lg border border-slate-800/90 flex flex-col gap-2 sm:min-w-[290px] shadow-xl"
          style={{ backgroundColor: 'rgba(9, 13, 20, 0.92)' }}
        >
          {/* Top Row: Speed Hero Readout + Overdrive Stage Pips */}
          <div className="flex items-end justify-between gap-3">
            <div>
              <span className="text-[10px] font-mono-tabular uppercase tracking-wider text-slate-400 block whitespace-nowrap">
                SPEED · CAP {telemetry.topSpeedCapKmh} KM/H
              </span>
              <div className="flex items-baseline gap-1.5">
                <span
                  data-testid="hud-speed-kmh"
                  className={`font-display font-bold text-3xl sm:text-4xl tabular-nums hud-stroke leading-none ${
                    telemetry.isBoosting
                      ? 'text-cyan-400'
                      : telemetry.overdriveStage >= 4
                        ? 'text-amber-400'
                        : 'text-slate-100'
                  }`}
                >
                  {telemetry.speedKmh}
                </span>
                <span className="text-xs font-mono-tabular text-slate-400 font-semibold">
                  KM/H
                </span>
              </div>
            </div>

            {/* 5 Discrete Overdrive Stage Pips (Full / Active / Hollow Socket) */}
            <div className="flex flex-col items-end">
              <span
                data-testid="hud-overdrive-stage"
                className="text-[11px] font-display font-bold tracking-wider uppercase text-emerald-400 whitespace-nowrap"
              >
                OVERDRIVE STG {telemetry.overdriveStage}/{MAX_OVERDRIVE_STAGE}
              </span>
              <div className="flex items-center gap-1 mt-1" aria-label={`Overdrive Stage ${telemetry.overdriveStage} of ${MAX_OVERDRIVE_STAGE}`}>
                {[1, 2, 3, 4, 5].map((stageNum) => {
                  const isUnlocked = stageNum <= telemetry.overdriveStage;
                  const isCurrent = stageNum === telemetry.overdriveStage;
                  return (
                    <svg key={stageNum} viewBox="0 0 18 12" className="w-4 h-3">
                      <polygon
                        points="3,1 17,1 14,11 0,11"
                        fill={
                          isUnlocked
                            ? stageNum >= 4
                              ? '#f59e0b'
                              : '#10b981'
                            : '#0f172a'
                        }
                        stroke={isCurrent ? '#f8fafc' : '#334155'}
                        strokeWidth="1.5"
                      />
                    </svg>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Middle Bar: Overdrive Next-Stage Progression + Momentum Ramp */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[10px] font-mono-tabular text-slate-400">
              <span className="whitespace-nowrap">{stageParams.label}</span>
              <span className="whitespace-nowrap">
                {telemetry.overdriveStage >= MAX_OVERDRIVE_STAGE
                  ? 'MAX SPEED TIER'
                  : `NEXT STAGE ${telemetry.overdriveCharge}%`}
              </span>
            </div>
            <div className="w-full h-2 bg-slate-900 rounded-sm overflow-hidden border border-slate-800">
              <div
                className="h-full bg-emerald-500 transition-transform duration-75 origin-left"
                style={{
                  transform: `scaleX(${Math.max(0.02, telemetry.overdriveCharge / 100)})`,
                }}
              />
            </div>
          </div>

          {/* Bottom Bar: Nitro Boost [SPACE] */}
          <div className="flex items-center gap-2.5">
            <span className="text-[10px] font-mono-tabular uppercase tracking-wider text-amber-400 shrink-0 whitespace-nowrap">
              NITRO [SPACE]
            </span>
            <div className="flex-1 h-2 bg-slate-900 rounded-sm overflow-hidden border border-slate-800">
              <div
                className="h-full bg-amber-400 transition-transform duration-75 origin-left"
                style={{
                  transform: `scaleX(${Math.max(0, telemetry.nitroFuel / 100)})`,
                }}
              />
            </div>
            <span className="text-[10px] font-mono-tabular text-slate-300 w-8 text-right">
              {telemetry.nitroFuel}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
