import { allowWrite } from "../../leaderboard/rateLimit";
import { cleanName, isPlayerId } from "../../leaderboard/shared";
import { leaderboardStore } from "../../leaderboard/store";

export const dynamic = "force-dynamic";

const error = (status: number, message: string) => Response.json({ error: message }, { status });

/** PUT /api/player { playerId, name } — rename a player on every board. */
export async function PUT(request: Request) {
  if (!allowWrite(request)) return error(429, "Too many changes — try again in a minute");
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return error(400, "Invalid JSON");
  }
  const name = cleanName(body.name);
  if (!isPlayerId(body.playerId)) return error(400, "Invalid player");
  if (!name) return error(400, "Invalid name");
  try {
    await leaderboardStore().rename(body.playerId, name);
    return Response.json({ name });
  } catch (e) {
    console.error(e);
    return error(503, "Leaderboard unavailable");
  }
}
