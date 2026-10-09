"use client";

import { useSyncExternalStore } from "react";
import { runStore } from "./runStore";

/**
 * Photo mode (F, or the pause menu): the game freezes (runStore "photo": no
 * clock, no moving Gugut, no voice), the HUD goes, and a free camera flies
 * about near Gugut (scene/PhotoCamera) — while the world keeps living: the
 * wind, the light, the goat breathing. The panel (ui/PhotoOverlay) sets the
 * lens and the time of day, and saves the picture as a PNG.
 */
export interface PhotoState {
  active: boolean;
  /** Field of view (degrees). */
  fov: number;
  /** The sunset held at this point (0 … 1), or null to keep the run's. */
  dusk: number | null;
  /** The panel shown (H hides it, for a clean look at the shot). */
  panel: boolean;
  /** performance.now() of the last saved photo (a flash and a "saved" note), 0 = none. */
  savedAt: number;
}

export const PHOTO_FOV_DEFAULT = 60;

const initial: PhotoState = { active: false, fov: PHOTO_FOV_DEFAULT, dusk: null, panel: true, savedAt: 0 };
let state = initial;
let captureWanted = false;
const listeners = new Set<() => void>();
const set = (next: Partial<PhotoState>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};

export const photo = {
  get: () => state,
  /** Into photo mode (only while a run is on). Returns whether it opened. */
  open(): boolean {
    const { phase } = runStore.get();
    if (state.active || (phase !== "armed" && phase !== "running")) return false;
    set({ ...initial, active: true });
    runStore.setPaused("photo", true);
    return true;
  },
  close() {
    if (!state.active) return;
    captureWanted = false;
    set({ active: false });
    runStore.setPaused("photo", false);
  },
  toggle() {
    if (state.active) photo.close();
    else photo.open();
  },
  setFov(fov: number) {
    set({ fov });
  },
  setDusk(dusk: number | null) {
    set({ dusk });
  },
  togglePanel() {
    set({ panel: !state.panel });
  },
  /** Save the next frame drawn (takeCapture, right after it's rendered). */
  capture() {
    if (state.active) captureWanted = true;
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

/**
 * Called right after a frame is drawn (post/PostEffects): if a photo was
 * asked for, save the canvas now — in the same task as the render, while the
 * frame is still in it — as a PNG download, without the HUD (it's DOM, not
 * in the canvas).
 */
export function takeCapture(canvas: HTMLCanvasElement) {
  if (!captureWanted) return;
  captureWanted = false;
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
    a.href = url;
    a.download = `gugut-photo-${stamp}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    set({ savedAt: performance.now() });
  }, "image/png");
}

export function usePhoto(): PhotoState {
  return useSyncExternalStore(photo.subscribe, photo.get, () => initial);
}
