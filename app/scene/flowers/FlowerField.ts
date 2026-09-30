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
/** Beyond this fraction of the draw distance (camera to head), the star-card LOD. */
const LOD_MEDIUM_BAND = 0.6;
/** Chunk side in metres. */
const CHUNK_SIZE = 3;
/** Re-sort a near chunk's heads into LODs after the camera moves this far (m). */
const RESPLIT_DISTANCE = 0.15;
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
  /** Every head's matrix, colour, sway phase (0..1) and position (x, y, z). */
  matrices: Float32Array;
  colors: Float32Array;
  phases: Float32Array;
  positions: Float32Array;
  count: number;
  /** The LOD drawn last frame: 0-2 for the whole chunk, -1 split per head. */
  lod: number;
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
 *
 * LOD is per head, as in open-world foliage: a far chunk draws all its heads
 * at one LOD, but a chunk near the camera sorts its heads by each head's own
 * distance, so only the heads right by you get the full petals (a whole chunk
 * of them was ~80% of the frame's triangles). All drawn heads are packed into
 * one mesh per LOD, so every flower is three draws.
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
      const allMatrices = new Float32Array(matrices);
      const allColors = new Float32Array(colors);
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        positions[i * 3] = allMatrices[i * 16 + 12];
        positions[i * 3 + 1] = allMatrices[i * 16 + 13];
        positions[i * 3 + 2] = allMatrices[i * 16 + 14];
      }

      const phases = new Float32Array(count);
      for (let i = 0; i < count; i++) phases[i] = rng();
      this.chunks.push({
        center,
        half: CHUNK_SIZE / 2,
        sphere,
        lastSeen: -Infinity,
        matrices: allMatrices,
        colors: allColors,
        phases,
        positions,
        count,
        lod: -2,
      });
    });

    // One mesh per LOD (three draws for every flower): the drawn heads are
    // packed into them each time the picture changes (see pack()).
    this.meshes = geometries.map((geometry, lod) => {
      const g = geometry.clone();
      g.setAttribute("headPhase", new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, total)), 1));
      const mesh = new THREE.InstancedMesh(g, material, Math.max(1, total));
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, total) * 3), 3);
      mesh.count = 0;
      mesh.frustumCulled = false; // the chunks are culled before packing
      mesh.castShadow = false; // the sun's shadow map is baked without them
      mesh.name = "Flowers";
      mesh.userData.lod = lod;
      this.group.add(mesh);
      return mesh;
    });
  }

  /** The shared per-LOD meshes (full petals, light petals, star card). */
  private readonly meshes: THREE.InstancedMesh[];
  /** The camera position the near chunks were last split for. */
  private readonly packedAt = new THREE.Vector3(Infinity, 0, 0);
  private readonly drawnChunks: Chunk[] = [];
  private readonly drawnLods: number[] = [];
  private packedChunks: Chunk[] = [];
  private packedLods: number[] = [];

  /**
   * Per-frame culling (see ChunkCuller); drawn heads pick a LOD by distance:
   * full petals within `fullDetail` metres, lighter petals to 60% of the draw
   * distance, a star card beyond. Pass drawDistance < 0 to hide everything.
   */
  updateVisibility(
    camera: THREE.Camera,
    playerX: number,
    playerZ: number,
    drawDistance: number,
    occlusion: boolean,
    fullDetail: number
  ) {
    this.culler.begin(camera);
    camera.getWorldPosition(this.eye);
    const medium = drawDistance * LOD_MEDIUM_BAND;
    const full = Math.min(fullDetail, medium);
    const chunks = this.drawnChunks;
    const lods = this.drawnLods;
    chunks.length = 0;
    lods.length = 0;
    let drawn = 0;
    let split = false;
    for (const ch of this.chunks) {
      if (this.culler.classify(ch, playerX, playerZ, drawDistance, occlusion) !== ChunkState.Drawn) continue;
      drawn += ch.count;
      const dist = this.culler.distanceTo(ch);
      // Near chunks: every head at its own LOD (-1); far: the whole chunk at one.
      const lod = dist < full ? -1 : dist < medium ? 1 : 2;
      if (lod === -1) split = true;
      chunks.push(ch);
      lods.push(lod);
    }
    this.drawn = drawn;

    // Repack when the drawn chunks or their LODs change, or (with near chunks
    // split per head) once the camera has moved enough to re-sort their heads.
    const changed =
      chunks.length !== this.packedChunks.length ||
      chunks.some((ch, i) => ch !== this.packedChunks[i] || lods[i] !== this.packedLods[i]);
    if (changed || (split && this.packedAt.distanceToSquared(this.eye) > RESPLIT_DISTANCE ** 2)) {
      this.pack(chunks, lods, full, medium);
    }
  }

  private readonly eye = new THREE.Vector3();
  private readonly lodCounts = [0, 0, 0];

  /**
   * Copy the drawn chunks' heads into the per-LOD meshes: a whole chunk into
   * its LOD's mesh, or a near chunk head by head, each by its own distance.
   */
  private pack(chunks: Chunk[], lods: number[], full: number, medium: number) {
    const counts = this.lodCounts;
    counts.fill(0);
    const meshes = this.meshes;
    const { x: ex, y: ey, z: ez } = this.eye;
    const put = (ch: Chunk, i: number, lod: number) => {
      const mesh = meshes[lod];
      const k = counts[lod]++;
      (mesh.instanceMatrix.array as Float32Array).set(ch.matrices.subarray(i * 16, i * 16 + 16), k * 16);
      (mesh.instanceColor!.array as Float32Array).set(ch.colors.subarray(i * 3, i * 3 + 3), k * 3);
      (mesh.geometry.getAttribute("headPhase").array as Float32Array)[k] = ch.phases[i];
    };
    chunks.forEach((ch, c) => {
      const lod = lods[c];
      if (lod >= 0) {
        const mesh = meshes[lod];
        const k = counts[lod];
        (mesh.instanceMatrix.array as Float32Array).set(ch.matrices, k * 16);
        (mesh.instanceColor!.array as Float32Array).set(ch.colors, k * 3);
        (mesh.geometry.getAttribute("headPhase").array as Float32Array).set(ch.phases, k);
        counts[lod] += ch.count;
        return;
      }
      for (let i = 0; i < ch.count; i++) {
        const dx = ch.positions[i * 3] - ex;
        const dy = ch.positions[i * 3 + 1] - ey;
        const dz = ch.positions[i * 3 + 2] - ez;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        put(ch, i, d < full ? 0 : d < medium ? 1 : 2);
      }
    });
    meshes.forEach((mesh, lod) => {
      const n = counts[lod];
      mesh.count = n;
      mesh.visible = n > 0;
      if (n === 0) return;
      for (const attr of [
        mesh.instanceMatrix,
        mesh.instanceColor!,
        mesh.geometry.getAttribute("headPhase") as THREE.InstancedBufferAttribute,
      ]) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, n * attr.itemSize);
        attr.needsUpdate = true;
      }
    });
    this.packedChunks = chunks.slice();
    this.packedLods = lods.slice();
    this.packedAt.copy(this.eye);
  }

  dispose() {
    for (const m of this.meshes) {
      m.geometry.dispose();
      m.dispose();
    }
  }
}
