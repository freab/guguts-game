"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three/webgpu";
import BlobShadow from "../character/BlobShadow";
import { fitSkinnedModel } from "../character/fitSkinnedModel";
import { runStore } from "../game/runStore";
import { temesgen } from "../game/temesgen";
import { useDisposable } from "../hooks/useDisposable";
import { GOAT_URL, createGoatMaterial } from "./Goat";
import { clearingRadius, restingSpot } from "./mazeData";

/** The kid's height (m) — a little thing beside the 1 m goat. */
const KID_HEIGHT = 0.5;
/** Walking pace (m/s), its little bob (m, bounces/s), and how far it sinks lying down (m). */
const PACE = 0.7;
const BOB = 0.03;
const BOB_RATE = 4;
const LIE_DOWN = 0.12;
const LIE_SECONDS = 0.8;

/**
 * Where the kid comes from (the clearing's edge, a little round from him) and
 * where it settles (at Temesgen's side, facing the way he does).
 */
function kidPath() {
  const spot = restingSpot();
  const forward = new THREE.Vector2(Math.sin(spot.facing), Math.cos(spot.facing));
  const right = new THREE.Vector2(forward.y, -forward.x);
  const end = new THREE.Vector2(spot.x, spot.z).addScaledVector(right, 0.75).addScaledVector(forward, 0.15);
  const around = Math.atan2(end.y, end.x) + Math.PI / 4;
  const r = clearingRadius() * 0.85;
  const start = new THREE.Vector2(Math.cos(around) * r, Math.sin(around) * r);
  return { start, end, facing: spot.facing };
}

/** Walk the kid in and lie it down, by how long since it was called up (s). */
function placeKid(group: THREE.Group, path: ReturnType<typeof kidPath>, since: number) {
  const length = path.start.distanceTo(path.end);
  const walked = Math.min(length, since * PACE);
  const t = walked / length;
  const x = THREE.MathUtils.lerp(path.start.x, path.end.x, t);
  const z = THREE.MathUtils.lerp(path.start.y, path.end.y, t);
  const walking = walked < length;
  const lying = walking ? 0 : Math.min(1, (since - length / PACE) / LIE_SECONDS);
  const bob = walking ? Math.abs(Math.sin(since * BOB_RATE * Math.PI)) * BOB : 0;
  group.position.set(x, bob - LIE_DOWN * lying, z);
  // Facing its way while it walks, then turning to face out with him.
  const heading = Math.atan2(path.end.x - path.start.x, path.end.y - path.start.y);
  group.rotation.y = walking ? heading : THREE.MathUtils.lerp(heading, path.facing, lying);
}

/**
 * A secret: sit and listen to Temesgen until you\x27re calm without having
 * called the goat once, and a little kid goat wanders out of the grass and
 * settles at his side for the rest of the run. Out of sight until then.
 */
export default function KidGoat() {
  const { scene } = useGLTF(GOAT_URL);
  const kid = useDisposable(() => {
    const model = fitSkinnedModel(scene, KID_HEIGHT);
    let source: THREE.MeshStandardMaterial | null = null;
    model.animated.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !source) source = mesh.material as THREE.MeshStandardMaterial;
    });
    const material = createGoatMaterial(source!, { reveal: false });
    model.animated.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.material = material.material;
        mesh.name = "";
      }
    });
    return { root: model.root, advance: material.advance, dispose: material.dispose };
  }, [scene]);

  const path = useMemo(() => kidPath(), []);
  const group = useRef<THREE.Group>(null);
  /** performance.now() when it was called up (0 = not, this run). */
  const cameAt = useRef(0);

  // Calm, without a single call: the kid comes.
  useEffect(() => {
    let calmed = temesgen.get().calmed;
    return temesgen.subscribe(() => {
      const now = temesgen.get().calmed;
      if (now && !calmed && runStore.get().callsUsed === 0 && !cameAt.current) {
        cameAt.current = performance.now();
        runStore.notify("A little kid goat wanders out of the long grass and settles beside Temesgen.");
      }
      calmed = now;
    });
  }, []);

  useFrame((_, dt) => {
    kid.advance(Math.min(dt, 0.1));
    if (!group.current || !cameAt.current) return;
    placeKid(group.current, path, (performance.now() - cameAt.current) / 1000);
  });

  return (
    // Waiting under the ground until it comes (drawn there, so the loading
    // warm-up compiles it with everything else — no stutter when it appears).
    <group ref={group} name="Kid goat" position={[path.start.x, -10, path.start.y]}>
      <primitive object={kid.root} />
      <BlobShadow size={0.6} height={0.03} />
    </group>
  );
}
