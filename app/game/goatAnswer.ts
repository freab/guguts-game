"use client";

import { useSyncExternalStore } from "react";

/**
 * The goat's answer to the latest call: when she bleats (performance.now()
 * ms — a moment after the call) and from where, for the on-screen direction
 * arc and the sound caption (ui/BleatIndicator). Posted by game/GoatVoice.
 */
export interface GoatAnswer {
  at: number;
  x: number;
  z: number;
  distance: number;
  /** Walls between her and the listener (her bleat is muffled). */
  occluded: boolean;
}

let answer: GoatAnswer | null = null;
const listeners = new Set<() => void>();

export const goatAnswer = {
  get: () => answer,
  post(next: GoatAnswer | null) {
    answer = next;
    listeners.forEach((l) => l());
  },
};

export function useGoatAnswer(): GoatAnswer | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    goatAnswer.get,
    () => null
  );
}
