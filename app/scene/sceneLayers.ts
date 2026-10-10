"use client";

import { useSyncExternalStore } from "react";

/**
 * Which parts of the scene are shown — all of them in the game. The "how
 * it's made" presentation (app/present) shows them one at a time. Hidden parts
 * still run (and still cast their baked shadows): they're only not drawn.
 */
export interface SceneLayers {
  ground: boolean;
  walls: boolean;
  sky: boolean;
  grass: boolean;
  flowers: boolean;
  vines: boolean;
  tree: boolean;
  characters: boolean;
  props: boolean;
  atmosphere: boolean;
}

export type SceneLayer = keyof SceneLayers;

/** Surfaces the presentation can show as a UV test grid before their texture. */
export type UvSurface = "ground";

export const ALL_LAYERS: SceneLayers = {
  ground: true,
  walls: true,
  sky: true,
  grass: true,
  flowers: true,
  vines: true,
  tree: true,
  characters: true,
  props: true,
  atmosphere: true,
};

let state: SceneLayers = ALL_LAYERS;
const listeners = new Set<() => void>();
/** performance.now() each part last came on (0: always there — nothing to animate). */
const shownAt = new Map<SceneLayer, number>();
/**
 * Ways to look inside (app/present's x-rays): a part as wireframe, the baked
 * lightmap itself, Temesgen coloured by the parts his vertex shader moves.
 */
const debug = {
  wireframe: null as SceneLayer | null,
  lightmap: false,
  limbs: false,
  uvGrid: { ground: false } as Record<UvSurface, boolean>,
  uvGridInstant: false,
};

export const sceneLayers = {
  get: () => state,
  /**
   * Show only these (or everything, given null). `deferred`: parts coming on
   * wait (hidden) until release() — the camera landing on the new shot.
   */
  only(layers: readonly SceneLayer[] | null, deferred = false) {
    const next = layers
      ? (Object.fromEntries(Object.keys(ALL_LAYERS).map((k) => [k, layers.includes(k as SceneLayer)])) as unknown as SceneLayers)
      : ALL_LAYERS;
    if (Object.keys(next).every((k) => next[k as SceneLayer] === state[k as SceneLayer])) return;
    // Parts coming on now animate in (scene/LayerGroup).
    const now = performance.now();
    for (const k of Object.keys(next) as SceneLayer[]) if (next[k] && !state[k]) shownAt.set(k, deferred ? Infinity : now);
    state = next;
    listeners.forEach((l) => l());
  },
  /** The parts waiting on the camera: in, now. */
  release() {
    const now = performance.now();
    for (const [k, at] of shownAt) if (at === Infinity) shownAt.set(k, now);
  },
  /** When a part last came on (0 = always there; Infinity = waiting to). */
  shownAt: (layer: SceneLayer) => shownAt.get(layer) ?? 0,
  debug: () => debug,
  setWireframe(layer: SceneLayer | null) {
    debug.wireframe = layer;
  },
  setLightmapView(on: boolean) {
    debug.lightmap = on;
  },
  /** These surfaces as a UV test grid (the rest textured): swept on or off, or `instant`ly. */
  setUvGrid(surfaces: readonly UvSurface[], instant = false) {
    debug.uvGrid = { ground: surfaces.includes("ground") };
    debug.uvGridInstant = instant;
  },
  setLimbView(on: boolean) {
    debug.limbs = on;
  },
  /** Everything back as in the game. */
  reset() {
    debug.wireframe = null;
    debug.lightmap = false;
    debug.limbs = false;
    debug.uvGrid = { ground: false };
    sceneLayers.only(null);
    // (After: nothing animates back in.)
    shownAt.clear();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function useSceneLayers(): SceneLayers {
  return useSyncExternalStore(sceneLayers.subscribe, sceneLayers.get, () => ALL_LAYERS);
}
