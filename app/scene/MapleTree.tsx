"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useControls, folder, monitor } from "leva";
import * as THREE from "three/webgpu";
import { treeSeed } from "../maze/mazeData";
import { playerStore } from "../character/playerStore";
import { useDisposable } from "../hooks/useDisposable";
import { useLeafAtlas, usePbrSet } from "./textures/pbrTextures";
import { useLoading } from "./bake/loadingStore";
import { createMapleMaterials } from "./tree/mapleMaterials";
import { mapleTreeLayout, type MapleTreeLayout } from "./tree/mapleTree";
import { TreeCuller, type CanopySectorMesh } from "./tree/TreeCuller";
import {
  barkGeometry,
  canopySectors,
  fallenLeafArea,
  fallenLeaves,
  fallingLeaves,
  mapleLeafGeometry,
  type LeafInstances,
} from "./tree/treeGeometry";

/** Leaves per (reference-size) cluster, leaves on the ground, leaves in the air. */
const LEAVES_PER_CLUSTER = 320;
const FALLEN_LEAVES = 2600;
const FALLING_LEAVES = 70;
/** Crown sectors (wedges around the trunk), each frustum-culled on its own. */
const CANOPY_SECTORS = 8;

/** Written every frame, read by the leva monitors. */
const stats = { leaves: "", tree: "" };

/** An instanced mesh over prebuilt matrices + colours. */
function instanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  leaves: LeafInstances,
  castShadow: boolean
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, leaves.count);
  mesh.instanceMatrix = new THREE.InstancedBufferAttribute(leaves.matrices, 16);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(leaves.colors, 3);
  mesh.computeBoundingSphere();
  mesh.castShadow = castShadow;
  return mesh;
}

/**
 * The whole tree, built once per maze: `tree` (bark, crown sectors, falling
 * leaves; the lantern is added as a child) and the fallen-leaf carpet beside
 * it under `root`, plus the culler that drives them.
 */
function buildTree(layout: MapleTreeLayout, mats: ReturnType<typeof createMapleMaterials>) {
  const leaf = mapleLeafGeometry();
  const bark = new THREE.Mesh(barkGeometry(layout), mats.bark);
  bark.castShadow = true;
  bark.receiveShadow = true;

  // The crown, in sectors. It casts into the (baked) sun shadow map: shade on
  // the walls and shafts of light through it in the god rays. Each sector's
  // leaf geometry carries its leaves' centres, for the distance-LOD scale-up.
  const sectorGeometries: THREE.BufferGeometry[] = [];
  const sectors: CanopySectorMesh[] = canopySectors(layout, treeSeed, LEAVES_PER_CLUSTER, CANOPY_SECTORS).map(
    (sector) => {
      const geometry = leaf.clone();
      geometry.setAttribute("leafOrigin", new THREE.InstancedBufferAttribute(sector.origins, 3));
      geometry.setAttribute("leafCell", new THREE.InstancedBufferAttribute(sector.cells, 1));
      sectorGeometries.push(geometry);
      return { mesh: instanced(geometry, mats.leaves, sector, true), total: sector.count };
    }
  );

  const area = fallenLeafArea(layout);
  const litter = fallenLeaves(layout, treeSeed, Math.round(FALLEN_LEAVES * layout.scale ** 2));
  const groundGeometry = leaf.clone();
  groundGeometry.setAttribute("leafCell", new THREE.InstancedBufferAttribute(litter.cells, 1));
  const ground = instanced(groundGeometry, mats.fallen, litter, false);

  // Falling leaves: the shader moves them, so bound their whole fall by hand.
  const fallingGeometry = fallingLeaves(layout, treeSeed, FALLING_LEAVES);
  fallingGeometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(layout.canopyCenter.x, layout.canopyTop / 2, layout.canopyCenter.z),
    Math.hypot(layout.canopySpread + 3, layout.canopyTop / 2 + 1)
  );
  const falling = new THREE.Mesh(fallingGeometry, mats.falling);

  const tree = new THREE.Group();
  tree.add(bark, falling, ...sectors.map((s) => s.mesh));
  const root = new THREE.Group();
  root.add(tree, ground);

  return {
    root,
    tree,
    culler: new TreeCuller(layout, tree, sectors, ground, area.center, area.radius),
    dispose() {
      leaf.dispose();
      for (const g of sectorGeometries) g.dispose();
      groundGeometry.dispose();
      bark.geometry.dispose();
      fallingGeometry.dispose();
      for (const s of sectors) s.mesh.dispose();
      ground.dispose();
    },
  };
}

