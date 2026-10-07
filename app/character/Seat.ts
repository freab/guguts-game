import * as THREE from "three/webgpu";
import { restingSpot } from "../maze/mazeData";
import { temesgen } from "../game/temesgen";
import type { LookInput } from "./LookInput";
import type { PlayerMotor } from "./PlayerMotor";
import { viewTilt } from "./viewTilt";

/** Where Gugut sits: this far (m) in front of Temesgen, facing him. */
const SEAT_DISTANCE = 1.45;
/** How far his eyes come down sitting on the grass (m), and where he looks (a touch up, at Temesgen). */
const SEAT_DROP = 0.55;
const SEAT_PITCH = 0.02;
/** Seconds to sit down, and to get up again. */
const SIT_TIME = 1.3;
const STAND_TIME = 0.6;

const ease = (t: number) => THREE.MathUtils.smootherstep(t, 0, 1);
/** From angle a towards b by t, the short way round. */
function lerpAngle(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

/**
 * Sitting down to listen to Temesgen's song (game/temesgen `seated`): Gugut
 * walks the last steps to a spot in front of him, turns to face him and
 * sits on the grass — the view lowers — and stays sat (looking around
 * freely) until the player moves, the song ends or he's asked to stop; then
 * he gets up and walks on.
 */
export class Seat {
  private phase: "standing" | "sitting" | "seated" = "standing";
  private t = 0;
  private readonly from = new THREE.Vector3();
  private fromYaw = 0;
  private fromPitch = 0;
  private readonly seat = new THREE.Vector3();
  private seatYaw = 0;

  constructor() {
    const spot = restingSpot();
    // In front of him (he faces +Z turned by `facing`), looking back at him.
    this.seat.set(spot.x + Math.sin(spot.facing) * SEAT_DISTANCE, 0, spot.z + Math.cos(spot.facing) * SEAT_DISTANCE);
    this.seatYaw = spot.facing;
  }

  /**
   * Run after the motor each frame. `wantsToMove`: the player is pressing a
   * move key or pushing the stick. Returns true while Gugut is sitting down or
   * sat — the controller then ignores movement.
   */
  update(dt: number, motor: PlayerMotor, look: LookInput, wantsToMove: boolean): boolean {
    const { seated } = temesgen.get();
    if (seated && this.phase === "standing") {
      this.phase = "sitting";
      this.t = 0;
      this.from.copy(motor.position);
      this.fromYaw = look.yaw;
      this.fromPitch = look.pitch;
    }
    if (!seated && this.phase !== "standing") this.phase = "standing";

    if (this.phase === "sitting") {
      this.t = Math.min(1, this.t + dt / SIT_TIME);
      const e = ease(this.t);
      motor.position.lerpVectors(this.from, this.seat, e);
      look.yaw = lerpAngle(this.fromYaw, this.seatYaw, e);
      look.pitch = THREE.MathUtils.lerp(this.fromPitch, SEAT_PITCH, e);
      // He walks the first part, then sits.
      viewTilt.drop = SEAT_DROP * ease(THREE.MathUtils.clamp((this.t - 0.35) / 0.65, 0, 1));
      if (this.t >= 1) this.phase = "seated";
      return true;
    }
    if (this.phase === "seated") {
      viewTilt.drop = SEAT_DROP;
      if (wantsToMove) temesgen.standUp();
      return true;
    }
    // Standing (or getting up): the view rises back; walking is free at once.
    viewTilt.drop = Math.max(0, viewTilt.drop - (SEAT_DROP / STAND_TIME) * dt);
    return false;
  }

  dispose() {
    viewTilt.drop = 0;
  }
}
