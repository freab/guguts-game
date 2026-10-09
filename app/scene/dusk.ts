"use client";

import { useSyncExternalStore } from "react";
import * as THREE from "three/webgpu";
import { uniform } from "three/tsl";
import { runStore } from "../game/runStore";

/**
 * The sun going down over a run ("bring her home before the sun goes down"):
 * `dusk` runs from 0 as the run starts to 1 by the level's SUNSET time, and
 * holds there (it never gets dark — there's no losing to the night).
 *
 * The sun light's direction, its shadows and the lightmap are baked once, so
 * the sun itself doesn't move; the light around it changes instead —
 * continuously (scene/Sunset: the sunlight deepens to orange and dims, the sky
 * fill turns pink-violet, the god rays warm and thicken, more fireflies come
 * out) and, in DUSK_STEPS steps, the sky itself (re-baked hazier and more
 * orange: Scene's sky parameters follow useDuskStep).
 */

/** Seconds of run until full dusk, by level (a custom maze: the medium one). */
const SUNSET: Record<string, number> = { easy: 240, medium: 420, hard: 600 };
/** The sky is re-baked this many times on the way (each a small, one-frame cost). */
export const DUSK_STEPS = 10;

/** 0 (as the run starts) … 1 (full dusk), for the shaders. */
export const dusk = uniform(0);

/** Where things are at full dusk. */
export const DUSK = {
  sunColor: new THREE.Color("#ff8a52"),
  sunIntensity: 0.8,
  ambientColor: new THREE.Color("#ffb38a"),
  ambientIntensity: 0.9,
  skyFill: new THREE.Color("#b58fc4"),
  groundFill: new THREE.Color("#6e4030"),
  hemisphereIntensity: 0.85,
  raysColor: new THREE.Color("#a0583a"),
  raysDensity: 1.35,
  /** Sky: added turbidity (haze, more orange near the horizon), Rayleigh scale, added Mie (a glow round the sun) and its G, brightness scale. */
  turbidity: 4,
  rayleigh: 0.75,
  mieCoefficient: 0.005,
  mieDirectionalG: 0.95,
  skyBrightness: 0.85,
};

const ease = (t: number) => {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
};

/** How far into dusk the run is (0 before the first step). */
export function duskForRun(now = performance.now()): number {
  const run = runStore.get();
  if (run.phase !== "running" && run.phase !== "won") return 0;
  const seconds = SUNSET[run.level ?? ""] ?? SUNSET.medium;
  return ease(runStore.elapsed(now) / 1000 / seconds);
}

/* The current step, for the sky re-bakes (React state in the Scene). */
let step = 0;
const listeners = new Set<() => void>();

/** Set dusk (0..1) for this frame: the uniform, and the step if it moved on. */
export function setDusk(value: number) {
  dusk.value = value;
  const next = Math.round(value * DUSK_STEPS);
  if (next !== step) {
    step = next;
    listeners.forEach((l) => l());
  }
}

/** Dusk, in DUSK_STEPS steps (0..1): what the baked sky is drawn for. */
export function useDuskStep(): number {
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => step,
    () => 0
  );
  return s / DUSK_STEPS;
}
