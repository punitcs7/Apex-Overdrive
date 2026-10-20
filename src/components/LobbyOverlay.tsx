import React, { useState } from 'react';
import {
  buildShareInviteUrl,
  canStartRoomRace,
  MAX_ROOM_PLAYERS,
  MIN_ROOM_PLAYERS,
} from '../game/multiplayerRules';
import { TRACKS } from '../game/tracks';
import { RoomStatePayload, TrackId } from '../game/types';

interface LobbyOverlayProps {
  room: RoomStatePayload;
  localPlayerId: string;
  playerName: string;
  errorBanner: string | null;
  onUpdatePlayerName: (name: string) => void;
  onSelectTrack: (trackId: TrackId) => void;
  onChangeBotCount: (botCount: number) => void;
  onStartMultiplayerRace: () => void;
  onLeaveLobby: () => void;
  onDeleteRoom?: () => void;
}

export const LobbyOverlay: React.FC<LobbyOverlayProps> = ({
  room,
  localPlayerId,
  playerName,
  errorBanner,
  onUpdatePlayerName,
  onSelectTrack,
  onChangeBotCount,
  onStartMultiplayerRace,
  onLeaveLobby,
  onDeleteRoom,
}) => {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const isHost = room.hostId === localPlayerId;
  const startCheck = canStartRoomRace(room);
  const humanCount = room.players.filter((p) => !p.isBot).length;
  const botCount = room.players.filter((p) => p.isBot).length;
  const totalCount = room.players.length;

  // Construct public shareable invite URL (converts private ais-dev-* to public ais-pre-*)
  const shareUrl =
    typeof window !== 'undefined'
      ? buildShareInviteUrl(window.location.origin, window.location.pathname, room.roomId)
      : `https://apex-overdrive.app/?room=${room.roomId}`;

  const handleCopyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2200);
    } catch {
      // Fallback copy via temporary input
      const input = document.createElement('input');
      input.value = shareUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2200);
    }
  };

  const handleCopyRoomCode = async () => {
    try {
      await navigator.clipboard.writeText(room.roomId);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const trackList = Object.values(TRACKS);

  // Build 8 fixed grid slots
  const slots = Array.from({ length: MAX_ROOM_PLAYERS }, (_, idx) => {
    return room.players[idx] || null;
  });

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
      style={{
        background:
          'linear-gradient(135deg, rgba(6, 9, 14, 0.94) 0%, rgba(9, 14, 24, 0.88) 100%)',
      }}
      role="region"
      aria-label="Online Multiplayer Lobby"
    >
      <div className="w-full max-w-4xl rounded-xl border border-slate-800 bg-[#0b111d] p-5 sm:p-7 shadow-2xl flex flex-col gap-6 my-auto">
        {/* Top Bar: Room Header + Player Count + Leave Button */}
        <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-mono-tabular text-emerald-400">
              <span>ONLINE MULTIPLAYER PADDOCK</span>
              <span aria-hidden="true">·</span>
              <span>MIN {MIN_ROOM_PLAYERS} / MAX {MAX_ROOM_PLAYERS} PLAYERS</span>
            </div>
            <h1 className="font-display font-bold text-xl sm:text-2xl text-slate-100 uppercase tracking-wide mt-0.5 whitespace-nowrap">
              Room {room.roomId} · Starting Grid
            </h1>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <div className="px-3 py-2 rounded-lg bg-[#070b12] border border-slate-800 font-mono-tabular text-xs whitespace-nowrap">
              <span className="text-slate-400">RACERS: </span>
              <span
                data-testid="lobby-player-count"
                className={`font-bold text-sm ${
                  totalCount >= MIN_ROOM_PLAYERS ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                {totalCount}/{MAX_ROOM_PLAYERS}
              </span>
            </div>

            {isHost && onDeleteRoom && (
              <button
                type="button"
                data-testid="lobby-delete-room"
                onClick={onDeleteRoom}
                className="px-3 py-2 rounded-lg border border-red-500/50 bg-red-950/30 hover:bg-red-900/50 text-red-200 hover:text-white font-display font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap"
              >
                Delete Room
              </button>
            )}

            <button
              type="button"
              onClick={onLeaveLobby}
              className="px-3 py-2 rounded-lg border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-white font-display font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap"
            >
              Leave Room
            </button>
          </div>
        </div>

        {errorBanner && (
          <div className="px-4 py-2.5 rounded-lg border border-red-500/60 bg-red-950/60 text-red-200 text-xs font-mono-tabular">
            {errorBanner}
          </div>
        )}

        {/* Shareable Invite Link Panel */}
        <div className="p-4 rounded-lg bg-[#070b12] border border-slate-800/90 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-mono-tabular text-slate-400">
              <span className="text-emerald-400 font-semibold whitespace-nowrap">
                PUBLIC INVITE LINK FOR FRIENDS
              </span>
              <span aria-hidden="true">·</span>
              <span>Anyone opening this link joins Room {room.roomId} immediately</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="text"
                readOnly
                aria-label="Shareable Invite Link"
                data-testid="share-invite-url"
                value={shareUrl}
                onClick={(e) => e.currentTarget.select()}
                className="w-full px-3 py-2 rounded bg-[#0c1322] border border-slate-800 text-xs font-mono-tabular text-slate-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <p className="mt-1.5 text-[11px] font-mono-tabular text-slate-400">
              Uses the public <span className="text-emerald-400">ais-pre</span> shared domain (ensure app sharing is enabled via the top-right Share button, or have friends enter code{' '}
              <span className="text-amber-400 font-bold">{room.roomId}</span>).
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleCopyShareLink}
              className="px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-display font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {copiedLink ? 'Invite Link Copied!' : 'Copy Invite Link'}
            </button>
            <button
              type="button"
              onClick={handleCopyRoomCode}
              className="px-3.5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono-tabular font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {copiedCode ? 'Copied!' : `Code: ${room.roomId}`}
            </button>
          </div>
        </div>

        {/* Middle Section: Driver Callsign + Circuit Selection + 8-Slot Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column (5 cols): Driver Setup & Host Controls */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            {/* Driver Callsign Input */}
            <div className="p-4 rounded-lg bg-[#080d17] border border-slate-800/80 flex flex-col gap-2">
              <label
                htmlFor="lobby-driver-name"
                className="text-xs font-mono-tabular uppercase tracking-wider text-slate-400"
              >
                Your Driver Callsign
              </label>
              <input
                id="lobby-driver-name"
                type="text"
                maxLength={16}
                value={playerName}
                onChange={(e) => onUpdatePlayerName(e.target.value)}
                placeholder="Enter Callsign"
                className="px-3 py-2 rounded bg-[#0d1526] border border-slate-700 text-sm font-display font-bold text-slate-100 focus:outline-none focus:border-emerald-500"
              />
            </div>

            {/* Circuit Track Selection (Host interactive, guests read-only) */}
            <div className="p-4 rounded-lg bg-[#080d17] border border-slate-800/80 flex flex-col gap-2.5">
              <div className="flex items-center justify-between text-xs font-mono-tabular text-slate-400">
                <span>CIRCUIT TRACK</span>
                <span>{isHost ? 'HOST CONTROL' : 'SELECTED BY HOST'}</span>
              </div>
              <div className="flex flex-col gap-2">
                {trackList.map((t) => {
                  const selected = room.trackId === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      disabled={!isHost}
                      onClick={() => isHost && onSelectTrack(t.id)}
                      className={`text-left px-3.5 py-2.5 rounded-lg border transition-colors ${
                        selected
                          ? 'bg-[#111c2d] border-emerald-500 text-slate-100'
                          : 'bg-[#0b111c] border-slate-800 text-slate-400 hover:border-slate-700'
                      } ${!isHost ? 'opacity-80 cursor-default' : 'cursor-pointer'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-display font-bold text-sm whitespace-nowrap">
                          {t.name}
                        </span>
                        <span className="text-xs font-mono-tabular text-emerald-400 whitespace-nowrap">
                          {t.totalLaps} LAPS
                        </span>
                      </div>
                      <span className="text-xs text-slate-400 block mt-0.5">{t.subtitle}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Optional AI Grid Fillers (Host can add/remove AI bots or fill all 22 F1 grid slots) */}
            <div className="p-4 rounded-lg bg-[#080d17] border border-slate-800/80 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="text-xs font-mono-tabular uppercase text-slate-300 block">
                    F1 AI Grid Fillers ({botCount} Bots)
                  </span>
                  <span className="text-[11px] text-slate-400 block">
                    Human friends automatically replace bots up to {MAX_ROOM_PLAYERS} cars
                  </span>
                </div>
                {isHost && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      aria-label="Remove AI Bot"
                      disabled={botCount <= 0}
                      onClick={() => onChangeBotCount(Math.max(0, botCount - 1))}
                      className="w-8 h-8 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 font-mono-tabular font-bold text-sm cursor-pointer disabled:cursor-not-allowed"
                    >
                      -
                    </button>
                    <button
                      type="button"
                      aria-label="Add AI Bot"
                      disabled={totalCount >= MAX_ROOM_PLAYERS}
                      onClick={() => onChangeBotCount(botCount + 1)}
                      className="w-8 h-8 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 font-mono-tabular font-bold text-sm cursor-pointer disabled:cursor-not-allowed"
                    >
                      +
                    </button>
                  </div>
                )}
              </div>

              {isHost && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={totalCount >= MAX_ROOM_PLAYERS}
                    onClick={() => onChangeBotCount(MAX_ROOM_PLAYERS - humanCount)}
                    className="flex-1 px-3 py-1.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 disabled:opacity-40 border border-emerald-500/50 text-emerald-300 font-mono-tabular font-bold text-xs uppercase cursor-pointer disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    Fill 22-Car F1 Grid
                  </button>
                  <button
                    type="button"
                    disabled={botCount === 0}
                    onClick={() => onChangeBotCount(0)}
                    className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 font-mono-tabular text-xs uppercase cursor-pointer disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    Clear Bots
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right Column (7 cols): 22-Car Formula 1 Starting Grid Slots */}
          <div className="lg:col-span-7 flex flex-col gap-2.5">
            <div className="flex items-center justify-between text-xs font-mono-tabular text-slate-400">
              <span>F1 STARTING GRID (CAPACITY: {MAX_ROOM_PLAYERS} CARS)</span>
              <span>{humanCount} HUMAN · {botCount} AI BOT</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[340px] overflow-y-auto pr-1">
              {slots.map((slotPlayer, idx) => {
                const isMe = slotPlayer?.id === localPlayerId;
                return (
                  <div
                    key={idx}
                    data-testid={`grid-slot-${idx + 1}`}
                    className={`px-3 py-2 rounded-lg border flex items-center justify-between gap-2 ${
                      slotPlayer
                        ? isMe
                          ? 'bg-[#101d2f] border-emerald-500/80'
                          : 'bg-[#0c1422] border-slate-800'
                        : 'bg-[#070b12]/60 border-slate-800/50 border-dashed'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {/* Grid Position Number */}
                      <span className="font-mono-tabular text-xs font-bold text-slate-500 w-7 shrink-0">
                        P{idx + 1}
                      </span>

                      {slotPlayer ? (
                        <>
                          {/* Car Livery Swatch */}
                          <span
                            className="w-3 h-3 rounded-sm shrink-0 border border-white/20"
                            style={{ backgroundColor: slotPlayer.color }}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 whitespace-nowrap">
                              <span
                                data-testid={isMe ? 'local-grid-callsign' : undefined}
                                className="font-display font-bold text-xs text-slate-100 truncate"
                              >
                                {isMe ? playerName.trim() || slotPlayer.name : slotPlayer.name}
                              </span>
                              {isMe && (
                                <span className="text-[10px] font-mono-tabular text-emerald-400 font-semibold whitespace-nowrap shrink-0">
                                  (YOU)
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] font-mono-tabular text-slate-400 block whitespace-nowrap">
                              {slotPlayer.isHost
                                ? 'Room Host · Ready'
                                : slotPlayer.isBot
                                  ? `F1 AI (${slotPlayer.policy})`
                                  : 'Online Peer · Ready'}
                            </span>
                          </div>
                        </>
                      ) : (
                        <span className="text-[11px] font-mono-tabular text-slate-500 whitespace-nowrap">
                          Open Grid Box
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bottom Footer: Launch Online Race Action & Min-Player Requirement Notice */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-slate-800 pt-4">
          <div className="text-xs font-mono-tabular text-slate-400">
            {startCheck.allowed ? (
              <span className="text-emerald-400">
                Grid Verified ({totalCount}/{MAX_ROOM_PLAYERS} Racers) · Ready for Green Flag!
              </span>
            ) : (
              <span className="text-amber-400">{startCheck.reason}</span>
            )}
          </div>

          {isHost ? (
            <button
              type="button"
              data-start="true"
              disabled={!startCheck.allowed}
              onClick={onStartMultiplayerRace}
              className="w-full sm:w-auto px-8 py-3.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-display font-bold text-base uppercase tracking-wider transition-colors cursor-pointer disabled:cursor-not-allowed whitespace-nowrap shrink-0"
            >
              {startCheck.allowed
                ? `Start Online Race (${totalCount} Players)`
                : `Waiting for Players (Min ${MIN_ROOM_PLAYERS} Required)`}
            </button>
          ) : (
            <div className="px-5 py-3 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono-tabular text-slate-300 whitespace-nowrap">
              Waiting for Host to Launch Race...
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
