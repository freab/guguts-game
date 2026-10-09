"use client";

import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import { LOOK_RADIANS_PER_PIXEL } from "../character/config";
import { playerStore } from "../character/playerStore";
import { photo } from "../game/photo";

/** Flying speed (m/s), and with Shift. */
const SPEED = 2.5;
const FAST = 7;
/**
 * How far the camera may roam from Gugut (m), and its heights: it stays near
 * him, where the world is built and drawn (it ends in fog at the view distance).
 */
const MAX_FROM_PLAYER = 12;
const MIN_Y = 0.25;
const MAX_Y = 10;
/** Looking (radians): never quite straight up or down. */
const PITCH_LIMIT = 1.5;
/** Touch drags turn more per pixel than a mouse (as in the game). */
const TOUCH_LOOK_SCALE = 2.2;

/** The free camera's own state (outside React; changed by events and each frame). */
class Flyer {
  readonly position = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  readonly keys = new Set<string>();
  private dragging: "mouse" | "touch" | null = null;
  private wasActive = false;

  /** Start from where the camera is now. */
  begin(camera: THREE.Camera) {
    this.position.copy(camera.position);
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
    this.yaw = e.y;
    this.pitch = e.x;
    this.keys.clear();
  }

  look(dx: number, dy: number, touch: boolean) {
    const k = LOOK_RADIANS_PER_PIXEL * (touch ? TOUCH_LOOK_SCALE : 1);
    this.yaw -= dx * k;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * k, -PITCH_LIMIT, PITCH_LIMIT);
  }

  attach(el: HTMLElement): () => void {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!photo.get().active) return;
      this.keys.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
    const onBlur = () => this.keys.clear();
    const onPointerDown = (e: PointerEvent) => {
      if (photo.get().active) this.dragging = e.pointerType === "touch" ? "touch" : "mouse";
    };
    const onPointerUp = () => {
      this.dragging = null;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!photo.get().active) return;
      if (document.pointerLockElement === el || this.dragging) this.look(e.movementX, e.movementY, this.dragging === "touch");
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointermove", onPointerMove);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }

  /** Each frame: fly, keep near Gugut, and put the camera here. */
  update(camera: THREE.PerspectiveCamera, dt: number) {
    const { active, fov } = photo.get();
    if (!active) {
      this.wasActive = false;
      return;
    }
    if (!this.wasActive) {
      this.wasActive = true;
      this.begin(camera);
    }
    const k = this.keys;
    const has = (...codes: string[]) => codes.some((c) => k.has(c));
    const forward = (has("KeyW", "ArrowUp") ? 1 : 0) - (has("KeyS", "ArrowDown") ? 1 : 0);
    const right = (has("KeyD", "ArrowRight") ? 1 : 0) - (has("KeyA", "ArrowLeft") ? 1 : 0);
    const up = (has("Space", "KeyE") ? 1 : 0) - (has("KeyQ", "ControlLeft", "ControlRight", "KeyC") ? 1 : 0);
    const speed = (has("ShiftLeft", "ShiftRight") ? FAST : SPEED) * Math.min(dt, 0.1);
    // Forward is where it looks (pitch included); right stays level.
    const cp = Math.cos(this.pitch);
    this.position.x += (-Math.sin(this.yaw) * cp * forward + Math.cos(this.yaw) * right) * speed;
    this.position.z += (-Math.cos(this.yaw) * cp * forward - Math.sin(this.yaw) * right) * speed;
    this.position.y += (Math.sin(this.pitch) * forward + up) * speed;
    // Near Gugut, above the ground, not too high.
    const dx = this.position.x - playerStore.x;
    const dz = this.position.z - playerStore.z;
    const far = Math.hypot(dx, dz);
    if (far > MAX_FROM_PLAYER) {
      this.position.x = playerStore.x + (dx / far) * MAX_FROM_PLAYER;
      this.position.z = playerStore.z + (dz / far) * MAX_FROM_PLAYER;
    }
    this.position.y = THREE.MathUtils.clamp(this.position.y, MIN_Y, MAX_Y);

    camera.position.copy(this.position);
    camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }
}

/**
 * Photo mode's free camera (game/photo): WASD / arrows fly where it looks,
 * Space / E up, Q / Ctrl down, Shift faster; the mouse (captured, or dragged)
 * and touch drags look around. It starts from Gugut's view and stays near him.
 * Mounted after the PlayerController (and the intro and win shots), so its
 * camera is the one drawn while photo mode is on.
 */
export default function PhotoCamera() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const flyer = useMemo(() => new Flyer(), []);
  useEffect(() => flyer.attach(gl.domElement), [flyer, gl]);
  useFrame((_, dt) => flyer.update(camera, dt));
  return null;
}
