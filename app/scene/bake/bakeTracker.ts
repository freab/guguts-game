/**
 * Registry of in-flight bakes (lightmap, sky, light probe…), so the preloader
 * can wait until every bake has finished before revealing the scene.
 */
const pending = new Set<Promise<unknown>>();

/** Register a bake; returns the same promise. */
export function trackBake<T>(bake: Promise<T>): Promise<T> {
  pending.add(bake);
  const done = () => pending.delete(bake);
  bake.then(done, done);
  return bake;
}

/** Resolves once no bake is in flight (including bakes started meanwhile). */
export async function allBakesSettled(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled([...pending]);
}

/** Resolves after `n` animation frames (lets effects and first renders run). */
export function nextFrames(n = 1): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number) =>
      left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1));
    step(n);
  });
}
