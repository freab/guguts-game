import * as THREE from "three/webgpu";
import {
  BOB_AMPLITUDE,
  BOB_FREQUENCY,
  CAMERA_WALL_PADDING,
  EYE_HEIGHT,
  FIRST_PERSON_PITCH,
  MIN_ARM,
  MIN_CAMERA_HEIGHT,
  PIVOT_HEIGHT,
  THIRD_PERSON_PITCH,
  WALK_CLIP_SPEED,
} from "./config";
import type { LookInput } from "./LookInput";
import type { PlayerMotor } from "./PlayerMotor";
import type { WallCollider } from "./WallCollider";

export type ViewMode = "first" | "third";

export interface RigSettings {
  /** Third-person camera distance (before scroll zoom). */
  distance: number;
  headBob: boolean;
  fovFirst: number;
  fovThird: number;
}

const ease = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/**
 * Drives the camera for both views.
 * - First person: at eye height with a speed-scaled head bob.
 * - Third person: a spring arm orbiting a smoothed pivot at chest height. If a
 *   wall sits between pivot and camera the arm snaps in immediately (never
 *   clips through a wall) and eases back out once the view clears.
 * The field of view blends between the two views' settings.
 */
export class CameraRig {
  private readonly pivot = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly back = new THREE.Vector3();
  private arm = -1;
  private pivotReady = false;

  update(
    camera: THREE.PerspectiveCamera,
    motor: PlayerMotor,
    input: LookInput,
    collider: WallCollider,
    view: ViewMode,
    settings: RigSettings,
    dt: number
  ): void {
    input.clampPitch(view === "first" ? FIRST_PERSON_PITCH : THIRD_PERSON_PITCH);
    const { yaw, pitch } = input;
    const cp = Math.cos(pitch);
    this.look.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);

    const p = motor.position;
    if (view === "first") {
      const stride = Math.min(1, motor.speed / WALK_CLIP_SPEED);
      const bob = settings.headBob
        ? Math.sin(motor.distance * BOB_FREQUENCY * Math.PI * 2) * BOB_AMPLITUDE * stride
        : 0;
      camera.position.set(p.x, p.y + EYE_HEIGHT + bob, p.z);
      this.pivotReady = false; // re-snap the third-person pivot on switch back
    } else {
      this.target.set(p.x, p.y + PIVOT_HEIGHT, p.z);
      if (!this.pivotReady) {
        this.pivot.copy(this.target);
        this.arm = -1;
        this.pivotReady = true;
      } else {
        this.pivot.lerp(this.target, ease(20, dt));
      }

      const wanted = settings.distance * input.zoom;
      this.back.copy(this.look).negate();
      const hit = collider.raycast(this.pivot, this.back, wanted + CAMERA_WALL_PADDING);
      const allowed = Math.max(MIN_ARM, Math.min(wanted, hit - CAMERA_WALL_PADDING));
      this.arm = this.arm < 0 || allowed < this.arm ? allowed : this.arm + (allowed - this.arm) * ease(6, dt);

      camera.position.copy(this.pivot).addScaledVector(this.back, this.arm);
      camera.position.y = Math.max(camera.position.y, MIN_CAMERA_HEIGHT);
    }

    camera.rotation.set(pitch, yaw, 0, "YXZ");

    const fov = view === "first" ? settings.fovFirst : settings.fovThird;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov += (fov - camera.fov) * ease(10, dt);
      camera.updateProjectionMatrix();
    }
  }
}
