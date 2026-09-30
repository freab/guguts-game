import * as THREE from "three/webgpu";
import {
  CELL,
  COLS,
  ROWS,
  WALL_THICKNESS_RATIO,
  cellToWorld,
  distanceToPath,
  obstacles,
  wallSlabs,
  worldToCell,
} from "../../maze/mazeData";
import { mapleTreeLayout } from "../tree/mapleTree";
import { ChunkCuller, type CullableChunk } from "./ChunkCuller";
import { ChunkState, grassMapStore, type GrassChunkInfo } from "./grassMapStore";

/** Tuft node names in grassLODs.glb, high -> low detail (132 / 64 / 32 verts). */
export const LOD_NAMES = ["LOD00", "LOD01", "LOD02"] as const;
/** Hard cap on tufts, whatever the maze size or density. */
const MAX_TUFTS = 80000;
/** Auto-LOD bands, as fractions of the draw distance (camera to tuft). */
export const LOD_FULL_BAND = 0.35;
export const LOD_MEDIUM_BAND = 0.7;
/** Keep blade bases this far from wall faces. */
const WALL_MARGIN = 0.08;
/** Occlusion sample height: grass-tip height. */
const OCCLUSION_SAMPLE_Y = 0.5;

export interface GrassFieldOptions {
  /** Tufts per square metre of open ground (before footpath thinning). */
  density: number;
  /** Base tuft scale. */
  tuftSize: number;
  /** Footpath half-width in world units; 0 = no footpath. */
  pathWidth: number;
  /** Grass height on the path centreline, as a fraction of full height. */
  pathGrass: number;
}

interface Chunk extends CullableChunk {
  /** The chunk's tufts: instance matrices and base positions (x, y, z). */
  matrices: Float32Array;
  origins: Float32Array;
  /** Shared with the minimap via grassMapStore. */
  info: GrassChunkInfo;
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};

/** Pull the three LOD tuft geometries out of the loaded grassLODs.glb scene. */
export function lodGeometries(scene: THREE.Object3D): THREE.BufferGeometry[] {
  return LOD_NAMES.map((name) => {
    let geometry: THREE.BufferGeometry | undefined;
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && o.name.includes(name)) geometry = m.geometry;
    });
    if (!geometry) throw new Error(`grassLODs.glb is missing ${name}`);
    return geometry;
  });
}

/**
 * The three LOD tufts as one geometry, each vertex tagged with its LOD
 * (`grassLod`): the shader keeps one LOD per tuft and collapses the others'
 * vertices to a point, so all the grass is one draw (grassNodeMaterial).
 */
function combinedTuft(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = ["position", "normal", "uv"] as const;
  const counts = geometries.map((g) => g.getAttribute("position").count);
  const total = counts.reduce((a, b) => a + b, 0);
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const size = geometries[0].getAttribute(name).itemSize;
    const data = new Float32Array(total * size);
    let offset = 0;
    for (const g of geometries) {
      const a = g.getAttribute(name);
      for (let v = 0; v < a.count; v++) for (let c = 0; c < size; c++) data[offset++] = a.getComponent(v, c);
    }
    out.setAttribute(name, new THREE.BufferAttribute(data, size));
  }
  // Indices (kept indexed, so shared vertices are still shaded once each).
  const indexCount = geometries.reduce((n, g, k) => n + (g.index ? g.index.count : counts[k]), 0);
  const index = new Uint32Array(indexCount);
  let at = 0;
  let base = 0;
  geometries.forEach((g, k) => {
    if (g.index) for (let t = 0; t < g.index.count; t++) index[at++] = base + g.index.getX(t);
    else for (let t = 0; t < counts[k]; t++) index[at++] = base + t;
    base += counts[k];
  });
  out.setIndex(new THREE.BufferAttribute(index, 1));
  const lod = new Float32Array(total);
  let v = 0;
  counts.forEach((c, level) => lod.fill(level, v, (v += c)));
  out.setAttribute("grassLod", new THREE.BufferAttribute(lod, 1));
  return out;
}

/**
 * The grass inside the maze: tufts scattered over the interior (between the
 * border walls' inner faces), never on a wall slab, and worn down along a
 * footpath down the middle of every corridor — shorter, smaller and sparser the
 * closer they are to the centreline. Tufts are bucketed into square chunks,
 * culled per chunk (distance, frustum, walls); the drawn chunks' tufts are
 * packed into one instanced mesh, so all the grass is a single draw, and each
 * tuft picks its own LOD in the shader.
 */
