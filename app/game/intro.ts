"use client";

import { useSyncExternalStore } from "react";

/**
 * The intro fly-in as a maze starts (scene/IntroFlight flies the camera,
 * ui/IntroOverlay frames it and offers the skip):
 *
 *   idle ─(scene mounts)→ ready ─(preloader gone)→ playing ─(flight ends)→ done
 *                                                     └─(skip)→ skipping ─(fade to black)→ done
 *
 * `ready`: the camera holds the flight's first shot, so the preloader's last
 * burn reveals it. While playing or skipping the game is paused (runStore
 * "intro"): no moving, no calls, no clock.
 */
export type IntroPhase = "idle" | "ready" | "playing" | "skipping" | "done";

let phase: IntroPhase = "idle";
const listeners = new Set<() => void>();
const set = (next: IntroPhase) => {
  if (phase === next) return;
  phase = next;
  listeners.forEach((l) => l());
};

export const intro = {
  get: () => phase,
  /** A new maze's scene is up: hold the first shot. */
  prepare() {
    set("ready");
  },
  /** The preloader has gone: fly. */
  play() {
    if (phase === "ready") set("playing");
  },
  /** The player skipped: fade to black, then done (ui/IntroOverlay). */
  skip() {
    if (phase === "playing") set("skipping");
  },
  /** The flight has landed (or the skip's fade is black): the game is the player's. */
  finish() {
    if (phase === "playing" || phase === "skipping") set("done");
  },
  /** The scene is gone. */
  reset() {
    set("idle");
  },
  /** Is the intro holding the camera? */
  active: () => phase === "ready" || phase === "playing" || phase === "skipping",
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function useIntro(): IntroPhase {
  return useSyncExternalStore(intro.subscribe, intro.get, () => "idle");
}
