import * as THREE from "three/webgpu";
import { ChunkCuller, type CullableChunk } from "../scene/grass/ChunkCuller";
import { ChunkState } from "../scene/grass/grassMapStore";
import { SHADOW_ONLY_LAYER } from "../scene/layers";

/** Chunk side in metres (3 cells). */
const CHUNK_SIZE = 6;
/**
 * Drawn before everything else (renderOrder sorts first, default 0): the
 * walls hide most of the maze, so with them in the depth buffer first, the
 * grass, flowers, ivy and leaves behind them fail the depth test instead of
 * being shaded and then painted over. Same image, much less overdraw.
 */
export const WALL_RENDER_ORDER = -10;

/** One kind of instanced piece (a wall shape, the capstones), all of it. */
export interface BatchPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Every instance's world matrix, 16 floats each. */
  matrices: Float32Array;
  /** Extra per-instance attributes, every instance's values. */
  attributes?: Record<string, { itemSize: number; values: Float32Array }>;
}

interface Chunk extends CullableChunk {
  /** Per part, the instances whose centre is in this chunk. */
  items: number[][];
  /** Squared distance from the camera this frame (for the draw order). */
  distance: number;
}

interface Packed {
  part: BatchPart;
  /** Drawn in the view: the visible chunks' instances, packed back to back. */
  mesh: THREE.InstancedMesh;
  attributes: [THREE.InstancedBufferAttribute, Float32Array][];
}

/**
 * The maze's static instanced pieces (wall slabs, capstones), culled in
 * chunks like the vegetation — by distance, the camera frustum and the walls
 * in between (ChunkCuller) — with one draw per part however many chunks are
 * visible: the visible chunks' instances are packed into one instanced mesh
 * per part whenever the visible set changes.
 *
 * The sun's shadow map is baked once and must see every wall, so each part
 * also has a full copy on SHADOW_ONLY_LAYER: drawn only by the shadow camera,
 * never in the view.
 */
export class WallBatch {
  readonly group = new THREE.Group();
  private readonly chunks: Chunk[] = [];
  private readonly packed: Packed[] = [];
  private readonly culler: ChunkCuller;
  private shown: Chunk[] = [];
  private readonly visible: Chunk[] = [];
  private readonly eye = new THREE.Vector3();
  private readonly disposables: { dispose(): void }[] = [];

  /**
   * @param height Top of the tallest piece (m), for the chunk bounds and the
   *   occlusion samples.
   * @param reach How far a piece reaches beyond its centre (m).
   */
  constructor(parts: BatchPart[], height: number, reach: number, name: string) {
    this.group.name = name;
    // A wall face is seen from the open cell beside it, which may lie just
    // outside the chunk; sampling at the wall top only ever sees more.
    this.culler = new ChunkCuller(height, reach);

    const byKey = new Map<string, Chunk>();
    parts.forEach((part, p) => {
      const count = part.matrices.length / 16;
      for (let i = 0; i < count; i++) {
        const x = part.matrices[i * 16 + 12];
        const z = part.matrices[i * 16 + 14];
        const ix = Math.floor(x / CHUNK_SIZE);
        const iz = Math.floor(z / CHUNK_SIZE);
        const key = `${ix},${iz}`;
        let ch = byKey.get(key);
        if (!ch) {
          const center = new THREE.Vector3((ix + 0.5) * CHUNK_SIZE, height / 2, (iz + 0.5) * CHUNK_SIZE);
          const r = CHUNK_SIZE / 2 + reach;
          ch = {
            center,
            half: CHUNK_SIZE / 2,
            sphere: new THREE.Sphere(center.clone(), Math.hypot(r, r, height / 2)),
            lastSeen: -Infinity,
            items: parts.map(() => []),
            distance: 0,
          };
          byKey.set(key, ch);
          this.chunks.push(ch);
        }
        ch.items[p].push(i);
      }

      // The view copy: room for every instance, filled with the visible ones.
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, count);
      mesh.count = 0;
      mesh.frustumCulled = false; // culled here, by chunk
      mesh.receiveShadow = true;
      mesh.renderOrder = WALL_RENDER_ORDER;
      const attributes: Packed["attributes"] = [];
      for (const [attrName, { itemSize, values }] of Object.entries(part.attributes ?? {})) {
        const attr = new THREE.InstancedBufferAttribute(new Float32Array(values.length), itemSize);
        part.geometry.setAttribute(attrName, attr);
        attributes.push([attr, values]);
      }
      this.packed.push({ part, mesh, attributes });
      this.group.add(mesh);

      // The shadow copy: everything, always, on its own geometry (its own attributes).
      const shadowGeometry = part.geometry.clone();
      for (const [attrName, { itemSize, values }] of Object.entries(part.attributes ?? {})) {
        shadowGeometry.setAttribute(attrName, new THREE.InstancedBufferAttribute(values, itemSize));
      }
      const shadow = new THREE.InstancedMesh(shadowGeometry, part.material, count);
      (shadow.instanceMatrix.array as Float32Array).set(part.matrices);
      shadow.instanceMatrix.needsUpdate = true;
      shadow.frustumCulled = false;
      shadow.castShadow = true;
      shadow.layers.set(SHADOW_ONLY_LAYER);
      this.group.add(shadow);
      this.disposables.push(mesh, shadow, shadowGeometry);
    });
  }

  /**
   * Per frame: draw only the chunks within `drawDistance` of the camera, in
   * view and not walled off, nearest first (so near walls hide far ones before
   * they are shaded); repack when that list changes.
   */
  update(camera: THREE.Camera, drawDistance: number, occlusion: boolean) {
    this.culler.begin(camera);
    this.eye.setFromMatrixPosition(camera.matrixWorld);
    const visible = this.visible;
    visible.length = 0;
    for (const ch of this.chunks) {
      if (this.culler.classify(ch, this.eye.x, this.eye.z, drawDistance, occlusion) === ChunkState.Drawn) {
        ch.distance = this.eye.distanceToSquared(ch.center);
        visible.push(ch);
      }
    }
    visible.sort((a, b) => a.distance - b.distance);
    if (visible.length === this.shown.length && visible.every((ch, i) => ch === this.shown[i])) return;
    this.shown = visible.slice();
    this.pack();
  }

  private pack() {
    this.packed.forEach(({ part, mesh, attributes }, p) => {
      const matrices = mesh.instanceMatrix.array as Float32Array;
      let n = 0;
      for (const ch of this.shown) {
        for (const i of ch.items[p]) {
          matrices.set(part.matrices.subarray(i * 16, i * 16 + 16), n * 16);
          for (const [attr, values] of attributes) {
            const s = attr.itemSize;
            (attr.array as Float32Array).set(values.subarray(i * s, i * s + s), n * s);
          }
          n++;
        }
      }
      mesh.count = n;
      for (const attr of [mesh.instanceMatrix, ...attributes.map(([a]) => a)]) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, Math.max(1, n) * attr.itemSize);
        attr.needsUpdate = true;
      }
    });
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    for (const { part } of this.packed) part.geometry.dispose();
  }
}
