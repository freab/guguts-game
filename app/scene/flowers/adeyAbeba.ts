import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Adey Abeba, the yellow Meskel daisy, ported from the adey-abeba project
 * (CC0, C:\2026\adey-abeba — src/components/Field.jsx). Its hero flower is
 * baked into one static, vertex-coloured geometry: eight petals deformed by a
 * CPU port of the hero petal's vertex shader, a centre disc and a tapered stem.
 *
 * Differences from the original, for instancing hundreds of them:
 * - The petal comes pre-decoded from petal2.drc with two meshoptimizer LODs
 *   (public/models/adey-abeba/petal-lods.json), so no Draco decoder ships.
 * - The 56k-triangle sculpted core.glb is replaced by a small procedural dome
 *   with speckles baked into its vertex colours.
 * - The result is re-based so the stem's foot is at y = 0 and it is 1 unit tall.
 */

/** One petal LOD as stored in petal-lods.json (flat arrays). */
export interface PetalLodData {
  position: number[];
  uv: number[];
  index: number[];
}

/** Mesh detail for one flower LOD. */
export interface FlowerDetail {
  /** Index into petal-lods.json (0 = full 339 tris, 1 = 59, 2 = 18). */
  petalLod: number;
  stemSegments: number;
  stemRadial: number;
  coreSegments: number;
}

/** High -> low detail, matching the grass LOD bands. */
export const FLOWER_DETAIL: FlowerDetail[] = [
  { petalLod: 0, stemSegments: 12, stemRadial: 6, coreSegments: 12 },
  { petalLod: 1, stemSegments: 6, stemRadial: 4, coreSegments: 8 },
  { petalLod: 2, stemSegments: 3, stemRadial: 3, coreSegments: 6 },
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
/** Height where the stem meets the underside of the head (and the head-scale pivot). */
const STEM_TOP = 0.1;
const CORE_HALF_HEIGHT = 0.115;
const PETAL_C1 = new THREE.Color("#ffd400");
const PETAL_C2 = new THREE.Color("#f6a800");
const CORE_RIM = new THREE.Color("#c77104");
const CORE_TOP = new THREE.Color("#6e3702");
const STEM_COLOR = new THREE.Color("#3f9d4a");

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

/** Non-indexed position + colour (flat fill unless the geometry has colours). */
function toPosColor(geo: THREE.BufferGeometry, fill?: THREE.Color): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.getAttribute("position");
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", pos.clone());
  const existing = g.getAttribute("color");
  if (existing) {
    out.setAttribute("color", existing.clone());
  } else {
    const c = fill ?? new THREE.Color(1, 1, 1);
    const arr = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) c.toArray(arr, i * 3);
    out.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  }
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
 * Short tapered stem tube (the hero's construction, shortened for a field).
 * It runs up into the core; the original stopped 0.25 short of the head.
 */
function buildStemTube(segments: number, radial: number): THREE.BufferGeometry {
  const len = 1.6;
  const depth = STEM_TOP;
  const to = new THREE.Vector3(0, CORE.py, depth);
  const leanRad = (8 * Math.PI) / 180;
  const from = new THREE.Vector3(to.x + Math.sin(leanRad) * len, to.y, to.z - Math.cos(leanRad) * len);
  const bend = new THREE.Vector3(0.4, 0, 0);
  const curve = new THREE.CatmullRomCurve3(
    [from, from.clone().lerp(to, 0.25).add(bend), from.clone().lerp(to, 0.75).add(bend), to],
    false,
    "centripetal"
  );
  const geo = new THREE.TubeGeometry(curve, segments, 0.09, radial, false);
  const taper = 0.25;
  const flare = 0.6;
  const pos = geo.getAttribute("position");
  const p = new THREE.Vector3();
  const per = radial + 1;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, p);
    const sc = 1 - (1 - taper) * t + flare * (1 - t) ** 3;
    for (let j = 0; j <= radial; j++) {
      const idx = i * per + j;
      pos.setXYZ(
        idx,
        p.x + (pos.getX(idx) - p.x) * sc,
        p.y + (pos.getY(idx) - p.y) * sc,
        p.z + (pos.getZ(idx) - p.z) * sc
      );
    }
  }
  return geo;
}

/**
 * Bake one whole flower (petals + core + stem) into a single geometry, upright
 * (head facing up), stem foot at the origin. Attributes: position, normal, color.
 * `headScale` shrinks the head about the top of the stem: the hero flower's
 * head is 1.7x as wide as it is tall, a lot for a maze verge.
 */
export function bakeAdeyAbeba(
  petalBase: THREE.BufferGeometry,
  detail: FlowerDetail,
  headScale = 1
): THREE.BufferGeometry {
  const mPetals = new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(0, 0.03, 0);
  const mFlip = new THREE.Matrix4().makeRotationX(Math.PI);
  const mRoot = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  const mCore = new THREE.Matrix4().compose(
    new THREE.Vector3(CORE.px, CORE.py, CORE.pz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(CORE.rx, 0, 0)),
    new THREE.Vector3(CORE.scale, CORE.scale, CORE.scale)
  );
  const mHead = new THREE.Matrix4()
    .makeTranslation(0, STEM_TOP, 0)
    .multiply(new THREE.Matrix4().makeScale(headScale, headScale, headScale))
    .multiply(new THREE.Matrix4().makeTranslation(0, -STEM_TOP, 0));

  const parts: THREE.BufferGeometry[] = [];
  for (const petal of bakePetals(petalBase)) {
    const g = toPosColor(petal);
    g.applyMatrix4(mPetals).applyMatrix4(mFlip).applyMatrix4(mRoot).applyMatrix4(mHead);
    parts.push(g);
  }
  const core = toPosColor(buildCore(detail.coreSegments));
  core.applyMatrix4(mCore).applyMatrix4(mFlip).applyMatrix4(mRoot).applyMatrix4(mHead);
  parts.push(core);
  const stem = toPosColor(buildStemTube(detail.stemSegments, detail.stemRadial), STEM_COLOR);
  stem.applyMatrix4(mRoot);
  parts.push(stem);

  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error("adey abeba: failed to merge flower parts");
  // Foot at the origin, 1 unit tall: an instance's scale is its height in metres.
  merged.computeBoundingBox();
  const { min, max } = merged.boundingBox!;
  const unit = 1 / (max.y - min.y);
  merged.translate(0, -min.y, 0);
  merged.scale(unit, unit, unit);
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}
