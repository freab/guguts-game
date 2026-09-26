"use client";

import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import type * as THREE from "three/webgpu";
import { SkyController, type SkyParams } from "./sky/SkyController";

/**
 * Realistic sky with clouds (three's WebGPU SkyMesh) plus the "sky light": a
 * light probe baked from that sky, so surfaces get sky-coloured ambient light.
 * The probe is re-baked whenever the sun or sky settings change.
 * See sky/SkyController.ts.
 */
export default function SkyEnvironment({
  params,
  skyLight,
}: {
  params: SkyParams;
  /** Ambient sky-light intensity (0 = off). */
  skyLight: number;
}) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);

  const controller = useMemo(() => new SkyController(), []);
  useEffect(() => () => controller.dispose(), [controller]);

  useEffect(() => {
    controller.update(params);
    invalidate();
    let cancelled = false;
    // The renderer is the WebGPURenderer created in Scene's async `gl` factory.
    controller
      .bakeProbe(gl as unknown as THREE.WebGPURenderer)
      .then((applied) => {
        if (applied && !cancelled) invalidate();
      })
      .catch((err) => console.warn("[gugut] sky light bake failed:", err));
    return () => {
      cancelled = true;
    };
  }, [controller, gl, params, invalidate]);

  useEffect(() => {
    controller.setProbeIntensity(skyLight);
    invalidate();
  }, [controller, skyLight, invalidate]);

  return (
    <>
      <primitive object={controller.sky} />
      <primitive object={controller.probe} />
    </>
  );
}
