import React, { useEffect, useState } from 'react';
import { extractRoomCode } from '../game/multiplayerRules';
import { TRACKS } from '../game/tracks';
import { RoomStatePayload, TrackId } from '../game/types';

export interface ActiveRoomSummary {
  roomId: string;
  hostId?: string;
  hostName: string;
  trackId: TrackId;
  playerCount: number;
  maxPlayers: number;
  status: 'lobby' | 'racing' | 'finished';
  room?: RoomStatePayload;
}

interface TitleOverlayProps {
  selectedTrackId: TrackId;
  playerName: string;
  openRooms?: ActiveRoomSummary[];
  onUpdatePlayerName: (name: string) => void;
  onSelectTrack: (id: TrackId) => void;
  onStartSoloRace: () => void;
  onCreateOnlineRoom: () => void;
  onJoinOnlineRoom: (roomCode: string, knownRoom?: RoomStatePayload) => void;
  onDeleteOnlineRoom?: (roomCode: string) => void;
  onClearAllOnlineRooms?: () => void;
}

export const TitleOverlay: React.FC<TitleOverlayProps> = ({
  selectedTrackId,
  playerName,
  openRooms = [],
  onUpdatePlayerName,
  onSelectTrack,
  onStartSoloRace,
  onCreateOnlineRoom,
  onJoinOnlineRoom,
  onDeleteOnlineRoom,
  onClearAllOnlineRooms,
}) => {
  const [joinCodeInput, setJoinCodeInput] = useState('');

  // Bind Enter and Space while in 'title' (unless typing in an input) to start solo race
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        onStartSoloRace();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onStartSoloRace]);

  const trackList = Object.values(TRACKS);

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = extractRoomCode(joinCodeInput);
    if (cleaned.length >= 3) {
      onJoinOnlineRoom(cleaned);
    }
  };

  return (
    <div
      className="fixed inset-0 z-20 flex flex-col justify-between p-6 sm:p-10 lg:p-12 pointer-events-none overflow-y-auto"
      style={{
        background:
          'linear-gradient(90deg, rgba(6, 9, 14, 0.95) 0%, rgba(6, 9, 14, 0.85) 42%, rgba(6, 9, 14, 0.22) 74%, rgba(6, 9, 14, 0.0) 100%)',
      }}
    >
      {/* Left-Third Negative Space Focal Lockup */}
      <div className="w-full max-w-xl my-auto flex flex-col items-start gap-5 pointer-events-auto">
        {/* Bespoke Inline SVG Motorsport Title Emblem */}
        <div className="w-full">
          <svg
            viewBox="0 0 460 132"
            className="w-full max-w-[430px] h-auto overflow-visible"
            role="img"
            aria-label="Apex Overdrive"
          >
            {/* Outer Tachometer Crest Frame */}
            <path
              d="M 12 26 L 195 26 L 215 10 L 444 10 L 432 118 L 16 118 L 4 46 Z"
              fill="#0c121d"
              stroke="#1e293b"
              strokeWidth="2.5"
            />
            {/* Top Speed Accent Bar */}
            <path d="M 218 10 L 444 10 L 441 18 L 212 18 Z" fill="#10b981" />
            <path d="M 16 114 L 185 114 L 192 118 L 16 118 Z" fill="#f59e0b" />

            {/* Checkered Motorsport Crest Icon */}
            <g transform="translate(24, 34)">
              <rect x="0" y="0" width="44" height="44" rx="6" fill="#111827" stroke="#334155" strokeWidth="2" />
              {/* Mini Checkered Pattern */}
              <rect x="6" y="6" width="8" height="8" fill="#f8fafc" />
              <rect x="22" y="6" width="8" height="8" fill="#f8fafc" />
              <rect x="14" y="14" width="8" height="8" fill="#f8fafc" />
              <rect x="30" y="14" width="8" height="8" fill="#f8fafc" />
              {/* RPM Tachometer Sweep Arc */}
              <path
                d="M 8 36 A 16 16 0 0 1 36 26"
                fill="none"
                stroke="#10b981"
                strokeWidth="3.5"
                strokeLinecap="round"
              />
              <circle cx="22" cy="34" r="3.5" fill="#f59e0b" />
              <line x1="22" y1="34" x2="35" y2="23" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" />
            </g>

            {/* Primary Display Lettering */}
            <text
              x="82"
              y="66"
              fill="#f8fafc"
              fontFamily="'Chakra Petch', sans-serif"
              fontWeight="700"
              fontStyle="italic"
              fontSize="44"
              letterSpacing="2"
            >
              APEX
            </text>
            <text
              x="212"
              y="66"
              fill="#10b981"
              fontFamily="'Chakra Petch', sans-serif"
              fontWeight="700"
              fontStyle="italic"
              fontSize="44"
              letterSpacing="2"
            >
              OVERDRIVE
            </text>

            {/* Sub-header Technical Specification Line */}
            <text
              x="84"
              y="95"
              fill="#94a3b8"
              fontFamily="'JetBrains Mono', monospace"
              fontWeight="600"
              fontSize="12"
              letterSpacing="1.3"
            >
              BAHRAIN & INDIA F1 CIRCUITS · 22-CAR WIDE GRID RACER
            </text>
          </svg>
        </div>

        {/* Circuit Selection Switcher (Bahrain Sakhir F1 & India Buddh F1) */}
        <div className="w-full flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs font-mono-tabular uppercase tracking-wider text-slate-400">
            <span>Select Real F1 Circuit Track (22-Car Wide Asphalt)</span>
            <span className="text-emerald-400">FIA GRADE-1 LAYOUTS</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label="Circuit Track Selection">
            {trackList.map((t) => {
              const isSelected = t.id === selectedTrackId;
              // Build mini SVG path from track samples
              const pts = t.samples;
              let svgPath = '';
              if (pts.length > 0) {
                svgPath = `M ${pts[0].x.toFixed(0)} ${pts[0].y.toFixed(0)}`;
                for (let i = 6; i < pts.length; i += 6) {
                  svgPath += ` L ${pts[i].x.toFixed(0)} ${pts[i].y.toFixed(0)}`;
                }
                svgPath += ' Z';
              }
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={(e) => {
                    onSelectTrack(t.id);
                    e.currentTarget.blur();
                  }}
                  className={`text-left px-3.5 py-2.5 rounded-lg border transition-colors cursor-pointer flex items-center justify-between gap-3 ${
                    isSelected
                      ? 'bg-[#111c2d] border-emerald-500 text-slate-100 shadow-sm'
                      : 'bg-[#0b111c] border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-display font-bold text-sm sm:text-base tracking-wide whitespace-nowrap">
                        {t.name}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono-tabular text-amber-400/90 mt-0.5 whitespace-nowrap truncate">
                      {t.locationName}
                    </p>
                    <p className="text-[11px] font-mono-tabular text-slate-400 mt-0.5 whitespace-nowrap">
                      {t.circuitLengthKm.split('·').slice(0, 2).join('·').trim()} · {t.totalLaps} Laps
                    </p>
                  </div>

                  {/* Mini Real F1 Circuit Vector Map */}
                  <div className="w-14 h-11 shrink-0 rounded bg-[#070b12] border border-slate-800/80 p-1.5 flex items-center justify-center">
                    <svg
                      viewBox={`0 0 ${t.arenaWidth} ${t.arenaHeight}`}
                      className="w-full h-full overflow-visible"
                      aria-hidden="true"
                    >
                      <path
                        d={svgPath}
                        fill="none"
                        stroke={isSelected ? '#10b981' : '#64748b'}
                        strokeWidth="190"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Online Multiplayer Setup Row: Callsign + Join by Code */}
        <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="title-driver-callsign"
              className="text-[11px] font-mono-tabular uppercase tracking-wider text-slate-400"
            >
              Driver Callsign
            </label>
            <input
              id="title-driver-callsign"
              type="text"
              maxLength={16}
              value={playerName}
              onChange={(e) => onUpdatePlayerName(e.target.value)}
              placeholder="APEX-DRIVER"
              className="px-3 py-2 rounded-lg bg-[#0b111c] border border-slate-800 text-sm font-display font-bold text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <form onSubmit={handleJoinSubmit} className="flex flex-col gap-1">
            <label
              htmlFor="title-room-code"
              className="text-[11px] font-mono-tabular uppercase tracking-wider text-slate-400"
            >
              Room Code or Paste Invite Link
            </label>
            <div className="flex items-center gap-2">
              <input
                id="title-room-code"
                type="text"
                maxLength={180}
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(extractRoomCode(e.target.value))}
                placeholder="6-CHAR CODE"
                className="w-full px-3 py-2 rounded-lg bg-[#0b111c] border border-slate-800 text-sm font-mono-tabular uppercase text-slate-100 focus:outline-none focus:border-amber-400"
              />
              <button
                type="submit"
                disabled={joinCodeInput.trim().length < 3}
                className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 font-display font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer disabled:cursor-not-allowed whitespace-nowrap shrink-0"
              >
                Join Room
              </button>
            </div>
          </form>
        </div>

        {/* Live Open Rooms Quick-Join Bar (with 1-click Join and Delete/Remove controls) */}
        {openRooms.length > 0 && (
          <div
            data-testid="live-rooms-bar"
            className="w-full flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 rounded-lg bg-[#0b111c] border border-emerald-500/40"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-mono-tabular text-emerald-400 font-semibold uppercase whitespace-nowrap">
                LIVE ROOMS:
              </span>
              {openRooms.slice(0, 4).map((r) => (
                <div
                  key={r.roomId}
                  className="inline-flex items-center rounded bg-emerald-500/20 border border-emerald-500/50 overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => onJoinOnlineRoom(r.roomId, r.room)}
                    className="px-2.5 py-1 hover:bg-emerald-500/30 text-xs font-mono-tabular text-slate-100 cursor-pointer whitespace-nowrap transition-colors"
                  >
                    Join {r.roomId} ({r.playerCount}/{r.maxPlayers} · {r.hostName})
                  </button>
                  {onDeleteOnlineRoom && (
                    <button
                      type="button"
                      aria-label={`Delete room ${r.roomId}`}
                      title={`Delete room ${r.roomId}`}
                      data-testid={`delete-live-room-${r.roomId}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteOnlineRoom(r.roomId);
                      }}
                      className="px-2 py-1 border-l border-emerald-500/40 bg-red-950/30 hover:bg-red-500/40 text-[11px] font-mono-tabular font-semibold text-red-300 hover:text-white cursor-pointer transition-colors inline-flex items-center gap-1 whitespace-nowrap"
                    >
                      <svg
                        viewBox="0 0 12 12"
                        className="w-2.5 h-2.5 stroke-current"
                        fill="none"
                        strokeWidth="2"
                        strokeLinecap="round"
                        aria-hidden="true"
                      >
                        <path d="M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5" />
                      </svg>
                      <span>Remove</span>
                    </button>
                  )}
                </div>
              ))}
            </div>

            {onClearAllOnlineRooms && (
              <button
                type="button"
                aria-label="Clear all live rooms"
                data-testid="clear-all-live-rooms"
                onClick={onClearAllOnlineRooms}
                className="px-2 py-0.5 rounded bg-slate-800/90 hover:bg-red-900/60 border border-slate-700 hover:border-red-500/50 text-[11px] font-mono-tabular text-slate-300 hover:text-red-200 cursor-pointer whitespace-nowrap transition-colors"
              >
                Clear All
              </button>
            )}
          </div>
        )}

        {/* Mechanics Callout Strip (Unboxed clean typography with separators) */}
        <div className="text-xs text-slate-300 font-mono-tabular flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="text-emerald-400 font-semibold">OVERDRIVE MECHANIC:</span>
          <span>5 Speed Stages (185 → 350+ KM/H)</span>
          <span aria-hidden="true">·</span>
          <span>22-Car Wide F1 Grid</span>
        </div>

        {/* Primary Action CTAs: Host Online Room + 22-Car Solo F1 GP */}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onCreateOnlineRoom();
            }}
            className="px-6 py-3.5 rounded-lg bg-amber-400 hover:bg-amber-300 active:bg-amber-500 text-slate-950 font-display font-bold text-base tracking-wider uppercase transition-transform active:scale-98 cursor-pointer shadow-lg whitespace-nowrap shrink-0"
          >
            Host Online Room (Up to 22 Cars)
          </button>

          <button
            type="button"
            data-start="true"
            onClick={(e) => {
              e.currentTarget.blur();
              onStartSoloRace();
            }}
            className="px-6 py-3.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-slate-950 font-display font-bold text-base tracking-wider uppercase transition-transform active:scale-98 cursor-pointer shadow-lg whitespace-nowrap shrink-0"
          >
            22-Car Solo F1 GP [Enter]
          </button>
        </div>
      </div>

      {/* Bottom Safe Margin Flat Control-Hint Line */}
      <div className="w-full flex items-center justify-between text-xs font-mono-tabular text-slate-400 pt-4">
        <span>
          WASD / Arrows Drive · Space Nitro Boost · R Recover Car · Esc Pause
        </span>
      </div>
    </div>
  );
};
