"use client";

import { useMemo, useState } from "react";
import { useProfile } from "../game/profile";
import { LEVELS, type LevelId } from "../maze/levels";
import Dialog from "./Dialog";
import LeaderboardTable from "./LeaderboardTable";
import ShareDialog, { type ShareCard } from "./ShareDialog";
import { useBoard } from "./useBoard";

/**
 * The global leaderboard, one tab per level (best time per player) — and,
 * with a time of your own on that level, a card to share it (the board
 * gives way to ui/ShareDialog, and comes back when it closes).
 */
export default function LeaderboardDialog({ initial, onClose }: { initial: LevelId; onClose: () => void }) {
  const profile = useProfile();
  const [level, setLevel] = useState<LevelId>(initial);
  const board = useBoard(level, profile.id, profile.name);
  const [sharing, setSharing] = useState(false);

  const you = board.data?.you;
  const players = board.data?.players;
  const card = useMemo<ShareCard | null>(
    () =>
      you
        ? {
            name: profile.name,
            level: LEVELS.find((l) => l.id === level)!.label,
            timeMs: you.timeMs,
            stars: 0,
            badges: [],
            rank: you.rank,
            players,
            detail: "Personal best",
          }
        : null,
    [you, players, profile.name, level]
  );

  if (sharing && card) return <ShareDialog card={card} onBoard onClose={() => setSharing(false)} />;
  return (
    <Dialog title="Leaderboard" onClose={onClose}>
      <div className="mb-3 flex gap-1 rounded-xl bg-[#303030] p-1">
        {LEVELS.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => setLevel(l.id)}
            className={`flex-1 px-3 py-1.5 text-sm font-medium ${level === l.id ? "ui-cta" : "ui-tile"}`}
          >
            {l.label}
          </button>
        ))}
      </div>
      <LeaderboardTable data={board.data} loading={board.loading} error={board.error} youName={profile.name} />
      {card && (
        <button
          type="button"
          onClick={() => setSharing(true)}
          className="ui-tile mt-3 flex w-full items-center justify-center gap-2 px-4 py-2.5 ui-label"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
          </svg>
          Share my best on {LEVELS.find((l) => l.id === level)!.label}
        </button>
      )}
    </Dialog>
  );
}
