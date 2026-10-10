import type { RemoteAction, RemoteState } from "./shared";

/**
 * Where a remote room lives (server only — api/remote): a queue of the
 * phone's taps, and the presentation's latest state.
 *
 * - Redis over Upstash's REST API when it's configured (the leaderboard's
 *   database: UPSTASH_REDIS_REST_URL / _TOKEN or Vercel's KV_REST_API_*), so it
 *   works on the deployed site, the phone and the laptop on any networks.
 * - Otherwise this server's memory: fine for the dev server, with the phone
 *   on the laptop's network (one process, so both see the same room).
 *
 * Rooms expire after ROOM_TTL_S of quiet.
 */
export interface RemoteStore {
  push(code: string, action: RemoteAction): Promise<void>;
  /** The phone's taps since last asked (oldest first), taken off the queue. */
  take(code: string): Promise<RemoteAction[]>;
  setState(code: string, state: RemoteState): Promise<void>;
  getState(code: string): Promise<RemoteState | null>;
}

const ROOM_TTL_S = 6 * 60 * 60;
/** A burst of taps is kept to this many (older ones dropped). */
const QUEUE_MAX = 20;

function redisStore(url: string, token: string): RemoteStore {
  const cmds = (code: string) => `gugut:remote:${code}:cmds`;
  const state = (code: string) => `gugut:remote:${code}:state`;
  async function pipeline(commands: (string | number)[][]): Promise<unknown[]> {
    const res = await fetch(`${url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands.map((c) => c.map(String))),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`remote database: HTTP ${res.status}`);
    const results = (await res.json()) as { result?: unknown; error?: string }[];
    return results.map((r) => {
      if (r.error) throw new Error(`remote database: ${r.error}`);
      return r.result;
    });
  }
  return {
    async push(code, action) {
      await pipeline([
        ["RPUSH", cmds(code), action],
        ["LTRIM", cmds(code), -QUEUE_MAX, -1],
        ["EXPIRE", cmds(code), ROOM_TTL_S],
      ]);
    },
    async take(code) {
      // One command a poll: pop everything waiting.
      const [taken] = await pipeline([["LPOP", cmds(code), QUEUE_MAX]]);
      return Array.isArray(taken) ? (taken as RemoteAction[]) : [];
    },
    async setState(code, s) {
      await pipeline([["SET", state(code), JSON.stringify(s), "EX", ROOM_TTL_S]]);
    },
    async getState(code) {
      const [raw] = await pipeline([["GET", state(code)]]);
      return typeof raw === "string" ? (JSON.parse(raw) as RemoteState) : null;
    },
  };
}

function memoryStore(): RemoteStore {
  // (On globalThis: the dev server reloads modules, the rooms should survive it.)
  const g = globalThis as typeof globalThis & {
    __gugutRemote?: Map<string, { cmds: RemoteAction[]; state: RemoteState | null; at: number }>;
  };
  const rooms = (g.__gugutRemote ??= new Map());
  const room = (code: string) => {
    const now = Date.now();
    for (const [k, r] of rooms) if (now - r.at > ROOM_TTL_S * 1000) rooms.delete(k);
    let r = rooms.get(code);
    if (!r) rooms.set(code, (r = { cmds: [], state: null, at: now }));
    r.at = now;
    return r;
  };
  return {
    async push(code, action) {
      const r = room(code);
      r.cmds.push(action);
      if (r.cmds.length > QUEUE_MAX) r.cmds.splice(0, r.cmds.length - QUEUE_MAX);
    },
    async take(code) {
      const r = room(code);
      return r.cmds.splice(0);
    },
    async setState(code, s) {
      room(code).state = s;
    },
    async getState(code) {
      return room(code).state;
    },
  };
}

let store: RemoteStore | null = null;

export function remoteStore(): RemoteStore {
  if (!store) {
    const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
    store = url && token ? redisStore(url, token) : memoryStore();
  }
  return store;
}
