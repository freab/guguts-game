import * as THREE from "three/webgpu";
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

interface Chunk extends CullableChunk {
  /** The wall faces in this chunk (grown only when the chunk is built). */
  faces: VineFace[];
  /** The chunk's meshes, once built (streamed in near the player). */
  group: THREE.Group | null;
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
 * wall normal gives each ring a stable frame without Frenet frames; a ring
 * every other growth step (7 cm apart) is plenty for these thin stems.
 */
function stemGeometry(stems: VineStem[]): THREE.BufferGeometry | null {
  if (stems.length === 0) return null;
  const plans = stems.map((stem) => ({
    stem,
    points: stem.points.filter((_, i) => i % 2 === 0 || i === stem.points.length - 1),
    radial: stem.r0 < 0.006 ? 3 : 4,
  }));
  let vertexCount = 0;
  let indexCount = 0;
  for (const { points, radial } of plans) {
    vertexCount += points.length * (radial + 1);
    indexCount += (points.length - 1) * radial * 6;
  }
  const position = new Float32Array(vertexCount * 3);
  const normal = new Float32Array(vertexCount * 3);
  const uv = new Float32Array(vertexCount * 2);
  const index = new Uint32Array(indexCount);

  let v = 0;
  let k = 0;
  for (const { stem, points, radial } of plans) {
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
      const r = THREE.MathUtils.lerp(stem.r0, stem.r1, i / (n - 1));
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        _dir.copy(_side).multiplyScalar(Math.cos(a)).addScaledVector(_up, Math.sin(a));
        position[v * 3] = p.x + _dir.x * r;
        position[v * 3 + 1] = p.y + _dir.y * r;
        position[v * 3 + 2] = p.z + _dir.z * r;
        normal[v * 3] = _dir.x;
        normal[v * 3 + 1] = _dir.y;
        normal[v * 3 + 2] = _dir.z;
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
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/** Instanced leaf cards: matrices from each leaf's basis, a tint and an atlas cell. */
function leafMesh(leaves: VineLeaf[], card: THREE.BufferGeometry, material: THREE.Material): THREE.InstancedMesh {
  const geometry = card.clone();
  const cells = new Float32Array(leaves.length);
  const mesh = new THREE.InstancedMesh(geometry, material, leaves.length);
  const m = new THREE.Matrix4();
  const tint = new THREE.Color();
  const x = new THREE.Vector3();
  const y = new THREE.Vector3();
  const z = new THREE.Vector3();
  leaves.forEach((leaf, i) => {
    m.makeBasis(
      x.copy(leaf.x).multiplyScalar(leaf.size),
      y.copy(leaf.y).multiplyScalar(leaf.size),
      z.copy(leaf.z).multiplyScalar(leaf.size)
    ).setPosition(leaf.position);
    mesh.setMatrixAt(i, m);
    // Slight per-leaf brightness (the hue comes from the grass palette).
    const age = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1);
    tint.setScalar(0.82 + 0.28 * age);
    mesh.setColorAt(i, tint);
    cells[i] = leaf.cell;
  });
  geometry.setAttribute("leafCell", new THREE.InstancedBufferAttribute(cells, 1));
  mesh.computeBoundingSphere();
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
  private readonly culler = new ChunkCuller(OCCLUSION_SAMPLE_Y);
  private readonly card = leafCardGeometry();
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
    const stems = stemGeometry(stemList);
    if (stems) {
      const mesh = new THREE.Mesh(stems, this.materials.stems);
      mesh.receiveShadow = true;
      group.add(mesh);
      ch.disposables.push(stems);
    }
    ch.leafCount = leafList.length;
    if (leafList.length > 0) {
      const leaves = leafMesh(leafList, this.card, this.materials.leaves);
      leaves.receiveShadow = true;
      group.add(leaves);
      ch.disposables.push(leaves, leaves.geometry);
    }
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
    for (const ch of this.chunks) {
      if (!ch.group) continue;
      built++;
      leavesBuilt += ch.leafCount;
      const visible =
        drawDistance >= 0 &&
        this.culler.classify(ch, playerX, playerZ, drawDistance, occlusion) === ChunkState.Drawn;
      if (ch.group.visible !== visible) ch.group.visible = visible;
      if (visible) {
        leaves += ch.leafCount;
        drawn++;
      }
    }
    this.leavesDrawn = leaves;
    this.chunksDrawn = drawn;
    this.chunksBuilt = built;
    this.leavesBuilt = leavesBuilt;
  }

  dispose() {
    for (const ch of this.chunks) this.free(ch);
    this.card.dispose();
  }
}
