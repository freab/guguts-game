import { remoteStore } from "../../remote/store";
import { REMOTE_ACTIONS, isRoomCode, type RemoteAction, type RemoteState } from "../../remote/shared";

export const dynamic = "force-dynamic";

const error = (status: number, message: string) => Response.json({ error: message }, { status });

/**
 * The phone remote (app/present/remote ↔ app/present):
 * GET ?code=…&as=presenter — the phone's taps since last asked (taken off the queue).
 * GET ?code=…&as=phone — the presentation's current slide, title and notes.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  if (!isRoomCode(code)) return error(400, "Unknown code");
  try {
    if (params.get("as") === "presenter") return Response.json({ actions: await remoteStore().take(code) });
    return Response.json({ state: await remoteStore().getState(code) });
  } catch {
    return error(503, "The remote is unavailable right now.");
  }
}

/**
 * POST { code, action } — a tap on the phone.
 * POST { code, state } — the presentation telling the phone where it is.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { code?: unknown; action?: unknown; state?: unknown } | null;
  if (!body || !isRoomCode(body.code)) return error(400, "Unknown code");
  try {
    if (typeof body.action === "string" && (REMOTE_ACTIONS as readonly string[]).includes(body.action)) {
      await remoteStore().push(body.code, body.action as RemoteAction);
      return Response.json({ ok: true });
    }
    if (body.state && typeof body.state === "object") {
      const s = body.state as RemoteState;
      // (Only what the phone shows, and not too much of it.)
      const state: RemoteState = {
        slide: Number(s.slide) || 0,
        count: Number(s.count) || 0,
        step: Number(s.step) || 0,
        steps: Number(s.steps) || 1,
        title: String(s.title ?? "").slice(0, 120),
        notes: Array.isArray(s.notes) ? s.notes.slice(0, 8).map((n) => String(n).slice(0, 400)) : [],
        xray: s.xray ? { label: String(s.xray.label).slice(0, 60), state: String(s.xray.state).slice(0, 30) } : null,
      };
      await remoteStore().setState(body.code, state);
      return Response.json({ ok: true });
    }
    return error(400, "Nothing to do");
  } catch {
    return error(503, "The remote is unavailable right now.");
  }
}
