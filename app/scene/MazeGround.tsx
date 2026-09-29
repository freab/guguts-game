"use client";

import { useMemo } from "react";
import * as THREE from "three/webgpu";
import { float, mix, mx_noise_float, positionWorld } from "three/tsl";
import { CELL, COLS, ROWS, cellToWorld } from "../maze/mazeData";
import { lightmapFactor } from "./bake/lightmap";
import { pbrSurface, usePbrSet, type PbrSet } from "./textures/pbrTextures";
import { useDisposable } from "../hooks/useDisposable";

/** Metres per texture repeat. */
const GROUND_TILE = 2.5;
/** Just above the grid floor (y = 0), below the footpath (0.015). */
const GROUND_Y = 0.005;

/**
 * The forest-floor surface (Poly Haven forrest_ground_01, CC0; KTX2): albedo,
 * normal, roughness and AO tiled in world space, a large-scale noise tint to
 * break up the repeat, and the baked lightmap (wall shadows + AO, dappled
 * shade under the maple) on top — the same bake as the grass, so they agree.
 * Shared with the footpath, which lies on the ground in the very same texture.
 */
export function groundSurface(set: PbrSet) {
  const uv = positionWorld.xz.div(GROUND_TILE);
  const s = pbrSurface(set, uv);
  const variation = mix(float(0.82), float(1.1), mx_noise_float(positionWorld.xz.mul(0.12)).mul(0.5).add(0.5));
  return { ...s, color: s.color.mul(variation).mul(lightmapFactor) };
}

function createGroundMaterial(set: PbrSet) {
  const s = groundSurface(set);
  const material = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
  material.colorNode = s.color;
  material.normalNode = s.normal;
  material.roughnessNode = s.roughness;
  material.aoNode = s.ao;
  return material;
}

/**
 * The ground inside the maze: a textured forest floor under the grass and
 * footpath. The infinite grid still carries on outside the maze.
 */
export default function MazeGround() {
  const set = usePbrSet("ground");
  const material = useDisposable(() => createGroundMaterial(set), [set]);

  // The maze's full footprint, border walls included.
  const { center, size } = useMemo(() => {
    const [x0, z0] = cellToWorld(0, 0);
    const [x1, z1] = cellToWorld(ROWS - 1, COLS - 1);
    return {
      center: [(x0 + x1) / 2, GROUND_Y, (z0 + z1) / 2] as const,
      size: [x1 - x0 + CELL, z1 - z0 + CELL] as const,
    };
  }, []);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={center} material={material}>
      <planeGeometry args={size} />
    </mesh>
  );
}
