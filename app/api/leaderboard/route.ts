import { allowWrite } from "../../leaderboard/rateLimit";
import { boardName, nameProblem } from "../../leaderboard/names";
import { cleanName, isLevelId, isPlausibleTime, isPlayerId, type LeaderboardResponse } from "../../leaderboard/shared";
import { leaderboardStore } from "../../leaderboard/store";

// Always fresh: the board changes with every finished run.
export const dynamic = "force-dynamic";

const error = (status: number, message: string) => Response.json({ error: message }, { status });

/** A board as sent: any name that slipped in before the filter shows as "Goatherd" (leaderboard/names). */
const clean = <T extends LeaderboardResponse>(board: T): T => ({
  ...board,
  entries: board.entries.map((e) => ({ ...e, name: boardName(e.name) })),
});

/** GET /api/leaderboard?level=easy&player=<id> — the top of a level's board, and the player's place. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const level = params.get("level");
  if (!isLevelId(level)) return error(400, "Unknown level");
  const player = params.get("player");
  try {
    return Response.json(clean(await leaderboardStore().board(level, isPlayerId(player) ? player : null)));
  } catch (e) {
    console.error(e);
    return error(503, "Leaderboard unavailable");
  }
}

/** POST /api/leaderboard { level, playerId, name, timeMs } — record a finished run (keeps the player's best). */
export async function POST(request: Request) {
  if (!(await allowWrite(request))) return error(429, "Too many submissions — try again in a minute");
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
  const problem = nameProblem(name);
  if (problem) return error(422, `${problem} (Settings → name)`);
  if (!isPlausibleTime(level, timeMs)) return error(422, "That time isn't possible");
  try {
    return Response.json(clean(await leaderboardStore().submit(level, playerId, name, Math.round(timeMs))));
  } catch (e) {
    console.error(e);
    return error(503, "Leaderboard unavailable");
  }
}
