"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three/webgpu";
import BlobShadow from "../character/BlobShadow";
import { fitSkinnedModel } from "../character/fitSkinnedModel";
import { exitPosition } from "./mazeData";

/**
 * Animated goat — Gobkit Free Animal Pack Vol. 2, CC0 (public domain):
 * https://gobkit.itch.io/gobkit-free-animal-pack-vol-2
 * Separate clips: idle / walk / attack / dead. Authored facing +Z.
 */
const GOAT_URL = "/models/Goat.glb";
/** Standing height (top of the horns), metres. */
const GOAT_HEIGHT = 1.0;

/** Plays the goat's idle loop, offset so it doesn't look canned. */
class GoatAnimator {
  private readonly mixer: THREE.AnimationMixer;

  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(root);
    const idle = clips.find((c) => /idle/i.test(c.name)) ?? clips[0];
    if (idle) {
      const action = this.mixer.clipAction(idle).play();
      action.time = Math.random() * idle.duration;
    }
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }
}

/**
 * Gugut's runaway goat, waiting on the exit tile at the far end of the maze —
 * the thing you're looking for. It faces back into the maze, towards you.
 */
export default function Goat() {
  const { scene, animations } = useGLTF(GOAT_URL);
  const goat = useMemo(() => fitSkinnedModel(scene, GOAT_HEIGHT), [scene]);
  const animator = useMemo(() => new GoatAnimator(goat.animated, animations), [goat, animations]);
  useEffect(() => () => animator.dispose(), [animator]);

  useFrame((_, dt) => animator.update(Math.min(dt, 0.1)));

  const [x, z] = exitPosition();
  // Model faces +Z; turn it to look at the maze centre (the origin).
  const facing = Math.atan2(-x, -z);

  return (
    <group position={[x, 0, z]} rotation={[0, facing, 0]}>
      <primitive object={goat.root} />
      {/* Above the exit marker (y = 0.03) so the marker doesn't cover it. */}
      <BlobShadow size={1.1} height={0.035} />
    </group>
  );
}

useGLTF.preload(GOAT_URL);