export class GrassField {
  readonly group = new THREE.Group();
  private readonly chunks: Chunk[] = [];
  private readonly culler = new ChunkCuller(OCCLUSION_SAMPLE_Y);
  /** All drawn grass: the visible chunks' tufts, packed. */
  private readonly mesh: THREE.InstancedMesh;
  private readonly tuft: THREE.BufferGeometry;
  /** The chunks packed into the mesh last time (repack only when it changes). */
  private packed: Chunk[] = [];
  private readonly drawn: Chunk[] = [];

  constructor(
    geometries: THREE.BufferGeometry[],
    material: THREE.Material,
    { density, tuftSize, pathWidth, pathGrass }: GrassFieldOptions
  ) {
    // Per-cell wall-slab footprint (0 = open cell) for O(1) rejection.
    const slabW = new Float32Array(ROWS * COLS);
    const slabD = new Float32Array(ROWS * COLS);
    for (const s of wallSlabs()) {
      slabW[s.r * COLS + s.c] = s.w;
      slabD[s.r * COLS + s.c] = s.d;
    }

    const inset = (CELL * WALL_THICKNESS_RATIO) / 2 + WALL_MARGIN;
    const [x0, z0] = cellToWorld(0, 0);
    const [x1, z1] = cellToWorld(ROWS - 1, COLS - 1);
    const minX = x0 + inset;
    const minZ = z0 + inset;
    const w = x1 - inset - minX;
    const d = z1 - inset - minZ;

    // Small chunks so draw-distance culling is fine-grained (4-8 m squares).
    const chunkSize = Math.min(8, Math.max(4, Math.max(w, d) / 8));
    const nx = Math.max(1, Math.ceil(w / chunkSize));
    const nz = Math.max(1, Math.ceil(d / chunkSize));
    const buckets: number[][] = Array.from({ length: nx * nz }, () => []);

    // Footpath profile: worn flat inside pathWidth, back to full grass by `fade`.
    const fade = Math.max(0.3, pathWidth * 0.8);

    // The clearing's tree: nothing grows in the trunk, and the grass is thinner
    // under the crown, where the fallen leaves lie.
    const trunk = obstacles()[0];
    const litter = mapleTreeLayout().canopySpread * 0.7;

    const samples = Math.min(Math.round(w * d * density), MAX_TUFTS);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < samples; i++) {
      const x = minX + Math.random() * w;
      const z = minZ + Math.random() * d;

      const [r, c] = worldToCell(x, z);
      const k = r * COLS + c;
      if (slabW[k] > 0) {
        const [cx, cz] = cellToWorld(r, c);
        if (
          Math.abs(x - cx) < slabW[k] / 2 + WALL_MARGIN &&
          Math.abs(z - cz) < slabD[k] / 2 + WALL_MARGIN
        ) {
          continue; // on a wall
        }
      }

      const fromTrunk = Math.hypot(x - trunk.x, z - trunk.z);
      if (fromTrunk < trunk.r + 0.15) continue;
      if (fromTrunk < litter && Math.random() < 0.55) continue;

      // 0 on the path centreline -> 1 on the verges.
      const verge =
        pathWidth > 0
          ? smoothstep(pathWidth, pathWidth + fade, distanceToPath(x, z))
          : 1;
      if (Math.random() > 0.3 + 0.7 * verge) continue; // sparser on the path
      const heightScale = pathGrass + (1 - pathGrass) * verge;
      if (heightScale < 0.03) continue; // bare path: don't draw flat tufts

      const s = tuftSize * (0.8 + Math.random() * 0.5);
      const spread = 0.7 + 0.3 * verge; // trodden tufts are smaller too
      dummy.position.set(x, 0, z);
      dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
      dummy.scale.set(s * spread, s * heightScale, s * spread);
      dummy.updateMatrix();

      const ix = Math.min(nx - 1, Math.floor((x - minX) / chunkSize));
      const iz = Math.min(nz - 1, Math.floor((z - minZ) / chunkSize));
      const bucket = buckets[iz * nx + ix];
      for (let e = 0; e < 16; e++) bucket.push(dummy.matrix.elements[e]);
    }

    // Covers the chunk diagonal plus blade height, lift and sway.
    const radius = chunkSize * 0.75 + tuftSize * 0.5 + 1.5;

