"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three/webgpu";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { CHARACTER_HEIGHT, MODEL_URL, RUN_CLIP_SPEED, WALK_CLIP_SPEED } from "./config";

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * Clone the rigged model (own skeleton), make it cast/receive shadows, and fit
 * it: uniformly scaled to CHARACTER_HEIGHT with its feet on y = 0, measured
 * from its actual bounds rather than hard-coded numbers.
 */
function prepareModel(source: THREE.Object3D) {
  const animated = cloneSkinned(source);
  animated.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      // The sun's shadow map is baked (walls only); a moving character baked
      // into it would leave a frozen "ghost" shadow — it uses BlobShadow instead.
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false; // skinned bounds don't follow the animation
    }
  });

  const fit = new THREE.Group();
  fit.add(animated);
  fit.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(fit);
  const scale = CHARACTER_HEIGHT / Math.max(box.max.y - box.min.y, 1e-3);
  fit.scale.setScalar(scale);
  fit.position.y = -box.min.y * scale;

  const root = new THREE.Group();
  root.add(fit);
  return { root, animated };
}

/**
 * Locomotion blend space: idle, walk and run always play, weighted by ground
 * speed (idle -> walk up to walk speed, walk -> run up to run speed). Walk and
 * run cadence follows the actual speed so feet match the ground, and the weaker
 * gait is phase-locked to the stronger so the legs stay in step mid-blend.
 */
class LocomotionRig {
  private readonly mixer: THREE.AnimationMixer;
  private readonly idle?: THREE.AnimationAction;
  private readonly walk?: THREE.AnimationAction;
  private readonly run?: THREE.AnimationAction;

  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(root);
    const start = (re: RegExp, weight: number) => {
      const clip = clips.find((c) => re.test(c.name));
      if (!clip) return undefined;
      const action = this.mixer.clipAction(clip);
      action.setEffectiveWeight(weight).play();
      return action;
    };
    this.idle = start(/idle/i, 1);
    this.walk = start(/walk/i, 0);
    this.run = start(/run/i, 0);
  }

  update(dt: number, speed: number, walkSpeed: number, runSpeed: number): void {
    let idleW = 0;
    let walkW = 0;
    let runW = 0;
    if (speed <= walkSpeed) {
      const t = speed / walkSpeed;
      idleW = 1 - t;
      walkW = t;
    } else {
      const t = clamp((speed - walkSpeed) / Math.max(runSpeed - walkSpeed, 0.01), 0, 1);
      walkW = 1 - t;
      runW = t;
    }
    this.idle?.setEffectiveWeight(idleW);
    this.walk?.setEffectiveWeight(walkW);
    this.run?.setEffectiveWeight(runW);

    if (this.walk) this.walk.timeScale = clamp(speed / WALK_CLIP_SPEED, 0.5, 2);
    if (this.run) this.run.timeScale = clamp(speed / RUN_CLIP_SPEED, 0.5, 2);

    if (this.walk && this.run) {
      const [lead, follow] = runW > walkW ? [this.run, this.walk] : [this.walk, this.run];
      const phase = lead.time / lead.getClip().duration;
      follow.time = phase * follow.getClip().duration;
    }

    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }
}

/** The player's rigged, animated body. Position/facing come from the parent. */
export default function CharacterModel({
  motor,
  visible,
  walkSpeed,
  runSpeed,
}: {
  /** Anything exposing the current ground speed (the PlayerMotor). */
  motor: { speed: number };
  visible: boolean;
  walkSpeed: number;
  runSpeed: number;
}) {
  const { scene, animations } = useGLTF(MODEL_URL);
  const model = useMemo(() => prepareModel(scene), [scene]);
  const rig = useMemo(() => new LocomotionRig(model.animated, animations), [model, animations]);
  useEffect(() => () => rig.dispose(), [rig]);

  useFrame((_, dt) => rig.update(Math.min(dt, 0.1), motor.speed, walkSpeed, runSpeed));

  return <primitive object={model.root} visible={visible} />;
}

useGLTF.preload(MODEL_URL);
