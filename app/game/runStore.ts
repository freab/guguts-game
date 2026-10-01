"use client";

import { useSyncExternalStore } from "react";
import type { LevelId } from "../maze/levels";

/**
 * One run through the maze. No time limit — the clock just measures it:
 *
 *   idle ─(scene ready)→ armed ─(first step)→ running ─(reach the goat)→ won
 *
 * The clock starts on the player's first step (not when the scene appears),
 * so reading the view or looking around is free, and it stops while the game
 * is paused (pause menu, a dialog, the controls help). Shared by the 3D loop
 * (game/GoalWatcher, the player controller) and the UI.
 */
export type RunPhase = "idle" | "armed" | "running" | "won";

/** Why the game is paused; paused while any is active. */
export type PauseReason = "menu" | "dialog" | "help" | "rotate";

export interface RunState {
  phase: RunPhase;
  level: LevelId | null;
  /** Played on the level's own maze (a custom size from #debug isn't ranked). */
  ranked: boolean;
  /** performance.now() at the first step and at the finish. */
  startedAt: number;
  finishedAt: number;
  /** Time spent paused while running (ms), not counting a pause in progress. */
  pausedTotal: number;
  /** performance.now() when the current pause began (0 = not paused). */
  pausedAt: number;
  /** Anything pausing the game right now. */
  pauses: readonly PauseReason[];
}

let state: RunState = {
  phase: "idle",
  level: null,
  ranked: false,
  startedAt: 0,
  finishedAt: 0,
  pausedTotal: 0,
  pausedAt: 0,
  pauses: [],
};
const listeners = new Set<() => void>();
const set = (next: Partial<RunState>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};

export const runStore = {
  get: () => state,
  /** A fresh run, waiting for the first step. */
  arm(level: LevelId, ranked: boolean) {
    set({ phase: "armed", level, ranked, startedAt: 0, finishedAt: 0, pausedTotal: 0, pausedAt: 0 });
  },
  reset() {
    set({ phase: "idle", startedAt: 0, finishedAt: 0, pausedTotal: 0, pausedAt: 0 });
  },
  start(now: number) {
    if (state.phase === "armed") set({ phase: "running", startedAt: now, pausedTotal: 0, pausedAt: 0 });
  },
  finish(now: number) {
    if (state.phase === "running") set({ phase: "won", finishedAt: now });
  },
  /** Pause (or un-pause) for a reason; the clock stops while any reason holds. */
  setPaused(reason: PauseReason, on: boolean, now = performance.now()) {
    const had = state.pauses.includes(reason);
    if (had === on) return;
    const pauses = on ? [...state.pauses, reason] : state.pauses.filter((r) => r !== reason);
    const next: Partial<RunState> = { pauses };
    if (state.phase === "running") {
      if (pauses.length > 0 && !state.pausedAt) next.pausedAt = now;
      if (pauses.length === 0 && state.pausedAt) {
        next.pausedTotal = state.pausedTotal + (now - state.pausedAt);
        next.pausedAt = 0;
      }
    }
    set(next);
  },
  isPaused: () => state.pauses.length > 0,
  /** Movement and look are ignored: the run is over, or the game is paused. */
  inputBlocked: () => state.phase === "won" || state.pauses.length > 0,
  /** The run's time so far (or final), in ms — paused time left out. */
  elapsed(now = performance.now()): number {
    if (state.phase !== "running" && state.phase !== "won") return 0;
    const end = state.phase === "won" ? state.finishedAt : state.pausedAt || now;
    return Math.max(0, end - state.startedAt - state.pausedTotal);
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function useRun(): RunState {
  return useSyncExternalStore(runStore.subscribe, runStore.get, runStore.get);
}
