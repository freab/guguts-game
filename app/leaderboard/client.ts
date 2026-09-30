"use client";

import type { LevelId } from "../maze/levels";
import type { LeaderboardResponse, SubmitResponse } from "./shared";

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? "The leaderboard is unavailable right now.");
  return body;
}

/** A level's board, with the player's place on it. */
export async function fetchBoard(level: LevelId, playerId: string): Promise<LeaderboardResponse> {
  const q = new URLSearchParams({ level, player: playerId });
  try {
    return await parse<LeaderboardResponse>(await fetch(`/api/leaderboard?${q}`, { cache: "no-store" }));
  } catch (e) {
    throw e instanceof TypeError ? new Error("Couldn't reach the leaderboard (offline?).") : e;
  }
}

/** Record a finished run; the board keeps the player's best. */
export async function submitRun(level: LevelId, playerId: string, name: string, timeMs: number): Promise<SubmitResponse> {
  try {
    return await parse<SubmitResponse>(
      await fetch("/api/leaderboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level, playerId, name, timeMs: Math.round(timeMs) }),
      })
    );
  } catch (e) {
    throw e instanceof TypeError ? new Error("Couldn't reach the leaderboard (offline?).") : e;
  }
}
