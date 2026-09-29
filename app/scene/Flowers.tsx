"use client";

import { useEffect } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import { useControls, folder, monitor } from "leva";
import * as THREE from "three/webgpu";
import { FLOWER_DETAIL, bakeAdeyAbeba, petalGeometry, type PetalLodData } from "./flowers/adeyAbeba";
import { FlowerField } from "./flowers/FlowerField";
import { createFlowerMaterial } from "./flowers/flowerNodeMaterial";
import { playerStore } from "../character/playerStore";
import { useDisposable } from "../hooks/useDisposable";

/** Petal LODs decoded from adey-abeba's petal2.drc (see flowers/adeyAbeba.ts). */
const PETAL_LODS_URL = "/models/adey-abeba/petal-lods.json";

interface PetalLodsFile {
  lods: PetalLodData[];
}

/** Written by the field every frame, read by the leva monitor. */
const stats = { drawn: 0 };

/**
 * Adey Abeba (Meskel daisy) flowers growing in drifts along the grass verges:
 * small yellow heads held just above the grass, a few per plant. The head is
 * baked once per LOD into a single vertex-coloured geometry and instanced per
 * chunk (flowers/FlowerField.ts); drawn only near the player and in view, like
 * the grass.
 */
export default function Flowers({
  pathWidth,
  maxDistance,
}: {
  /** Footpath half-width in world units; flowers stay off it. 0 = no footpath. */
  pathWidth: number;
  /** The scene's view distance: flowers are never drawn beyond it. */
  maxDistance: number;
}) {
  const {
    enabled,
    density,
    headsPerPlant,
    clumping,
    headSize,
    height,
    drawDistance,
    fadeWidth,
    occlusion,
    windStrength,
    brightness,
    seed,
  } = useControls("Game", {
    Flowers: folder(
      {
        enabled: { value: true, label: "Show flowers" },
        density: { value: 8, min: 0.1, max: 12, step: 0.1, label: "Plants / m²" },
        headsPerPlant: { value: 11, min: 2, max: 12, step: 1, label: "Heads / plant" },
        clumping: { value: 0.85, min: 0, max: 1, step: 0.05, label: "Clumping" },
        headSize: { value: 0.08, min: 0.02, max: 0.3, step: 0.005, label: "Head size (m)" },
        height: { value: 0.28, min: 0.05, max: 1.2, step: 0.01, label: "Head height (m)" },
        drawDistance: { value: 8, min: 4, max: 80, step: 1, label: "Draw distance" },
        fadeWidth: { value: 3, min: 0.5, max: 15, step: 0.5, label: "Fade width" },
        occlusion: { value: true, label: "Occlusion culling" },
        windStrength: { value: 0.03, min: 0, max: 0.2, step: 0.005, label: "Wind sway" },
        brightness: { value: 2.2, min: 0.3, max: 3, step: 0.05, label: "Brightness" },
        seed: { value: 7, min: 0, max: 9999, step: 1, label: "Seed" },
        Drawn: monitor(() => stats.drawn, { graph: false, interval: 300 }),
      },
      { collapsed: true }
    ),
  });

  const petals = useLoader(THREE.FileLoader, PETAL_LODS_URL, (loader) =>
    loader.setResponseType("json")
  ) as unknown as PetalLodsFile;

  // One baked flower head per LOD (high -> low detail).
  const geometries = useDisposable(
    () =>
      FLOWER_DETAIL.map((detail) => {
        const lod = petals.lods[detail.petalLod];
        return bakeAdeyAbeba(lod ? petalGeometry(lod) : null, detail);
      }),
    [petals],
    (list) => list.forEach((g) => g.dispose())
  );

  const flowers = useDisposable(() => createFlowerMaterial(), []);

  const field = useDisposable(
    () =>
      new FlowerField(geometries, flowers.material, {
        density,
        headsPerPlant,
        headSize,
        height,
        clumping,
        pathWidth,
        seed,
      }),
    [geometries, flowers, density, headsPerPlant, headSize, height, clumping, pathWidth, seed]
  );

  useEffect(() => {
    flowers.setLook({ maxHeight: height * 1.3, windStrength, brightness });
  }, [flowers, height, windStrength, brightness]);

  useFrame(({ camera }, delta) => {
    const { x, z } = playerStore;
    const distance = Math.min(drawDistance, maxDistance);
    flowers.setFade(x, z, Math.max(0, distance - fadeWidth), distance);
    flowers.advance(delta);
    field.updateVisibility(camera, x, z, enabled ? distance : -1, occlusion);
    stats.drawn = field.drawn;
  });

  return enabled ? <primitive object={field.group} /> : null;
}
