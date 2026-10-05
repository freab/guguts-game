"use client";

import { useEffect } from "react";
import { posterFont } from "../fonts";
import { GOAT_CALLS, runStore, useRun } from "../game/runStore";
import { formatTime } from "../leaderboard/shared";

export interface PauseActions {
  onResume: () => void;
  /** Back to the game, calling the goat. */
  onCallGoat: () => void;
  onRestart: () => void;
  onControls: () => void;
  onLeaderboard: () => void;
  onSettings: () => void;
  onChangeLevel: () => void;
}

/**
 * The pause menu (Esc, P, the pause button, or leaving the tab). The clock
 * stops while it's open.
 */
export default function PauseMenu(actions: PauseActions) {
  const run = useRun();

  useEffect(() => {
    runStore.setPaused("menu", true);
    if (document.pointerLockElement) document.exitPointerLock();
    return () => runStore.setPaused("menu", false);
  }, []);

  const button =
    "w-full rounded-full px-5 py-2.5 text-sm font-semibold transition-colors bg-white/10 text-white hover:bg-white/20";
  return (
    <div className="absolute inset-0 z-[66] flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[92vh] w-full max-w-xs overflow-y-auto rounded-3xl border border-white/10 bg-[#0b0d08]/95 p-6 text-[#fdf3d4] shadow-2xl">
        <h2 className={`${posterFont.className} text-center text-5xl tracking-wide`}>Paused</h2>
        {run.phase === "running" && (
          <p className="mt-1 text-center font-mono text-lg tabular-nums text-amber-200">
            {formatTime(runStore.elapsed())}
          </p>
        )}
        <div className="mt-5 space-y-2">
          <button
            type="button"
            autoFocus
            onClick={actions.onResume}
            className="w-full rounded-full bg-amber-300 px-5 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-amber-200"
          >
            Resume
          </button>
          <button type="button" onClick={actions.onCallGoat} className={button}>
            {run.calls > 0 ? `Call the goat (${run.calls} of ${GOAT_CALLS} left)` : "Call the goat — too thirsty, find water"}
          </button>
          <button type="button" onClick={actions.onRestart} className={button}>
            Restart (new maze)
          </button>
          <button type="button" onClick={actions.onControls} className={button}>
            Controls
          </button>
          <button type="button" onClick={actions.onLeaderboard} className={button}>
            Leaderboard
          </button>
          <button type="button" onClick={actions.onSettings} className={button}>
            Settings
          </button>
          <button type="button" onClick={actions.onChangeLevel} className={button}>
            Change level
          </button>
        </div>
      </div>
    </div>
  );
}
