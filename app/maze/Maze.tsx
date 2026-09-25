"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three/webgpu";
import {
  CELL,
  COLS,
  ROWS,
  WALL_HEIGHT,
  cellAt,
  cellToWorld,
  exitPosition,
} from "./mazeData";

// Wall thickness as a fraction of a cell — walls are slim slabs, not full-cell
// blocks, so the corridors read as an open grassy grid. Runs still span the full
// cell *along* their direction, so the maze stays sealed (no gaps to slip through).
const THICKNESS = CELL * 0.32;

/** Procedural grass: a tiled canvas of speckled green blades. Cheap and seamless
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
// glowing marker on the exit tile. Purely visual now (no physics colliders).
export default function Maze() {
  const wallsRef = useRef<THREE.InstancedMesh>(null);

  // Collect each wall cell's box, sized thin across the run and full along it so
  // adjacent walls tile edge-to-edge (junctions stay full on both axes).
  const walls = useMemo(() => {
    const isWall = (r: number, c: number) =>
      r >= 0 && r < ROWS && c >= 0 && c < COLS && cellAt(r, c) === "wall";

    const out: {
      pos: [number, number, number];
      size: [number, number, number];
    }[] = [];

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (cellAt(r, c) !== "wall") continue;
        const [x, z] = cellToWorld(r, c);
        const horiz = isWall(r, c - 1) || isWall(r, c + 1);
        const vert = isWall(r - 1, c) || isWall(r + 1, c);
        out.push({
          pos: [x, WALL_HEIGHT / 2, z],
          size: [horiz ? CELL : THICKNESS, WALL_HEIGHT, vert ? CELL : THICKNESS],
        });
      }
    }
    return out;
  }, []);

  // Push each wall's transform into the instanced mesh (unit box + per-instance
  // scale gives every slab its own thin/full dimensions from one geometry).
  useLayoutEffect(() => {
    const mesh = wallsRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    walls.forEach(({ pos, size }, i) => {
      dummy.position.set(pos[0], pos[1], pos[2]);
      dummy.scale.set(size[0], size[1], size[2]);
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
  const grass = useMemo(() => {
    const tex = makeGrassTexture();
    const tiles = groundSize / 3; // one grass tile ≈ every 3 world units
    tex.repeat.set(tiles, tiles);
    return tex;
  }, [groundSize]);

  const [exitX, exitZ] = exitPosition();

  return (
    <>
      {/* Grassy ground (single mesh). */}
      <mesh position={[0, -0.05, 0]} receiveShadow>
        <boxGeometry args={[groundSize, 0.1, groundSize]} />
        <meshStandardMaterial map={grass} roughness={0.95} metalness={0} />
      </mesh>

      {/* All walls in one instanced draw call. */}
      <instancedMesh
        key={walls.length}
        ref={wallsRef}
        args={[undefined, undefined, walls.length]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#c9bfa7" roughness={0.85} metalness={0} />
      </instancedMesh>

      {/* Exit marker (visual only). */}
      <mesh position={[exitX, 0.03, exitZ]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[CELL * 0.9, CELL * 0.9]} />
        <meshStandardMaterial
          color="#39d98a"
          emissive="#39d98a"
          emissiveIntensity={1.2}
          toneMapped={false}
        />
      </mesh>
    </>
  );
}
