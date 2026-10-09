"use client";

import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import { runStore } from "../game/runStore";
import { exitPosition } from "../maze/mazeData";

/** Her face (m above the ground), where the view turns to. */
const FACE_HEIGHT = 0.8;
/** How long the turn takes (s), and how far the view drifts in towards her (m). */
const TURN_SECONDS = 1.6;
const PUSH_IN = 0.3;
/** …never closer than this to her face (m). */
const NEAREST = 0.85;

const UP = new THREE.Vector3(0, 1, 0);
const _face = new THREE.Vector3();
const _to = new THREE.Vector3();
const _look = new THREE.Quaternion();
const _m = new THREE.Matrix4();

const ease = (t: number) => {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

/**
 * Reaching her: the view eases round onto her face and drifts in a little,
 * while the light blooms up (maze/GoatReveal, ui/WinFlash), before the
 * story's end comes up. Mounted after the PlayerController (which holds
 * Gugut still once the run is won), so each frame it starts from his view.
 */
export default function WinShot() {
  const camera = useThree((s) => s.camera);

  useFrame(() => {
    const run = runStore.get();
    if (run.phase !== "won") return;
    const w = ease((performance.now() - run.finishedAt) / 1000 / TURN_SECONDS);
    const [gx, gz] = exitPosition();
    _face.set(gx, FACE_HEIGHT, gz);
    _to.copy(_face).sub(camera.position);
    const push = Math.min(PUSH_IN, Math.max(0, _to.length() - NEAREST)) * w;
    camera.position.addScaledVector(_to.normalize(), push);
    _m.lookAt(camera.position, _face, UP);
    _look.setFromRotationMatrix(_m);
    camera.quaternion.slerp(_look, w);
  });

  return null;
}
