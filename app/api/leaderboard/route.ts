import { allowWrite } from "../../leaderboard/rateLimit";
import { cleanName, isLevelId, isPlausibleTime, isPlayerId } from "../../leaderboard/shared";
import { leaderboardStore } from "../../leaderboard/store";

// Always fresh: the board changes with every finished run.
export const dynamic = "force-dynamic";

const error = (status: number, message: string) => Response.json({ error: message }, { status });

/** GET /api/leaderboard?level=easy&player=<id> — the top of a level's board, and the player's place. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const level = params.get("level");
  if (!isLevelId(level)) return error(400, "Unknown level");
  const player = params.get("player");
  try {
    return Response.json(await leaderboardStore().board(level, isPlayerId(player) ? player : null));
  } catch (e) {
    console.error(e);
    return error(503, "Leaderboard unavailable");
  }
}

/** POST /api/leaderboard { level, playerId, name, timeMs } — record a finished run (keeps the player's best). */
export async function POST(request: Request) {
  if (!allowWrite(request)) return error(429, "Too many submissions — try again in a minute");
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return error(400, "Invalid JSON");
  }
  const { level, playerId, timeMs } = body;
  const name = cleanName(body.name);
  if (!isLevelId(level)) return error(400, "Unknown level");
  if (!isPlayerId(playerId)) return error(400, "Invalid player");
  if (!name) return error(400, "Invalid name");
  if (!isPlausibleTime(level, timeMs)) return error(422, "That time isn't possible");
  try {
    return Response.json(await leaderboardStore().submit(level, playerId, name, Math.round(timeMs)));
  } catch (e) {
    console.error(e);
    return error(503, "Leaderboard unavailable");
  }
}
