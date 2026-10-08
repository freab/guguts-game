import { useSyncExternalStore } from "react";

/**
 * Where the preloader is. The scene reveals only at "ready":
 * assets → baking (lightmap, sky, shadows, light probe) → compiling (shader
 * pipelines) → warming (post-processing's first frames) → ready.
 */
export type LoadingStage = "assets" | "baking" | "compiling" | "warming" | "ready";

interface LoadingState {
  stage: LoadingStage;
  /** Progress of the current bake stage, 0..1. */
  bakeProgress: number;
  /**
   * The scene stops rendering (frameloop "never", last frame stays on
   * screen) while the preloader burns away over it, so the burn gets the
   * whole GPU and plays smoothly (ui/LoadingOverlay).
   */
  sceneHeld: boolean;
}

let state: LoadingState = { stage: "assets", bakeProgress: 0, sceneHeld: false };
const listeners = new Set<() => void>();

export function setLoading(next: Partial<LoadingState>): void {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => state;

/** React hook for the loading screen. */
export function useLoading(): LoadingState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
