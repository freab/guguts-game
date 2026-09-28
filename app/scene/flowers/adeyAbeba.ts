import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Adey Abeba, the yellow Meskel daisy, ported from the adey-abeba project
 * (CC0, C:\2026\adey-abeba — src/components/Field.jsx). Only the flower head
 * is kept: eight petals deformed by a CPU port of the hero petal's vertex
 * shader plus a centre disc, baked into one static, vertex-coloured geometry.
 * Real Meskel daisies are small heads held just above the grass, so there is
 * no stem — the grass hides where it would be.
 *
 * Differences from the original, for instancing thousands of them:
 * - The petal comes pre-decoded from petal2.drc as meshoptimizer LODs
 *   (public/models/adey-abeba/petal-lods.json), so no Draco decoder ships.
 * - The 56k-triangle sculpted core.glb is replaced by a small procedural dome
 *   with speckles baked into its vertex colours.
 * - The farthest LOD is a flat eight-pointed star, not petals at all.
 * - Heads are normalised to 1 unit across, centred on the origin with the
 *   petals at y ≈ 0: an instance's scale is its head diameter in metres.
 */

/** One petal LOD as stored in petal-lods.json (flat arrays). */
export interface PetalLodData {
  position: number[];
  uv: number[];
  index: number[];
}

/** Mesh detail for one flower-head LOD. */
export interface FlowerDetail {
  /** Index into petal-lods.json (0 = full 339 tris, 1 = 59, 2 = 18), or -1 for the star card. */
  petalLod: number;
  coreSegments: number;
}

/** High -> low detail (≈540, ≈180 and 22 triangles). */
export const FLOWER_DETAIL: FlowerDetail[] = [
  { petalLod: 1, coreSegments: 8 },
  { petalLod: 2, coreSegments: 5 },
  { petalLod: -1, coreSegments: 0 },
];

/* ---------- hero-flower defaults (mirror adey-abeba's bloming.jsx) ---------- */
const PP = {
  openness: 0.26,
  width: 0.98,
  widthTaper: 0.4,
  zOffset: 0.05,
  curl: -1.0,
  pitch: -1.87,
  bend: 1.41,
  yDrop: -0.09,
};
const CORE = { px: 0, py: 0.028, pz: -0.12, rx: -1.571, scale: 0.877 };
/** Half-extents of the original core mesh (its disc radius and dome height). */
const CORE_RADIUS = 0.31;
const CORE_HALF_HEIGHT = 0.115;
/** Star card: petal tips and notches, as fractions of the head radius. */
const STAR_NOTCH = 0.35;
const STAR_CORE = 0.18;
const PETAL_C1 = new THREE.Color("#ffd400");
const PETAL_C2 = new THREE.Color("#f6a800");
const CORE_RIM = new THREE.Color("#c77104");
const CORE_TOP = new THREE.Color("#6e3702");

function rot(x: number, y: number, a: number): [number, number] {
  const s = Math.sin(a);
  const c = Math.cos(a);
  return [c * x - s * y, s * x + c * y];
}

