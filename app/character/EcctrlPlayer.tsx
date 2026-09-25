"use client";

import { useEffect, useMemo, useRef } from "react";
import { useGLTF, useAnimations } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import {
  Ecctrl,
  EcctrlAnimationStateController,
  useEcctrlAnimationStore,
  type EcctrlHandle,
  type EcctrlAnimationState,
} from "ecctrl";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import * as THREE from "three";
import { useControls, folder } from "leva";
import { atExit } from "../maze/mazeData";
import { setPlayerPos } from "../maze/playerState";

// The Ecctrl controller (physics floating-capsule from pmndrs/ecctrl). This is
// the alternative to the custom foot-locking controller — no IK, just clip
// playback driven by Ecctrl's animation-state store.
const MODEL_URL = "/models/Xbot.glb";

// Capsule sizing tuned roughly to Xbot's height; the model is offset down so its
// feet sit at the capsule's base.
const CAPSULE_HALF_HEIGHT = 0.65;
const CAPSULE_RADIUS = 0.3;
const MODEL_Y_OFFSET = -(CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS);

function XbotModel() {
  const group = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(MODEL_URL);
  // Clone so this instance owns its own skeleton (independent of the foot-lock
  // controller's cached scene).
  const cloned = useMemo(() => skeletonClone(scene), [scene]);
  const { actions, names } = useAnimations(animations, group);

  const animationState = useEcctrlAnimationStore((s) => s.animationState);
  const currentRef = useRef<THREE.AnimationAction | null>(null);

  // Map Ecctrl's animation states to Xbot clip names (Xbot has no jump clips,
  // so those fall back to idle/walk).
  const clipFor = useMemo<Record<EcctrlAnimationState, string | undefined>>(() => {
    const find = (re: RegExp) => names.find((n) => re.test(n));
    const idle = find(/idle/i);
    const walk = find(/walk/i);
    const run = find(/run/i);
    return {
      IDLE: idle,
      WALK: walk,
      RUN: run,
      JUMP_START: walk ?? idle,
      JUMP_IDLE: idle,
      JUMP_FALL: run ?? walk ?? idle,
      JUMP_LAND: idle,
    };
  }, [names]);

  useEffect(() => {
    const clip = clipFor[animationState] ?? clipFor.IDLE;
    const next = clip ? actions[clip] : null;
    if (!next || next === currentRef.current) return;
    currentRef.current?.fadeOut(0.2);
    next.reset().fadeIn(0.2).play();
    currentRef.current = next;
  }, [animationState, actions, clipFor]);

  return (
    <primitive ref={group} object={cloned} position={[0, MODEL_Y_OFFSET, 0]} />
  );
}

export default function EcctrlPlayer({
  position = [0, 2, 0],
  onWin,
}: {
  position?: [number, number, number];
  onWin?: () => void;
}) {
  const ref = useRef<EcctrlHandle>(null);
  const wonRef = useRef(false);

  // Leva: live movement tuning for the physics (Ecctrl) controller.
  const { maxWalkVel, maxRunVel } = useControls({
    "Player (Ecctrl)": folder(
      {
        maxWalkVel: { value: 1.4, min: 0.2, max: 6, step: 0.1 },
        maxRunVel: { value: 3.2, min: 0.5, max: 10, step: 0.1 },
      },
      { collapsed: true }
    ),
  });

  // Win check: read the capsule's world position and test the exit tile.
  useFrame(() => {
    const p = ref.current?.currPos;
    if (!p) return;
    setPlayerPos(p.x, p.z);
    if (!wonRef.current && atExit(p.x, p.z)) {
      wonRef.current = true;
      onWin?.();
    }
  });

  return (
    <>
      {/* Drives the animation-state store from the capsule's motion. */}
      <EcctrlAnimationStateController ecctrl={ref} />
      <Ecctrl
        ref={ref}
        capsuleHalfHeight={CAPSULE_HALF_HEIGHT}
        capsuleRadius={CAPSULE_RADIUS}
        position={position}
        maxWalkVel={maxWalkVel}
        maxRunVel={maxRunVel}
      >
        <XbotModel />
      </Ecctrl>
    </>
  );
}

useGLTF.preload(MODEL_URL);
