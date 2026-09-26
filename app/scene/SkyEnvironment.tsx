"use client";

import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import type * as THREE from "three/webgpu";
import { SkyController, type SkyParams } from "./sky/SkyController";

/** Point the scene's image-based lighting at a (re)baked sky environment map. */
function setSceneEnvironment(
  scene: THREE.Scene,
  texture: THREE.Texture | null,
  intensity: number
) {
  scene.environment = texture;
  scene.environmentIntensity = intensity;
}

/**
 * Realistic sky + sky lighting on WebGPU: three's SkyMesh (Preetham scattering
 * with sun disc and procedural clouds) as the backdrop, re-baked into
 * `scene.environment` whenever the sun or sky changes, so every physically
 * based material is lit by the sky you see. See sky/SkyController.ts.
 */
export default function SkyEnvironment({
  params,
  envIntensity,
}: {
  params: SkyParams;
  envIntensity: number;
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);

  // The renderer is the WebGPURenderer created in Scene's async `gl` factory.
  const controller = useMemo(
    () => new SkyController(gl as unknown as THREE.WebGPURenderer),
    [gl]
  );
  useEffect(() => () => controller.dispose(), [controller]);

  useEffect(() => {
    controller.update(params);
    setSceneEnvironment(scene, controller.bakeEnvironment(), envIntensity);
    invalidate();
  }, [controller, scene, params, envIntensity, invalidate]);

  useEffect(() => () => setSceneEnvironment(scene, null, 1), [scene]);

  return <primitive object={controller.sky} />;
}
