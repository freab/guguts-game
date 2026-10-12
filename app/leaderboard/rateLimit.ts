/**
 * A per-client limit on leaderboard writes (submissions, renames): at most
 * MAX_WRITES a minute. Counted in the leaderboard's Redis when there is one,
 * so it holds across every server instance (Vercel runs many); in memory
 * otherwise (local play). Enough to stop a script hammering the board.
 */
const WINDOW_MS = 60_000;
const MAX_WRITES = 12;
const hits = new Map<string, number[]>();

function clientOf(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

function allowInMemory(client: string): boolean {
  const now = Date.now();
  const recent = (hits.get(client) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_WRITES) {
    hits.set(client, recent);
    return false;
  }
  recent.push(now);
  hits.set(client, recent);
  if (hits.size > 5000) hits.clear(); // don't grow without bound
  return true;
}

export async function allowWrite(request: Request): Promise<boolean> {
  const client = clientOf(request);
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return allowInMemory(client);
  // One counter per client per minute, gone two minutes later.
  const key = `gugut:rl:${client}:${Math.floor(Date.now() / WINDOW_MS)}`;
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        ["INCR", key],
        ["EXPIRE", key, "120"],
      ]),
      cache: "no-store",
    });
    if (!res.ok) return allowInMemory(client);
    const [count] = (await res.json()) as { result?: number }[];
    return (count?.result ?? 0) <= MAX_WRITES;
  } catch {
    // The database is down: the in-memory count, rather than none.
    return allowInMemory(client);
  }
}
