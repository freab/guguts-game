"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useKeyboardControls, type KeyboardControlsEntry } from "@react-three/drei";
import { useControls, folder } from "leva";
import * as THREE from "three/webgpu";
import { cellAt, startPosition } from "../maze/mazeData";
import BlobShadow from "./BlobShadow";
import { CameraRig } from "./CameraRig";
import { LookInput } from "./LookInput";
import { PlayerMotor, facingForYaw, type MoveKeys } from "./PlayerMotor";
import { Seat } from "./Seat";
import { WallCollider } from "./WallCollider";
import { MAX_DELTA } from "./config";
import { writePlayerStore } from "./playerStore";
import { touchInput } from "./touchInput";
import { runStore } from "../game/runStore";
import { photo } from "../game/photo";
import { buna } from "../game/secrets";

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
export function spawnYaw(): number {
  return cellAt(1, 2) !== "wall" ? -Math.PI / 2 : Math.PI;
}

function placeBody(body: THREE.Object3D, motor: PlayerMotor): void {
  body.position.copy(motor.position);
  body.rotation.y = motor.facing;
}

/**
 * The player: keyboard / touch movement with wall collision, mouse / drag
 * look, and the first-person camera. Owns the per-frame loop in this order:
 * input -> motor (move + collide) -> seat (sitting down to listen to
 * Temesgen) -> body transform -> camera -> shared state.
 */
export default function PlayerController() {
  const { walkSpeed, runSpeed, sensitivity, invertY, headBob, fov } =
    useControls({
      Player: folder(
        {
          walkSpeed: { value: 2.2, min: 0.5, max: 5, step: 0.1, label: "Walk speed" },
          runSpeed: { value: 5.5, min: 2, max: 10, step: 0.1, label: "Run speed" },
          sensitivity: { value: 1, min: 0.2, max: 3, step: 0.05, label: "Mouse sens." },
          invertY: { value: false, label: "Invert Y" },
          headBob: { value: true, label: "Head bob" },
          fov: { value: 75, min: 50, max: 100, step: 1, label: "FOV" },
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
  const seat = useMemo(() => new Seat(), []);
  useEffect(() => () => seat.dispose(), [seat]);
  const body = useRef<THREE.Group>(null);
  /** Keys + touch stick, merged each frame (reused, no per-frame allocation). */
  const input = useRef<MoveKeys>({
    forward: false,
    backward: false,
    left: false,
    right: false,
    run: false,
    stickX: 0,
    stickY: 0,
  });

  useEffect(() => look.attach(gl.domElement), [look, gl]);
  useEffect(() => {
    look.configure(sensitivity, invertY);
  }, [look, sensitivity, invertY]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, MAX_DELTA);
    // The run is over (or a dialog is open): stand still, ignore input.
    const blocked = runStore.inputBlocked();
    // Photo mode has the camera: the mouse mustn't turn Gugut meanwhile.
    look.setEnabled(!photo.get().active);
    // Touch: apply the look drag since last frame, and the move stick.
    if (touchInput.lookDX || touchInput.lookDY) {
      if (!blocked) look.addDrag(touchInput.lookDX, touchInput.lookDY);
      touchInput.lookDX = touchInput.lookDY = 0;
    }
    const keys = Object.assign(input.current, getKeys());
    keys.stickX = touchInput.moveX;
    keys.stickY = touchInput.moveY;
    const wantsToMove =
      !blocked && (keys.forward || keys.backward || keys.left || keys.right || Math.hypot(keys.stickX, keys.stickY) > 0.3);
    // Sitting (or sitting down) to listen to Temesgen: no walking.
    if (blocked || seat.update(dt, motor, look, wantsToMove)) {
      keys.forward = keys.backward = keys.left = keys.right = keys.run = false;
      keys.stickX = keys.stickY = 0;
    }
    // (Faster for a while after the BUNA secret: game/secrets.)
    const boost = buna.boost();
    motor.update(dt, keys, look.yaw, collider, { walkSpeed: walkSpeed * boost, runSpeed: runSpeed * boost });
    motor.faceCamera(look.yaw);
    if (body.current) placeBody(body.current, motor);
    rig.update(camera, motor, look, { headBob, fov });
    writePlayerStore(motor.position.x, motor.position.z, look.yaw, motor.speed, camera);
  });

  return (
    <group ref={body}>
      <BlobShadow />
    </group>
  );
}
