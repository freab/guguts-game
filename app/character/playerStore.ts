import type * as THREE from "three/webgpu";

/**
 * Live player state, written by the PlayerController every frame and read by
 * things outside the React render cycle (the minimap overlay, the sun's shadow
 * camera, grass culling) on their own loops — so nothing re-renders per frame.
 */
export const playerStore = {
  /** Feet position on the ground plane. */
  x: 0,
  z: 0,
  /** Unit vector of the camera's horizontal look direction. */
  lookX: 0,
  lookZ: -1,
  /** Current ground speed (m/s). */
  speed: 0,
  /** Camera position on the ground plane (behind the player in third person). */
  camX: 0,
  camZ: 0,
  /** Half of the camera's horizontal field of view (radians). */
  halfFovX: 0.6,
};

export function writePlayerStore(
  x: number,
  z: number,
  yaw: number,
  speed: number,
  camera: THREE.PerspectiveCamera
): void {
  playerStore.x = x;
  playerStore.z = z;
  playerStore.lookX = -Math.sin(yaw);
  playerStore.lookZ = -Math.cos(yaw);
  playerStore.speed = speed;
  playerStore.camX = camera.position.x;
  playerStore.camZ = camera.position.z;
  const halfFovY = (camera.fov * Math.PI) / 360;
  playerStore.halfFovX = Math.atan(Math.tan(halfFovY) * camera.aspect);
}
