"use client";

import { useEffect, useState } from "react";
import { useRun, type Notice } from "../game/runStore";

/** How long a notice stays up (ms), then fades. */
const NOTICE_MS = 5000;
const FADE_MS = 700;

/**
 * A short message to the player under the clock (runStore.notice): the goat
 * calls running out, water found… Each notice shows for a few seconds and
 * fades; a newer one replaces it.
 */
export default function GameNotice() {
  const { notice, phase } = useRun();
  if (!notice || phase === "won" || phase === "idle") return null;
  return <Message key={notice.at} notice={notice} />;
}

function Message({ notice }: { notice: Notice }) {
  const [fading, setFading] = useState(false);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const fade = setTimeout(() => setFading(true), NOTICE_MS);
    const hide = setTimeout(() => setGone(true), NOTICE_MS + FADE_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(hide);
    };
  }, []);
  if (gone) return null;
  return (
    <div
      role="status"
      className={`pointer-events-none absolute left-1/2 top-28 z-20 w-[min(92vw,26rem)] -translate-x-1/2 rounded-2xl bg-black/60 px-4 py-2.5 text-center text-sm text-[#fdf3d4] backdrop-blur transition-opacity sm:top-16 ${
        fading ? "opacity-0" : "opacity-100"
      }`}
      style={{ transitionDuration: `${FADE_MS}ms`, animation: "notice-in 250ms ease-out" }}
    >
      {notice.text}
    </div>
  );
}
