"use client";

import { useCallback, useEffect, useState } from "react";
import { posterFont } from "../../fonts";
import { CODE_LENGTH, PHONE_POLL_MS, cleanRoomCode, isRoomCode, type RemoteAction, type RemoteState } from "../../remote/shared";

const CODE_KEY = "gugut.remote.code";

/**
 * The phone remote (app/present: R on the laptop shows the code). Paired by
 * the laptop's code, it sends taps (api/remote) and shows where the
 * presentation is: the slide, its title, the speaker notes, the X-ray's state.
 * Keeps the screen awake while open.
 */
export default function RemoteClient() {
  const [code, setCode] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  // A code from the address (?code=…) or the last one used here.
  useEffect(() => {
    const fromUrl = cleanRoomCode(new URLSearchParams(window.location.search).get("code") ?? "");
    let saved = "";
    try {
      saved = localStorage.getItem(CODE_KEY) ?? "";
    } catch {
      // Storage blocked: just ask.
    }
    const start = isRoomCode(fromUrl) ? fromUrl : isRoomCode(saved) ? saved : null;
    // (After mount: storage and the address are only here in the browser.)
    const t = window.setTimeout(() => {
      if (start) setCode(start);
      else setTyped(saved);
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  const pair = (next: string) => {
    try {
      localStorage.setItem(CODE_KEY, next);
    } catch {
      // Not remembered, that's all.
    }
    setCode(next);
  };

  return (
    <div className={`${posterFont.variable} mx-auto flex min-h-dvh max-w-md flex-col px-4 py-5 text-[#fdf3d4]`}>
      {code ? <Remote code={code} onUnpair={() => setCode(null)} /> : <Pairing typed={typed} setTyped={setTyped} onPair={pair} />}
    </div>
  );
}

function Pairing({ typed, setTyped, onPair }: { typed: string; setTyped: (v: string) => void; onPair: (code: string) => void }) {
  const clean = cleanRoomCode(typed);
  const valid = isRoomCode(clean);
  return (
    <form
      className="flex flex-1 flex-col justify-center gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onPair(clean);
      }}
    >
      <div>
        <p className="font-[family-name:var(--font-jolly)] text-5xl leading-none">Phone remote</p>
        <p className="mt-3 text-[#fdf3d4]/70">Press R on the presentation to see its code, then type it here.</p>
      </div>
      <input
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        maxLength={CODE_LENGTH + 2}
        placeholder="CODE"
        className="rounded-2xl border border-[#fdf3d4]/25 bg-[#111] px-5 py-4 text-center font-mono text-4xl tracking-[0.35em] uppercase outline-none focus:border-[#c9a45c]"
      />
      <button
        type="submit"
        disabled={!valid}
        className="rounded-2xl bg-[#c9a45c] py-4 text-xl font-semibold text-[#2a2312] disabled:opacity-30"
      >
        Connect
      </button>
    </form>
  );
}

function Remote({ code, onUnpair }: { code: string; onUnpair: () => void }) {
  const [state, setState] = useState<RemoteState | null>(null);
  const [offline, setOffline] = useState(false);

  // Say hello (the laptop shows "phone connected"), then follow the presentation.
  const send = useCallback(
    (action: RemoteAction) => {
      navigator.vibrate?.(12);
      void fetch("/api/remote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, action }),
      }).catch(() => setOffline(true));
    },
    [code]
  );
  useEffect(() => {
    void fetch("/api/remote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, action: "hello" }),
    }).catch(() => {});
    let live = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/remote?code=${code}&as=phone`, { cache: "no-store" });
        const body = (await res.json()) as { state?: RemoteState | null };
        if (!live) return;
        setOffline(!res.ok);
        if (res.ok) setState(body.state ?? null);
      } catch {
        if (live) setOffline(true);
      }
    };
    void poll();
    const id = window.setInterval(poll, PHONE_POLL_MS);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [code]);

  // Keep the screen on while presenting.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const ask = () =>
      (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock
        ?.request("screen")
        .then((l) => (lock = l))
        .catch(() => {});
    void ask();
    const again = () => document.visibilityState === "visible" && void ask();
    document.addEventListener("visibilitychange", again);
    return () => {
      document.removeEventListener("visibilitychange", again);
      void lock?.release();
    };
  }, []);

  const last = state ? state.slide + 1 >= state.count && state.step + 1 >= state.steps : false;
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between text-sm text-[#fdf3d4]/60">
        <span className="flex items-center gap-2">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${offline ? "bg-[#e0523a]" : state ? "bg-[#7fd08a]" : "bg-[#c9a45c]"}`} />
          {offline ? "Can't reach the presentation" : state ? `Slide ${state.slide + 1} / ${state.count}` : "Waiting for the presentation…"}
        </span>
        <button type="button" onClick={onUnpair} className="font-mono tracking-[0.2em] underline-offset-4 hover:underline">
          {code}
        </button>
      </div>

      <div className="min-h-24">
        <p className="font-[family-name:var(--font-jolly)] text-4xl leading-[0.95]">{state?.title ?? "…"}</p>
        {state && state.steps > 1 && (
          <p className="mt-1 text-sm text-[#c9a45c]">
            Step {state.step + 1} of {state.steps}
          </p>
        )}
      </div>

      {/* The notes: what to say. */}
      <div className="flex-1 overflow-y-auto rounded-2xl border border-[#c9a45c]/30 bg-[#111] p-4">
        <p className="mb-2 text-[11px] uppercase tracking-[0.25em] text-[#c9a45c]">Notes</p>
        {state?.notes.length ? (
          <ul className="flex list-disc flex-col gap-2 pl-5 text-lg leading-snug">
            {state.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : (
          <p className="text-[#fdf3d4]/40">No notes for this slide.</p>
        )}
      </div>

      {/* The extras. */}
      <div className="grid grid-cols-3 gap-3">
        <button
          type="button"
          disabled={!state?.xray}
          onClick={() => send("xray")}
          className="col-span-2 rounded-2xl border border-[#c9a45c]/60 bg-[#c9a45c]/15 px-3 py-4 text-left disabled:opacity-25"
        >
          <span className="block text-xl font-semibold">X-ray</span>
          <span className="block text-sm text-[#fdf3d4]/70">
            {state?.xray ? `${state.xray.label}: ${state.xray.state}` : "None on this slide"}
          </span>
        </button>
        <button type="button" onClick={() => send("bleat")} className="rounded-2xl border border-[#fdf3d4]/20 bg-[#111] py-4 text-lg">
          Bleat
        </button>
      </div>

      {/* The big two. */}
      <div className="grid grid-cols-[1fr_2fr] gap-3">
        <button type="button" onClick={() => send("prev")} className="rounded-3xl border border-[#fdf3d4]/20 bg-[#111] py-10 text-2xl active:bg-[#222]">
          ◀
        </button>
        <button
          type="button"
          onClick={() => send("next")}
          disabled={last}
          className="rounded-3xl bg-[#fdf3d4] py-10 text-3xl font-semibold text-[#0b0d08] active:bg-[#e8dcb8] disabled:opacity-30"
        >
          Next ▶
        </button>
      </div>
      <button type="button" onClick={() => send("first")} className="self-center text-sm text-[#fdf3d4]/40 underline-offset-4 hover:underline">
        Back to the first slide
      </button>
    </div>
  );
}
