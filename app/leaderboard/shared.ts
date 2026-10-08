import { LEVELS, type LevelId } from "../maze/levels";

/**
 * Leaderboard types and input rules, shared by the API (app/api/…) and the
 * game UI. Times are milliseconds from the first step to reaching the goat;
 * each player keeps their best time per level.
 */

export interface LeaderboardEntry {
  rank: number;
  name: string;
  timeMs: number;
  /** This row is the asking player. */
  you: boolean;
}

export interface LeaderboardResponse {
  level: LevelId;
  /** The top of the board (best first). */
  entries: LeaderboardEntry[];
  /** The asking player's best on this board, and its rank (null: no time yet). */
  you: { rank: number; timeMs: number } | null;
  /** Players on this board. */
  players: number;
  /** Where the board is kept: "global" (shared database) or "local" (this server only). */
  storage: "global" | "local";
}

export interface SubmitResponse extends LeaderboardResponse {
  /** The submitted time beat the player's previous best (or is their first). */
  newBest: boolean;
}

/**
 * A player's public page (app/s/[id]): their name and best time on each
 * level they've finished, with its rank. Reached by a share id — never the
 * player id, which is what lets a device submit and rename as that player.
 */
export interface ShareProfile {
  name: string;
  bests: Partial<Record<LevelId, { timeMs: number; rank: number; players: number }>>;
}

/** Share ids: 12 URL-safe characters (store.shareIdFor). */
export function isShareId(raw: unknown): raw is string {
  return typeof raw === "string" && /^[A-Za-z0-9_-]{12}$/.test(raw);
}

export const TOP_N = 10;
export const NAME_MAX = 20;

/** A tidy display name: no control characters, spaces collapsed, at most NAME_MAX. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX)
    .trim();
  return name.length > 0 ? name : null;
}

/** Player ids are random, made on the device (see game/profile.ts). */
export function isPlayerId(raw: unknown): raw is string {
  return typeof raw === "string" && /^[a-zA-Z0-9-]{8,64}$/.test(raw);
}

export function isLevelId(raw: unknown): raw is LevelId {
  return typeof raw === "string" && LEVELS.some((l) => l.id === raw);
}

/**
 * Fastest believable time per level (ms): a first sanity check against junk
 * submissions — no real run is this quick even running flat out.
 */
export const MIN_TIME_MS: Record<LevelId, number> = { easy: 5000, medium: 9000, hard: 13000 };
export const MAX_TIME_MS = 3 * 60 * 60 * 1000;

export function isPlausibleTime(level: LevelId, raw: unknown): raw is number {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= MIN_TIME_MS[level] && raw <= MAX_TIME_MS;
}

/** 83_456 ms → "1:23.45". */
export function formatTime(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}
