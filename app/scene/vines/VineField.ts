import * as THREE from "three/webgpu";
import { CELL } from "../../maze/mazeData";
import { ChunkCuller, type CullableChunk } from "../grass/ChunkCuller";
import { ChunkState } from "../grass/grassMapStore";
import type { VineMaterials } from "./vineMaterials";
import { growFace, type VineFace, type VineGrowth, type VineLeaf, type VineStem } from "./vineLayout";

/** Chunk side in metres. */
const CHUNK_SIZE = 6;
/** Occlusion sample height: mid-wall, where most of the ivy is. */
const OCCLUSION_SAMPLE_Y = 1.4;
/** Stem texture repeat along the stem, metres. */
const STEM_TILE = 0.3;
/** Stems thinner than this (tendrils) are drawn last, and dropped far away. */
const THIN_STEM = 0.006;
/**
 * Leaf LOD, as on the maple, per leaf in the shader (vineMaterials): beyond
 * LEAF_LOD_NEAR metres only near/distance of the leaves are drawn (at least
 * LEAF_LOD_MIN), each scaled up about its stalk so the wall stays as covered.
 */
export const LEAF_LOD_NEAR = 5;
export const LEAF_LOD_MIN = 0.3;
/** Leaf slots the shared leaf mesh starts with (it grows when needed). */
const LEAF_CAPACITY = 16384;
/** Beyond this, tendrils are under a pixel wide (and deep in the fog): skip them. */
const TENDRIL_DISTANCE = 11;
/**
 * Stem rings, every Nth growth point (7 cm apart): near, and from
 * STEM_LOD_DISTANCE on, where a 2 cm stem is a few pixels wide.
 */
const STEM_STRIDE_NEAR = 2;
const STEM_STRIDE_FAR = 4;
const TENDRIL_STRIDE_FAR = 3;
const STEM_LOD_DISTANCE = 6;

interface Chunk extends CullableChunk {
  /** The wall faces in this chunk (grown only when the chunk is built). */
  faces: VineFace[];
  /** The chunk's meshes, once built (streamed in near the player). */
  group: THREE.Group | null;
  /** The chunk's leaves, packed into the shared leaf mesh while it is drawn. */
  leaves: LeafData | null;
  /** Stems near and far (fewer rings); one is visible. */
  stems: THREE.Mesh | null;
  stemsFar: THREE.Mesh | null;
  leafCount: number;
  disposables: { dispose(): void }[];
}

/**
 * An ivy leaf card: a unit quad facing +Z, its stem end at the origin and the
 * tip at +Y. The V coordinate is flipped (0 at the tip) because KTX2 textures
 * aren't flipped on upload: row 0 of the atlas — the tips — is at v = 0.
 */
function leafCardGeometry(): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const uv = geo.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  return geo;
}

const _t = new THREE.Vector3();
const _side = new THREE.Vector3();
const _up = new THREE.Vector3();
const _dir = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Stems and tendrils as tapered tubes, written straight into one indexed
 * geometry (no per-stem TubeGeometry, no merge). Stems lie on a wall, so the
 * wall normal gives each ring a stable frame without Frenet frames. A ring
 * every `stride` growth points (7 cm apart), always including the tip:
 * `thinStride` for tendrils.
 */
