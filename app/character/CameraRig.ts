import * as THREE from "three/webgpu";
import { BOB_AMPLITUDE, BOB_FREQUENCY, EYE_HEIGHT, FIRST_PERSON_PITCH, WALK_CLIP_SPEED } from "./config";
import type { LookInput } from "./LookInput";
import type { PlayerMotor } from "./PlayerMotor";
import { viewTilt } from "./viewTilt";

export interface RigSettings {
  headBob: boolean;
  fov: number;
}

/**
 * The first-person camera: at eye height over the player's feet, turned by
 * the look input, with a speed-scaled head bob while walking.
 */
export class CameraRig {
  update(camera: THREE.PerspectiveCamera, motor: PlayerMotor, input: LookInput, settings: RigSettings): void {
    input.clampPitch(FIRST_PERSON_PITCH);
    const { yaw, pitch } = input;
    const p = motor.position;
    const stride = Math.min(1, motor.speed / WALK_CLIP_SPEED);
    const bob = settings.headBob ? Math.sin(motor.distance * BOB_FREQUENCY * Math.PI * 2) * BOB_AMPLITUDE * stride : 0;
    // (Lower when sitting down, and any tilt of the head — tipping back to drink: viewTilt.)
    camera.position.set(p.x, p.y + EYE_HEIGHT - viewTilt.drop + bob, p.z);
    camera.rotation.set(pitch + viewTilt.pitch, yaw, 0, "YXZ");
    if (camera.fov !== settings.fov) {
      camera.fov = settings.fov;
      camera.updateProjectionMatrix();
    }
  }
}
