"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useKeyboardControls, type KeyboardControlsEntry } from "@react-three/drei";
import { useControls, folder } from "leva";
import * as THREE from "three/webgpu";
import { cellAt, startPosition } from "../maze/mazeData";
import BlobShadow from "./BlobShadow";
import CharacterModel from "./CharacterModel";
import { CameraRig, type ViewMode } from "./CameraRig";
import { LookInput } from "./LookInput";
import { PlayerMotor, facingForYaw } from "./PlayerMotor";
import { WallCollider } from "./WallCollider";
import { MAX_DELTA } from "./config";
import { writePlayerStore } from "./playerStore";

export type Control = "forward" | "backward" | "left" | "right" | "run";

/** WASD + arrow keys to move, Shift to run. Wrap the Canvas in KeyboardControls with this. */
export const KEYBOARD_MAP: KeyboardControlsEntry<Control>[] = [
  { name: "forward", keys: ["KeyW", "ArrowUp"] },
  { name: "backward", keys: ["KeyS", "ArrowDown"] },
  { name: "left", keys: ["KeyA", "ArrowLeft"] },
  { name: "right", keys: ["KeyD", "ArrowRight"] },
  { name: "run", keys: ["ShiftLeft", "ShiftRight"] },
];

/** Camera yaw at spawn: look down whichever corridor leaves the start cell. */
function spawnYaw(): number {
  return cellAt(1, 2) !== "wall" ? -Math.PI / 2 : Math.PI;
}

function placeBody(body: THREE.Object3D, motor: PlayerMotor): void {
  body.position.copy(motor.position);
  body.rotation.y = motor.facing;
}

/**
 * The playable character: keyboard movement with wall collision, mouse look,
 * and a first- / third-person camera. Owns the per-frame loop in this order:
 * input -> motor (move + collide) -> body transform -> camera -> shared state.
 */
export default function PlayerController({ view }: { view: ViewMode }) {
  const { walkSpeed, runSpeed, sensitivity, invertY, distance, headBob, fovFirst, fovThird } =
    useControls({
      Player: folder(
        {
          walkSpeed: { value: 2.2, min: 0.5, max: 5, step: 0.1, label: "Walk speed" },
          runSpeed: { value: 5.5, min: 2, max: 10, step: 0.1, label: "Run speed" },
          sensitivity: { value: 1, min: 0.2, max: 3, step: 0.05, label: "Mouse sens." },
          invertY: { value: false, label: "Invert Y" },
          distance: { value: 4.2, min: 1.5, max: 10, step: 0.1, label: "3P distance" },
          headBob: { value: true, label: "Head bob" },
          fovFirst: { value: 75, min: 50, max: 100, step: 1, label: "1P FOV" },
          fovThird: { value: 55, min: 35, max: 80, step: 1, label: "3P FOV" },
        },
        { collapsed: true }
      ),
    });

  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const [, getKeys] = useKeyboardControls<Control>();

  const collider = useMemo(() => new WallCollider(), []);
  const look = useMemo(() => new LookInput(spawnYaw(), -0.25), []);
  const motor = useMemo(() => {
    const [x, , z] = startPosition();
    return new PlayerMotor(new THREE.Vector3(x, 0, z), facingForYaw(look.yaw));
  }, [look]);
  const rig = useMemo(() => new CameraRig(), []);
  const body = useRef<THREE.Group>(null);

  useEffect(() => look.attach(gl.domElement), [look, gl]);
  useEffect(() => {
    look.configure(sensitivity, invertY);
  }, [look, sensitivity, invertY]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, MAX_DELTA);
    motor.update(dt, getKeys(), look.yaw, collider, { walkSpeed, runSpeed });
    // In first person the (hidden) body turns with the view, so switching to
    // third person shows it facing where you were looking.
    if (view === "first") motor.faceCamera(look.yaw);
    if (body.current) placeBody(body.current, motor);
    rig.update(camera, motor, look, collider, view, { distance, headBob, fovFirst, fovThird }, dt);
    writePlayerStore(motor.position.x, motor.position.z, look.yaw, motor.speed, camera);
  });

  return (
    <group ref={body}>
      <BlobShadow />
      {/* Suspends until the model loads — caught by the scene's Suspense, so
          the preloader waits for it along with every other asset. */}
      <CharacterModel
        motor={motor}
        visible={view === "third"}
        walkSpeed={walkSpeed}
        runSpeed={runSpeed}
      />
    </group>
  );
}
