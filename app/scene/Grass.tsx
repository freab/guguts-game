"use client";

import { useEffect, useMemo } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { useControls, folder } from "leva";
import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createGrassMaterial } from "./grass/grassNodeMaterial";
import { GrassField, LOD_FULL_BAND, LOD_MEDIUM_BAND, lodGeometries } from "./grass/GrassField";
import { playerStore } from "../character/playerStore";
import { useDisposable } from "../hooks/useDisposable";

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
  drawDistance,
}: {
  /** Footpath half-width in world units; 0 = no footpath. */
  pathWidth: number;
  /** Grass height on the path centreline, as a fraction of full height. */
  pathGrass: number;
  /** Radius around the player that grass is drawn in (the scene's view distance). */
  drawDistance: number;
}) {
  const {
    enabled,
    density,
    tuftSize,
    height,
    lod,
    fadeWidth,
    occlusion,
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
        density: { value: 8, min: 1, max: 30, step: 1, label: "Tufts / m²" },
        tuftSize: { value: 2.6, min: 1, max: 5, step: 0.1, label: "Tuft size" },
        height: { value: 0.2, min: 0, max: 2, step: 0.05, label: "Fluff height" },
        lod: { value: "Auto", options: ["Auto", "High", "Medium", "Low"], label: "LOD" },
        fadeWidth: { value: 3, min: 0.5, max: 15, step: 0.5, label: "Fade width" },
        occlusion: { value: true, label: "Occlusion culling" },
        shadows: { value: true, label: "Wall shadows (baked)" },
        wind: { value: true, label: "Wind" },
        windStrength: { value: 0.05, min: 0, max: 0.4, step: 0.01, label: "Wind strength" },
        windFps: { value: 20, min: 10, max: 60, step: 5, label: "Wind FPS" },
        brightness: { value: 1.75, min: 0.3, max: 2, step: 0.05, label: "Brightness" },
        baseColor: { value: "#638332", label: "Base" },
        tipColor1: { value: "#89c47b", label: "Tip A" },
        tipColor2: { value: "#056535", label: "Tip B" },
      },
      { collapsed: true }
    ),
  });

  const invalidate = useThree((s) => s.invalidate);
  const gltf = useLoader(GLTFLoader, "/grassLODs.glb");
  const alphaMap = useLoader(THREE.TextureLoader, "/grass.jpeg");

  const geometries = useMemo(() => lodGeometries(gltf.scene), [gltf]);

  // One material for the life of the scene; the field rebuilds around it.
  const grass = useDisposable(() => createGrassMaterial(alphaMap), [alphaMap]);

  const field = useDisposable(
    () =>
      new GrassField(geometries, grass.material, {
        density,
        tuftSize,
        pathWidth,
        pathGrass,
      }),
    [geometries, grass, density, tuftSize, pathWidth, pathGrass]
  );

  // Live-tunable look (uniforms only, no rebuild).
  useEffect(() => {
    grass.setLook({ height, windStrength, brightness, baseColor, tipColor1, tipColor2 });
    invalidate();
  }, [grass, height, windStrength, brightness, baseColor, tipColor1, tipColor2, invalidate]);

  useEffect(() => {
    grass.setBakedShadows(shadows);
    invalidate();
  }, [grass, shadows, invalidate]);

  // Per frame: grass only where the character is and can see — distance,
  // frustum and wall-occlusion culling — and each drawn chunk picks its LOD.
  const forcedLod = lod === "High" ? 0 : lod === "Medium" ? 1 : lod === "Low" ? 2 : -1;
  useFrame(({ camera }) => {
    const { x, z } = playerStore;
    grass.setFade(x, z, Math.max(0, drawDistance - fadeWidth), drawDistance);
    grass.setLod(drawDistance * LOD_FULL_BAND, drawDistance * LOD_MEDIUM_BAND, forcedLod);
    field.updateVisibility(camera, x, z, enabled ? drawDistance : -1, occlusion);
  });

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

  return enabled ? <primitive object={field.group} name="Grass" /> : null;
}
