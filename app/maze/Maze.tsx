"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three/webgpu";
import { createGroundMaterial, createWallMaterial } from "../scene/materials";
import {
  CELL,
  COLS,
  ROWS,
  WALL_HEIGHT,
  exitPosition,
  wallSlabs,
} from "./mazeData";

/** Procedural lawn: a tiled canvas of speckled green blades. Cheap and seamless
 *  enough that the noise hides the tile repeat under the sun. */
function makeGrassTexture(): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const ctx = cv.getContext("2d")!;

  // Base lawn colour.
  ctx.fillStyle = "#4c7d3a";
  ctx.fillRect(0, 0, S, S);

  // Short vertical strokes in varied greens = blades of grass.
  const palette = [
    "#3c6b30",
    "#568c42",
    "#2f5a27",
    "#6aa04d",
    "#457f38",
    "#39682f",
    "#78ab55",
  ];
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = palette[(Math.random() * palette.length) | 0];
    const x = Math.random() * S;
    const y = Math.random() * S;
    ctx.fillRect(x, y, 1, 1 + Math.random() * 3);
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Renders the maze: a grassy ground, all wall cells as ONE instanced mesh (a unit
// box scaled per instance — one draw call however big the maze gets), and a
// glowing marker on the exit tile. Purely visual (no physics colliders).
// Walls and ground are physically based (MeshStandardNodeMaterial) so they take
// their ambient light from the sky environment map — Lambert ignores it.
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

  // A generous grassy field that runs well past the maze out to the horizon.
  const mazeSpan = Math.max(COLS, ROWS) * CELL;
  const groundSize = mazeSpan * 3 + 60;
  const lawn = useMemo(() => makeGrassTexture(), []);
  // One lawn tile ≈ every 3 world units.
  const groundMaterial = useMemo(
    () => createGroundMaterial(lawn, groundSize / 3),
    [lawn, groundSize]
  );
  const wallMaterial = useMemo(() => createWallMaterial(), []);
  useEffect(
    () => () => {
      lawn.dispose();
      groundMaterial.dispose();
      wallMaterial.dispose();
    },
    [lawn, groundMaterial, wallMaterial]
  );

  const [exitX, exitZ] = exitPosition();

  return (
    <>
      {/* Grassy ground (single mesh). */}
      <mesh position={[0, -0.05, 0]} material={groundMaterial} receiveShadow>
        <boxGeometry args={[groundSize, 0.1, groundSize]} />
      </mesh>

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
