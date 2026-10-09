"use client";

import { WIN_SHOT_MS, useRun } from "../game/runStore";

/**
 * Reaching her: a warm light blooms over the screen as the view settles on
 * her (scene/WinShot), peaking just as the story's end comes up over it
 * (ui/GameOver, after WIN_SHOT_MS), then fading away beneath it.
 */
export default function WinFlash() {
  const run = useRun();
  if (run.phase !== "won") return null;
  return (
    <div
      key={run.finishedAt}
      className="pointer-events-none absolute inset-0 z-[64]"
      style={{
        background: "radial-gradient(circle at 50% 50%, rgba(255,236,200,0.95), rgba(255,190,120,0.75) 55%, rgba(255,170,100,0.55))",
        animation: `win-flash ${WIN_SHOT_MS + 1400}ms ease-in-out forwards`,
      }}
    />
  );
}
