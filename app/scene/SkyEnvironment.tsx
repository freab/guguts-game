"use client";

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import type * as THREE from "three/webgpu";
import { trackBake } from "./bake/bakeTracker";
import { SkyController, type SkyParams } from "./sky/SkyController";
import { useDisposable } from "../hooks/useDisposable";

/** Show the baked sky cube as the background, or clear it (live sky mode). */
function setSceneBackground(scene: THREE.Scene, texture: THREE.Texture | null): void {
  scene.background = texture;
}

/** Install (or remove) the scene-wide fog node (read by every node material). */
function setSceneFog(scene: THREE.Scene, node: THREE.Node | null): void {
  (scene as THREE.Scene & { fogNode: THREE.Node | null }).fogNode = node;
}

/**
 * Realistic sky with clouds (three's WebGPU SkyMesh) plus the "sky light": a
 * light probe baked from that sky, so surfaces get sky-coloured ambient light.
 *
 * By default the sky itself is baked too — rendered once into a cube used as
 * the scene background, so the sky + cloud shader costs nothing per frame. With
 * `liveClouds` the SkyMesh renders every frame instead and the clouds drift.
 * Everything re-bakes when the sun or sky settings change.
 *
 * It also owns the view-distance fog: the world fades into the sky colour
 * behind it between `fog.near` and `fog.far` (see SkyController.fogNode).
 * See sky/SkyController.ts.
 */
export default function SkyEnvironment({
  params,
  skyLight,
  liveClouds,
  fog,
}: {
  params: SkyParams;
  /** Ambient sky-light intensity (0 = off). */
  skyLight: number;
  liveClouds: boolean;
  /** View-distance fog range (view depth, metres); null = no fog. */
  fog: { near: number; far: number } | null;
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  // The renderer is the WebGPURenderer created in Scene's async `gl` factory.
  const renderer = gl as unknown as THREE.WebGPURenderer;

  const controller = useDisposable(() => new SkyController(), []);

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

  // The fog node is part of every material's shader, so it goes in on mount
  // (before the preloader compiles them) and toggling it recompiles them; its
  // range is uniforms.
  const fogOn = fog !== null;
  useEffect(() => {
    setSceneFog(scene, fogOn ? controller.fogNode : null);
    return () => setSceneFog(scene, null);
  }, [scene, controller, fogOn]);
  useEffect(() => {
    if (fog) controller.setFogRange(fog.near, fog.far);
  }, [controller, fog]);

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
