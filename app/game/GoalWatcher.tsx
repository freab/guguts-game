"use client";

import { useFrame } from "@react-three/fiber";
import { playerStore } from "../character/playerStore";
import { exitPosition } from "../maze/mazeData";
import { runStore } from "./runStore";

/** How close (metres, feet to the goat) counts as having reached her. */
const REACH = 1.4;
/** Ground speed that counts as the first step (starts the clock). */
const FIRST_STEP_SPEED = 0.3;

/**
 * Drives the run from inside the Canvas: starts the clock on the player's
 * first step, and ends the run when they reach the goat on the exit tile.
 */
export default function GoalWatcher() {
  useFrame(() => {
    const { phase } = runStore.get();
    if (phase === "armed" && playerStore.speed > FIRST_STEP_SPEED) {
      runStore.start(performance.now());
    } else if (phase === "running") {
      const [gx, gz] = exitPosition();
      if (Math.hypot(playerStore.x - gx, playerStore.z - gz) < REACH) runStore.finish(performance.now());
    }
  });
  return null;
}
