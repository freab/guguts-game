import * as THREE from "three/webgpu";
import { treeScale, treeSeed } from "../../maze/mazeData";

/**
 * The maple in the clearing, as pure data: a seeded, procedural branching
 * structure (gnarled trunk splitting low into spreading limbs, one long
 * drooping limb carrying a lantern, roots flaring into the ground) plus the
 * leaf clusters at the twig ends. Rendered by MapleTree.tsx; the lightmap bake
 * uses the clusters as soft occluders for dappled shade on the ground.
 *
 * A new tree grows with every maze (seeded by mazeData.treeSeed), scaled to
 * the clearing (mazeData.treeScale). Cached, so every consumer agrees.
 */

export interface BranchSpec {
  /** Centreline points, base to tip. */
  points: THREE.Vector3[];
  /** Radius at the base and at the tip. */
  r0: number;
  r1: number;
  /** 0 = trunk / main limb, higher = finer; -1 = root. */
  depth: number;
}

export interface LeafCluster {
  center: THREE.Vector3;
  radius: number;
}

export interface MapleTreeLayout {
  branches: BranchSpec[];
  clusters: LeafCluster[];
  /** Point on the long limb the lantern hangs from. */
  lanternAnchor: THREE.Vector3;
  /** Height where the trunk splits into limbs. */
  trunkTop: number;
  trunkRadius: number;
  /** Bounding sphere of the foliage. */
  canopyCenter: THREE.Vector3;
  canopyRadius: number;
  /** How far the crown reaches out from its centre, on the ground plane. */
  canopySpread: number;
  /** Lowest and highest foliage. */
  canopyBottom: number;
  canopyTop: number;
  scale: number;
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

/** Unit direction from an azimuth (around +Y) and an elevation above horizontal. */
function direction(azimuth: number, elevation: number): THREE.Vector3 {
  const c = Math.cos(elevation);
  return new THREE.Vector3(Math.cos(azimuth) * c, Math.sin(elevation), Math.sin(azimuth) * c);
}

let cache: { key: string; layout: MapleTreeLayout } | null = null;

/** The current maze's tree (built once per maze). */
export function mapleTreeLayout(): MapleTreeLayout {
  const scale = treeScale();
  const key = `${treeSeed}:${scale}`;
  if (cache?.key === key) return cache.layout;
  const layout = grow(treeSeed, scale);
  cache = { key, layout };
  return layout;
}

function grow(seed: number, s: number): MapleTreeLayout {
  const rng = mulberry32(seed);
  const range = (a: number, b: number) => a + rng() * (b - a);
  const branches: BranchSpec[] = [];
  const clusters: LeafCluster[] = [];

  // Trunk: short, thick and leaning, with an S-bend, splitting low.
  const leanAz = rng() * Math.PI * 2;
  const lean = new THREE.Vector3(Math.cos(leanAz), 0, Math.sin(leanAz));
  const side = new THREE.Vector3(-lean.z, 0, lean.x);
  const trunkTop = 2.3 * s;
  const trunk = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3().addScaledVector(side, 0.18 * s).setY(0.8 * s),
    new THREE.Vector3().addScaledVector(lean, 0.25 * s).addScaledVector(side, -0.15 * s).setY(1.6 * s),
    new THREE.Vector3().addScaledVector(lean, 0.45 * s).setY(trunkTop),
  ];
  const trunkRadius = 0.42 * s;
  branches.push({ points: trunk, r0: trunkRadius, r1: 0.3 * s, depth: 0 });
  const fork = trunk[trunk.length - 1];

  // Roots: a few flaring into the ground around the base.
  const roots = 4 + Math.floor(rng() * 2);
  for (let i = 0; i < roots; i++) {
    const a = (i / roots) * Math.PI * 2 + range(-0.3, 0.3);
    const out = direction(a, 0);
    const len = range(0.9, 1.4) * s;
    branches.push({
      points: [
        new THREE.Vector3(0, 0.55 * s, 0).addScaledVector(out, 0.1 * s),
        new THREE.Vector3(0, 0.22 * s, 0).addScaledVector(out, len * 0.45),
        new THREE.Vector3(0, -0.12 * s, 0).addScaledVector(out, len),
      ],
      r0: 0.2 * s,
      r1: 0.04 * s,
      depth: -1,
    });
  }

