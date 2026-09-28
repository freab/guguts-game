"use client";

import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import type * as THREE from "three/webgpu";
import { trackBake } from "./bake/bakeTracker";
import { SkyController, type SkyParams } from "./sky/SkyController";

/** Show the baked sky cube as the background, or clear it (live sky mode). */
function setSceneBackground(scene: THREE.Scene, texture: THREE.Texture | null): void {
  scene.background = texture;
}

/**
 * Realistic sky with clouds (three's WebGPU SkyMesh) plus the "sky light": a
 * light probe baked from that sky, so surfaces get sky-coloured ambient light.
 *
 * By default the sky itself is baked too — rendered once into a cube used as
 * the scene background, so the sky + cloud shader costs nothing per frame. With
 * `liveClouds` the SkyMesh renders every frame instead and the clouds drift.
 * Everything re-bakes when the sun or sky settings change.
 * See sky/SkyController.ts.
 */
export default function SkyEnvironment({
  params,
  skyLight,
  liveClouds,
}: {
  params: SkyParams;
  /** Ambient sky-light intensity (0 = off). */
  skyLight: number;
  liveClouds: boolean;
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  // The renderer is the WebGPURenderer created in Scene's async `gl` factory.
  const renderer = gl as unknown as THREE.WebGPURenderer;

  const controller = useMemo(() => new SkyController(), []);
  useEffect(() => () => controller.dispose(), [controller]);

  useEffect(() => {
    controller.update(params);
    setSceneBackground(scene, liveClouds ? null : controller.bakeBackground(renderer));
    invalidate();

    let cancelled = false;
    trackBake(controller.bakeProbe(renderer))
      .then((applied) => {
        if (applied && !cancelled) invalidate();
      })
      .catch((err) => console.warn("[gugut] sky light bake failed:", err));
    return () => {
      cancelled = true;
    };
  }, [controller, renderer, scene, params, liveClouds, invalidate]);

  useEffect(() => () => setSceneBackground(scene, null), [scene]);

  useEffect(() => {
    controller.setProbeIntensity(skyLight);
    invalidate();
  }, [controller, skyLight, invalidate]);

  return (
    <>
      {liveClouds && <primitive object={controller.sky} />}
      <primitive object={controller.probe} />
    </>
  );
}
