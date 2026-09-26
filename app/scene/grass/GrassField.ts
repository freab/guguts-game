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

/** Tuft node names in grassLODs.glb, high -> low detail (132 / 64 / 32 verts). */
export const LOD_NAMES = ["LOD00", "LOD01", "LOD02"] as const;
/** Hard cap on tufts, whatever the maze size or density. */
const MAX_TUFTS = 80000;
/** Auto-LOD distances (camera to chunk edge, world units). */
const LOD_NEAR = 20;
const LOD_FAR = 45;
/** Keep blade bases this far from wall faces. */
const WALL_MARGIN = 0.08;

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

    const chunkSize = Math.max(8, Math.max(w, d) / 6);
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
        mesh.visible = false; // updateLod() picks one per chunk
        this.group.add(mesh);
        return mesh;
      });
      this.chunks.push({ center, half: chunkSize / 2, meshes });
    });
  }

  /** Show one LOD per chunk: forced (0-2), or by camera distance when -1. */
  updateLod(cameraPosition: THREE.Vector3, forced: number) {
    for (const ch of this.chunks) {
      let want = forced;
      if (want < 0) {
        const dist = Math.max(0, cameraPosition.distanceTo(ch.center) - ch.half);
        want = dist < LOD_NEAR ? 0 : dist < LOD_FAR ? 1 : 2;
      }
      for (let i = 0; i < ch.meshes.length; i++) {
        const visible = i === want;
        if (ch.meshes[i].visible !== visible) ch.meshes[i].visible = visible;
      }
    }
  }

  setReceiveShadow(on: boolean) {
    for (const ch of this.chunks) for (const m of ch.meshes) m.receiveShadow = on;
  }

  dispose() {
    for (const ch of this.chunks) for (const m of ch.meshes) m.dispose();
  }
}
