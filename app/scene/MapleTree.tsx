"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useControls, folder } from "leva";
import * as THREE from "three/webgpu";
import { treeSeed } from "../maze/mazeData";
import { createMapleMaterials } from "./tree/mapleMaterials";
import { mapleTreeLayout, type MapleTreeLayout } from "./tree/mapleTree";
import { useDisposable } from "../hooks/useDisposable";
import {
  barkGeometry,
  canopyLeaves,
  fallenLeaves,
  fallingLeaves,
  mapleLeafGeometry,
  type LeafInstances,
} from "./tree/treeGeometry";

/** Leaves per (reference-size) cluster, leaves on the ground, leaves in the air. */
const LEAVES_PER_CLUSTER = 320;
const FALLEN_LEAVES = 2600;
const FALLING_LEAVES = 70;

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

/** The whole tree as one group of meshes (built once per maze). */
function buildTree(tree: MapleTreeLayout, mats: ReturnType<typeof createMapleMaterials>) {
  const leaf = mapleLeafGeometry();
  const bark = new THREE.Mesh(barkGeometry(tree), mats.bark);
  bark.castShadow = true;
  bark.receiveShadow = true;

  // The canopy casts into the (baked) sun shadow map: shade on the walls and
  // shafts of light through the crown in the god rays.
  const canopy = instanced(leaf, mats.leaves, canopyLeaves(tree, treeSeed, LEAVES_PER_CLUSTER), true);
  const ground = instanced(
    leaf,
    mats.fallen,
    fallenLeaves(tree, treeSeed, Math.round(FALLEN_LEAVES * tree.scale ** 2)),
    false
  );
  const falling = new THREE.Mesh(fallingLeaves(tree, treeSeed, FALLING_LEAVES), mats.falling);
  falling.frustumCulled = false; // the shader moves it around

  const group = new THREE.Group();
  group.add(bark, canopy, ground, falling);
  return {
    group,
    dispose() {
      leaf.dispose();
      bark.geometry.dispose();
      falling.geometry.dispose();
      canopy.dispose();
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
  useFrame(({ clock }) => {
    const g = swing.current;
    if (!g) return;
    const t = clock.elapsedTime;
    g.rotation.z = Math.sin(t * 1.3) * 0.05;
    g.rotation.x = Math.sin(t * 0.9 + 1) * 0.035;
  });
  const chain = 0.55;
  return (
    <group position={anchor} scale={scale}>
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
 * The autumn maple in the maze's central clearing: a procedural tree
 * (tree/mapleTree.ts) with a gnarled trunk, a red crown of instanced leaves,
 * a carpet of fallen leaves, leaves drifting down and a lantern hanging from
 * its long limb. It towers over the walls — a landmark to steer by.
 */
export default function MapleTree() {
  const { show, leafBrightness, wind, lanternGlow } = useControls("Game", {
    Tree: folder(
      {
        show: { value: true, label: "Show tree" },
        leafBrightness: { value: 1, min: 0.3, max: 2.5, step: 0.05, label: "Leaf brightness" },
        wind: { value: 1, min: 0, max: 3, step: 0.1, label: "Wind" },
        lanternGlow: { value: 2.2, min: 0, max: 6, step: 0.1, label: "Lantern glow" },
      },
      { collapsed: true }
    ),
  });

  const tree = useMemo(() => mapleTreeLayout(), []);
  const mats = useDisposable(() => createMapleMaterials(tree), [tree]);
  const built = useDisposable(() => buildTree(tree, mats), [tree, mats]);

  useEffect(() => {
    mats.setLook({ leafBrightness, wind, lanternGlow });
  }, [mats, leafBrightness, wind, lanternGlow]);

  useFrame((_, delta) => mats.advance(delta));

  if (!show) return null;
  return (
    <>
      <primitive object={built.group} />
      <Lantern anchor={tree.lanternAnchor} scale={tree.scale} mats={mats} />
    </>
  );
}
