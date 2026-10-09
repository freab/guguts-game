"use client";

import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import { runStore } from "../game/runStore";
import { goat } from "../game/goat";

/** Her face (m above the ground), where the view turns to. */
const FACE_HEIGHT = 0.8;
/** How long the turn onto her takes (s), and how far the view drifts in towards her (m). */
const TURN_SECONDS = 1.6;
const PUSH_IN = 0.3;
/** …never closer than this to her face (m). */
const NEAREST = 0.85;
/**
 * Then the fly-out: up and back, away from her over the maze, over FLY_SECONDS
 * (the outro story burns in partway — runStore.WIN_SHOT_MS). It stays inside
 * the view distance (the world ends in fog there), so she stays in sight.
 */
const FLY_SECONDS = 5;
const FLY_UP = 8;
const FLY_BACK = 6;
/** Where the camera looks as it rises: from her face down to the pair of them in the maze. */
const LOOK_FROM_HEIGHT = FACE_HEIGHT;
const LOOK_TO_HEIGHT = 0.3;

const UP = new THREE.Vector3(0, 1, 0);
const _face = new THREE.Vector3();
const _to = new THREE.Vector3();
const _away = new THREE.Vector3();
const _look = new THREE.Quaternion();
const _m = new THREE.Matrix4();

/** Ease in and out (smootherstep). */
const ease = (t: number) => {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

/** One frame of the shot, from Gugut's view this frame (once the run is won). */
function winShot(camera: THREE.Camera) {
  const run = runStore.get();
  if (run.phase !== "won") return;
  const t = (performance.now() - run.finishedAt) / 1000;
  const [gx, gz] = goat.position();

  // The turn onto her, and the small push in.
  const w = ease(t / TURN_SECONDS);
  _face.set(gx, FACE_HEIGHT, gz);
  _to.copy(_face).sub(camera.position);
  const push = Math.min(PUSH_IN, Math.max(0, _to.length() - NEAREST)) * w;
  // Which way is "away from her", on the ground.
  _away.set(-_to.x, 0, -_to.z).normalize();
  camera.position.addScaledVector(_to.normalize(), push);

  // The fly-out: up and back, looking down at her more as it rises.
  const f = ease((t - TURN_SECONDS) / FLY_SECONDS);
  camera.position.addScaledVector(_away, FLY_BACK * f);
  camera.position.y += FLY_UP * f;
  _face.y = THREE.MathUtils.lerp(LOOK_FROM_HEIGHT, LOOK_TO_HEIGHT, f);

  _m.lookAt(camera.position, _face, UP);
  _look.setFromRotationMatrix(_m);
  camera.quaternion.slerp(_look, w);
}

/**
 * Reaching her, the outro's camera: the view eases round onto her face and
 * drifts in a little (as her light blooms up — maze/GoatReveal), then lifts
 * away — up and back over the maze, still watching her and Gugut — while the
 * end of the story burns in over it (ui/OutroStory). Mounted after the
 * PlayerController (which holds Gugut still once the run is won), so each
 * frame starts from his view.
 */
export default function WinShot() {
  const camera = useThree((s) => s.camera);

  useFrame(() => winShot(camera));

  return null;
}
