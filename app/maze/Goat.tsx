"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three/webgpu";
import { float, positionLocal, rotate, sin, smoothstep, uniform, vec3 } from "three/tsl";
import BlobShadow from "../character/BlobShadow";
import { fitSkinnedModel } from "../character/fitSkinnedModel";
import { exitPosition } from "./mazeData";
import { useDisposable } from "../hooks/useDisposable";

/**
 * The goat: one static, textured mesh (no rig, no clips), authored facing +Z
 * in a unit box — body along Z (tail at -0.5, snout at +0.5), feet at
 * y ≈ -0.47, head top at y ≈ +0.47, front legs around z ≈ 0, hind legs
 * around z ≈ -0.45. The regions below are in those model units.
 */
const GOAT_URL = "/models/goatnew.glb";
/** Standing height (top of the head), metres. */
const GOAT_HEIGHT = 1.0;

/** Seconds per breath: a calm, resting goat. */
const BREATH_PERIOD = 3.4;
/** How much the barrel swells on the in-breath (fraction of its radius). */
const BREATH_SWELL = 0.035;
/** Where the neck bends from, for the head's slow look-around and nod. */
const NECK = new THREE.Vector3(0, 0.1, 0.12);

/**
 * The goat's material with life in the vertex shader — no skeleton needed:
 * - breathing: the barrel (between the legs, above them) swells and settles,
 *   the belly a little more than the back, with a slight pause after each
 *   out-breath; legs, head and rump stay put;
 * - the head and neck turn slowly to look around and nod faintly with each
 *   breath, bending smoothly from the neck.
 * Each goat gets its own phase so they don't breathe in step.
 */
function createGoatMaterial(source: THREE.MeshStandardMaterial) {
  const time = uniform(Math.random() * 100);
  const material = new THREE.MeshStandardNodeMaterial();
  material.map = source.map;
  material.color.copy(source.color);
  material.roughnessMap = source.roughnessMap;
  material.metalnessMap = source.metalnessMap;
  material.roughness = source.roughness;
  material.metalness = source.metalness;
  material.normalMap = source.normalMap;

  const p = positionLocal;
  // Breath: 0 → 1 → 0, eased, with a short rest at the bottom.
  const phase = time.mul((2 * Math.PI) / BREATH_PERIOD);
  const breath = smoothstep(-0.6, 1, sin(phase));
  // The barrel: along the body between the haunch and the shoulder, above the
  // legs and below the neck.
  const barrel = smoothstep(-0.46, -0.3, p.z)
    .mul(smoothstep(0.2, 0.04, p.z))
    .mul(smoothstep(-0.3, -0.14, p.y))
    .mul(smoothstep(0.3, 0.16, p.y));
  // Out from the body's long axis; the belly drops a little more.
  const belly = smoothstep(0.05, -0.15, p.y).mul(0.6).add(1);
  const swell = vec3(p.x, p.y.mul(belly), 0).mul(breath.mul(barrel).mul(BREATH_SWELL));

  // Head: a slow wandering look (layered sines), and a faint nod on each breath.
  const headWeight = smoothstep(0.08, 0.26, p.z).mul(smoothstep(-0.02, 0.14, p.y));
  const look = sin(time.mul(0.31)).add(sin(time.mul(0.73).add(1.7)).mul(0.5)).mul(0.11);
  const nod = breath.mul(0.025).add(sin(time.mul(0.23).add(0.4)).mul(0.04));
  const neck = vec3(NECK.x, NECK.y, NECK.z);
  const turned = rotate(p.sub(neck), vec3(nod.mul(headWeight), look.mul(headWeight), float(0))).add(neck);

  material.positionNode = turned.add(swell);
  return {
    material,
    advance: (dt: number) => void (time.value += dt),
    dispose: () => material.dispose(),
  };
}

/**
 * Gugut's runaway goat, waiting on the exit tile at the far end of the maze —
 * the thing you're looking for. It faces back into the maze, towards you.
 */
export default function Goat() {
  const { scene } = useGLTF(GOAT_URL);
  const goat = useMemo(() => fitSkinnedModel(scene, GOAT_HEIGHT), [scene]);
  const life = useDisposable(() => {
    let source: THREE.MeshStandardMaterial | null = null;
    goat.animated.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !source) source = mesh.material as THREE.MeshStandardMaterial;
    });
    const goatMaterial = createGoatMaterial(source!);
    goat.animated.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.material = goatMaterial.material;
        mesh.name = ""; // (counted under "Goat" in the #debug readout)
      }
    });
    return goatMaterial;
  }, [goat]);

  useFrame((_, dt) => life.advance(Math.min(dt, 0.1)));

  const [x, z] = exitPosition();
  // Model faces +Z; turn it to look at the maze centre (the origin).
  const facing = Math.atan2(-x, -z);

  return (
    <group name="Goat" position={[x, 0, z]} rotation={[0, facing, 0]}>
      <primitive object={goat.root} />
      <BlobShadow size={1.1} height={0.035} />
    </group>
  );
}

useGLTF.preload(GOAT_URL);
