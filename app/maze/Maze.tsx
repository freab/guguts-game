"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three/webgpu";
import { mix, positionWorld, smoothstep, uniform } from "three/tsl";
import {
  CELL,
  WALL_HEIGHT,
  exitPosition,
  wallSlabs,
} from "./mazeData";

/**
 * Wall material: matte stone with ambient occlusion baked in analytically —
 * darker towards the base where wall meets ground (computed from height, so no
 * texture and no runtime AO pass).
 */
function createWallMaterial() {
  const material = new THREE.MeshLambertNodeMaterial();
  const base = uniform(new THREE.Color("#c9bfa7"));
  material.colorNode = base.mul(mix(0.55, 1, smoothstep(0, 0.9, positionWorld.y)));
  return material;
}

// Renders the maze: all wall cells as ONE instanced mesh (a unit
// box scaled per instance — one draw call however big the maze gets), and a
// glowing marker on the exit tile. Purely visual (no physics colliders).
// Materials are Lambert/Basic rather than PBR: this is a matte scene, so the
// cheaper shading looks the same and costs less per pixel.
export default function Maze() {
  const wallsRef = useRef<THREE.InstancedMesh>(null);

  // Slim wall slabs (thin across the run, full along it) from the shared helper.
  const walls = useMemo(() => wallSlabs(), []);

  // Push each wall's transform into the instanced mesh (unit box + per-instance
  // scale gives every slab its own thin/full dimensions from one geometry).
  useLayoutEffect(() => {
    const mesh = wallsRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    walls.forEach(({ x, z, w, d }, i) => {
      dummy.position.set(x, WALL_HEIGHT / 2, z);
      dummy.scale.set(w, WALL_HEIGHT, d);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.count = walls.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [walls]);

  const wallMaterial = useMemo(() => createWallMaterial(), []);
  useEffect(() => () => wallMaterial.dispose(), [wallMaterial]);

  const [exitX, exitZ] = exitPosition();

  return (
    <>
      {/* All walls in one instanced draw call. */}
      <instancedMesh
        key={walls.length}
        ref={wallsRef}
        args={[undefined, wallMaterial, walls.length]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[1, 1, 1]} />
      </instancedMesh>

      {/* Exit marker (unlit, full-bright). */}
      <mesh position={[exitX, 0.03, exitZ]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[CELL * 0.9, CELL * 0.9]} />
        <meshBasicMaterial color="#39d98a" toneMapped={false} />
      </mesh>
    </>
  );
}
