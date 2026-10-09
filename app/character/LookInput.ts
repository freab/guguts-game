import { LOOK_RADIANS_PER_PIXEL } from "./config";

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Touch look turns this much more per pixel than the mouse. */
const TOUCH_LOOK_SCALE = 2.2;

/**
 * Mouse look. Click the canvas to capture the mouse (pointer lock — Esc
 * releases it); while not captured, dragging also looks around.
 *
 * yaw: rotation about +Y (0 = looking down -Z). pitch: negative = looking down.
 */
export class LookInput {
  yaw: number;
  pitch: number;
  private sensitivity = 1;
  private invertY = false;
  private dragging = false;
  /** Off while something else has the camera (photo mode): the mouse doesn't turn Gugut. */
  private enabled = true;

  constructor(yaw: number, pitch: number) {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  configure(sensitivity: number, invertY: boolean): void {
    this.sensitivity = sensitivity;
    this.invertY = invertY;
  }

  clampPitch([min, max]: [number, number]): void {
    this.pitch = clamp(this.pitch, min, max);
  }

  /**
   * Look by a touch drag of (dx, dy) screen pixels (TouchControls). Touch
   * needs more turn per pixel than a mouse: a thumb sweeps far fewer pixels.
   */
  addDrag(dx: number, dy: number): void {
    const k = LOOK_RADIANS_PER_PIXEL * TOUCH_LOOK_SCALE * this.sensitivity;
    this.yaw -= dx * k;
    this.pitch -= dy * k * (this.invertY ? -1 : 1);
  }

  /** Start listening on the canvas; returns the cleanup function. */
  attach(el: HTMLElement): () => void {
    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 0 || e.button === 2) this.dragging = true;
    };
    const onPointerUp = () => {
      this.dragging = false;
    };
    const onClick = () => {
      if (document.pointerLockElement !== el) {
        el.requestPointerLock()?.catch?.(() => {
          // Browsers refuse pointer lock right after an Esc; dragging still works.
        });
      }
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!this.enabled || (document.pointerLockElement !== el && !this.dragging)) return;
      const k = LOOK_RADIANS_PER_PIXEL * this.sensitivity;
      this.yaw -= e.movementX * k;
      this.pitch -= e.movementY * k * (this.invertY ? -1 : 1);
    };
    const onContextMenu = (e: Event) => e.preventDefault();

    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    el.addEventListener("click", onClick);
    document.addEventListener("mousemove", onMouseMove);
    el.addEventListener("contextmenu", onContextMenu);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("click", onClick);
      document.removeEventListener("mousemove", onMouseMove);
      el.removeEventListener("contextmenu", onContextMenu);
      if (document.pointerLockElement === el) document.exitPointerLock();
    };
  }
}
