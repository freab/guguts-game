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
import { WallCollider } from "../../character/WallCollider";
import { ChunkState, grassMapStore, type GrassChunkInfo } from "./grassMapStore";

/** Tuft node names in grassLODs.glb, high -> low detail (132 / 64 / 32 verts). */
export const LOD_NAMES = ["LOD00", "LOD01", "LOD02"] as const;
/** Hard cap on tufts, whatever the maze size or density. */
const MAX_TUFTS = 80000;
/** Auto-LOD bands, as fractions of the draw distance (camera to chunk edge). */
const LOD_FULL_BAND = 0.35;
const LOD_MEDIUM_BAND = 0.7;
/** Keep blade bases this far from wall faces. */
const WALL_MARGIN = 0.08;

/** Occlusion: sample points per chunk side (3 → a 3×3 grid) at grass-tip height. */
const OCCLUSION_SAMPLES = 3;
const OCCLUSION_SAMPLE_Y = 0.5;
/** Frames a chunk must stay unseen before it is culled (stops flicker at gaps). */
const OCCLUSION_HOLD_FRAMES = 8;

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

interface Chunk {
  center: THREE.Vector3;
  half: number;
  /** One mesh per LOD, sharing a single instance-matrix buffer; one is visible. */
  meshes: THREE.InstancedMesh[];
  /** Shared with the minimap via grassMapStore. */
  info: GrassChunkInfo;
  /** Frame this chunk last had line of sight (occlusion hysteresis). */
  lastSeen: number;
}

