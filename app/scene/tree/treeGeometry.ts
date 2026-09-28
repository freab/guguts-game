import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { MapleTreeLayout } from "./mapleTree";

/** Autumn maple palette: [colour, weight]. Mostly reds, some orange, a few pale. */
const PALETTE: [string, number][] = [
  ["#d8261c", 0.32],
  ["#f0401f", 0.24],
  ["#ff6a2a", 0.18],
  ["#a3161a", 0.14],
  ["#f3c1b4", 0.07],
  ["#ffd2a8", 0.05],
];
const PALETTE_COLORS = PALETTE.map(([hex]) => new THREE.Color(hex));

function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickColor(rng: () => number, out: THREE.Color): THREE.Color {
  let u = rng();
  for (let i = 0; i < PALETTE.length; i++) {
    u -= PALETTE[i][1];
    if (u <= 0) return out.copy(PALETTE_COLORS[i]);
  }
  return out.copy(PALETTE_COLORS[0]);
}

/**
 * Bark: every branch as a tapered tube along a smooth curve, merged into one
 * geometry. The trunk flares at the foot, and a ripple around each tube makes
 * the bark gnarled rather than pipe-smooth.
 */
export function barkGeometry(tree: MapleTreeLayout): THREE.BufferGeometry {
  const parts = tree.branches.map((b, index) => {
    const isTrunk = index === 0;
    const segments = isTrunk ? 14 : b.depth <= 0 ? 10 : b.depth === 1 ? 8 : 5;
    const radial = isTrunk ? 12 : b.depth <= 0 ? 8 : b.depth === 1 ? 6 : 5;
    const curve = new THREE.CatmullRomCurve3(b.points, false, "centripetal");
    const geo = new THREE.TubeGeometry(curve, segments, 1, radial, false);
    const pos = geo.getAttribute("position");
    const p = new THREE.Vector3();
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      curve.getPointAt(t, p);
      let r = THREE.MathUtils.lerp(b.r0, b.r1, t);
      if (isTrunk) r *= 1 + 0.9 * (1 - t) ** 4; // flared foot
      for (let j = 0; j <= radial; j++) {
        const k = i * (radial + 1) + j;
        const a = (j / radial) * Math.PI * 2;
        const gnarl = 1 + 0.09 * Math.sin(a * 3 + t * 9 + index) + 0.05 * Math.sin(a * 5 - t * 13);
        pos.setXYZ(
          k,
          p.x + (pos.getX(k) - p.x) * r * gnarl,
          p.y + (pos.getY(k) - p.y) * r * gnarl,
          p.z + (pos.getZ(k) - p.z) * r * gnarl
        );
      }
    }
    geo.deleteAttribute("uv");
    return geo;
  });
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error("maple: failed to merge bark");
  merged.computeVertexNormals();
  return merged;
}

/**
 * A small maple leaf, 1 unit across, lying flat and facing up: a five-lobed
 * star (long middle lobe, short lower ones) as a 10-triangle fan.
 */
export function mapleLeafGeometry(): THREE.BufferGeometry {
  // Lobe tips (angle from +Z, radius) with notches between them.
  const lobes: [number, number][] = [
    [0, 0.55],
    [1.15, 0.46],
    [2.3, 0.3],
    [-2.3, 0.3],
    [-1.15, 0.46],
  ];
  const ring: [number, number][] = [];
  const sorted = [...lobes].sort((a, b) => a[0] - b[0]);
  sorted.forEach(([angle, r], i) => {
    ring.push([Math.sin(angle) * r, Math.cos(angle) * r]);
    const next = sorted[(i + 1) % sorted.length];
    let mid = (angle + next[0]) / 2;
    if (i === sorted.length - 1) mid += Math.PI; // wrap-around notch at the stem
    const notch = i === sorted.length - 1 ? 0.12 : 0.2;
    ring.push([Math.sin(mid) * notch, Math.cos(mid) * notch]);
  });
  const positions: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    positions.push(0, 0, 0, bx, 0, bz, ax, 0, az);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

export interface LeafInstances {
  matrices: Float32Array;
  colors: Float32Array;
  count: number;
}

/**
 * The canopy: leaves scattered through every cluster, mostly towards its
 * surface, with a little baked shading — darker deep inside a cluster and
 * low in the crown, lighter on top.
 */
export function canopyLeaves(tree: MapleTreeLayout, seed: number, perCluster: number): LeafInstances {
  const rng = mulberry32(seed ^ 0x51ed27);
  const s = tree.scale;
  const bottom = tree.canopyBottom;
  const top = tree.canopyTop;
  const matrices: number[] = [];
  const colors: number[] = [];
  const dummy = new THREE.Object3D();
  const dir = new THREE.Vector3();
  const color = new THREE.Color();
  for (const cl of tree.clusters) {
    const n = Math.round(perCluster * (cl.radius / (1.1 * s)) ** 2);
    for (let i = 0; i < n; i++) {
      dir.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1);
      if (dir.lengthSq() > 1 || dir.lengthSq() < 1e-4) {
        i--;
        continue;
      }
      dir.normalize();
      const depth = 0.3 + 0.7 * Math.sqrt(rng()); // biased to the surface
      dummy.position.set(
        cl.center.x + dir.x * cl.radius * depth,
        cl.center.y + dir.y * cl.radius * depth * 0.75,
        cl.center.z + dir.z * cl.radius * depth
      );
      dummy.rotation.set((rng() - 0.5) * 2, rng() * Math.PI * 2, (rng() - 0.5) * 2);
      dummy.scale.setScalar((0.2 + rng() * 0.09) * s);
      dummy.updateMatrix();
      matrices.push(...dummy.matrix.elements);

      const height = THREE.MathUtils.clamp((dummy.position.y - bottom) / (top - bottom), 0, 1);
      const shade = (0.55 + 0.45 * depth) * (0.72 + 0.28 * height);
      pickColor(rng, color).multiplyScalar(shade);
      colors.push(color.r, color.g, color.b);
    }
  }
  return { matrices: new Float32Array(matrices), colors: new Float32Array(colors), count: colors.length / 3 };
}

