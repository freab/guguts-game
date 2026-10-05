"use client";

import { useEffect, useRef, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { touchInput } from "../character/touchInput";

/** How far (px) the stick's knob travels from its centre: a full push. */
const STICK_RADIUS = 56;

const coarse = () => window.matchMedia("(pointer: coarse)");

/** Keep receiving this pointer's moves even off the zone (fine if the browser refuses). */
function capture(e: ReactPointerEvent<HTMLDivElement>) {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    // e.g. the pointer is already gone: its moves still arrive while over the zone.
  }
}

/** True on touch-first devices (phones, tablets): a coarse primary pointer. */
export function useIsTouch(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = coarse();
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => coarse().matches,
    () => false
  );
}

/**
 * Phone controls, the usual mobile-game layout:
 * - left half: a floating move stick — it appears under the thumb wherever it
 *   lands; a small push walks, a full push runs;
 * - right half: drag to look around (the call-the-goat button sits at the
 *   bottom right, under the thumb — SceneClient).
 * Move and look work together (one pointer each). The overlay writes to
 * character/touchInput; the player controller reads it every frame. The
 * stick moves through refs, not React state, so dragging never re-renders.
 */
export default function TouchControls() {
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const idle = useRef<HTMLDivElement>(null);
  const stick = useRef<{ id: number; x: number; y: number } | null>(null);
  const lookPointer = useRef<{ id: number; x: number; y: number } | null>(null);

  // Let go of everything if the controls go away mid-push (level change…).
  useEffect(
    () => () => {
      touchInput.moveX = touchInput.moveY = 0;
      touchInput.lookDX = touchInput.lookDY = 0;
    },
    []
  );

  const showStick = (x: number, y: number, dx: number, dy: number) => {
    if (base.current) {
      base.current.style.display = "block";
      base.current.style.transform = `translate(${x - STICK_RADIUS}px, ${y - STICK_RADIUS}px)`;
    }
    if (knob.current) knob.current.style.transform = `translate(${dx}px, ${dy}px)`;
    if (idle.current) idle.current.style.opacity = "0";
  };
  const hideStick = () => {
    if (base.current) base.current.style.display = "none";
    if (idle.current) idle.current.style.opacity = "1";
  };

  const onStickDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (stick.current) return;
    capture(e);
    stick.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    showStick(e.clientX, e.clientY, 0, 0);
  };
  const onStickMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = stick.current;
    if (!s || s.id !== e.pointerId) return;
    let dx = e.clientX - s.x;
    let dy = e.clientY - s.y;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      dx *= STICK_RADIUS / len;
      dy *= STICK_RADIUS / len;
    }
    touchInput.moveX = dx / STICK_RADIUS;
    touchInput.moveY = -dy / STICK_RADIUS; // screen up = forward
    showStick(s.x, s.y, dx, dy);
  };
  const onStickUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (stick.current?.id !== e.pointerId) return;
    stick.current = null;
    touchInput.moveX = touchInput.moveY = 0;
    hideStick();
  };

  const onLookDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (lookPointer.current) return;
    capture(e);
    lookPointer.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const onLookMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const l = lookPointer.current;
    if (!l || l.id !== e.pointerId) return;
    touchInput.lookDX += e.clientX - l.x;
    touchInput.lookDY += e.clientY - l.y;
    l.x = e.clientX;
    l.y = e.clientY;
  };
  const onLookUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (lookPointer.current?.id === e.pointerId) lookPointer.current = null;
  };

  // No browser gestures (scroll, pinch-zoom, text selection, long-press menus)
  // on the play area.
  const zone = "absolute inset-y-0 touch-none select-none [-webkit-touch-callout:none]";

  return (
    <div className="absolute inset-0 z-[5]" onContextMenu={(e) => e.preventDefault()}>
      <div
        className={`${zone} left-0 w-1/2`}
        onPointerDown={onStickDown}
        onPointerMove={onStickMove}
        onPointerUp={onStickUp}
        onPointerCancel={onStickUp}
      />
      <div
        className={`${zone} right-0 w-1/2`}
        onPointerDown={onLookDown}
        onPointerMove={onLookMove}
        onPointerUp={onLookUp}
        onPointerCancel={onLookUp}
      />

      {/* Where to put your thumb, until you do. */}
      <div
        ref={idle}
        className="pointer-events-none absolute bottom-10 left-10 h-28 w-28 rounded-full border-2 border-white/25 bg-white/5 transition-opacity duration-300"
      >
        <div className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/20" />
      </div>

      {/* The stick, drawn where the thumb landed. */}
      <div
        ref={base}
        className="pointer-events-none absolute left-0 top-0 hidden rounded-full border-2 border-white/35 bg-black/15 backdrop-blur-[2px]"
        style={{ width: STICK_RADIUS * 2, height: STICK_RADIUS * 2 }}
      >
        <div
          ref={knob}
          className="absolute rounded-full bg-white/60 shadow-lg"
          style={{ width: 52, height: 52, left: STICK_RADIUS - 26, top: STICK_RADIUS - 26 }}
        />
      </div>

    </div>
  );
}
