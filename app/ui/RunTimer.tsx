"use client";

import { useEffect, useRef } from "react";
import { runStore, useRun } from "../game/runStore";
import { formatTime } from "../leaderboard/shared";

/**
 * The run's clock (top centre; below the top-right buttons on narrow screens). No time limit — it just counts up from the
 * first step and stops at the goat. Updates its own text on each animation
 * frame, so the ticking never re-renders React.
 */
export default function RunTimer() {
  const run = useRun();
  const text = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let id = 0;
    const tick = () => {
      if (text.current) text.current.textContent = formatTime(runStore.elapsed());
      if (runStore.get().phase === "running") id = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(id);
  }, [run.phase, run.startedAt, run.finishedAt]);

  if (run.phase === "idle") return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-14 z-20 -translate-x-1/2 sm:top-3 rounded-full bg-black/50 px-4 py-1.5 font-mono text-lg font-semibold tabular-nums text-zinc-100 backdrop-blur">
      <span ref={text}>0:00.00</span>
      {run.phase === "armed" && (
        <span className="ml-2 hidden font-sans text-xs font-normal text-zinc-300 md:inline">starts when you move</span>
      )}
    </div>
  );
}
