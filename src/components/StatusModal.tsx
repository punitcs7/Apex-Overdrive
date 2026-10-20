import React from 'react';
import { formatTimeMs, MAX_OVERDRIVE_STAGE } from '../game/rules';
import { GameState, HudTelemetry, RunSnapshot } from '../game/types';

interface StatusModalProps {
  gameState: GameState;
  telemetry: HudTelemetry;
  runSnapshot: RunSnapshot | null;
  onResume: () => void;
  onRestart: () => void;
  onReturnToTitle: () => void;
}

export const StatusModal: React.FC<StatusModalProps> = ({
  gameState,
  telemetry,
  runSnapshot,
  onResume,
  onRestart,
  onReturnToTitle,
}) => {
  if (gameState !== 'paused' && gameState !== 'gameover') {
    return null;
  }

  const isPaused = gameState === 'paused';
  const position = isPaused
    ? telemetry.position
    : runSnapshot?.finishPosition ?? telemetry.position;
  const totalCars = isPaused
    ? telemetry.totalCars
    : runSnapshot?.totalCars ?? telemetry.totalCars;
  const totalTimeMs = isPaused
    ? telemetry.totalTimeMs
    : runSnapshot?.totalTimeMs ?? telemetry.totalTimeMs;
  const bestLapMs = isPaused
    ? telemetry.bestLapTimeMs
    : runSnapshot?.bestLapTimeMs ?? telemetry.bestLapTimeMs;
  const peakSpeedKmh = isPaused
    ? telemetry.peakSpeedKmh
    : runSnapshot?.peakSpeedKmh ?? telemetry.peakSpeedKmh;
  const overdriveStage = isPaused
    ? telemetry.overdriveStage
    : runSnapshot?.maxOverdriveStage ?? telemetry.overdriveStage;

  const isPodiumFirst = !isPaused && position === 1;

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(6, 9, 14, 0.84)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-status-heading"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-[#0c121e] p-6 sm:p-8 shadow-2xl flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div>
            <span className="text-xs font-mono-tabular uppercase tracking-wider text-emerald-400 block">
              {isPaused ? 'RACE SUSPENDED' : runSnapshot?.trackName || 'CHECKERED FLAG'}
            </span>
            <h2
              id="modal-status-heading"
              className="font-display font-bold text-2xl sm:text-3xl text-slate-100 tracking-wide uppercase mt-0.5"
            >
              {isPaused
                ? 'Telemetry Paused'
                : isPodiumFirst
                  ? '1st Place Victory!'
                  : `Finished #${position} of ${totalCars}`}
            </h2>
          </div>

          {/* Position Emblem */}
          <div className="px-3 py-1.5 rounded bg-slate-900 border border-slate-700 font-display font-bold text-xl text-amber-400 tabular-nums">
            P{position}
          </div>
        </div>

        {/* 2x2 Tabular Telemetry Stat Grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3.5 rounded-lg bg-[#090d16] border border-slate-800/90">
            <span className="text-[11px] font-mono-tabular uppercase text-slate-400 block">
              Total Time
            </span>
            <span className="font-display font-bold text-xl text-slate-100 tabular-nums mt-0.5 block">
              {formatTimeMs(totalTimeMs)}
            </span>
          </div>

          <div className="p-3.5 rounded-lg bg-[#090d16] border border-slate-800/90">
            <span className="text-[11px] font-mono-tabular uppercase text-slate-400 block">
              Best Lap
            </span>
            <span className="font-display font-bold text-xl text-emerald-400 tabular-nums mt-0.5 block">
              {bestLapMs !== null ? formatTimeMs(bestLapMs) : '--:--.-'}
            </span>
          </div>

          <div className="p-3.5 rounded-lg bg-[#090d16] border border-slate-800/90">
            <span className="text-[11px] font-mono-tabular uppercase text-slate-400 block">
              Peak Speed
            </span>
            <span className="font-display font-bold text-xl text-cyan-400 tabular-nums mt-0.5 block">
              {peakSpeedKmh} KM/H
            </span>
          </div>

          <div className="p-3.5 rounded-lg bg-[#090d16] border border-slate-800/90">
            <span className="text-[11px] font-mono-tabular uppercase text-slate-400 block">
              Overdrive Tier
            </span>
            <span className="font-display font-bold text-xl text-amber-400 tabular-nums mt-0.5 block">
              STAGE {overdriveStage}/{MAX_OVERDRIVE_STAGE}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center gap-3 pt-1">
          {isPaused ? (
            <>
              <button
                type="button"
                onClick={onResume}
                className="w-full sm:flex-1 py-3 px-5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-display font-bold text-base uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap"
              >
                Resume Race
              </button>
              <button
                type="button"
                onClick={onRestart}
                className="w-full sm:w-auto py-3 px-5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 font-display font-bold text-base uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap"
              >
                Restart
              </button>
              <button
                type="button"
                onClick={onReturnToTitle}
                className="w-full sm:w-auto py-3 px-4 rounded-lg border border-slate-700 hover:border-slate-500 text-slate-300 font-display font-bold text-sm uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap"
              >
                Title
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                data-start="true"
                onClick={onRestart}
                className="w-full sm:flex-1 py-3.5 px-6 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-display font-bold text-base uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap"
              >
                Race Again
              </button>
              <button
                type="button"
                onClick={onReturnToTitle}
                className="w-full sm:w-auto py-3.5 px-5 rounded-lg border border-slate-700 hover:border-slate-500 text-slate-200 font-display font-bold text-base uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap"
              >
                Select Track
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
