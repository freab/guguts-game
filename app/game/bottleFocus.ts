"use client";

import { useSyncExternalStore } from "react";
import { runStore } from "./runStore";

/**
 * Picking up the hidden water (maze/WaterBottles):
 * - `focused`: the bottle Gugut is close to and looking at (-1 = none) —
 *   it glows, and the "Drink" prompt shows (ui/DrinkPrompt);
 * - `grab`: the bottle being drunk and when it started (performance.now() ms),
 *   while the bottle flies up to him and he drinks.
 * The E key, the touch "Drink" button and the prompt all call `grab()`.
 */
export interface BottleFocusState {
  focused: number;
  grab: { index: number; at: number } | null;
}

let state: BottleFocusState = { focused: -1, grab: null };
const listeners = new Set<() => void>();
const set = (next: Partial<BottleFocusState>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};

export const bottleFocus = {
  get: () => state,
  setFocused(index: number) {
    if (state.focused !== index) set({ focused: index });
  },
  /** Drink the focused bottle (if any, and not already drinking). */
  grab(now = performance.now()): boolean {
    const { phase } = runStore.get();
    if (state.focused < 0 || state.grab || (phase !== "armed" && phase !== "running") || runStore.isPaused()) return false;
    set({ grab: { index: state.focused, at: now }, focused: -1 });
    // A little buzz on phones.
    if (typeof navigator !== "undefined") navigator.vibrate?.(35);
    return true;
  },
  /** The drink is over (or a new run started). */
  done() {
    if (state.grab) set({ grab: null });
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function useBottleFocus(): BottleFocusState {
  return useSyncExternalStore(bottleFocus.subscribe, bottleFocus.get, bottleFocus.get);
}
