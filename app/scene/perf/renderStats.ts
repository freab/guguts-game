/**
 * The renderer's draw calls and triangles last frame (Scene's PerfProbe).
 * Module-level, outside Scene, so the leva "Perf" monitors keep the same
 * objects when the scene remounts, and the presentation (app/present) can
 * read them without importing the scene.
 */
export const perfCalls = { current: 0 };
export const perfTris = { current: 0 };
