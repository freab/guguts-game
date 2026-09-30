/**
 * A small per-client limit on leaderboard writes (in memory, per server
 * instance): enough to stop a script hammering the board, not a security
 * boundary.
 */
const WINDOW_MS = 60_000;
const MAX_WRITES = 12;
const hits = new Map<string, number[]>();

export function allowWrite(request: Request): boolean {
  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
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
