"use client";

import { formatTime, type LeaderboardResponse } from "../leaderboard/shared";

/**
 * A level's board: the top times, the player's row highlighted — and shown
 * below the top rows too when they're further down.
 */
export default function LeaderboardTable({
  data,
  loading,
  error,
  youName,
}: {
  data: LeaderboardResponse | null;
  loading: boolean;
  error: string | null;
  /** The player's current name (their row may have been saved under an older one). */
  youName: string;
}) {
  if (error) return <p className="py-6 text-center text-sm text-amber-200/90">{error}</p>;
  if (!data) return <p className="py-6 text-center text-sm text-white/50">{loading ? "Loading…" : ""}</p>;
  if (data.entries.length === 0) {
    return <p className="py-6 text-center text-sm text-white/60">No times yet — be the first to bring her home.</p>;
  }

  const youShown = data.entries.some((e) => e.you);
  const row = (rank: number, name: string, timeMs: number, you: boolean) => (
    <tr key={`${rank}-${name}`} className={you ? "bg-amber-300/15 text-amber-100" : "odd:bg-white/[0.03]"}>
      <td className="w-10 py-1.5 pl-3 pr-2 text-right tabular-nums text-white/60">{rank}</td>
      <td className="max-w-0 truncate py-1.5 pr-3">
        {you ? youName : name}
        {you && <span className="ml-1.5 text-xs text-amber-200/80">(you)</span>}
      </td>
      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{formatTime(timeMs)}</td>
    </tr>
  );

  return (
    <div>
      <table className="w-full table-fixed text-sm">
        <tbody>
          {data.entries.map((e) => row(e.rank, e.name, e.timeMs, e.you))}
          {!youShown && data.you && (
            <>
              <tr>
                <td colSpan={3} className="py-0.5 text-center text-white/30">
                  ⋯
                </td>
              </tr>
              {row(data.you.rank, youName, data.you.timeMs, true)}
            </>
          )}
        </tbody>
      </table>
      <p className="mt-2 text-right text-xs text-white/40">
        {data.players} {data.players === 1 ? "player" : "players"}
        {data.storage === "local" && " · local board (this server only)"}
      </p>
    </div>
  );
}
