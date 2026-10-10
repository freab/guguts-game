"use client";

import { useSyncExternalStore } from "react";

/** The presentation (app/present): which slide is up, and the step within it. */
export interface PresentState {
  slide: number;
  /** The step within the slide (slides with steps). */
  step: number;
}

let state: PresentState = { slide: 0, step: 0 };
const listeners = new Set<() => void>();
const set = (next: Partial<PresentState>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};

export const presentStore = {
  get: () => state,
  goTo: (slide: number) => set({ slide, step: 0 }),
  setStep: (step: number) => set({ step }),
  reset: () => set({ slide: 0, step: 0 }),
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function usePresent(): PresentState {
  return useSyncExternalStore(presentStore.subscribe, presentStore.get, presentStore.get);
}

/**
 * Written by the camera director every frame, read by the slide overlay on
 * its own loop (no re-renders): the camera, and where the goat is from it.
 */
export const presentLive = {
  camX: 0,
  camY: 0,
  camZ: 0,
  /** The goat's direction relative to where the camera looks (radians, + = right). */
  goatBearing: 0,
  goatDistance: 0,
  /** Is the renderer on WebGPU (true) or its WebGL 2 fallback (false)? null until known. */
  webgpu: null as boolean | null,
};
