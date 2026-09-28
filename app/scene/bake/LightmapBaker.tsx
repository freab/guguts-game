"use client";

import { useEffect } from "react";
import type * as THREE from "three/webgpu";
import { trackBake } from "./bakeTracker";
import { bakeLightmap } from "./lightmap";
import { setLoading } from "./loadingStore";

/**
 * Bakes the ground lightmap on mount (the scene remounts per maze) and again
 * whenever the sun moves; a newer bake cancels an unfinished older one. The
 * bake is registered with the tracker, so the preloader waits for it.
 */
export default function LightmapBaker({ sunDirection }: { sunDirection: THREE.Vector3 }) {
  useEffect(() => {
    let cancelled = false;
    trackBake(
      bakeLightmap(
        sunDirection,
        (fraction) => {
          if (!cancelled) setLoading({ bakeProgress: fraction });
        },
        () => cancelled
      )
    ).catch((err) => console.warn("[gugut] lightmap bake failed:", err));
    return () => {
      cancelled = true;
    };
  }, [sunDirection]);

  return null;
}
