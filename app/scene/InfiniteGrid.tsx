"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useControls, folder } from "leva";
import * as THREE from "three/webgpu";
import {
  abs,
  cameraPosition,
  float,
  fract,
  fwidth,
  length,
  max,
  min,
  mix,
  positionWorld,
  smoothstep,
  uniform,
} from "three/tsl";
import { CELL } from "../maze/mazeData";
import { lightmapFactor } from "./bake/lightmap";
import { useDisposable } from "../hooks/useDisposable";

/** Plane size; it follows the camera, and lines fade out well before its edge. */
const PLANE_SIZE = 2000;

interface GridSettings {
  cellSize: number;
  sectionSize: number;
  cellThickness: number;
  sectionThickness: number;
  fadeDistance: number;
  fillColor: string;
  cellColor: string;
  sectionColor: string;
}

/**
 * Infinite ground grid as a TSL material (drei's <Grid> is GLSL, which WebGPU
 * can't run). Lines are computed from world XZ, anti-aliased in screen space
 * with fwidth, and fade out with distance from the camera. `fill` = a lit floor
 * with lines on it (wall shadows + AO from the baked lightmap); otherwise lines
 * only, over the sky.
 */
function createGridMaterial(fill: boolean) {
  const u = {
    cellSize: uniform(1),
    sectionSize: uniform(10),
    cellThickness: uniform(1),
    sectionThickness: uniform(1.5),
    fadeDistance: uniform(120),
    offset: uniform(0),
    fillColor: uniform(new THREE.Color("#3b3e44")),
    cellColor: uniform(new THREE.Color("#5a5e66")),
    sectionColor: uniform(new THREE.Color("#8a8f99")),
  };

  const p = positionWorld.xz.sub(u.offset);

  /** 1 on a grid line of the given spacing, 0 between, AA'd over ~1px. */
  type FloatUniform = typeof u.cellSize;
  const line = (size: FloatUniform, thickness: FloatUniform) => {
    const coord = p.div(size);
    const dist = abs(fract(coord.sub(0.5)).sub(0.5)).div(fwidth(coord));
    return float(1).sub(min(min(dist.x, dist.y).div(thickness), 1));
  };

  const cell = line(u.cellSize, u.cellThickness);
  const section = line(u.sectionSize, u.sectionThickness);
  const fade = float(1).sub(
    smoothstep(u.fadeDistance.mul(0.3), u.fadeDistance, length(positionWorld.xz.sub(cameraPosition.xz)))
  );
  const lines = max(cell, section).mul(fade);
  const lineColor = mix(u.cellColor, u.sectionColor, section);

  let material: THREE.MeshLambertNodeMaterial | THREE.MeshBasicNodeMaterial;
  if (fill) {
    material = new THREE.MeshLambertNodeMaterial();
    // Wall shadows + AO come from the baked lightmap (no shadow-map sampling).
    material.colorNode = mix(u.fillColor, lineColor, lines).mul(lightmapFactor);
  } else {
    material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    material.colorNode = lineColor;
    material.opacityNode = lines;
  }

  return {
    material,
    set(s: GridSettings, offset: number) {
      u.cellSize.value = s.cellSize;
      u.sectionSize.value = s.sectionSize;
      u.cellThickness.value = s.cellThickness;
      u.sectionThickness.value = s.sectionThickness;
      u.fadeDistance.value = s.fadeDistance;
      u.offset.value = offset;
      u.fillColor.value.set(s.fillColor);
      u.cellColor.value.set(s.cellColor);
      u.sectionColor.value.set(s.sectionColor);
    },
    dispose() {
      material.dispose();
    },
  };
}

/** Keep the plane under the camera so the grid never ends. */
function followCamera(mesh: THREE.Mesh, camera: THREE.Camera) {
  mesh.position.x = camera.position.x;
  mesh.position.z = camera.position.z;
}

/**
 * An infinite grid ground. Lines line up with the maze's cell edges (offset by
 * half a cell), so grid cells match maze cells when "Cell size" is a divisor of
 * the maze cell.
 */
export default function InfiniteGrid() {
  const meshRef = useRef<THREE.Mesh>(null);
  const invalidate = useThree((s) => s.invalidate);

  const { fill, ...settings } = useControls("Game", {
    Ground: folder(
      {
        fill: { value: true, label: "Solid floor" },
        fillColor: { value: "#3b3e44", label: "Floor" },
        cellSize: { value: 1, min: 0.25, max: 10, step: 0.25, label: "Cell size" },
        cellThickness: { value: 1, min: 0.25, max: 4, step: 0.25, label: "Cell line px" },
        cellColor: { value: "#5a5e66", label: "Cell line" },
        sectionSize: { value: 10, min: 1, max: 50, step: 1, label: "Section size" },
        sectionThickness: { value: 1.5, min: 0.25, max: 5, step: 0.25, label: "Section line px" },
        sectionColor: { value: "#8a8f99", label: "Section line" },
        fadeDistance: { value: 120, min: 20, max: 500, step: 5, label: "Fade distance" },
      },
      { collapsed: true }
    ),
  });

  const grid = useDisposable(() => createGridMaterial(fill), [fill]);

  const {
    cellSize,
    sectionSize,
    cellThickness,
    sectionThickness,
    fadeDistance,
    fillColor,
    cellColor,
    sectionColor,
  } = settings;
  useEffect(() => {
    grid.set(
      { cellSize, sectionSize, cellThickness, sectionThickness, fadeDistance, fillColor, cellColor, sectionColor },
      CELL / 2
    );
    invalidate();
  }, [
    grid,
    cellSize,
    sectionSize,
    cellThickness,
    sectionThickness,
    fadeDistance,
    fillColor,
    cellColor,
    sectionColor,
    invalidate,
  ]);

  useFrame(({ camera }) => {
    if (meshRef.current) followCamera(meshRef.current, camera);
  });

  return (
    <mesh
      ref={meshRef}
      rotation={[-Math.PI / 2, 0, 0]}
      material={grid.material}
      frustumCulled={false}
    >
      <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
    </mesh>
  );
}