const _frustum = new THREE.Frustum();
const _viewProjection = new THREE.Matrix4();
const _sample = new THREE.Vector3();
const _ray = new THREE.Vector3();

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
 * The grass inside the maze: tufts scattered over the interior (between the
 * border walls' inner faces), never on a wall slab, and worn down along a
 * footpath down the middle of every corridor — shorter, smaller and sparser the
 * closer they are to the centreline. Tufts are bucketed into square chunks, each
 * its own instanced mesh with a tight bounding sphere, so off-screen chunks are
 * frustum-culled and each chunk picks its own LOD.
 */
export class GrassField {
  readonly group = new THREE.Group();
  private readonly chunks: Chunk[] = [];
  private readonly walls = new WallCollider();
  private frame = 0;

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
      const matrices = new THREE.InstancedBufferAttribute(new Float32Array(data), 16);

      const meshes = geometries.map((geometry) => {
        const mesh = new THREE.InstancedMesh(geometry, material, count);
        mesh.instanceMatrix = matrices; // one GPU buffer shared by all LODs
        mesh.boundingSphere = new THREE.Sphere(center.clone(), radius);
        mesh.castShadow = false; // grass never needs to cast
        mesh.visible = false; // updateVisibility() picks one per chunk
        this.group.add(mesh);
        return mesh;
      });
      const info: GrassChunkInfo = {
        x: center.x,
        z: center.z,
        half: chunkSize / 2,
        tufts: count,
        state: ChunkState.OutOfRange,
      };
      this.chunks.push({ center, half: chunkSize / 2, meshes, info, lastSeen: -Infinity });
    });

    grassMapStore.chunks = this.chunks.map((ch) => ch.info);
    grassMapStore.totalTufts = this.chunks.reduce((n, ch) => n + ch.info.tufts, 0);
  }

  /**
   * Per-frame culling, cheapest test first; each chunk ends up drawn (one LOD
   * mesh visible) or culled (all hidden):
   * 1. Distance — only chunks within `drawDistance` of the player. The shader
   *    fades blades out before that edge, so switching a chunk off is invisible.
   * 2. Frustum — only chunks in the camera's view.
   * 3. Occlusion — only chunks the camera has a line of sight to past the walls
   *    (when `occlusion` is on), with a few frames' hold so gaps don't flicker.
   * Drawn chunks pick a LOD: forced (0-2), or -1 for bands relative to the draw
   * distance. Pass drawDistance < 0 to hide everything (grass disabled).
   * Each chunk's result is published to grassMapStore for the minimap.
   */
  updateVisibility(
    camera: THREE.Camera,
    playerX: number,
    playerZ: number,
    drawDistance: number,
    forced: number,
    occlusion: boolean
  ) {
    this.frame++;
    camera.updateMatrixWorld();
    _viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_viewProjection, camera.coordinateSystem);

    let drawnChunks = 0;
    let drawnTufts = 0;
    for (const ch of this.chunks) {
      const dx = Math.max(0, Math.abs(playerX - ch.center.x) - ch.half);
      const dz = Math.max(0, Math.abs(playerZ - ch.center.z) - ch.half);

      let state: ChunkState;
      if (Math.hypot(dx, dz) >= drawDistance) {
        state = ChunkState.OutOfRange;
      } else if (!_frustum.intersectsSphere(ch.meshes[0].boundingSphere!)) {
        state = ChunkState.OutOfView;
      } else if (occlusion && !this.isVisible(ch, camera.position)) {
        state = ChunkState.Occluded;
      } else {
        state = ChunkState.Drawn;
      }
      ch.info.state = state;

      let lod = -2; // hide every LOD mesh
      if (state === ChunkState.Drawn) {
        drawnChunks++;
        drawnTufts += ch.info.tufts;
        lod = forced;
        if (lod === -1) {
          const dist = Math.max(0, camera.position.distanceTo(ch.center) - ch.half);
          lod = dist < drawDistance * LOD_FULL_BAND ? 0 : dist < drawDistance * LOD_MEDIUM_BAND ? 1 : 2;
        }
      }
      for (let i = 0; i < ch.meshes.length; i++) {
        const visible = i === lod;
        if (ch.meshes[i].visible !== visible) ch.meshes[i].visible = visible;
      }
    }
    grassMapStore.drawDistance = Math.max(0, drawDistance);
    grassMapStore.drawnChunks = drawnChunks;
    grassMapStore.drawnTufts = drawnTufts;
  }

  /**
   * Occlusion test with hysteresis: visible if the camera has a line of sight
   * past the walls to any of a grid of points across the chunk (at grass-tip
   * height), or had one within the last few frames.
   */
  private isVisible(ch: Chunk, eye: THREE.Vector3): boolean {
    if (this.hasLineOfSight(ch, eye)) {
      ch.lastSeen = this.frame;
      return true;
    }
    return this.frame - ch.lastSeen <= OCCLUSION_HOLD_FRAMES;
  }

  private hasLineOfSight(ch: Chunk, eye: THREE.Vector3): boolean {
    // Standing in (or right next to) the chunk: always visible.
    const nx = Math.max(0, Math.abs(eye.x - ch.center.x) - ch.half);
    const nz = Math.max(0, Math.abs(eye.z - ch.center.z) - ch.half);
    if (Math.hypot(nx, nz) < 1) return true;

    const n = OCCLUSION_SAMPLES;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        // Centre first (most likely visible), then the rest of the grid.
        const a = (i + (n >> 1)) % n;
        const b = (j + (n >> 1)) % n;
        const u = ((a + 0.5) / n) * 2 - 1;
        const v = ((b + 0.5) / n) * 2 - 1;
        _sample.set(ch.center.x + u * ch.half, OCCLUSION_SAMPLE_Y, ch.center.z + v * ch.half);
        _ray.subVectors(_sample, eye);
        const dist = _ray.length();
        if (dist < 1e-6) return true;
        _ray.divideScalar(dist);
        if (this.walls.raycast(eye, _ray, dist) >= dist - 0.05) return true;
      }
    }
    return false;
  }

  dispose() {
    for (const ch of this.chunks) for (const m of ch.meshes) m.dispose();
    if (grassMapStore.chunks[0] === this.chunks[0]?.info) {
      grassMapStore.chunks = [];
      grassMapStore.totalTufts = 0;
      grassMapStore.drawnChunks = 0;
      grassMapStore.drawnTufts = 0;
    }
  }
}
