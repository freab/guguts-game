"use client";

import { useSyncExternalStore } from "react";
import type { LevelId } from "../maze/levels";

/**
 * One run through the maze. No time limit — the clock just measures it:
 *
 *   idle ─(scene ready)→ armed ─(first step)→ running ─(reach the goat)→ won
 *
 * The clock starts on the player's first step (not when the scene appears),
 * so reading the view or looking around is free. Shared by the 3D loop
 * (game/GoalWatcher, the player controller) and the UI (timer, game-over).
 */
export type RunPhase = "idle" | "armed" | "running" | "won";

export interface RunState {
  phase: RunPhase;
  level: LevelId | null;
  /** Played on the level's own maze (a custom size from #debug isn't ranked). */
  ranked: boolean;
  /** performance.now() at the first step and at the finish. */
  startedAt: number;
  finishedAt: number;
  /** A dialog (settings, leaderboard) is open: the player stands still. */
  dialogOpen: boolean;
}

let state: RunState = {
  phase: "idle",
  level: null,
  ranked: false,
  startedAt: 0,
  finishedAt: 0,
  dialogOpen: false,
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
    set({ phase: "armed", level, ranked, startedAt: 0, finishedAt: 0 });
  },
  reset() {
    set({ phase: "idle", startedAt: 0, finishedAt: 0 });
  },
  start(now: number) {
    if (state.phase === "armed") set({ phase: "running", startedAt: now });
  },
  finish(now: number) {
    if (state.phase === "running") set({ phase: "won", finishedAt: now });
  },
  setDialogOpen(open: boolean) {
    if (state.dialogOpen !== open) set({ dialogOpen: open });
  },
  /** Movement and look are ignored: the run is over, or a dialog is open. */
  inputBlocked: () => state.phase === "won" || state.dialogOpen,
  /** The run's time so far (or final), in ms. */
  elapsed(now = performance.now()): number {
    if (state.phase === "running") return now - state.startedAt;
    if (state.phase === "won") return state.finishedAt - state.startedAt;
    return 0;
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
