import * as THREE from "three/webgpu";
import { WallCollider } from "../../character/WallCollider";
import { CELL, COLS, ROWS, cellAt, cellToWorld, treeSeed, worldToCell } from "../../maze/mazeData";
import { ChunkState } from "./grassMapStore";

/** Frames a chunk must stay unseen before it is culled (stops flicker at gaps). */
const OCCLUSION_HOLD_FRAMES = 8;
/**
 * Occlusion sample heights at or below this share one visibility cache (grass,
 * flowers, fallen leaves): sampling a little higher only ever sees more, so
 * it never culls anything visible.
 */
const LOW_SAMPLE_Y = 0.5;
/** Sample points per maze cell: its centre and four points towards its corners. */
const CELL_SAMPLES: [number, number][] = [
  [0, 0],
  [-0.35, -0.35],
  [0.35, -0.35],
  [-0.35, 0.35],
  [0.35, 0.35],
];

/** A square patch of instanced vegetation, as the culler sees it. */
export interface CullableChunk {
  center: THREE.Vector3;
  /** Half the chunk's side length. */
  half: number;
  /** Bounds of everything drawn in the chunk (frustum test). */
  sphere: THREE.Sphere;
  /** Frame this chunk last had line of sight (occlusion hysteresis). */
  lastSeen: number;
}

const _sample = new THREE.Vector3();
const _ray = new THREE.Vector3();
const _viewProjection = new THREE.Matrix4();

const UNKNOWN = 0;
const VISIBLE = 1;
const HIDDEN = 2;

/**
 * The one per-frame visibility pass every vegetation system shares: the
 * camera frustum, and which maze cells the camera can see into past the walls
 * (line of sight to a few points in the cell), worked out lazily — only for
 * cells some system asks about — and cached for the frame, per sample height.
 * One wall grid for all, and a cell asked about by grass, flowers and ivy
 * costs its rays once.
 */
class SharedVisibility {
  readonly frustum = new THREE.Frustum();
  readonly eye = new THREE.Vector3();
  /** Advances each frame the camera moves (hysteresis counts these). */
  frame = 0;
  private walls: WallCollider | null = null;
  private mazeKey = "";
  private readonly lastView = new Float32Array(32);
  /** Per sample height: a state per maze cell (UNKNOWN / VISIBLE / HIDDEN). */
  private readonly cells = new Map<number, Uint8Array>();

  /**
   * Bring the shared state up to date with the camera. Every culler calls
   * this each frame; only the first call after the camera moves does work.
   */
  update(camera: THREE.Camera) {
    const key = `${ROWS}x${COLS}:${treeSeed}`;
    if (key !== this.mazeKey) {
      this.mazeKey = key;
      this.walls = new WallCollider();
      this.lastView.fill(NaN);
    }
    camera.updateMatrixWorld();
    const world = camera.matrixWorld.elements;
    const projection = camera.projectionMatrix.elements;
    let same = true;
    for (let i = 0; i < 16; i++) {
      if (this.lastView[i] !== world[i] || this.lastView[16 + i] !== projection[i]) {
        same = false;
        break;
      }
    }
    if (same) return;
    this.lastView.set(world);
    this.lastView.set(projection, 16);
    this.frame++;
    _viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(_viewProjection, camera.coordinateSystem);
    this.eye.setFromMatrixPosition(camera.matrixWorld);
    for (const states of this.cells.values()) states.fill(UNKNOWN);
  }

