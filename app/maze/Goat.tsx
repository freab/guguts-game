"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three/webgpu";
import BlobShadow from "../character/BlobShadow";
import { fitSkinnedModel } from "../character/fitSkinnedModel";
import { exitPosition } from "./mazeData";
import { useDisposable } from "../hooks/useDisposable";

/**
 * Animated goat — Gobkit Free Animal Pack Vol. 2, CC0 (public domain):
 * https://gobkit.itch.io/gobkit-free-animal-pack-vol-2
 * Separate clips: idle / walk / attack / dead. Authored facing +Z.
 */
const GOAT_URL = "/models/Goat.glb";
/** Standing height (top of the horns), metres. */
const GOAT_HEIGHT = 1.0;

/** Seconds per idle cycle: look around, graze, look around again. */
const GRAZE_PERIOD = 9;

const _parentQ = new THREE.Quaternion();
const _offset = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/** 0 → 1 → 0 over [start, end], easing in and out over `edge` seconds. */
function bump(t: number, start: number, end: number, edge: number): number {
  const s = THREE.MathUtils.smoothstep(t, start, start + edge);
  return s * (1 - THREE.MathUtils.smoothstep(t, end - edge, end));
}

/**
 * The goat's idle loop. The pack's idle clip is only a slight breathing bob
 * (≈3° of motion), so a procedural layer goes on top of it every frame: she
 * looks around, bows to graze and chew, wags her tail in bursts and flicks her
 * ears. It's a chibi rig — the face (mouth, eyes, ears) sits on the round body
 * ("Spine") and "Head" is just the tuft on top — so turning and bowing happen
 * at the spine. Everything is offset per goat so it doesn't look canned.
 */
class GoatAnimator {
  private readonly mixer: THREE.AnimationMixer;
  private readonly bones: Partial<Record<"spine" | "tuft" | "mouth" | "tail" | "leftEar" | "rightEar", THREE.Object3D>>;
  private time = Math.random() * 100;

  constructor(
    root: THREE.Object3D,
    clips: THREE.AnimationClip[],
    /** The model's frame (+Z forward, +Y up); the procedural axes live in it. */
    private readonly frame: THREE.Object3D
  ) {
    this.mixer = new THREE.AnimationMixer(root);
    const idle = clips.find((c) => /idle/i.test(c.name)) ?? clips[0];
    if (idle) {
      const action = this.mixer.clipAction(idle).setLoop(THREE.LoopRepeat, Infinity).play();
      action.timeScale = 0.7; // slower, calmer breathing
      action.time = Math.random() * idle.duration;
    }
    this.bones = {
      spine: root.getObjectByName("Spine"),
      tuft: root.getObjectByName("Head"),
      mouth: root.getObjectByName("Mouth"),
      tail: root.getObjectByName("Tail"),
      leftEar: root.getObjectByName("LeftEar"),
      rightEar: root.getObjectByName("RightEar"),
    };
  }

  update(dt: number): void {
    // The clip rewrites every animated bone's pose, so offsets never pile up.
    this.mixer.update(dt);
    this.time += dt;
    const t = this.time;
    const { spine, tuft, mouth, tail, leftEar, rightEar } = this.bones;

    // Graze: every cycle she bows forward for a few seconds and chews.
    const cycle = t % GRAZE_PERIOD;
    const graze = bump(cycle, 5, 8.2, 0.7);
    // Look around (slow, layered sines) — less while grazing.
    const look = (Math.sin(t * 0.41) + 0.5 * Math.sin(t * 0.93 + 1.7)) * 0.35 * (1 - graze);
    this.rotate(spine, Y_AXIS, look);
    this.rotate(spine, X_AXIS, graze * 0.38);
    this.rotate(mouth, X_AXIS, graze * Math.max(0, Math.sin(t * 11)) * 0.25);
    // The tuft lags the body a little.
    this.rotate(tuft, Z_AXIS, Math.sin(t * 1.9) * 0.08 - look * 0.3);

    // Tail: quick wagging bursts.
    const wag = bump((t + 1.3) % 4.3, 0, 1.3, 0.25);
    this.rotate(tail, Y_AXIS, wag * Math.sin(t * 20) * 0.45);

    // Ears: short independent flicks.
    this.rotate(leftEar, Z_AXIS, bump((t + 0.4) % 3.7, 0, 0.35, 0.12) * 0.5);
    this.rotate(rightEar, Z_AXIS, -bump((t + 2.1) % 5.3, 0, 0.35, 0.12) * 0.5);
  }

  /** Rotate a bone by `angle` about an axis given in the model's frame. */
  private rotate(bone: THREE.Object3D | undefined, axis: THREE.Vector3, angle: number): void {
    if (!bone?.parent || angle === 0) return;
    // Axis in model space -> world space -> the bone's parent space.
    this.frame.getWorldQuaternion(_offset);
    _axis.copy(axis).applyQuaternion(_offset);
    bone.parent.getWorldQuaternion(_parentQ);
    _axis.applyQuaternion(_parentQ.invert()).normalize();
    bone.quaternion.premultiply(_offset.setFromAxisAngle(_axis, angle));
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
  const animator = useDisposable(
    () => new GoatAnimator(goat.animated, animations, goat.root),
    [goat, animations]
  );

  useFrame((_, dt) => animator.update(Math.min(dt, 0.1)));

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
