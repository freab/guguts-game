"use client";

import { useEffect, useState } from "react";
import { fetchBoard } from "../leaderboard/client";
import type { LeaderboardResponse } from "../leaderboard/shared";
import type { LevelId } from "../maze/levels";

/**
 * A level's leaderboard, fetched (again) whenever the level, the player or
 * `refresh` changes. `seed` shows a board already in hand (e.g. the one the
 * submit returned) without fetching.
 */
export function useBoard(
  level: LevelId | null,
  playerId: string,
  refresh: unknown = 0,
  seed: LeaderboardResponse | null = null
) {
  const key = `${level}|${playerId}|${String(refresh)}`;
  const [result, setResult] = useState<{ key: string; data: LeaderboardResponse | null; error: string | null }>({
    key: "",
    data: null,
    error: null,
  });

  useEffect(() => {
    if (!level || !playerId || seed) return;
    let cancelled = false;
    fetchBoard(level, playerId).then(
      (data) => !cancelled && setResult({ key, data, error: null }),
      (e: Error) => !cancelled && setResult({ key, data: null, error: e.message })
    );
    return () => {
      cancelled = true;
    };
  }, [key, level, playerId, seed]);

  if (seed) return { data: seed, error: null, loading: false };
  const current = result.key === key;
  return { data: current ? result.data : null, error: current ? result.error : null, loading: !current };
}
