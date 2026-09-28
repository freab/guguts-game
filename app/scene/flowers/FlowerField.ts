import * as THREE from "three/webgpu";
import {
  CELL,
  COLS,
  ROWS,
  WALL_THICKNESS_RATIO,
  cellToWorld,
  distanceToPath,
  wallSlabs,
  worldToCell,
} from "../../maze/mazeData";
import { ChunkCuller, type CullableChunk } from "../grass/ChunkCuller";
import { mapleTreeLayout } from "../tree/mapleTree";
import { ChunkState } from "../grass/grassMapStore";

/** Hard cap on flower heads, whatever the maze size or density. */
const MAX_HEADS = 120000;
/** Auto-LOD bands, as fractions of the draw distance (camera to chunk edge). */
const LOD_FULL_BAND = 0.25;
const LOD_MEDIUM_BAND = 0.6;
/** Chunk side in metres. */
const CHUNK_SIZE = 6;
/** Radius a plant's heads spread over, in metres. */
const PLANT_RADIUS = 0.14;

export interface FlowerFieldOptions {
  /** Plants per square metre of verge, before clumping. */
  density: number;
  /** Most heads on one plant (each has 2..this many). */
  headsPerPlant: number;
  /** Mean head diameter in metres. */
  headSize: number;
  /** Mean height of the heads above the ground, in metres. */
  height: number;
  /** 0 = evenly scattered, 1 = tight clumps with bare stretches between. */
  clumping: number;
  /** Footpath half-width in world units; flowers stay off it. 0 = no footpath. */
  pathWidth: number;
  seed: number;
}

interface Chunk extends CullableChunk {
  /** One mesh per LOD, sharing one instance-matrix and colour buffer. */
  meshes: THREE.InstancedMesh[];
}

/* ---------- deterministic rng + value noise (from adey-abeba's Field.jsx) ---------- */
function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
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
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a * (1 - ux) * (1 - uz) + b * ux * (1 - uz) + c * (1 - ux) * uz + d * ux * uz;
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};

/**
 * Adey Abeba flowers along the grass, grown like the real thing: small yellow
 * heads held just above the grass, a few per plant, plants gathered in drifts
 * (domain-warped value noise, as in the adey-abeba field) on the verges inside
 * the maze — off the footpath and clear of the walls. Bucketed into chunks with one
 * instanced mesh per LOD, culled like the grass (distance, frustum, walls).
 */
export class FlowerField {
  readonly group = new THREE.Group();
  private readonly chunks: Chunk[] = [];
  private readonly culler: ChunkCuller;
  readonly total: number;
  drawn = 0;

