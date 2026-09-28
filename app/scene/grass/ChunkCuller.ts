import * as THREE from "three/webgpu";
import { WallCollider } from "../../character/WallCollider";
import { ChunkState } from "./grassMapStore";

/** Occlusion: sample points per chunk side (3 → a 3×3 grid). */
const OCCLUSION_SAMPLES = 3;
/** Frames a chunk must stay unseen before it is culled (stops flicker at gaps). */
const OCCLUSION_HOLD_FRAMES = 8;

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

const _frustum = new THREE.Frustum();
const _viewProjection = new THREE.Matrix4();
const _sample = new THREE.Vector3();
const _ray = new THREE.Vector3();

/**
 * Per-frame culling for chunked vegetation (grass, flowers), cheapest test first:
 * 1. Distance — only chunks within the draw distance of the player.
 * 2. Frustum — only chunks in the camera's view.
 * 3. Occlusion — only chunks the camera has a line of sight to past the walls,
 *    with a few frames' hold so gaps don't flicker.
 */
export class ChunkCuller {
  private readonly walls = new WallCollider();
  private frame = 0;
  private readonly eye = new THREE.Vector3();

  /** @param sampleY Height of the occlusion sample points (top of the vegetation). */
  constructor(private readonly sampleY: number) {}

  /** Call once per frame, before classify(). */
  begin(camera: THREE.Camera) {
    this.frame++;
    camera.updateMatrixWorld();
    _viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_viewProjection, camera.coordinateSystem);
    this.eye.setFromMatrixPosition(camera.matrixWorld);
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
    if (!_frustum.intersectsSphere(ch.sphere)) return ChunkState.OutOfView;
    if (occlusion && !this.isVisible(ch)) return ChunkState.Occluded;
    return ChunkState.Drawn;
  }

  /** Camera distance to the chunk's nearest edge (for LOD bands). */
  distanceTo(ch: CullableChunk): number {
    return Math.max(0, this.eye.distanceTo(ch.center) - ch.half);
  }

  private isVisible(ch: CullableChunk): boolean {
    if (this.hasLineOfSight(ch)) {
      ch.lastSeen = this.frame;
      return true;
    }
    return this.frame - ch.lastSeen <= OCCLUSION_HOLD_FRAMES;
  }

  /** Line of sight past the walls to any of a grid of points across the chunk. */
  private hasLineOfSight(ch: CullableChunk): boolean {
    const eye = this.eye;
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
        _sample.set(ch.center.x + u * ch.half, this.sampleY, ch.center.z + v * ch.half);
        _ray.subVectors(_sample, eye);
        const dist = _ray.length();
        if (dist < 1e-6) return true;
        _ray.divideScalar(dist);
        if (this.walls.raycast(eye, _ray, dist) >= dist - 0.05) return true;
      }
    }
    return false;
  }
}