function stemGeometry(stems: VineStem[], stride: number, thinStride: number): THREE.BufferGeometry | null {
  if (stems.length === 0) return null;
  const plans = stems.map((stem) => {
    const n = stem.points.length;
    const step = stem.r0 < THIN_STEM ? thinStride : stride;
    const rings: number[] = [];
    for (let i = 0; i < n; i++) if (i % step === 0 || i === n - 1) rings.push(i);
    return {
      stem,
      points: rings.map((i) => stem.points[i]),
      // Where along the stem each ring is (0..1), for the taper.
      along: rings.map((i) => i / (n - 1)),
      radial: stem.r0 < THIN_STEM ? 3 : 4,
    };
  });
  // Tendrils last, so far away the draw range can simply stop before them.
  plans.sort((a, b) => Number(a.stem.r0 < THIN_STEM) - Number(b.stem.r0 < THIN_STEM));
  let vertexCount = 0;
  let indexCount = 0;
  let thickIndexCount = 0;
  for (const { stem, points, radial } of plans) {
    vertexCount += points.length * (radial + 1);
    indexCount += (points.length - 1) * radial * 6;
    if (stem.r0 >= THIN_STEM) thickIndexCount = indexCount;
  }
  const position = new Float32Array(vertexCount * 3);
  const normal = new Float32Array(vertexCount * 3);
  const uv = new Float32Array(vertexCount * 2);
  const wall = new Float32Array(vertexCount * 3);
  const index = new Uint32Array(indexCount);

  let v = 0;
  let k = 0;
  for (const { stem, points, along: at, radial } of plans) {
    const n = points.length;
    const base = v;
    let along = 0;
    for (let i = 0; i < n; i++) {
      const p = points[i];
      _t.subVectors(points[Math.min(i + 1, n - 1)], points[Math.max(i - 1, 0)]).normalize();
      _side.crossVectors(_t, stem.normal);
      if (_side.lengthSq() < 1e-6) _side.crossVectors(_t, UP); // heading straight off the wall
      _side.normalize();
      _up.crossVectors(_side, _t).normalize();
      const r = THREE.MathUtils.lerp(stem.r0, stem.r1, at[i]);
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        _dir.copy(_side).multiplyScalar(Math.cos(a)).addScaledVector(_up, Math.sin(a));
        position[v * 3] = p.x + _dir.x * r;
        position[v * 3 + 1] = p.y + _dir.y * r;
        position[v * 3 + 2] = p.z + _dir.z * r;
        normal[v * 3] = _dir.x;
        normal[v * 3 + 1] = _dir.y;
        normal[v * 3 + 2] = _dir.z;
        stem.normal.toArray(wall, v * 3);
        uv[v * 2] = j / radial;
        uv[v * 2 + 1] = along / STEM_TILE;
        v++;
      }
      if (i < n - 1) along += p.distanceTo(points[i + 1]);
    }
    // Quads between consecutive rings, wound outwards.
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < radial; j++) {
        const a = base + i * (radial + 1) + j;
        const b = a + radial + 1;
        index[k++] = a;
        index[k++] = b;
        index[k++] = a + 1;
        index[k++] = b;
        index[k++] = b + 1;
        index[k++] = a + 1;
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute("wallNormal", new THREE.BufferAttribute(wall, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  geometry.userData.thickIndexCount = thickIndexCount;
  return geometry;
}

/** One chunk's leaves as instance data, ready to pack into the shared leaf mesh. */
interface LeafData {
  count: number;
  matrices: Float32Array;
  colors: Float32Array;
  cells: Float32Array;
  origins: Float32Array;
  /** Out of the wall each leaf grows on. */
  walls: Float32Array;
  /**
   * A fixed random number per leaf: which leaves the LOD keeps, and the
   * leaf's tint and flutter phase — stable however the leaves are packed.
   */
  ranks: Float32Array;
}

/** A chunk's leaf cards: matrices from each leaf's basis, a tint, an atlas cell, its stalk point and rank. */
function leafData(leaves: VineLeaf[]): LeafData {
  const count = leaves.length;
  const data: LeafData = {
    count,
    matrices: new Float32Array(count * 16),
    colors: new Float32Array(count * 3),
    cells: new Float32Array(count),
    origins: new Float32Array(count * 3),
    walls: new Float32Array(count * 3),
    ranks: new Float32Array(count),
  };
  const m = new THREE.Matrix4();
  const x = new THREE.Vector3();
  const y = new THREE.Vector3();
  const z = new THREE.Vector3();
  let seed = (count * 2654435761) | 0;
  leaves.forEach((leaf, i) => {
    m.makeBasis(
      x.copy(leaf.x).multiplyScalar(leaf.size),
      y.copy(leaf.y).multiplyScalar(leaf.size),
      z.copy(leaf.z).multiplyScalar(leaf.size)
    ).setPosition(leaf.position);
    m.toArray(data.matrices, i * 16);
    // Slight per-leaf brightness (the hue comes from the grass palette).
    const age = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1);
    data.colors.fill(0.82 + 0.28 * age, i * 3, i * 3 + 3);
    data.cells[i] = leaf.cell;
    leaf.position.toArray(data.origins, i * 3);
    leaf.wall.toArray(data.walls, i * 3);
    seed = (Math.imul(seed ^ (seed >>> 15), 2246822519) + 0x6d2b79f5) | 0;
    data.ranks[i] = (seed >>> 0) / 4294967296;
  });
  return data;
}

/**
 * The one mesh every drawn ivy leaf is packed into (one draw for all of them):
 * the leaf card instanced with per-leaf cell, stalk point and rank.
 */
function sharedLeafMesh(card: THREE.BufferGeometry, material: THREE.Material, capacity: number): THREE.InstancedMesh {
  const geometry = card.clone();
  geometry.setAttribute("leafCell", new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
  geometry.setAttribute("leafOrigin", new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
  geometry.setAttribute("leafRank", new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
  geometry.setAttribute("leafWall", new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  mesh.count = 0;
  mesh.frustumCulled = false; // the chunks are culled before packing
  mesh.receiveShadow = true;
  mesh.name = "Ivy leaves";
  return mesh;
}

/** Chunks are built this far beyond the draw distance, ahead of being seen … */
const BUILD_MARGIN = 6;
/** … and freed again this far beyond it. */
const FREE_MARGIN = 18;
/** Build at most this many chunks per frame (tube building is CPU work). */
const BUILDS_PER_FRAME = 2;

/**
 * The ivy, bucketed into square chunks and streamed: a chunk's faces are
 * grown and its meshes (one stem mesh, one instanced leaf mesh) built only
 * once the player comes within range — nearest first, a couple per frame —
 * and freed again when they are far away, so load time and memory stay flat
 * however dense the ivy or big the maze. Built chunks are culled like the grass and flowers: by the view
 * distance, the camera frustum and the walls in between (ChunkCuller).
 */
export class VineField {
  readonly group = new THREE.Group();
  private readonly chunks: Chunk[] = [];
  // Ivy is on wall faces, seen from the open cell beside the wall — which
  // may lie just outside the chunk — so the chunk's cells reach one further.
  private readonly culler = new ChunkCuller(OCCLUSION_SAMPLE_Y, CELL);
  private readonly card = leafCardGeometry();
  /** Every drawn leaf, packed from the visible chunks (see pack()). */
  private leafMesh: THREE.InstancedMesh;
  private packed: Chunk[] = [];
  private readonly visible: Chunk[] = [];
  /** Leaves in the built chunks. */
  leavesBuilt = 0;
  leavesDrawn = 0;
  chunksDrawn = 0;
  chunksBuilt = 0;

  constructor(
    faces: VineFace[],
    private readonly growth: VineGrowth,
    private readonly materials: VineMaterials
  ) {
    this.leafMesh = sharedLeafMesh(this.card, materials.leaves, LEAF_CAPACITY);
    this.group.add(this.leafMesh);

    const key = (p: THREE.Vector3) => `${Math.floor(p.x / CHUNK_SIZE)},${Math.floor(p.z / CHUNK_SIZE)}`;
    const buckets = new Map<string, VineFace[]>();
    for (const vf of faces) {
      const k = key(vf.face.origin);
      const list = buckets.get(k);
      if (list) list.push(vf);
      else buckets.set(k, [vf]);
    }

    for (const [k, list] of buckets) {
      const [ix, iz] = k.split(",").map(Number);
      const center = new THREE.Vector3((ix + 0.5) * CHUNK_SIZE, 1.25, (iz + 0.5) * CHUNK_SIZE);
      this.chunks.push({
        center,
        half: CHUNK_SIZE / 2,
        sphere: new THREE.Sphere(center.clone(), CHUNK_SIZE * 0.75 + 2),
        lastSeen: -Infinity,
        faces: list,
        group: null,
        leaves: null,
        stems: null,
        stemsFar: null,
        leafCount: 0,
        disposables: [],
      });
    }
  }

  private build(ch: Chunk) {
    // Grow this chunk's faces now; the data is dropped once the meshes exist.
    const stemList: VineStem[] = [];
    const leafList: VineLeaf[] = [];
    for (const vf of ch.faces) {
      const grown = growFace(vf, this.growth);
      stemList.push(...grown.stems);
      leafList.push(...grown.leaves);
    }
    const group = new THREE.Group();
    const stemMesh = (geometry: THREE.BufferGeometry | null) => {
      if (!geometry) return null;
      const mesh = new THREE.Mesh(geometry, this.materials.stems);
      mesh.name = "Ivy stems";
      mesh.receiveShadow = true;
      group.add(mesh);
      ch.disposables.push(geometry);
      return mesh;
    };
    ch.stems = stemMesh(stemGeometry(stemList, STEM_STRIDE_NEAR, STEM_STRIDE_NEAR));
    ch.stemsFar = stemMesh(stemGeometry(stemList, STEM_STRIDE_FAR, TENDRIL_STRIDE_FAR));
    if (ch.stemsFar) ch.stemsFar.visible = false;
    ch.leafCount = leafList.length;
    ch.leaves = leafList.length > 0 ? leafData(leafList) : null;
    group.visible = false;
    this.group.add(group);
    ch.group = group;
  }

  private free(ch: Chunk) {
    if (!ch.group) return;
    this.group.remove(ch.group);
    for (const d of ch.disposables) d.dispose();
    ch.disposables = [];
    ch.group = null;
    ch.leaves = null;
    ch.stems = null;
    ch.stemsFar = null;
  }

  /**
   * Thin a visible chunk's tendrils by the camera's distance (its leaves thin
   * in the shader); returns about how many of its leaves the shader draws.
   */
  private applyLod(ch: Chunk): number {
    const dist = this.culler.distanceTo(ch);
    const keep = dist <= LEAF_LOD_NEAR ? 1 : Math.max(LEAF_LOD_MIN, LEAF_LOD_NEAR / dist);
    const drawn = Math.ceil(ch.leafCount * keep);
    if (ch.stems && ch.stemsFar) {
      const far = dist > STEM_LOD_DISTANCE;
      if (ch.stems.visible === far) ch.stems.visible = !far;
      if (ch.stemsFar.visible !== far) ch.stemsFar.visible = far;
      if (far) {
        const geometry = ch.stemsFar.geometry;
        const all = geometry.index!.count;
        const count = dist > TENDRIL_DISTANCE ? (geometry.userData.thickIndexCount as number) : all;
        if (geometry.drawRange.count !== count) geometry.setDrawRange(0, count);
      }
    }
    return drawn;
  }

  /** Ground distance from the player to the chunk's square. */
  private distance(ch: Chunk, x: number, z: number) {
    return Math.hypot(Math.max(0, Math.abs(x - ch.center.x) - ch.half), Math.max(0, Math.abs(z - ch.center.z) - ch.half));
  }

  /**
   * Per frame: stream chunks in and out around the player, then show only
   * built chunks within `drawDistance` (< 0 = none), in view and not walled off.
   */
  update(camera: THREE.Camera, playerX: number, playerZ: number, drawDistance: number, occlusion: boolean) {
    // Stream: build the nearest missing chunks in range, free far ones.
    const wanted: { ch: Chunk; d: number }[] = [];
    for (const ch of this.chunks) {
      const d = this.distance(ch, playerX, playerZ);
      if (!ch.group && drawDistance >= 0 && d < drawDistance + BUILD_MARGIN) wanted.push({ ch, d });
      else if (ch.group && d > drawDistance + FREE_MARGIN) this.free(ch);
    }
    wanted.sort((a, b) => a.d - b.d);
    for (const { ch } of wanted.slice(0, BUILDS_PER_FRAME)) this.build(ch);

    this.culler.begin(camera);
    let leaves = 0;
    let drawn = 0;
    let built = 0;
    let leavesBuilt = 0;
    const shown = this.visible;
    shown.length = 0;
    for (const ch of this.chunks) {
      if (!ch.group) continue;
      built++;
      leavesBuilt += ch.leafCount;
      const visible =
        drawDistance >= 0 &&
        this.culler.classify(ch, playerX, playerZ, drawDistance, occlusion) === ChunkState.Drawn;
      if (ch.group.visible !== visible) ch.group.visible = visible;
      if (visible) {
        leaves += this.applyLod(ch);
        drawn++;
        if (ch.leaves) shown.push(ch);
      }
    }
    if (shown.length !== this.packed.length || shown.some((ch, i) => ch !== this.packed[i])) this.pack(shown);
    this.leafMesh.userData.drawnInstances = leaves; // for the #debug triangle readout
    this.leavesDrawn = leaves;
    this.chunksDrawn = drawn;
    this.chunksBuilt = built;
    this.leavesBuilt = leavesBuilt;
  }

  /** Copy these chunks' leaves, back to back, into the shared leaf mesh. */
  private pack(chunks: Chunk[]) {
    const needed = chunks.reduce((n, ch) => n + ch.leaves!.count, 0);
    const capacity = (this.leafMesh.instanceMatrix.array as Float32Array).length / 16;
    if (needed > capacity) {
      // Grow (rare): a new mesh with room to spare.
      this.group.remove(this.leafMesh);
      this.leafMesh.geometry.dispose();
      this.leafMesh.dispose();
      this.leafMesh = sharedLeafMesh(this.card, this.materials.leaves, Math.max(needed, capacity * 2));
      this.group.add(this.leafMesh);
    }
    const mesh = this.leafMesh;
    const g = mesh.geometry;
    const targets: [THREE.InstancedBufferAttribute, keyof LeafData][] = [
      [mesh.instanceMatrix, "matrices"],
      [mesh.instanceColor!, "colors"],
      [g.getAttribute("leafCell") as THREE.InstancedBufferAttribute, "cells"],
      [g.getAttribute("leafOrigin") as THREE.InstancedBufferAttribute, "origins"],
      [g.getAttribute("leafRank") as THREE.InstancedBufferAttribute, "ranks"],
      [g.getAttribute("leafWall") as THREE.InstancedBufferAttribute, "walls"],
    ];
    let n = 0;
    for (const ch of chunks) {
      const data = ch.leaves!;
      for (const [attr, key] of targets) (attr.array as Float32Array).set(data[key] as Float32Array, n * attr.itemSize);
      n += data.count;
    }
    mesh.count = n;
    for (const [attr] of targets) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, Math.max(1, n) * attr.itemSize);
      attr.needsUpdate = true;
    }
    this.packed = chunks.slice();
  }

  dispose() {
    for (const ch of this.chunks) this.free(ch);
    this.leafMesh.geometry.dispose();
    this.leafMesh.dispose();
    this.card.dispose();
  }
}
