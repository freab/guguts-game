import * as THREE from "three/webgpu";
import {
  ACCELERATION,
  COLLISION_RADIUS,
  DECELERATION,
  MAX_SUBSTEP,
  TURN_RATE,
} from "./config";
import type { WallCollider } from "./WallCollider";

/** Held movement keys (WASD / arrows, Shift), and an optional analog stick. */
export interface MoveKeys {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  run: boolean;
  /** Touch stick, -1..1 (x = right, y = forward); overrides the keys while pushed. */
  stickX?: number;
  stickY?: number;
}

/** Stick push below this is ignored (thumb resting on it). */
const STICK_DEADZONE = 0.12;
/** Stick push at which walking turns into running (full push = run speed). */
const STICK_RUN_FROM = 0.8;

export interface MoveSettings {
  walkSpeed: number;
  runSpeed: number;
}

const TAU = Math.PI * 2;

/** Exponentially approach angle b from a along the shortest arc. */
function dampAngle(a: number, b: number, rate: number, dt: number): number {
  const delta = ((((b - a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
  return a + delta * (1 - Math.exp(-rate * dt));
}

/** Body yaw (model faces +Z) that looks along a camera yaw (camera looks -Z). */
export function facingForYaw(yaw: number): number {
  return Math.atan2(-Math.sin(yaw), -Math.cos(yaw));
}

/**
 * Kinematic character motor on the ground plane. Input is camera-relative,
 * velocity eases towards the target (no instant starts/stops), movement is
 * sub-stepped against the walls so it can never tunnel, and whatever a wall
 * blocks is removed from the velocity — the player slides along walls.
 */
export class PlayerMotor {
  readonly position: THREE.Vector3;
  readonly velocity = new THREE.Vector3();
  /** Body yaw; the model faces +Z at 0. */
  facing: number;
  /** Actual ground speed after collisions (m/s) — drives the animations. */
  speed = 0;
  /** Total distance walked (m) — phase for the head bob. */
  distance = 0;

  private readonly previous = new THREE.Vector3();
  private readonly step = new THREE.Vector3();

  constructor(start: THREE.Vector3, facing: number) {
    this.position = start.clone();
    this.facing = facing;
  }

  update(
    dt: number,
    keys: MoveKeys,
    cameraYaw: number,
    collider: WallCollider,
    settings: MoveSettings
  ): void {
    if (dt <= 0) return;

    // Input -> world direction, relative to where the camera looks. A pushed
    // touch stick wins over the keys and also sets the pace: a small push
    // walks slowly, up to walking speed at STICK_RUN_FROM, running at full push.
    const stick = Math.min(1, Math.hypot(keys.stickX ?? 0, keys.stickY ?? 0));
    const useStick = stick > STICK_DEADZONE;
    const ix = useStick ? keys.stickX! : (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const iz = useStick ? keys.stickY! : (keys.forward ? 1 : 0) - (keys.backward ? 1 : 0);
    const len = Math.hypot(ix, iz);
    let wx = 0;
    let wz = 0;
    if (len > 0) {
      const sin = Math.sin(cameraYaw);
      const cos = Math.cos(cameraYaw);
      const f = iz / len;
      const s = ix / len;
      // camera forward = (-sin, -cos), camera right = (cos, -sin)
      wx = -sin * f + cos * s;
      wz = -cos * f - sin * s;
    }

    let targetSpeed = len > 0 ? (keys.run ? settings.runSpeed : settings.walkSpeed) : 0;
    if (useStick) {
      const push = (stick - STICK_DEADZONE) / (1 - STICK_DEADZONE);
      const walkUpTo = (STICK_RUN_FROM - STICK_DEADZONE) / (1 - STICK_DEADZONE);
      targetSpeed =
        push < walkUpTo
          ? settings.walkSpeed * Math.max(0.35, push / walkUpTo)
          : settings.walkSpeed + (settings.runSpeed - settings.walkSpeed) * ((push - walkUpTo) / (1 - walkUpTo));
    }
    const k = 1 - Math.exp(-(len > 0 ? ACCELERATION : DECELERATION) * dt);
    this.velocity.x += (wx * targetSpeed - this.velocity.x) * k;
    this.velocity.z += (wz * targetSpeed - this.velocity.z) * k;

    // Sub-stepped move + collision.
    this.previous.copy(this.position);
    this.step.set(this.velocity.x * dt, 0, this.velocity.z * dt);
    const steps = Math.max(1, Math.ceil(this.step.length() / MAX_SUBSTEP));
    this.step.divideScalar(steps);
    for (let i = 0; i < steps; i++) {
      this.position.add(this.step);
      collider.resolveCircle(this.position, COLLISION_RADIUS);
    }

    // Keep only the motion the walls allowed.
    const mx = this.position.x - this.previous.x;
    const mz = this.position.z - this.previous.z;
    this.velocity.set(mx / dt, 0, mz / dt);
    const moved = Math.hypot(mx, mz);
    this.speed = moved / dt;
    this.distance += moved;

    // Turn the body towards the direction of travel.
    if (this.speed > 0.15) {
      this.facing = dampAngle(this.facing, Math.atan2(mx, mz), TURN_RATE, dt);
    }
  }

  /** Face along the camera's view (used in first person). */
  faceCamera(cameraYaw: number): void {
    this.facing = facingForYaw(cameraYaw);
  }
}
