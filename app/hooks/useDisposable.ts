import { useEffect, useMemo, type DependencyList } from "react";

interface Disposable {
  dispose(): void;
}

/** Disposals waiting a tick, by value (cancelled if the value is re-attached). */
const pending = new WeakMap<object, ReturnType<typeof setTimeout>>();

/**
 * `useMemo` for things that own GPU resources or running state (geometries,
 * materials, render pipelines, animation mixers…): builds the value, and
 * disposes it once it has been replaced or its component has unmounted.
 *
 * Why not `useEffect(() => () => value.dispose(), [value])`: in development,
 * React StrictMode (on by default in the App Router, and bridged into the R3F
 * canvas) runs every effect's cleanup once right after mounting, then the
 * effect again — while useMemo keeps the same value. Disposing there destroys
 * GPU buffers the scene is still drawing (WebGPU: "used in submit while
 * destroyed") or stops animations for good. So disposal waits a tick and is
 * cancelled if React re-attaches the same value.
 */
export function useDisposable<T extends object>(
  factory: () => T,
  deps: DependencyList,
  dispose: (value: T) => void = (value) => (value as unknown as Disposable).dispose()
): T {
  // The caller's deps are the memo's deps, like useMemo itself.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/use-memo
  const value = useMemo(factory, deps);
  useEffect(() => {
    const timer = pending.get(value);
    if (timer !== undefined) {
      clearTimeout(timer);
      pending.delete(value);
    }
    return () => {
      pending.set(
        value,
        setTimeout(() => {
          pending.delete(value);
          dispose(value);
        }, 0)
      );
    };
    // `dispose` is intentionally not a dependency: it only runs on teardown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return value;
}