  constructor(
    geometries: THREE.BufferGeometry[],
    material: THREE.Material,
    { density, headsPerPlant, headSize, height, clumping, pathWidth, seed }: FlowerFieldOptions
  ) {
    this.culler = new ChunkCuller(height);
    const rng = mulberry32(seed);

    // Per-cell wall-slab footprint (0 = open cell) for O(1) rejection.
    const slabW = new Float32Array(ROWS * COLS);
    const slabD = new Float32Array(ROWS * COLS);
    for (const s of wallSlabs()) {
      slabW[s.r * COLS + s.c] = s.w;
      slabD[s.r * COLS + s.c] = s.d;
    }

    // Heads must clear the wall faces.
    const margin = PLANT_RADIUS + headSize;
    const inset = (CELL * WALL_THICKNESS_RATIO) / 2 + margin;
    const [x0, z0] = cellToWorld(0, 0);
    const [x1, z1] = cellToWorld(ROWS - 1, COLS - 1);
    const minX = x0 + inset;
    const minZ = z0 + inset;
    const w = x1 - inset - minX;
    const d = z1 - inset - minZ;

    const nx = Math.max(1, Math.ceil(w / CHUNK_SIZE));
    const nz = Math.max(1, Math.ceil(d / CHUNK_SIZE));
    const buckets: { matrices: number[]; colors: number[] }[] = Array.from(
      { length: nx * nz },
      () => ({ matrices: [], colors: [] })
    );

    // Where the grass is full height again (GrassField's footpath fade).
    const verge = pathWidth > 0 ? pathWidth + Math.max(0.3, pathWidth * 0.8) * 0.6 : 0;
    const noiseOffset = rng() * 1000;

    // No flowers in the maple's shade.
    const shade = mapleTreeLayout().canopySpread * 0.75;

    const samples = Math.round(w * d * density);
    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    let total = 0;
    for (let i = 0; i < samples && total < MAX_HEADS; i++) {
      const x = minX + rng() * w;
      const z = minZ + rng() * d;

      // Drifts: warped noise patches, sharpened by `clumping`.
      const nxw = x * 0.18 + noiseOffset + (valueNoise(x * 0.1 + 11, z * 0.1 + 3) - 0.5) * 2;
      const nzw = z * 0.18 + (valueNoise(x * 0.1 + 7, z * 0.1 + 23) - 0.5) * 2;
      const patch = valueNoise(nxw, nzw);
      const keep = THREE.MathUtils.lerp(1, smoothstep(0.35, 0.7, patch), clumping);
      if (rng() > keep) continue;

      const [r, c] = worldToCell(x, z);
      const k = r * COLS + c;
      if (slabW[k] > 0) {
        const [cx, cz] = cellToWorld(r, c);
        if (Math.abs(x - cx) < slabW[k] / 2 + margin && Math.abs(z - cz) < slabD[k] / 2 + margin) {
          continue; // on (or leaning into) a wall
        }
      }
      if (verge > 0 && distanceToPath(x, z) < verge) continue; // off the footpath
      if (Math.hypot(x, z) < shade) continue;

      // One plant: a few heads on hidden stems, splayed out from its centre,
      // at slightly different heights, each nodding a little outwards.
      const ix = Math.min(nx - 1, Math.floor((x - minX) / CHUNK_SIZE));
      const iz = Math.min(nz - 1, Math.floor((z - minZ) / CHUNK_SIZE));
      const bucket = buckets[iz * nx + ix];
      const plantHeight = height * (0.8 + rng() * 0.4);
      const heads = 2 + Math.floor(rng() * Math.max(1, headsPerPlant - 1));
      for (let h = 0; h < heads; h++) {
        const a = rng() * Math.PI * 2;
        const r = PLANT_RADIUS * Math.sqrt(rng());
        const lean = 0.15 + (r / PLANT_RADIUS) * 0.35;
        dummy.position.set(x + Math.cos(a) * r, plantHeight * (0.85 + rng() * 0.3), z + Math.sin(a) * r);
        // Tilt about the horizontal axis perpendicular to the lean direction.
        dummy.rotation.set(Math.sin(a) * lean, rng() * Math.PI * 2, -Math.cos(a) * lean, "XZY"); // spin first, then tilt
        dummy.scale.setScalar(headSize * (0.8 + rng() * 0.4));
        dummy.updateMatrix();
        // Slight per-head tint so a drift isn't one flat yellow.
        tint.setRGB(0.85 + rng() * 0.2, 0.8 + rng() * 0.25, 0.85 + rng() * 0.2);

        for (let e = 0; e < 16; e++) bucket.matrices.push(dummy.matrix.elements[e]);
        bucket.colors.push(tint.r, tint.g, tint.b);
        total++;
      }
    }
    this.total = total;

    // Covers the chunk diagonal plus the highest heads and their sway.
    const radius = CHUNK_SIZE * 0.75 + height * 1.5;

    buckets.forEach(({ matrices, colors }, bi) => {
      const count = matrices.length / 16;
      if (count === 0) return;
      const ix = bi % nx;
      const iz = Math.floor(bi / nx);
      const center = new THREE.Vector3(minX + (ix + 0.5) * CHUNK_SIZE, height, minZ + (iz + 0.5) * CHUNK_SIZE);
      const sphere = new THREE.Sphere(center.clone(), radius);
      const instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(matrices), 16);
      const instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(colors), 3);

      const meshes = geometries.map((geometry) => {
        const mesh = new THREE.InstancedMesh(geometry, material, count);
        mesh.instanceMatrix = instanceMatrix; // one GPU buffer shared by all LODs
        mesh.instanceColor = instanceColor;
        mesh.boundingSphere = sphere;
        mesh.castShadow = false; // the sun's shadow map is baked without them
        mesh.visible = false; // updateVisibility() picks one per chunk
        this.group.add(mesh);
        return mesh;
      });
      this.chunks.push({ center, half: CHUNK_SIZE / 2, sphere, meshes, lastSeen: -Infinity });
    });
  }

  /**
   * Per-frame culling (see ChunkCuller); drawn chunks pick a LOD by distance.
   * Pass drawDistance < 0 to hide everything.
   */
  updateVisibility(
    camera: THREE.Camera,
    playerX: number,
    playerZ: number,
    drawDistance: number,
    occlusion: boolean
  ) {
    this.culler.begin(camera);
    let drawn = 0;
    for (const ch of this.chunks) {
      let lod = -1; // hide every LOD mesh
      if (this.culler.classify(ch, playerX, playerZ, drawDistance, occlusion) === ChunkState.Drawn) {
        drawn += ch.meshes[0].count;
        const dist = this.culler.distanceTo(ch);
        lod = dist < drawDistance * LOD_FULL_BAND ? 0 : dist < drawDistance * LOD_MEDIUM_BAND ? 1 : 2;
      }
      for (let i = 0; i < ch.meshes.length; i++) {
        const visible = i === lod;
        if (ch.meshes[i].visible !== visible) ch.meshes[i].visible = visible;
      }
    }
    this.drawn = drawn;
  }

  dispose() {
    for (const ch of this.chunks) for (const m of ch.meshes) m.dispose();
  }
}
