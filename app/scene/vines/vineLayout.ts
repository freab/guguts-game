import * as THREE from "three/webgpu";
import { COLS, ROWS, WALL_HEIGHT, cellAt, treeSeed, wallSlabs } from "../../maze/mazeData";

/**
 * Ivy on the maze walls, as pure data: which wall faces carry a vine, and for
 * each vine its woody stems (with curling tendrils at the tips) and the leaves
 * along them. Seeded per maze, so the same maze always grows the same ivy.
 * Rendered by vines/VineField.ts.
 */

/** One side of a wall slab that isn't buried against another wall. */
export interface WallFace {
  /** Centre of the face at ground level. */
  origin: THREE.Vector3;
  /** Out of the wall, into the corridor. */
  normal: THREE.Vector3;
  /** Along the wall (horizontal). */
  tangent: THREE.Vector3;
  width: number;
}

/** A stem or tendril: a curve along the wall with its radius at each end. */
export interface VineStem {
  points: THREE.Vector3[];
  r0: number;
  r1: number;
  /** Out of the wall it grows on (a stable frame for building the tube). */
  normal: THREE.Vector3;
}

export interface VineLeaf {
  position: THREE.Vector3;
  /** Card basis: x across the leaf, y towards its tip, z out of its face. */
  x: THREE.Vector3;
  y: THREE.Vector3;
  z: THREE.Vector3;
  size: number;
  /** Ivy atlas cell 0..7. */
  cell: number;
}

/** How the ivy grows on a face. */
export interface VineGrowth {
  /** Leaves per metre of stem (before randomness). */
  leafDensity: number;
  /** Leaf size multiplier (1 ≈ 10 cm leaves). */
  leafSize: number;
  /** Tallest a vine climbs, as a fraction of the wall height. */
  maxHeight: number;
}

/** A wall face that carries vines, with its own growth seed. */
export interface VineFace {
  face: WallFace;
  seed: number;
}

export interface VineLayout {
  stems: VineStem[];
  leaves: VineLeaf[];
}

function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const UP = new THREE.Vector3(0, 1, 0);
/** How far leaves and stems sit off the wall surface (no z-fighting). */
const STEM_OFFSET = 0.012;
const STEP = 0.07;
/** Metres of wall per climbing vine. */
const VINE_SPACING = 0.4;
/** Per growth step: chance of a climber branching off, and of a tendril. */
const CLIMBER_CHANCE = 0.06;
const TENDRIL_CHANCE = 0.07;

/**
 * Every exposed wall surface: each side of each wall slab whose neighbouring
 * cell isn't wall — corridor sides, the maze's outer faces and the ends of
 * wall stubs alike — as wide as the slab runs along it.
 */
export function wallFaces(): WallFace[] {
  const isWall = (r: number, c: number) => r >= 0 && r < ROWS && c >= 0 && c < COLS && cellAt(r, c) === "wall";
  const faces: WallFace[] = [];
  const dirs: [number, number][] = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ];
  for (const slab of wallSlabs()) {
    for (const [dr, dc] of dirs) {
      if (isWall(slab.r + dr, slab.c + dc)) continue; // buried against the next slab
      // Out of the wall, towards the exposed side.
      const normal = new THREE.Vector3(dc, 0, dr);
      const tangent = new THREE.Vector3(dr !== 0 ? 1 : 0, 0, dc !== 0 ? 1 : 0);
      const halfThickness = dc !== 0 ? slab.w / 2 : slab.d / 2;
      const width = dc !== 0 ? slab.d : slab.w;
      if (width < 0.2) continue;
      faces.push({
        origin: new THREE.Vector3(slab.x, 0, slab.z).addScaledVector(normal, halfThickness),
        normal,
        tangent,
        width,
      });
    }
  }
  return faces;
}

/** A small curling spiral springing off the wall — a tendril. */
function tendril(rng: () => number, at: THREE.Vector3, face: WallFace, heading: THREE.Vector3): VineStem {
  const turns = 1.2 + rng() * 1.3;
  const n = 12;
  const radius = 0.025 + rng() * 0.02;
  const side = rng() < 0.5 ? -1 : 1;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * turns * Math.PI * 2;
    const r = radius * (1 - t * 0.7);
    // Curls in the plane of the heading and the wall normal, drifting out.
    points.push(
      at
        .clone()
        .addScaledVector(heading, Math.sin(a) * r + t * 0.04)
        .addScaledVector(face.normal, (1 - Math.cos(a)) * r * 0.8 + t * 0.03)
        .addScaledVector(face.tangent, side * t * 0.02)
    );
  }
  return { points, r0: 0.004, r1: 0.0015, normal: face.normal };
}

