import { useSyncExternalStore } from "react";

/** One row of a profiling run: the frame with one feature switched off. */
export interface ProfileRow {
  name: string;
  fps: number;
  /** Average frame interval (CPU + GPU + vsync). */
  frameMs: number;
  /** Average GPU time per frame (null when the GPU can't time itself). */
  gpuMs: number | null;
  /** Average main-thread work per frame: our updates, and three encoding draws. */
  updateMs: number;
  renderMs: number;
}

/** Geometry submitted per frame by one system (a named object: Grass, Ivy…). */
export interface GeometryRow {
  name: string;
  triangles: number;
  draws: number;
}

export interface PerfState {
  /** Live: smoothed frame interval and GPU time, updated a few times a second. */
  frameMs: number;
  gpuMs: number | null;
  /** Live main-thread work per frame (see ProfileRow). */
  updateMs: number;
  renderMs: number;
  /** Live: triangles and draw calls per system, biggest first. */
  geometry: GeometryRow[];
  /** Whether the GPU supports timestamp queries (null = not known yet). */
  gpuTiming: boolean | null;
  /** A profiling run: requested, in progress (current step), finished (rows). */
  requested: boolean;
  step: string | null;
  rows: ProfileRow[] | null;
}

let state: PerfState = {
  frameMs: 0,
  gpuMs: null,
  updateMs: 0,
  renderMs: 0,
  geometry: [],
  gpuTiming: null,
  requested: false,
  step: null,
  rows: null,
};
const listeners = new Set<() => void>();

export function setPerf(next: Partial<PerfState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function getPerf(): PerfState {
  return state;
}

/** Ask the in-canvas profiler to start a run (it needs the renderer). */
export function requestProfile() {
  if (state.step) return;
  setPerf({ requested: true, rows: null });
}

export function usePerf(): PerfState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state
  );
}
