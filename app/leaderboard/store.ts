import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { LEVELS, type LevelId } from "../maze/levels";
import { TOP_N, type LeaderboardEntry, type LeaderboardResponse, type ShareProfile, type SubmitResponse } from "./shared";

/**
 * Where the leaderboard lives (server only — imported by the API routes).
 *
 * - Global: a Redis database over Upstash's REST API, used when its URL and
 *   token are set (UPSTASH_REDIS_REST_URL / _TOKEN, or the KV_REST_API_URL /
 *   _TOKEN names Vercel's Upstash integration sets). One sorted set per level
 *   (player id → best time, lowest first) and one hash of player names.
 * - Local: otherwise, a JSON file in .data/ — fine for development or a
 *   single self-hosted server, but not shared between deployments.
 *
 * A player keeps only their best time per level; renaming changes the name
 * shown on every board.
 *
 * Sharing: a player's public page is found by a share id (shareIdFor) — a
 * one-way hash of their player id, remembered so the page can look them up.
 * The player id itself (which can submit and rename) is never made public.
 */
export interface LeaderboardStore {
  storage: "global" | "local";
  board(level: LevelId, playerId: string | null): Promise<LeaderboardResponse>;
  submit(level: LevelId, playerId: string, name: string, timeMs: number): Promise<SubmitResponse>;
  rename(playerId: string, name: string): Promise<void>;
  /** The player's share id (made and remembered on first use). */
  share(playerId: string): Promise<string>;
  /** A shared player's name and bests, or null for an unknown share id. */
  profile(shareId: string): Promise<ShareProfile | null>;
}

/** A player's share id: the first 12 characters of a hash of their (random, secret) id. */
export function shareIdFor(playerId: string): string {
  return createHash("sha256").update(`gugut-share:${playerId}`).digest("base64url").slice(0, 12);
}

/* ------------------------------------------------------------ Redis (global) */