  /** Can the camera see into any maze cell overlapping this square (at height y)? */
  seesArea(cx: number, cz: number, half: number, y: number): boolean {
    const level = y <= LOW_SAMPLE_Y ? LOW_SAMPLE_Y : y;
    let states = this.cells.get(level);
    if (!states || states.length !== ROWS * COLS) {
      states = new Uint8Array(ROWS * COLS);
      this.cells.set(level, states);
    }
    const [r0, c0] = worldToCell(cx - half, cz - half);
    const [r1, c1] = worldToCell(cx + half, cz + half);
    for (let r = Math.max(0, Math.min(r0, r1)); r <= Math.min(ROWS - 1, Math.max(r0, r1)); r++) {
      for (let c = Math.max(0, Math.min(c0, c1)); c <= Math.min(COLS - 1, Math.max(c0, c1)); c++) {
        const k = r * COLS + c;
        if (states[k] === UNKNOWN) states[k] = this.cellVisible(r, c, level) ? VISIBLE : HIDDEN;
        if (states[k] === VISIBLE) return true;
      }
    }
    return false;
  }

  private cellVisible(r: number, c: number, y: number): boolean {
    // A wall cell is all wall; what shows of it (its faces, the ivy on them)
    // is seen from the open cells beside it.
    if (cellAt(r, c) === "wall") return false;
    const [x, z] = cellToWorld(r, c);
    for (const [u, v] of CELL_SAMPLES) {
      _sample.set(x + u * CELL, y, z + v * CELL);
      _ray.subVectors(_sample, this.eye);
      const dist = _ray.length();
      if (dist < 1e-6) return true;
      _ray.divideScalar(dist);
      if (this.walls!.raycast(this.eye, _ray, dist) >= dist - 0.05) return true;
    }
    return false;
  }
}

const shared = new SharedVisibility();

/**
 * Per-frame culling for chunked vegetation (grass, flowers, ivy, the tree),
 * cheapest test first:
 * 1. Distance — only chunks within the draw distance of the player.
 * 2. Frustum — only chunks in the camera's view.
 * 3. Occlusion — only chunks overlapping a maze cell the camera can see into
 *    past the walls, with a few frames' hold so gaps don't flicker.
 * All cullers share one frustum, one wall grid and one per-frame cell
 * visibility cache (SharedVisibility above).
 */
export class ChunkCuller {
  /**
   * @param sampleY Height of the occlusion sample points (top of the vegetation).
   * @param margin Extra metres around a chunk whose cells count as its own —
   *   for things on wall faces (ivy), seen from the open cell beside the wall,
   *   which may lie just outside the chunk.
   */
  constructor(
    private readonly sampleY: number,
    private readonly margin = 0
  ) {}

  /** Call once per frame, before classify(). */
  begin(camera: THREE.Camera) {
    shared.update(camera);
  }

  classify(
    ch: CullableChunk,
    playerX: number,
    playerZ: number,
    drawDistance: number,
    occlusion: boolean
  ): ChunkState {
    const dx = Math.max(0, Math.abs(playerX - ch.center.x) - ch.half);
    const dz = Math.max(0, Math.abs(playerZ - ch.center.z) - ch.half);
    if (Math.hypot(dx, dz) >= drawDistance) return ChunkState.OutOfRange;
    if (!shared.frustum.intersectsSphere(ch.sphere)) return ChunkState.OutOfView;
    if (occlusion && !this.isVisible(ch)) return ChunkState.Occluded;
    return ChunkState.Drawn;
  }

  /** Camera distance to the chunk's nearest edge (for LOD bands). */
  distanceTo(ch: CullableChunk): number {
    return Math.max(0, shared.eye.distanceTo(ch.center) - ch.half);
  }

  private isVisible(ch: CullableChunk): boolean {
    if (this.hasLineOfSight(ch)) {
      ch.lastSeen = shared.frame;
      return true;
    }
    return shared.frame - ch.lastSeen <= OCCLUSION_HOLD_FRAMES;
  }

  private hasLineOfSight(ch: CullableChunk): boolean {
    const eye = shared.eye;
    // Standing in (or right next to) the chunk: always visible.
    const nx = Math.max(0, Math.abs(eye.x - ch.center.x) - ch.half);
    const nz = Math.max(0, Math.abs(eye.z - ch.center.z) - ch.half);
    if (Math.hypot(nx, nz) < 1) return true;
    return shared.seesArea(ch.center.x, ch.center.z, ch.half + this.margin, this.sampleY);
  }
}