  /**
   * One branch as a wandering polyline, then its children. `droop` pulls the
   * direction down per step (the long limb), otherwise it bends upward a little.
   */
  const branch = (
    start: THREE.Vector3,
    dir: THREE.Vector3,
    length: number,
    r0: number,
    depth: number,
    droop = 0
  ): THREE.Vector3[] => {
    const steps = 4;
    const points = [start.clone()];
    const d = dir.clone();
    const p = start.clone();
    for (let i = 0; i < steps; i++) {
      d.x += range(-0.22, 0.22);
      d.z += range(-0.22, 0.22);
      d.y += range(-0.12, 0.12) + (droop ? -droop : 0.05);
      d.normalize();
      p.addScaledVector(d, length / steps);
      p.y = Math.max(p.y, 2.1 * s); // limbs stay above head height
      points.push(p.clone());
    }
    const r1 = r0 * (depth >= 2 ? 0.35 : 0.55);
    branches.push({ points, r0, r1, depth });

    const tip = points[points.length - 1];
    if (depth >= 2) {
      clusters.push({ center: tip.clone().add(new THREE.Vector3(0, 0.25 * s, 0)), radius: range(0.95, 1.3) * s });
      return points;
    }

    // Children from the outer half, splaying around the parent's heading.
    const children = depth === 0 ? 3 : 2;
    const heading = Math.atan2(dir.z, dir.x);
    for (let i = 0; i < children; i++) {
      const t = range(0.5, 1);
      const at = new THREE.Vector3().lerpVectors(
        points[Math.floor(t * steps)],
        points[Math.min(steps, Math.floor(t * steps) + 1)],
        (t * steps) % 1
      );
      const az = heading + (i - (children - 1) / 2) * range(0.7, 1.1) + range(-0.25, 0.25);
      const el = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) * 0.5 + range(0.15, 0.55);
      branch(at, direction(az, el), length * range(0.55, 0.7), r1 * 0.9, depth + 1);
    }
    // Leafy limbs keep foliage along their outer length too.
    if (depth === 1) clusters.push({ center: tip.clone(), radius: range(0.9, 1.2) * s });
    return points;
  };

  // Main limbs spread evenly around the fork; one long, low and drooping.
  const limbs = 5;
  const baseAz = leanAz + range(-0.4, 0.4);
  let lanternAnchor = fork.clone();
  for (let i = 0; i < limbs; i++) {
    const az = baseAz + (i / limbs) * Math.PI * 2 + range(-0.3, 0.3);
    const start = fork.clone().add(new THREE.Vector3(0, range(-0.35, 0) * s, 0));
    if (i === 0) {
      const points = branch(start, direction(az, 0.28), 4.3 * s, 0.22 * s, 1, 0.07);
      lanternAnchor = new THREE.Vector3().lerpVectors(points[3], points[4], 0.35);
    } else {
      branch(start, direction(az, range(0.6, 1.0)), range(2.3, 3.0) * s, range(0.2, 0.25) * s, 0);
    }
  }

  // Foliage bounds (for the lightmap and the leaf shading).
  const box = new THREE.Box3();
  for (const c of clusters) {
    box.expandByPoint(c.center.clone().addScalar(c.radius));
    box.expandByPoint(c.center.clone().subScalar(c.radius));
  }
  const canopyCenter = box.getCenter(new THREE.Vector3());
  const canopyRadius = box.getSize(new THREE.Vector3()).length() / 2;
  let canopySpread = 0;
  for (const c of clusters) {
    canopySpread = Math.max(
      canopySpread,
      Math.hypot(c.center.x - canopyCenter.x, c.center.z - canopyCenter.z) + c.radius
    );
  }

  return {
    branches,
    clusters,
    lanternAnchor,
    trunkTop,
    trunkRadius,
    canopyCenter,
    canopyRadius,
    canopySpread,
    canopyBottom: box.min.y,
    canopyTop: box.max.y,
    scale: s,
  };
}

/** Deterministic value noise in [0, 1] (dappled light through the leaves). */
function hash2(ix: number, iz: number) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function valueNoise(x: number, z: number) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  return (
    hash2(ix, iz) * (1 - ux) * (1 - uz) +
    hash2(ix + 1, iz) * ux * (1 - uz) +
    hash2(ix, iz + 1) * (1 - ux) * uz +
    hash2(ix + 1, iz + 1) * ux * uz
  );
}

/** Leaf "optical density" per metre of canopy a sun ray passes through. */
const LEAF_DENSITY = 1.15;
const _oc = new THREE.Vector3();

/**
 * How much sunlight reaches ground point `origin` along unit `dir` through the
 * tree (1 = none blocked): the trunk blocks fully, and each leaf cluster
 * absorbs by the length of the ray inside it, broken up with noise so the
 * shade is dappled. Used by the lightmap bake.
 */
export function treeTransmittance(tree: MapleTreeLayout, origin: THREE.Vector3, dir: THREE.Vector3): number {
  // Trunk: a vertical cylinder up to the fork.
  const b = origin.x * dir.x + origin.z * dir.z;
  const a = dir.x * dir.x + dir.z * dir.z;
  const c = origin.x * origin.x + origin.z * origin.z - tree.trunkRadius * tree.trunkRadius;
  const disc = b * b - a * c;
  if (a > 1e-9 && disc >= 0) {
    const t = (-b - Math.sqrt(disc)) / a;
    const y = origin.y + dir.y * Math.max(t, 0);
    if (t > -tree.trunkRadius && y < tree.trunkTop) return 0;
  }

  // Quick reject: the ray misses the whole canopy.
  _oc.subVectors(tree.canopyCenter, origin);
  const tc = _oc.dot(dir);
  if (tc < 0 || _oc.lengthSq() - tc * tc > tree.canopyRadius * tree.canopyRadius) return 1;

  let optical = 0;
  let entry = -1;
  for (const cl of tree.clusters) {
    _oc.subVectors(cl.center, origin);
    const tca = _oc.dot(dir);
    if (tca < 0) continue;
    const d2 = _oc.lengthSq() - tca * tca;
    const r2 = cl.radius * cl.radius;
    if (d2 >= r2) continue;
    const half = Math.sqrt(r2 - d2);
    optical += 2 * half;
    if (entry < 0 || tca - half < entry) entry = tca - half;
  }
  if (optical === 0) return 1;
  // Dapple: vary density by noise where the ray enters the foliage.
  const ex = origin.x + dir.x * entry;
  const ez = origin.z + dir.z * entry;
  const dapple = 0.35 + 1.1 * valueNoise(ex * 2.2, ez * 2.2);
  return Math.exp(-optical * LEAF_DENSITY * dapple);
}