/** A small hanging lantern: chain, roof, frame posts and glowing panes. */
function Lantern({
  anchor,
  scale,
  mats,
}: {
  anchor: THREE.Vector3;
  scale: number;
  mats: ReturnType<typeof createMapleMaterials>;
}) {
  const swing = useRef<THREE.Group>(null);
  const hang = useRef<THREE.Group>(null);
  const offset = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }) => {
    const g = swing.current;
    const h = hang.current;
    if (!g || !h) return;
    const t = clock.elapsedTime;
    g.rotation.z = Math.sin(t * 1.3) * 0.05;
    g.rotation.x = Math.sin(t * 0.9 + 1) * 0.035;
    // Ride the limb it hangs from as the tree sways.
    h.position.copy(anchor).add(mats.swayAt(anchor, offset));
  });
  const chain = 0.55;
  return (
    <group ref={hang} position={anchor} scale={scale}>
      <group ref={swing}>
        <mesh position={[0, -chain / 2, 0]} material={mats.lanternFrame}>
          <cylinderGeometry args={[0.012, 0.012, chain, 5]} />
        </mesh>
        <group position={[0, -chain - 0.22, 0]}>
          {/* Roof */}
          <mesh position={[0, 0.22, 0]} rotation={[0, Math.PI / 4, 0]} material={mats.lanternFrame} castShadow>
            <coneGeometry args={[0.24, 0.14, 4]} />
          </mesh>
          {/* Glowing core */}
          <mesh material={mats.lanternGlow}>
            <boxGeometry args={[0.2, 0.3, 0.2]} />
          </mesh>
          {/* Corner posts + base */}
          {[
            [1, 1],
            [1, -1],
            [-1, 1],
            [-1, -1],
          ].map(([sx, sz]) => (
            <mesh key={`${sx}${sz}`} position={[sx * 0.11, 0, sz * 0.11]} material={mats.lanternFrame}>
              <boxGeometry args={[0.03, 0.34, 0.03]} />
            </mesh>
          ))}
          <mesh position={[0, -0.17, 0]} material={mats.lanternFrame}>
            <boxGeometry args={[0.26, 0.03, 0.26]} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

/**
 * The summer maple in the maze's central clearing: a procedural tree
 * (tree/mapleTree.ts) with a gnarled trunk, a green crown of instanced leaves,
 * a carpet of fallen leaves, leaves drifting down and a lantern hanging from
 * its long limb. It towers over the walls — a landmark to steer by.
 */
export default function MapleTree({
  viewDistance,
}: {
  /** The scene's view distance: the tree shows only once you are this close to its crown. */
  viewDistance: number;
}) {
  const { show, leafBrightness, wind, lanternGlow, culling, occlusion, lodNear, lodMin, groundDistance } =
    useControls("Game", {
      Tree: folder(
        {
          show: { value: true, label: "Show tree" },
          leafBrightness: { value: 1, min: 0.3, max: 2.5, step: 0.05, label: "Leaf brightness" },
          wind: { value: 1, min: 0, max: 3, step: 0.1, label: "Wind" },
          lanternGlow: { value: 2.2, min: 0, max: 6, step: 0.1, label: "Lantern glow" },
          culling: { value: true, label: "Culling + LOD" },
          occlusion: { value: true, label: "Occlusion culling" },
          lodNear: { value: 16, min: 4, max: 80, step: 1, label: "Full detail within" },
          lodMin: { value: 0.2, min: 0.05, max: 1, step: 0.05, label: "Fewest leaves" },
          groundDistance: { value: 30, min: 5, max: 100, step: 1, label: "Fallen leaves dist." },
          Leaves: monitor(() => stats.leaves, { graph: false, interval: 300 }),
          Visible: monitor(() => stats.tree, { graph: false, interval: 300 }),
        },
        { collapsed: true }
      ),
    });
  // Cull only once loading is done: the one-off shadow-map bake and shader
  // compile must see the whole tree.
  const ready = useLoading().stage === "ready";

  const tree = useMemo(() => mapleTreeLayout(), []);
  const bark = usePbrSet("bark");
  const leafAtlas = useLeafAtlas();
  const mats = useDisposable(() => createMapleMaterials(tree, { bark, leaves: leafAtlas }), [tree, bark, leafAtlas]);
  const built = useDisposable(() => buildTree(tree, mats), [tree, mats]);

  useEffect(() => {
    mats.setLook({ leafBrightness, wind, lanternGlow });
  }, [mats, leafBrightness, wind, lanternGlow]);

  const lod = useMemo(
    () => ({ near: lodNear, min: lodMin, enabled: culling && ready }),
    [lodNear, lodMin, culling, ready]
  );
  useEffect(() => mats.setLod(lod), [mats, lod]);

  useFrame(({ camera }, delta) => {
    mats.advance(delta);
    const { x, z } = playerStore;
    built.culler.update(camera, x, z, lod.enabled, occlusion, lod, viewDistance, Math.min(groundDistance, viewDistance));
    const s = built.culler.stats;
    stats.leaves = `${s.leavesDrawn} / ${s.leavesTotal} · ${s.sectorsDrawn} sectors`;
    stats.tree = `tree ${s.treeVisible ? "drawn" : "hidden"} · ground ${s.groundVisible ? "drawn" : "hidden"}`;
  });

  if (!show) return null;
  return (
    <primitive object={built.root}>
      {/* Inside the tree group, so it hides with the tree. */}
      <primitive object={built.tree}>
        <Lantern anchor={tree.lanternAnchor} scale={tree.scale} mats={mats} />
      </primitive>
    </primitive>
  );
}
