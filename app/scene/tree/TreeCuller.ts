import * as THREE from "three/webgpu";
import { ChunkCuller, type CullableChunk } from "../grass/ChunkCuller";
import { ChunkState } from "../grass/grassMapStore";
import { leafLodFraction, type LeafLod } from "./mapleMaterials";
import type { MapleTreeLayout } from "./mapleTree";

/** One crown sector: its instanced mesh and how many leaves it holds. */
export interface CanopySectorMesh {
  mesh: THREE.InstancedMesh;
  total: number;
}

export interface TreeCullStats {
  leavesDrawn: number;
  leavesTotal: number;
  sectorsDrawn: number;
  treeVisible: boolean;
  groundVisible: boolean;
}

const _frustum = new THREE.Frustum();
const _viewProjection = new THREE.Matrix4();

/**
 * Per-frame culling and LOD for the maple, cheapest wins first:
 * 1. Occlusion — the whole tree (bark, crown, lantern, falling leaves) hides
 *    when walls block every line of sight to the top of its crown. Sight to a
 *    lower point at the same spot is only ever more blocked, so testing the
 *    top is conservative. From most corridors the crown is behind a wall.
 * 2. Frustum — each crown sector is its own instanced mesh with tight bounds,
 *    so three.js skips the sectors outside the view (standing in the clearing
 *    looking up, most of them).
 * 3. Distance LOD — visible sectors draw only a prefix of their (shuffled)
 *    leaves as they get further away; the shader scales those up to match.
 * The fallen-leaf carpet is culled on its own at ground level: hidden from
 * nearly everywhere outside the clearing.
 */
export class TreeCuller {
  private readonly crownCuller: ChunkCuller;
  private readonly groundCuller = new ChunkCuller(0.2);
  private readonly crown: CullableChunk;
  private readonly ground: CullableChunk;
  readonly stats: TreeCullStats;

  constructor(
    layout: MapleTreeLayout,
    private readonly tree: THREE.Object3D,
    private readonly sectors: CanopySectorMesh[],
    private readonly groundMesh: THREE.Object3D,
    groundCenter: THREE.Vector3,
    groundRadius: number
  ) {
    this.crownCuller = new ChunkCuller(layout.canopyTop - 0.3);
    const crownCenter = layout.canopyCenter.clone();
    this.crown = {
      center: crownCenter,
      half: layout.canopySpread,
      sphere: new THREE.Sphere(crownCenter.clone(), layout.canopyRadius + 1),
      lastSeen: -Infinity,
    };
    this.ground = {
      center: groundCenter.clone(),
      half: groundRadius,
      sphere: new THREE.Sphere(groundCenter.clone(), groundRadius * Math.SQRT2 + 0.5),
      lastSeen: -Infinity,
    };
    const leavesTotal = sectors.reduce((n, s) => n + s.total, 0);
    this.stats = { leavesDrawn: leavesTotal, leavesTotal, sectorsDrawn: sectors.length, treeVisible: true, groundVisible: true };
  }

  /**
   * `enabled` false (while loading): draw everything at full detail, so the
   * one-off shadow-map bake and shader compile see the whole tree.
   */
  update(
    camera: THREE.Camera,
    playerX: number,
    playerZ: number,
    enabled: boolean,
    occlusion: boolean,
    lod: LeafLod,
    groundDistance: number
  ) {
    const s = this.stats;
    if (!enabled) {
      this.setVisible(this.tree, true);
      this.setVisible(this.groundMesh, true);
      for (const sector of this.sectors) sector.mesh.count = sector.total;
      s.treeVisible = s.groundVisible = true;
      s.leavesDrawn = s.leavesTotal;
      s.sectorsDrawn = this.sectors.length;
      return;
    }

    this.crownCuller.begin(camera);
    s.treeVisible =
      this.crownCuller.classify(this.crown, playerX, playerZ, Infinity, occlusion) === ChunkState.Drawn;
    this.setVisible(this.tree, s.treeVisible);

    this.groundCuller.begin(camera);
    s.groundVisible =
      this.groundCuller.classify(this.ground, playerX, playerZ, groundDistance, occlusion) === ChunkState.Drawn;
    this.setVisible(this.groundMesh, s.groundVisible);

    s.leavesDrawn = 0;
    s.sectorsDrawn = 0;
    if (!s.treeVisible) return;

    _viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_viewProjection, camera.coordinateSystem);
    const eye = camera.position;
    for (const { mesh, total } of this.sectors) {
      const sphere = mesh.boundingSphere!;
      if (!_frustum.intersectsSphere(sphere)) continue; // three.js skips it too
      const d = Math.max(0, eye.distanceTo(sphere.center) - sphere.radius * 0.5);
      const count = Math.max(1, Math.ceil(total * leafLodFraction(lod, d)));
      if (mesh.count !== count) mesh.count = count;
      s.leavesDrawn += count;
      s.sectorsDrawn++;
    }
  }

  private setVisible(object: THREE.Object3D, visible: boolean) {
    if (object.visible !== visible) object.visible = visible;
  }
}