function redisStore(url: string, token: string): LeaderboardStore {
  const boardKey = (level: LevelId) => `gugut:lb:${level}`;
  const NAMES = "gugut:names";
  const SHARES = "gugut:shares";

  async function pipeline(commands: (string | number)[][]): Promise<unknown[]> {
    const res = await fetch(`${url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      // The REST API takes every argument as a string.
      body: JSON.stringify(commands.map((c) => c.map(String))),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`leaderboard database: HTTP ${res.status}`);
    const results = (await res.json()) as { result?: unknown; error?: string }[];
    return results.map((r) => {
      if (r.error) throw new Error(`leaderboard database: ${r.error}`);
      return r.result;
    });
  }

  async function board(level: LevelId, playerId: string | null): Promise<LeaderboardResponse> {
    const key = boardKey(level);
    const [top, count, rank, score] = await pipeline([
      ["ZRANGE", key, 0, TOP_N - 1, "WITHSCORES"],
      ["ZCARD", key],
      ...(playerId
        ? [
            ["ZRANK", key, playerId],
            ["ZSCORE", key, playerId],
          ]
        : []),
    ]);
    const flat = (top as string[]) ?? [];
    const ids: string[] = [];
    const times: number[] = [];
    for (let i = 0; i < flat.length; i += 2) {
      ids.push(flat[i]);
      times.push(Number(flat[i + 1]));
    }
    const names = ids.length ? ((await pipeline([["HMGET", NAMES, ...ids]]))[0] as (string | null)[]) : [];
    const entries: LeaderboardEntry[] = ids.map((id, i) => ({
      rank: i + 1,
      name: names[i] ?? "Anonymous",
      timeMs: times[i],
      you: id === playerId,
    }));
    return {
      level,
      entries,
      you: typeof rank === "number" && score != null ? { rank: rank + 1, timeMs: Number(score) } : null,
      players: Number(count) || 0,
      storage: "global",
    };
  }

  return {
    storage: "global",
    board,
    async submit(level, playerId, name, timeMs) {
      const key = boardKey(level);
      // ZADD LT: only ever lowers a player's time (a new player is just added).
      const [previous] = await pipeline([
        ["ZSCORE", key, playerId],
        ["ZADD", key, "LT", timeMs, playerId],
        ["HSET", NAMES, playerId, name],
      ]);
      const newBest = previous == null || timeMs < Number(previous);
      return { ...(await board(level, playerId)), newBest };
    },
    async rename(playerId, name) {
      await pipeline([["HSET", NAMES, playerId, name]]);
    },
    async share(playerId) {
      const id = shareIdFor(playerId);
      await pipeline([["HSET", SHARES, id, playerId]]);
      return id;
    },
    async profile(shareId) {
      const [playerId] = await pipeline([["HGET", SHARES, shareId]]);
      if (typeof playerId !== "string") return null;
      const results = await pipeline([
        ["HGET", NAMES, playerId],
        ...LEVELS.flatMap((l) => [
          ["ZSCORE", boardKey(l.id), playerId],
          ["ZRANK", boardKey(l.id), playerId],
          ["ZCARD", boardKey(l.id)],
        ]),
      ]);
      const bests: ShareProfile["bests"] = {};
      LEVELS.forEach((l, i) => {
        const [score, rank, count] = results.slice(1 + i * 3, 4 + i * 3);
        if (score != null && typeof rank === "number") {
          bests[l.id] = { timeMs: Number(score), rank: rank + 1, players: Number(count) || 0 };
        }
      });
      return { name: typeof results[0] === "string" ? results[0] : "Anonymous", bests };
    },
  };
}

/* ---------------------------------------------------------------- file (local) */

interface FileData {
  names: Record<string, string>;
  boards: Partial<Record<LevelId, Record<string, number>>>;
  /** Share id → player id. */
  shares?: Record<string, string>;
}

function fileStore(file: string): LeaderboardStore {
  // One read-modify-write at a time. The file is read on every request (it
  // is small), so editing or deleting it takes effect at once.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  };

  async function load(): Promise<FileData> {
    try {
      return JSON.parse(await readFile(file, "utf8")) as FileData;
    } catch {
      return { names: {}, boards: {} };
    }
  }
  async function save(data: FileData) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(data));
  }

  function boardFrom(d: FileData, level: LevelId, playerId: string | null): LeaderboardResponse {
    const times = d.boards[level] ?? {};
    const sorted = Object.entries(times).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
    const at = playerId ? sorted.findIndex(([id]) => id === playerId) : -1;
    return {
      level,
      entries: sorted.slice(0, TOP_N).map(([id, timeMs], i) => ({
        rank: i + 1,
        name: d.names[id] ?? "Anonymous",
        timeMs,
        you: id === playerId,
      })),
      you: at >= 0 ? { rank: at + 1, timeMs: sorted[at][1] } : null,
      players: sorted.length,
      storage: "local",
    };
  }

  return {
    storage: "local",
    board: (level, playerId) => serial(async () => boardFrom(await load(), level, playerId)),
    submit: (level, playerId, name, timeMs) =>
      serial(async () => {
        const d = await load();
        const times = (d.boards[level] ??= {});
        const previous = times[playerId];
        const newBest = previous === undefined || timeMs < previous;
        if (newBest) times[playerId] = timeMs;
        d.names[playerId] = name;
        await save(d);
        return { ...boardFrom(d, level, playerId), newBest };
      }),
    rename: (playerId, name) =>
      serial(async () => {
        const d = await load();
        d.names[playerId] = name;
        await save(d);
      }),
    share: (playerId) =>
      serial(async () => {
        const d = await load();
        const id = shareIdFor(playerId);
        if ((d.shares ??= {})[id] !== playerId) {
          d.shares[id] = playerId;
          await save(d);
        }
        return id;
      }),
    profile: (shareId) =>
      serial(async () => {
        const d = await load();
        const playerId = d.shares?.[shareId];
        if (!playerId) return null;
        const bests: ShareProfile["bests"] = {};
        for (const l of LEVELS) {
          const you = boardFrom(d, l.id, playerId).you;
          if (you) bests[l.id] = { ...you, players: Object.keys(d.boards[l.id] ?? {}).length };
        }
        return { name: d.names[playerId] ?? "Anonymous", bests };
      }),
  };
}

/* ------------------------------------------------------------------- pick one */

let store: { key: string; store: LeaderboardStore } | null = null;

/** The store for the current environment (re-picked if the Upstash settings change). */
export function leaderboardStore(): LeaderboardStore {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  const key = url && token ? `${url}|${token}` : "local";
  if (store?.key !== key) {
    store = {
      key,
      store: url && token ? redisStore(url, token) : fileStore(path.join(process.cwd(), ".data", "leaderboard.json")),
    };
  }
  return store.store;
}
