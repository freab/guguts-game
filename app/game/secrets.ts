"use client";

import { useSyncExternalStore } from "react";
import { runStore } from "./runStore";

/**
 * Hidden inputs:
 * - the Konami code on the title screen (ui/LoadingOverlay): the goat on the
 *   logo bleats and the logo flashes cherry red;
 * - B U N A typed during a run: "the coffee kicks in" — Gugut moves
 *   BUNA_BOOST× as fast for BUNA_SECONDS, a warm glow round the screen
 *   (ui/BunaGlow); the run is no longer ranked;
 * - "Gugut" as your name: gold on the leaderboard (ui/LeaderboardTable) and
 *   "The original goatherd" on your share card (ui/GameOver).
 */

export const KONAMI = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "KeyB",
  "KeyA",
];
export const BUNA = ["KeyB", "KeyU", "KeyN", "KeyA"];
/** The longest pause between two keys of a sequence (ms). */
const KEY_GAP_MS = 1500;

/**
 * Watches key presses for one sequence of key codes; `onMatch` when the last
 * ones pressed spell it out (each within KEY_GAP_MS of the one before).
 */
export function sequenceWatcher(sequence: readonly string[], onMatch: () => void) {
  let at = 0;
  let last = 0;
  return (e: KeyboardEvent) => {
    if (e.repeat) return;
    const now = performance.now();
    if (now - last > KEY_GAP_MS) at = 0;
    last = now;
    if (e.code === sequence[at]) at++;
    else at = e.code === sequence[0] ? 1 : 0;
    if (at === sequence.length) {
      at = 0;
      onMatch();
    }
  };
}

/** The coffee: how long it lasts (s) and how much faster Gugut goes. */
export const BUNA_SECONDS = 10;
export const BUNA_BOOST = 1.5;

let bunaUntil = 0;
const listeners = new Set<() => void>();

export const buna = {
  /** BUNA typed: the coffee kicks in (only during a run). */
  drink(now = performance.now()) {
    const { phase } = runStore.get();
    if (phase !== "running" || runStore.isPaused()) return;
    bunaUntil = now + BUNA_SECONDS * 1000;
    runStore.caffeinate(now);
    listeners.forEach((l) => l());
  },
  /** Gugut's speed multiplier right now. */
  boost: (now = performance.now()) => (now < bunaUntil ? BUNA_BOOST : 1),
  /** performance.now() it wears off (0 = never drunk). */
  until: () => bunaUntil,
  reset() {
    bunaUntil = 0;
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function useBunaUntil(): number {
  return useSyncExternalStore(buna.subscribe, buna.until, () => 0);
}

/** Is this the name of the original goatherd? */
export const isGugut = (name: string) => name.trim().toLowerCase() === "gugut";
