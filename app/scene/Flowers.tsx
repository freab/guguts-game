"use client";

import { useEffect, useMemo } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import { useControls, folder, monitor } from "leva";
import * as THREE from "three/webgpu";
import { FLOWER_DETAIL, bakeAdeyAbeba, petalGeometry, type PetalLodData } from "./flowers/adeyAbeba";
import { FlowerField } from "./flowers/FlowerField";
import { createFlowerMaterial } from "./flowers/flowerNodeMaterial";
import { playerStore } from "../character/playerStore";

/** Petal LODs decoded from adey-abeba's petal2.drc (see flowers/adeyAbeba.ts). */
const PETAL_LODS_URL = "/models/adey-abeba/petal-lods.json";
/** The adey-abeba hero head is 1.7x as wide as the flower is tall; 0.4 of that suits a verge. */
const BASE_HEAD_SCALE = 0.4;

interface PetalLodsFile {
  lods: PetalLodData[];
}

/** Written by the field every frame, read by the leva monitor. */
const stats = { drawn: 0 };

/**
 * Adey Abeba (Meskel daisy) flowers growing in drifts along the grass verges.
 * The flower is baked once per LOD into a single vertex-coloured geometry and
 * instanced per chunk (flowers/FlowerField.ts); drawn only near the player and
 * in view, like the grass.
 */
export default function Flowers({
  pathWidth,
}: {
  /** Footpath half-width in world units; flowers stay off it. 0 = no footpath. */
  pathWidth: number;
}) {
  const {
    enabled,
    density,
    clumping,
    size,
    headSize,
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
        density: { value: 1.2, min: 0.05, max: 6, step: 0.05, label: "Flowers / m²" },
        clumping: { value: 0.75, min: 0, max: 1, step: 0.05, label: "Clumping" },
        size: { value: 0.5, min: 0.15, max: 1.5, step: 0.05, label: "Height (m)" },
        headSize: { value: 1, min: 0.4, max: 2.5, step: 0.05, label: "Head size" },
        drawDistance: { value: 18, min: 4, max: 80, step: 1, label: "Draw distance" },
        fadeWidth: { value: 3, min: 0.5, max: 15, step: 0.5, label: "Fade width" },
        occlusion: { value: true, label: "Occlusion culling" },
        windStrength: { value: 0.04, min: 0, max: 0.3, step: 0.01, label: "Wind sway" },
        brightness: { value: 1.3, min: 0.3, max: 3, step: 0.05, label: "Brightness" },
        seed: { value: 7, min: 0, max: 9999, step: 1, label: "Seed" },
        Drawn: monitor(() => stats.drawn, { graph: false, interval: 300 }),
      },
      { collapsed: true }
    ),
  });

  const petals = useLoader(THREE.FileLoader, PETAL_LODS_URL, (loader) =>
    loader.setResponseType("json")
  ) as unknown as PetalLodsFile;

  // One baked flower per LOD (high -> low detail).
  const geometries = useMemo(
    () =>
      FLOWER_DETAIL.map((detail) =>
        bakeAdeyAbeba(petalGeometry(petals.lods[detail.petalLod]), detail, BASE_HEAD_SCALE * headSize)
      ),
    [petals, headSize]
  );
  useEffect(() => () => geometries.forEach((g) => g.dispose()), [geometries]);

  const flowers = useMemo(() => createFlowerMaterial(), []);
  useEffect(() => () => flowers.dispose(), [flowers]);

  const field = useMemo(
    () =>
      new FlowerField(geometries, flowers.material, {
        density,
        size,
        headSize,
        clumping,
        pathWidth,
        seed,
      }),
    [geometries, flowers, density, size, headSize, clumping, pathWidth, seed]
  );
  useEffect(() => () => field.dispose(), [field]);

  useEffect(() => {
    flowers.setLook({ maxHeight: size * 1.25, windStrength, brightness });
  }, [flowers, size, windStrength, brightness]);

  useFrame(({ camera }, delta) => {
    const { x, z } = playerStore;
    flowers.setFade(x, z, Math.max(0, drawDistance - fadeWidth), drawDistance);
    flowers.advance(delta);
    field.updateVisibility(camera, x, z, enabled ? drawDistance : -1, occlusion);
    stats.drawn = field.drawn;
  });

  return enabled ? <primitive object={field.group} /> : null;
}
