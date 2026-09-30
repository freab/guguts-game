"use client";

import { useState } from "react";
import { useProfile } from "../game/profile";
import { LEVELS, type LevelId } from "../maze/levels";
import Dialog from "./Dialog";
import LeaderboardTable from "./LeaderboardTable";
import { useBoard } from "./useBoard";

/** The global leaderboard, one tab per level (best time per player). */
export default function LeaderboardDialog({ initial, onClose }: { initial: LevelId; onClose: () => void }) {
  const profile = useProfile();
  const [level, setLevel] = useState<LevelId>(initial);
  const board = useBoard(level, profile.id, profile.name);

  return (
    <Dialog title="Leaderboard" onClose={onClose}>
      <div className="mb-3 flex gap-1 rounded-full bg-black/40 p-1">
        {LEVELS.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => setLevel(l.id)}
            className={`flex-1 rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              level === l.id ? "bg-[#fdf3d4] text-black" : "text-white/70 hover:bg-white/10"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>
      <LeaderboardTable data={board.data} loading={board.loading} error={board.error} youName={profile.name} />
    </Dialog>
  );
}