/** Leaves on the ground under the crown, thickest near the trunk. */
export function fallenLeaves(tree: MapleTreeLayout, seed: number, count: number): LeafInstances {
  const rng = mulberry32(seed ^ 0x2c1b3c6d);
  const s = tree.scale;
  // Centred between the trunk and the middle of the crown.
  const cx = tree.canopyCenter.x * 0.6;
  const cz = tree.canopyCenter.z * 0.6;
  const reach = tree.canopySpread * 0.9;
  const matrices = new Float32Array(count * 16);
  const colors = new Float32Array(count * 3);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let n = 0;
  for (let tries = 0; n < count && tries < count * 4; tries++) {
    const a = rng() * Math.PI * 2;
    const r = reach * Math.pow(rng(), 0.75);
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    if (Math.hypot(x, z) < tree.trunkRadius * 1.6) continue; // not inside the trunk
    dummy.position.set(x, 0.012 + rng() * 0.012, z);
    dummy.rotation.set((rng() - 0.5) * 0.3, rng() * Math.PI * 2, (rng() - 0.5) * 0.3);
    dummy.scale.setScalar((0.2 + rng() * 0.1) * s);
    dummy.updateMatrix();
    dummy.matrix.toArray(matrices, n * 16);
    // Fallen leaves are duller and browner.
    pickColor(rng, color).multiplyScalar(0.62 + rng() * 0.25);
    if (rng() < 0.18) color.set("#7a2a18");
    color.toArray(colors, n * 3);
    n++;
  }
  return { matrices: matrices.subarray(0, n * 16), colors: colors.subarray(0, n * 3), count: n };
}

/**
 * Leaves drifting down from the crown, as one merged geometry. Each leaf's
 * vertices carry its own spawn point, phase and fall period (the shader does
 * the falling, spinning and drifting — see mapleMaterials.ts).
 */
export function fallingLeaves(tree: MapleTreeLayout, seed: number, count: number): THREE.BufferGeometry {
  const rng = mulberry32(seed ^ 0x7f4a7c15);
  const leaf = mapleLeafGeometry();
  const leafPos = leaf.getAttribute("position");
  const size = 0.24 * tree.scale;
  const positions: number[] = [];
  const colors: number[] = [];
  const spawn: number[] = [];
  const period: number[] = [];
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const r = tree.canopySpread * 0.75 * Math.sqrt(rng());
    const x = tree.canopyCenter.x + Math.cos(a) * r;
    const z = tree.canopyCenter.z + Math.sin(a) * r;
    const y = THREE.MathUtils.lerp(tree.canopyBottom, tree.canopyTop, 0.3 + rng() * 0.4);
    const phase = rng();
    const seconds = 9 + rng() * 7;
    pickColor(rng, color);
    for (let v = 0; v < leafPos.count; v++) {
      positions.push(leafPos.getX(v) * size, leafPos.getY(v) * size, leafPos.getZ(v) * size);
      colors.push(color.r, color.g, color.b);
      spawn.push(x, y, z, phase);
      period.push(seconds);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(positions.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute("fallSpawn", new THREE.Float32BufferAttribute(spawn, 4));
  geo.setAttribute("fallPeriod", new THREE.Float32BufferAttribute(period, 1));
  leaf.dispose();
  return geo;
}
