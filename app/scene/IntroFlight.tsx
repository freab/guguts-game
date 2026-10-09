"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import { EYE_HEIGHT } from "../character/config";
import { intro } from "../game/intro";
import { WALL_HEIGHT, clearingRadius, startPosition, treeScale } from "../maze/mazeData";

/**
 * Seconds of flight: longer for a bigger maze (a longer way from the tree to
 * the start), within a range.
 */
const SECONDS_PER_METRE = 0.09;
const DURATION: [number, number] = [5, 7.5];
/** The camera turns from the tree to Gugut's own view over this part of the flight. */
const TURN: [number, number] = [0.35, 0.92];
/** …and settles into his eyes over this last part. */
const LAND = 0.88;

const UP = new THREE.Vector3(0, 1, 0);
const _pos = new THREE.Vector3();
const _endPos = new THREE.Vector3();
const _endQuat = new THREE.Quaternion();
const _treeQuat = new THREE.Quaternion();
const _m = new THREE.Matrix4();

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};
/** Ease in and out (smootherstep): a drone's gentle start and landing. */
const ease = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/**
 * The flight: from low in the clearing, looking up at the maple with the
 * setting sun behind it, it pulls back and up over the walls, glides along
 * towards the start corner, and comes down into Gugut's eyes — turning from
 * the tree to his own view on the way. It stays low (just over the walls):
 * the world ends in fog at the view distance, so a high shot would see mist.
 */
function makeFlight() {
  const [sx, , sz] = startPosition();
  const dist = Math.hypot(sx, sz) || 1;
  const dir = new THREE.Vector3(sx / dist, 0, sz / dist);
  const near = clearingRadius() * 0.8;
  const along = (d: number, y: number) => dir.clone().multiplyScalar(d).setY(y);
  const curve = new THREE.CatmullRomCurve3(
    [
      along(near, 2),
      along(near + 2.5, 3.8),
      along(near + (dist - near) * 0.55, WALL_HEIGHT + 3.5),
      new THREE.Vector3(sx, WALL_HEIGHT + 2.5, sz),
      new THREE.Vector3(sx, EYE_HEIGHT, sz),
    ],
    false,
    "centripetal"
  );
  return {
    curve,
    /** Where the camera looks at first: up into the maple's crown. */
    tree: new THREE.Vector3(0, 4 * treeScale(), 0),
    duration: THREE.MathUtils.clamp(dist * SECONDS_PER_METRE + 3, ...DURATION),
  };
}

/**
 * Flies the camera for the intro (game/intro). Mounted after the
 * PlayerController, so each frame it starts from the player's own view —
 * where the flight lands — and overrides it until the flight is done.
 */
export default function IntroFlight() {
  const camera = useThree((s) => s.camera);
  const flight = useMemo(() => makeFlight(), []);
  const progress = useRef(0);

  useEffect(() => {
    intro.prepare();
    return () => intro.reset();
  }, []);

  useFrame((_, delta) => {
    const phase = intro.get();
    if (!intro.active()) return;
    // The player's view this frame: where the flight lands.
    _endPos.copy(camera.position);
    _endQuat.copy(camera.quaternion);
    // Waiting for the preloader: hold the first shot. Skipping: hold while it fades to black.
    if (phase === "playing") progress.current += Math.min(delta, 0.05) / flight.duration;
    const u = Math.min(1, progress.current);
    if (u >= 1) {
      intro.finish();
      return;
    }
    flight.curve.getPoint(ease(u), _pos);
    _pos.lerp(_endPos, smoothstep(LAND, 1, u));
    _m.lookAt(_pos, flight.tree, UP);
    _treeQuat.setFromRotationMatrix(_m);
    camera.position.copy(_pos);
    camera.quaternion.copy(_treeQuat).slerp(_endQuat, smoothstep(TURN[0], TURN[1], u));
  });

  return null;
}