    buckets.forEach((data, bi) => {
      const count = data.length / 16;
      if (count === 0) return;
      const ix = bi % nx;
      const iz = Math.floor(bi / nx);
      const center = new THREE.Vector3(
        minX + (ix + 0.5) * chunkSize,
        0.4,
        minZ + (iz + 0.5) * chunkSize
      );
      const matrices = new Float32Array(data);
      const origins = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        origins[i * 3] = matrices[i * 16 + 12];
        origins[i * 3 + 1] = matrices[i * 16 + 13];
        origins[i * 3 + 2] = matrices[i * 16 + 14];
      }
      const sphere = new THREE.Sphere(center.clone(), radius);
      const info: GrassChunkInfo = {
        x: center.x,
        z: center.z,
        half: chunkSize / 2,
        tufts: count,
        state: ChunkState.OutOfRange,
      };
      this.chunks.push({ center, half: chunkSize / 2, sphere, matrices, origins, info, lastSeen: -Infinity });
    });

    // One mesh for all of it, sized for every tuft; updateVisibility packs the
    // drawn chunks into it. The chunks are culled here, so three mustn't.
    const total = this.chunks.reduce((n, ch) => n + ch.info.tufts, 0);
    this.tuft = combinedTuft(geometries);
    this.tuft.setAttribute("tuftOrigin", new THREE.InstancedBufferAttribute(new Float32Array(total * 3), 3));
    this.mesh = new THREE.InstancedMesh(this.tuft, material, total);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false; // grass never needs to cast
    this.mesh.name = "Grass";
    // For the #debug readout: triangles a tuft actually rasterises (at most
    // the full-detail LOD — the other LODs' collapse to nothing).
    const lod0 = geometries[0];
    this.mesh.userData.trianglesPerInstance = (lod0.index ? lod0.index.count : lod0.getAttribute("position").count) / 3;
    this.group.add(this.mesh);

    grassMapStore.chunks = this.chunks.map((ch) => ch.info);
    grassMapStore.totalTufts = this.chunks.reduce((n, ch) => n + ch.info.tufts, 0);
  }

  /**
   * Per-frame culling (distance, frustum, then wall occlusion when `occlusion`
   * is on — see ChunkCuller); the drawn chunks' tufts are packed into the one
   * grass mesh (only when the set changes). The shader fades blades out before
   * the draw distance, so dropping a chunk there is invisible, and picks each
   * tuft's LOD (grassNodeMaterial). Pass drawDistance < 0 to hide everything
   * (grass disabled). Each chunk's result is published to grassMapStore for
   * the minimap.
   */
  updateVisibility(
    camera: THREE.Camera,
    playerX: number,
    playerZ: number,
    drawDistance: number,
    occlusion: boolean
  ) {
    this.culler.begin(camera);

    const drawn = this.drawn;
    drawn.length = 0;
    let drawnTufts = 0;
    for (const ch of this.chunks) {
      const state = this.culler.classify(ch, playerX, playerZ, drawDistance, occlusion);
      ch.info.state = state;
      if (state === ChunkState.Drawn) {
        drawn.push(ch);
        drawnTufts += ch.info.tufts;
      }
    }
    if (drawn.length !== this.packed.length || drawn.some((ch, i) => ch !== this.packed[i])) this.pack(drawn);

    grassMapStore.drawDistance = Math.max(0, drawDistance);
    grassMapStore.drawnChunks = drawn.length;
    grassMapStore.drawnTufts = drawnTufts;
  }

  /** Copy these chunks' tufts, back to back, into the grass mesh. */
  private pack(chunks: Chunk[]) {
    const matrices = this.mesh.instanceMatrix;
    const origins = this.tuft.getAttribute("tuftOrigin") as THREE.InstancedBufferAttribute;
    let n = 0;
    for (const ch of chunks) {
      (matrices.array as Float32Array).set(ch.matrices, n * 16);
      (origins.array as Float32Array).set(ch.origins, n * 3);
      n += ch.info.tufts;
    }
    this.mesh.count = n;
    for (const [attr, size] of [
      [matrices, 16],
      [origins, 3],
    ] as const) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, Math.max(1, n) * size);
      attr.needsUpdate = true;
    }
    this.packed = chunks.slice();
  }

  dispose() {
    this.mesh.dispose();
    this.tuft.dispose();
    if (grassMapStore.chunks[0] === this.chunks[0]?.info) {
      grassMapStore.chunks = [];
      grassMapStore.totalTufts = 0;
      grassMapStore.drawnChunks = 0;
      grassMapStore.drawnTufts = 0;
    }
  }
}
