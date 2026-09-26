"use client";

import { useEffect, useMemo } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { useControls, folder } from "leva";
import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createGrassMaterial } from "./grass/grassNodeMaterial";
import { GrassField, lodGeometries } from "./grass/GrassField";

/** Schedules at most one pending callback at a time (throttles the wind clock). */
class FrameThrottle {
  private timer: ReturnType<typeof setTimeout> | null = null;

  request(ms: number, callback: () => void) {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      callback();
    }, ms);
  }

  cancel() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

/**
 * FluffyGrass-style grass growing only inside the maze, worn into a footpath
 * down the middle of every corridor. Runs on WebGPU via a TSL node material
 * (grass/grassNodeMaterial.ts); placement, chunking and LOD live in
 * grass/GrassField.ts.
 */
export default function Grass({
  pathWidth,
  pathGrass,
}: {
  /** Footpath half-width in world units; 0 = no footpath. */
  pathWidth: number;
  /** Grass height on the path centreline, as a fraction of full height. */
  pathGrass: number;
}) {
  const {
    enabled,
    density,
    tuftSize,
    height,
    lod,
    shadows,
    wind,
    windStrength,
    windFps,
    brightness,
    baseColor,
    tipColor1,
    tipColor2,
  } = useControls("Game", {
    Grass: folder(
      {
        enabled: { value: true, label: "Show grass" },
        density: { value: 10, min: 1, max: 30, step: 1, label: "Tufts / m²" },
        tuftSize: { value: 2.5, min: 1, max: 5, step: 0.1, label: "Tuft size" },
        height: { value: 0.6, min: 0, max: 2, step: 0.05, label: "Fluff height" },
        lod: { value: "Auto", options: ["Auto", "High", "Medium", "Low"], label: "LOD" },
        shadows: { value: true, label: "Wall shadows" },
        wind: { value: true, label: "Wind" },
        windStrength: { value: 0.08, min: 0, max: 0.4, step: 0.01, label: "Wind strength" },
        windFps: { value: 30, min: 10, max: 60, step: 5, label: "Wind FPS" },
        brightness: { value: 1, min: 0.3, max: 2, step: 0.05, label: "Brightness" },
        baseColor: { value: "#313f1b", label: "Base" },
        tipColor1: { value: "#9bd38d", label: "Tip A" },
        tipColor2: { value: "#1f352a", label: "Tip B" },
      },
      { collapsed: true }
    ),
  });

  const invalidate = useThree((s) => s.invalidate);
  const gltf = useLoader(GLTFLoader, "/grassLODs.glb");
  const alphaMap = useLoader(THREE.TextureLoader, "/grass.jpeg");

  const geometries = useMemo(() => lodGeometries(gltf.scene), [gltf]);

  // One material for the life of the scene; the field rebuilds around it.
  const grass = useMemo(() => createGrassMaterial(alphaMap), [alphaMap]);
  useEffect(() => () => grass.dispose(), [grass]);

  const field = useMemo(
    () =>
      new GrassField(geometries, grass.material, {
        density,
        tuftSize,
        pathWidth,
        pathGrass,
      }),
    [geometries, grass, density, tuftSize, pathWidth, pathGrass]
  );
  useEffect(() => () => field.dispose(), [field]);

  // Live-tunable look (uniforms only, no rebuild).
  useEffect(() => {
    grass.setLook({ height, windStrength, brightness, baseColor, tipColor1, tipColor2 });
    invalidate();
  }, [grass, height, windStrength, brightness, baseColor, tipColor1, tipColor2, invalidate]);

  useEffect(() => {
    field.setReceiveShadow(shadows);
    invalidate();
  }, [field, shadows, invalidate]);

  // Per frame: each chunk picks its LOD from its distance to the camera.
  const forcedLod = lod === "High" ? 0 : lod === "Medium" ? 1 : lod === "Low" ? 2 : -1;
  useFrame(({ camera }) => field.updateLod(camera.position, forcedLod));

  // Wind clock. The canvas renders on demand, so while wind is on we request
  // the next frame ourselves — throttled to `windFps` (30 halves the GPU work).
  const throttle = useMemo(() => new FrameThrottle(), []);
  useFrame((_, delta) => {
    if (!enabled || !wind) return;
    grass.advance(delta);
    throttle.request(1000 / windFps, invalidate);
  });
  useEffect(() => {
    invalidate(); // kick the loop when wind or its rate changes
    return () => throttle.cancel();
  }, [enabled, wind, windFps, invalidate, throttle]);

  return enabled ? <primitive object={field.group} /> : null;
}
