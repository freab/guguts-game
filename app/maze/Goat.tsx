"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three/webgpu";
import { float, materialColor, mix, positionLocal, rotate, sin, smoothstep, uniform, vec3 } from "three/tsl";
import BlobShadow from "../character/BlobShadow";
import { fitSkinnedModel } from "../character/fitSkinnedModel";
import { useDisposable } from "../hooks/useDisposable";
import { revealRim } from "./GoatReveal";
import { goat } from "../game/goat";
import { goldenGoat } from "../game/goldenGoat";
import { sceneLayers } from "../scene/sceneLayers";

/**
 * The goat: one static, textured mesh (no rig, no clips), authored facing +Z
 * in a unit box — body along Z (tail at -0.5, snout at +0.5), feet at
 * y ≈ -0.47, head top at y ≈ +0.47, front legs around z ≈ 0, hind legs
 * around z ≈ -0.45. The regions below are in those model units.
 */
export const GOAT_URL = "/models/goatnew.glb";
/** Standing height (top of the head), metres. */
const GOAT_HEIGHT = 1.0;

/** The golden goat's coat (multiplies her texture). */
const GOLD_FUR = new THREE.Color("#f5cf6a");

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
export function createGoatMaterial(
  source: THREE.MeshStandardMaterial,
  { reveal = true, golden = false }: { reveal?: boolean; golden?: boolean } = {}
) {
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
  // Lit warm once she's been seen (maze/GoatReveal) — not the kid (maze/KidGoat).
  // The rare golden goat (game/goldenGoat): gold fur, glittering as she
  // breathes — by `gold` (0..1: all or nothing in the game; the presentation
  // turns her golden in front of you, app/present).
  const gold = uniform(golden ? 1 : 0);
  const glitter = sin(time.mul(2.3).add(positionLocal.x.mul(41)).add(positionLocal.y.mul(37)).add(positionLocal.z.mul(29)))
    .mul(0.5)
    .add(0.5)
    .pow(8);
  const goldGlow = vec3(1, 0.78, 0.32).mul(glitter.mul(1.6).add(0.12)).mul(gold);
  material.colorNode = materialColor.rgb.mul(mix(vec3(1, 1, 1), vec3(GOLD_FUR.r, GOLD_FUR.g, GOLD_FUR.b), gold));
  material.emissiveNode = reveal ? revealRim().add(goldGlow) : goldGlow;
  return {
    material,
    advance: (dt: number) => void (time.value += dt),
    /** Towards golden (1) or not (0), over about half a second. */
    turnGold: (target: number, dt: number) => void (gold.value += (target - gold.value) * Math.min(1, dt * 4)),
    dispose: () => material.dispose(),
  };
}

/** Trot bob (m) and its rate (bounces/s) while she runs. */
const TROT_BOB = 0.05;
const TROT_RATE = 5.5;

/** Dancing (game/goat): hops (m) and their rate (per s), a swing from side to side (radians) and a rock. */
const DANCE_HOP = 0.14;
const DANCE_RATE = 2.4;
const DANCE_SWING = 0.45;
const DANCE_ROCK = 0.1;

/** Put her where she is now, facing her way, bobbing as she trots, hopping as she dances (model faces +Z). */
function placeGoat(group: THREE.Group) {
  const [x, z] = goat.position();
  const t = performance.now() / 1000;
  const bob = goat.moving() ? Math.abs(Math.sin(t * TROT_RATE * Math.PI)) * TROT_BOB : 0;
  const d = goat.dance();
  const beat = t * DANCE_RATE * Math.PI;
  group.position.set(x, bob + Math.abs(Math.sin(beat)) * DANCE_HOP * d, z);
  group.rotation.set(0, goat.facing() + Math.sin(beat / 2) * DANCE_SWING * d, Math.sin(beat) * DANCE_ROCK * d);
}

/**
 * Gugut's runaway goat, waiting on the exit tile at the far end of the maze —
 * the thing you're looking for — facing back into the maze, towards you. On
 * Hard she runs when called (game/goat): she trots, turning her way.
 */
export default function Goat() {
  const { scene } = useGLTF(GOAT_URL);
  // Her copy of the scan and its breathing material, made together: in
  // development React runs this twice (StrictMode) and keeps the first, so
  // the material whose clock is advanced must be the one on the mesh that's
  // drawn — built apart, the second run's material ends up on it, frozen.
  const life = useDisposable(() => {
    const goat = fitSkinnedModel(scene, GOAT_HEIGHT);
    let source: THREE.MeshStandardMaterial | null = null;
    goat.animated.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !source) source = mesh.material as THREE.MeshStandardMaterial;
    });
    const golden = goldenGoat();
    const goatMaterial = createGoatMaterial(source!, { golden });
    goat.animated.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.material = goatMaterial.material;
        mesh.name = ""; // (counted under "Goat" in the #debug readout)
      }
    });
    return { root: goat.root, golden, turnGold: goatMaterial.turnGold, advance: goatMaterial.advance, dispose: goatMaterial.dispose };
  }, [scene]);

  // Where she is (game/goat): her tile by the bush, a new maze each mount —
  // set while rendering, so everything mounted with her reads the right spot.
  useMemo(() => goat.reset(), []);
  const group = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    life.advance(Math.min(dt, 0.1));
    // Golden in this maze, or shown golden by the presentation: turning gold over half a second.
    life.turnGold(life.golden || sceneLayers.debug().golden ? 1 : 0, dt);
    goat.update(dt);
    if (group.current) placeGoat(group.current);
  });

  const [x, z] = goat.position();
  return (
    <group ref={group} name="Goat" position={[x, 0, z]} rotation={[0, goat.facing(), 0]}>
      <primitive object={life.root} />
      <BlobShadow size={1.1} height={0.035} />
    </group>
  );
}

useGLTF.preload(GOAT_URL);
