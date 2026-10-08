import { allowWrite } from "../../leaderboard/rateLimit";
import { isPlayerId } from "../../leaderboard/shared";
import { leaderboardStore } from "../../leaderboard/store";

export const dynamic = "force-dynamic";

const error = (status: number, message: string) => Response.json({ error: message }, { status });

/**
 * POST /api/share { playerId } — the player's share id, for a link to their
 * public page (/s/<id>) with their best times. The player id stays secret:
 * the link carries only a one-way hash of it.
 */
export async function POST(request: Request) {
  if (!allowWrite(request)) return error(429, "Too many requests — try again in a minute");
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return error(400, "Invalid JSON");
  }
  if (!isPlayerId(body.playerId)) return error(400, "Invalid player");
  try {
    return Response.json({ id: await leaderboardStore().share(body.playerId) });
  } catch (e) {
    console.error(e);
    return error(503, "Leaderboard unavailable");
  }
}
