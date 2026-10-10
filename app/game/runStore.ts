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

/**
 * Calling the goat: for a moment, a bare map shows where she is (the
 * CallMap). Gugut's voice is good for GOAT_CALLS calls; after that his throat is
 * dry until he drinks — BOTTLES bottles of water are hidden in the maze (see
 * game/bottles), each giving his voice back in full.
 */
export const GOAT_CALLS = 3;
export const BOTTLES = 2;
/** How long the call's map stays up, then fades (ms). */
export const CALL_MAP_MS = 3200;
export const CALL_MAP_FADE_MS = 1200;
/**
 * Reaching her: the view eases onto her and her light blooms up, then the
 * camera lifts away over the maze (scene/WinShot, maze/GoatReveal); this far
 * in, the end of the story starts to burn in over it (ui/GameOver → OutroStory).
 */
export const WIN_SHOT_MS = 3800;

/** A short message to the player (a call used up, water found…). */
export interface Notice {
  text: string;
  /** performance.now() when it was posted (each notice is a fresh one). */
  at: number;
}

/** Why the game is paused; paused while any is active. */
export type PauseReason = "menu" | "dialog" | "help" | "rotate" | "talk" | "intro" | "photo" | "present";

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
  /** Goat calls left, and used this run. */
  calls: number;
  callsUsed: number;
  /** performance.now() of the last call (its map shows for a moment), 0 = none. */
  calledAt: number;
  /** performance.now() of the last call tried with no voice left (a dry rasp), 0 = none. */
  dryAt: number;
  /**
   * performance.now() when Gugut, calmed by Temesgen's song, heard the goat
   * bleat on her own (game/temesgen) — her direction shows like a call's
   * answer, without using one. 0 = not yet.
   */
  heardAt: number;
  /** performance.now() when Gugut first caught sight of her (game/GoatVoice), 0 = not yet. */
  sawAt: number;
  /** Found the monks' jebena (a secret: game/jebena) — the "First buna" badge. */
  jebenaFound: boolean;
  /** Typed BUNA (a secret: game/secrets) — a faster Gugut, so the run isn't ranked. */
  caffeinated: boolean;
  /** Which of the hidden bottles have been drunk. */
  bottlesTaken: readonly boolean[];
  /** The latest message for the player, if any. */
  notice: Notice | null;
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
  calls: GOAT_CALLS,
  callsUsed: 0,
  calledAt: 0,
  dryAt: 0,
  heardAt: 0,
  sawAt: 0,
  jebenaFound: false,
  caffeinated: false,
  bottlesTaken: Array(BOTTLES).fill(false),
  notice: null,
};
/** Everything a new run starts with for the goat calls and the water. */
const freshCalls = () => ({
  calls: GOAT_CALLS,
  callsUsed: 0,
  calledAt: 0,
  dryAt: 0,
  heardAt: 0,
  sawAt: 0,
  jebenaFound: false,
  caffeinated: false,
  bottlesTaken: Array<boolean>(BOTTLES).fill(false),
  notice: null,
});
const listeners = new Set<() => void>();
const set = (next: Partial<RunState>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};

export const runStore = {
  get: () => state,
  /** A fresh run, waiting for the first step. */
  arm(level: LevelId, ranked: boolean) {
    set({ phase: "armed", level, ranked, startedAt: 0, finishedAt: 0, pausedTotal: 0, pausedAt: 0, ...freshCalls() });
  },
  reset() {
    set({ phase: "idle", startedAt: 0, finishedAt: 0, pausedTotal: 0, pausedAt: 0, ...freshCalls() });
  },
  /**
   * Call the goat (the C key, the HUD button, the pause menu): uses a call and
   * flashes her position on the map — or, with no voice left, tells the
   * player to find water. Returns whether she was called.
   */
  callGoat(now = performance.now()): boolean {
    if (state.phase !== "armed" && state.phase !== "running") return false;
    if (state.calls <= 0) {
      set({
        dryAt: now,
        notice: {
          text: "Your throat is too dry to call. Find water — two bottles are hidden in the maze.",
          at: now,
        },
      });
      return false;
    }
    const calls = state.calls - 1;
    set({
      calls,
      callsUsed: state.callsUsed + 1,
      calledAt: now,
      notice:
        calls === 0
          ? {
              text: "That was your last call — your throat is parched. Find water: two bottles are hidden in the maze.",
              at: now,
            }
          : state.notice,
    });
    return true;
  },
  /** Calm at last (listening to Temesgen): Gugut hears the goat bleat on her own. */
  hearGoat(now = performance.now()) {
    if (state.phase !== "armed" && state.phase !== "running") return;
    set({
      heardAt: now,
      notice: { text: "Calm at last, you hear her — a bleat, clear across the maze.", at: now },
    });
  },
  /** Gugut picks up the monks' jebena (game/jebena). */
  findJebena(now = performance.now()) {
    if (state.jebenaFound || (state.phase !== "armed" && state.phase !== "running")) return;
    set({
      jebenaFound: true,
      notice: { text: "A jebena on a stone — still warm. The monks were here. You keep it safe for later.", at: now },
    });
  },
  /** The coffee kicks in (game/secrets): faster for a while — and off the leaderboard. */
  caffeinate(now = performance.now()) {
    if (state.phase !== "running") return;
    set({
      caffeinated: true,
      ranked: false,
      notice: { text: "BUNA! The coffee kicks in — Gugut flies. (This run won't be ranked.)", at: now },
    });
  },
  /** A message for the player (GameNotice). */
  notify(text: string, now = performance.now()) {
    set({ notice: { text, at: now } });
  },
  /** Gugut sees her for the first time this run. */
  seeGoat(now = performance.now()) {
    if (state.sawAt || (state.phase !== "armed" && state.phase !== "running")) return;
    set({ sawAt: now });
  },
  /** Drink hidden bottle `i`: Gugut's voice comes back in full. */
  drink(i: number, now = performance.now()) {
    if (state.bottlesTaken[i] || state.phase === "won") return;
    const bottlesTaken = state.bottlesTaken.map((taken, j) => taken || j === i);
    set({
      bottlesTaken,
      calls: GOAT_CALLS,
      notice: { text: `You drink the cool water — your voice is back (${GOAT_CALLS} calls).`, at: now },
    });
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
