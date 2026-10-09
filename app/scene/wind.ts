import { cameraPosition, dot, sin, uniform, vec2 } from "three/tsl";
import type * as THREE from "three/webgpu";

/**
 * The wind, shared by what you hear and what you see: one gust curve, on one
 * clock (seconds since the page loaded).
 * - The audio's wind (audioEngine's drift) swells with gustAt(now).
 * - The grass, flowers, maple and ivy sway by gustScale at their own spot:
 *   the same curve, delayed by how far downwind of the player that spot is —
 *   so a gust rolls across the field, and reaches the player just as it is
 *   heard. Strong gusts also blow a few leaves past (atmosphere/GustLeaves).
 */

/** Which way it blows (unit, world XZ): the grass's travelling wave runs this way too. */
export const WIND_DIRECTION = { x: Math.SQRT1_2, z: Math.SQRT1_2 };
/** How fast a gust's front rolls across the ground (m/s). */
const GUST_FRONT_SPEED = 6;

/** How gusty it is at `t` s: 0 (a lull) … 1 (a strong gust), drifting over a minute or so. */
export function gustAt(t: number): number {
  return 0.5 + 0.5 * (0.6 * Math.sin(t * 0.19) + 0.4 * Math.sin(t * 0.53 + 1.3));
}

/** The wind clock (s), for the shaders: set every frame by tickWind. */
export const windTime = uniform(0);

/** Seconds on the wind clock now. */
export const windNow = () => performance.now() / 1000;

export function tickWind() {
  windTime.value = windNow();
}

/** gustAt in TSL, at world point `xz`: later downwind of the player. */
export function gustNode(xz: THREE.Node<"vec2">) {
  const downwind = dot(xz.sub(cameraPosition.xz), vec2(WIND_DIRECTION.x, WIND_DIRECTION.z)).div(GUST_FRONT_SPEED);
  const t = windTime.sub(downwind);
  return sin(t.mul(0.19)).mul(0.6).add(sin(t.mul(0.53).add(1.3)).mul(0.4)).mul(0.5).add(0.5);
}

/**
 * What a gust does to sway at `xz`: 0.35× in a lull, 1.65× in a strong gust
 * — 1× on average, so the tuned sway strengths still hold on the whole.
 */
export function gustScale(xz: THREE.Node<"vec2">) {
  return gustNode(xz).mul(1.3).add(0.35);
}