/** Deterministic 0..1 hash of a vertex index (core speckles). */
function hash1(i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Indexed petal geometry from one LOD of petal-lods.json. */
export function petalGeometry(data: PetalLodData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(data.position, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(data.uv, 2));
  g.setIndex(data.index);
  return g;
}

/** Non-indexed position + colour only (what the merge needs). */
function toPosColor(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", g.getAttribute("position").clone());
  out.setAttribute("color", g.getAttribute("color").clone());
  return out;
}

/** Port of the hero petal vertex shader (static params) -> 8 deformed, coloured petals. */
function bakePetals(petalBase: THREE.BufferGeometry): THREE.BufferGeometry[] {
  const prog = PP.openness;
  const tint = new THREE.Color(1, 0.8 + 0.2 * prog, 0.6 + 0.4 * prog);
  const s0 = 1 - Math.pow(Math.abs(prog - 0.5) * 2, 3);
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const g = petalBase.clone();
    const pos = g.getAttribute("position");
    const uv = g.getAttribute("uv");
    const colors = new Float32Array(pos.count * 3);
    const a2 = (i / 8) * Math.PI * 2;
    for (let v = 0; v < pos.count; v++) {
      let px = pos.getX(v);
      let py = pos.getY(v);
      let pz = pos.getZ(v);
      const ux = uv.getX(v);
      const uy = uv.getY(v);
      pz += PP.zOffset;
      px *= PP.width - prog * PP.widthTaper;
      px *= s0;
      py *= s0;
      pz *= s0;
      [px, py] = rot(px, py, -(ux - 0.5) * (1 - prog) * PP.curl);
      [py, pz] = rot(py, pz, prog * Math.PI - Math.PI / 2 - uy * PP.bend + PP.pitch);
      [px, pz] = rot(px, pz, a2);
      py -= prog * prog * PP.yDrop;
      pos.setXYZ(v, px, py, pz);
      colors[v * 3] = (PETAL_C1.r + (PETAL_C2.r - PETAL_C1.r) * uy) * tint.r;
      colors[v * 3 + 1] = (PETAL_C1.g + (PETAL_C2.g - PETAL_C1.g) * uy) * tint.g;
      colors[v * 3 + 2] = (PETAL_C1.b + (PETAL_C2.b - PETAL_C1.b) * uy) * tint.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    out.push(g);
  }
  return out;
}

/**
 * Low-poly stand-in for core.glb: a flattened dome (the original's footprint),
 * dark on top fading to orange at the rim, with speckled "seeds".
 */
function buildCore(segments: number): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(CORE_RADIUS, segments, Math.max(3, segments >> 1));
  geo.scale(1, CORE_HALF_HEIGHT / CORE_RADIUS, 1);
  const pos = geo.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const top = THREE.MathUtils.clamp(pos.getY(i) / CORE_HALF_HEIGHT, 0, 1);
    c.copy(CORE_RIM).lerp(CORE_TOP, top * top);
    if (hash1(i) < 0.3) c.multiplyScalar(0.55); // seeds
    c.toArray(colors, i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

/**
 * Far LOD: a flat eight-pointed star (radius 0.5, facing up) with a dark
 * centre — 16 petal triangles plus a 6-triangle disc.
 */
function buildStarHead(): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const push = (x: number, y: number, z: number, c: THREE.Color) => {
    positions.push(x, y, z);
    colors.push(c.r, c.g, c.b);
  };
  const ring = (i: number, r: number): [number, number] => {
    const a = (i / 16) * Math.PI * 2;
    return [Math.cos(a) * r, Math.sin(a) * r];
  };
  for (let i = 0; i < 16; i++) {
    const r0 = (i % 2 === 0 ? 1 : STAR_NOTCH) * 0.5;
    const r1 = (i % 2 === 0 ? STAR_NOTCH : 1) * 0.5;
    const [ax, az] = ring(i, r0);
    const [bx, bz] = ring(i + 1, r1);
    push(0, 0, 0, PETAL_C2);
    push(bx, 0, bz, i % 2 === 0 ? PETAL_C2 : PETAL_C1);
    push(ax, 0, az, i % 2 === 0 ? PETAL_C1 : PETAL_C2);
  }
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2;
    const a1 = ((i + 1) / 6) * Math.PI * 2;
    const r = STAR_CORE;
    push(0, 0.02, 0, CORE_TOP);
    push(Math.cos(a1) * r, 0.01, Math.sin(a1) * r, CORE_RIM);
    push(Math.cos(a0) * r, 0.01, Math.sin(a0) * r, CORE_RIM);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return g;
}

/**
 * Bake one flower head (petals + core) into a single geometry, facing up,
 * 1 unit across, centred on the origin. Attributes: position, normal, color.
 */
export function bakeAdeyAbeba(petalBase: THREE.BufferGeometry | null, detail: FlowerDetail): THREE.BufferGeometry {
  let merged: THREE.BufferGeometry;
  if (!petalBase || detail.petalLod < 0) {
    merged = buildStarHead();
  } else {
    const mPetals = new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(0, 0.03, 0);
    const mFlip = new THREE.Matrix4().makeRotationX(Math.PI);
    const mRoot = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    const mCore = new THREE.Matrix4().compose(
      new THREE.Vector3(CORE.px, CORE.py, CORE.pz),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(CORE.rx, 0, 0)),
      new THREE.Vector3(CORE.scale, CORE.scale, CORE.scale)
    );

    const parts: THREE.BufferGeometry[] = [];
    for (const petal of bakePetals(petalBase)) {
      const g = toPosColor(petal);
      g.applyMatrix4(mPetals).applyMatrix4(mFlip).applyMatrix4(mRoot);
      parts.push(g);
    }
    const core = toPosColor(buildCore(detail.coreSegments));
    core.applyMatrix4(mCore).applyMatrix4(mFlip).applyMatrix4(mRoot);
    parts.push(core);

    const joined = mergeGeometries(parts, false);
    if (!joined) throw new Error("adey abeba: failed to merge flower parts");
    merged = joined;

    // Centre on the head, petals at y ≈ 0, 1 unit across.
    merged.computeBoundingBox();
    const { min, max } = merged.boundingBox!;
    const unit = 1 / Math.max(max.x - min.x, max.z - min.z);
    merged.translate(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2);
    merged.scale(unit, unit, unit);
  }
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}
