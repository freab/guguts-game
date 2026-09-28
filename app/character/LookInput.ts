import { LOOK_RADIANS_PER_PIXEL, ZOOM_RANGE } from "./config";

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * Mouse look for both camera views. Click the canvas to capture the mouse
 * (pointer lock — Esc releases it); while not captured, dragging also looks
 * around. The scroll wheel zooms the third-person camera.
 *
 * yaw: rotation about +Y (0 = looking down -Z). pitch: negative = looking down.
 */
export class LookInput {
  yaw: number;
  pitch: number;
  /** Multiplier on the third-person camera distance. */
  zoom = 1;
  private sensitivity = 1;
  private invertY = false;
  private dragging = false;

  constructor(yaw: number, pitch: number) {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  configure(sensitivity: number, invertY: boolean): void {
    this.sensitivity = sensitivity;
    this.invertY = invertY;
  }

  clampPitch([min, max]: [number, number]): void {
    this.pitch = clamp(this.pitch, min, max);
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
      if (document.pointerLockElement !== el && !this.dragging) return;
      const k = LOOK_RADIANS_PER_PIXEL * this.sensitivity;
      this.yaw -= e.movementX * k;
      this.pitch -= e.movementY * k * (this.invertY ? -1 : 1);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      this.zoom = clamp(this.zoom * Math.exp(e.deltaY * 0.001), ZOOM_RANGE[0], ZOOM_RANGE[1]);
    };
    const onContextMenu = (e: Event) => e.preventDefault();

    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    el.addEventListener("click", onClick);
    document.addEventListener("mousemove", onMouseMove);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("contextmenu", onContextMenu);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("click", onClick);
      document.removeEventListener("mousemove", onMouseMove);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("contextmenu", onContextMenu);
      if (document.pointerLockElement === el) document.exitPointerLock();
    };
  }
}