/** One leaf on a stem point, tip roughly up, face out from the wall. */
function leaf(rng: () => number, at: THREE.Vector3, face: WallFace, size: number): VineLeaf {
  // Face out of the wall, tipped up or down a little; ivy leaves stand proud.
  const z = face.normal
    .clone()
    .addScaledVector(UP, (rng() - 0.35) * 0.7)
    .addScaledVector(face.tangent, (rng() - 0.5) * 0.6)
    .normalize();
  // Tip up, swung ±55° about the facing direction.
  const tip = UP.clone().applyAxisAngle(z, (rng() - 0.5) * 1.9);
  const x = new THREE.Vector3().crossVectors(tip, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  return {
    position: at.clone().addScaledVector(face.normal, 0.01 + rng() * 0.035),
    x,
    y,
    z,
    size,
    cell: Math.floor(rng() * 8),
  };
}

/**
 * Grow the ivy on one face:
 * - vines climb from the foot of the wall as wandering random walks (upward
 *   bias, bouncing off the face edges), one every VINE_SPACING;
 * - climbers branch off them and spread sideways across the wall;
 * - tendrils curl off the stems here and there, and off every tip;
 * with leaves along all the stems.
 */
export function growFace({ face, seed }: VineFace, options: VineGrowth): VineLayout {
  const rng = mulberry32(seed);
  const stems: VineStem[] = [];
  const leaves: VineLeaf[] = [];
  const top = WALL_HEIGHT * options.maxHeight;

  const climb = (face: WallFace, startU: number, startV: number, heading: number, length: number, depth: number) => {
    let u = startU;
    let v = startV;
    let angle = heading; // 0 = straight up, in radians towards +tangent
    // Vines drift back towards straight up; climbers hold their sideways line.
    const preferred = depth === 0 ? 0 : heading;
    const points: THREE.Vector3[] = [];
    const toWorld = (uu: number, vv: number) =>
      face.origin
        .clone()
        .addScaledVector(face.tangent, uu)
        .addScaledVector(UP, vv)
        .addScaledVector(face.normal, STEM_OFFSET);
    points.push(toWorld(u, v));
    const steps = Math.max(3, Math.round(length / STEP));
    const half = face.width / 2 - 0.06;
    for (let i = 0; i < steps; i++) {
      angle += (rng() - 0.5) * 0.7;
      angle = preferred + (angle - preferred) * 0.85;
      u += Math.sin(angle) * STEP;
      v += Math.cos(angle) * STEP;
      if (u > half || u < -half) {
        u = THREE.MathUtils.clamp(u, -half, half);
        angle = -angle;
      }
      if (v > top) break;
      const p = toWorld(u, v);
      points.push(p);

      // Leaves, alternating sides of the stem.
      if (rng() < options.leafDensity * STEP) {
        const size = (0.07 + rng() * 0.07) * options.leafSize * (depth > 0 ? 0.85 : 1);
        const side = i % 2 === 0 ? 1 : -1;
        leaves.push(leaf(rng, p.clone().addScaledVector(face.tangent, side * 0.025), face, size));
      }
      // Climbers: side shoots spreading across the wall (60°–100° off vertical).
      if (depth < 1 && i > 2 && rng() < CLIMBER_CHANCE) {
        const side = rng() < 0.5 ? -1 : 1;
        climb(face, u, v, side * (1.05 + rng() * 0.7), length * (0.35 + rng() * 0.25), depth + 1);
      }
      // Tendrils curling off along the stem.
      if (i > 1 && rng() < TENDRIL_CHANCE) {
        const heading3 = p.clone().sub(points[points.length - 2]).normalize();
        heading3.applyAxisAngle(face.normal, (rng() < 0.5 ? -1 : 1) * (0.6 + rng() * 0.6));
        stems.push(tendril(rng, p, face, heading3));
      }
    }
    if (points.length < 3) return;
    stems.push({ points, r0: depth === 0 ? 0.014 : 0.009, r1: 0.003, normal: face.normal });
    // A tendril curling off the tip, heading the way the vine was growing.
    const tip = points[points.length - 1];
    const heading3 = tip.clone().sub(points[points.length - 2]).normalize();
    stems.push(tendril(rng, tip, face, heading3));
  };

  // Vines spread evenly across the face (about one per VINE_SPACING), so no
  // stretch of wall stays bare.
  const vines = Math.max(1, Math.round(face.width / VINE_SPACING));
  for (let k = 0; k < vines; k++) {
    const u = ((k + 0.5) / vines - 0.5 + ((rng() - 0.5) * 0.6) / vines) * face.width * 0.9;
    const length = top * (0.5 + rng() * 0.6) * 1.3;
    climb(face, u, 0, (rng() - 0.5) * 0.6, length, 0);
  }
  return { stems, leaves };
}

/**
 * The wall faces that carry vines (`coverage` of them), each with its own
 * seed: growth is per face and on demand (growFace), yet the same maze and
 * seed always grow the same ivy, whatever order faces are grown in.
 */
export function vineFaces(coverage: number, seed: number): VineFace[] {
  const base = (treeSeed ^ Math.imul(seed, 0x9e3779b1)) >>> 0;
  const out: VineFace[] = [];
  wallFaces().forEach((face, i) => {
    const faceSeed = Math.imul(base ^ Math.imul(i + 1, 0x27d4eb2d), 0x85ebca6b) >>> 0;
    if (mulberry32(faceSeed ^ 0x5bd1e995)() <= coverage) out.push({ face, seed: faceSeed });
  });
  return out;
}

