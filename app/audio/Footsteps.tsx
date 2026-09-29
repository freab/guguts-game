"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { playerStore } from "../character/playerStore";
import { audio } from "./audioEngine";

/** Stride (metres per step) walking and running; cadence follows from speed. */
const WALK_STRIDE = 0.8;
const RUN_STRIDE = 1.35;
const WALK_SPEED = 2.2;
const RUN_SPEED = 5.5;
/** Below this ground speed the player is standing still. */
const MIN_SPEED = 0.4;

/**
 * Footsteps on grass: a step every stride of distance walked, so the cadence
 * speeds up naturally when running — longer strides, louder, brighter steps.
 * Sits inside the Canvas to read the player's speed every frame.
 */
export default function Footsteps() {
  const travelled = useRef(0);
  useFrame((_, delta) => {
    const speed = playerStore.speed;
    if (speed < MIN_SPEED) {
      // Standing: the next move starts with a step, not mid-stride.
      travelled.current = WALK_STRIDE * 0.7;
      return;
    }
    const run = Math.min(1, Math.max(0, (speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED)));
    const stride = WALK_STRIDE + (RUN_STRIDE - WALK_STRIDE) * run;
    travelled.current += speed * Math.min(delta, 0.1);
    if (travelled.current >= stride) {
      travelled.current -= stride;
      audio.footstep(0.45 + 0.55 * run);
    }
  });
  return null;
}
