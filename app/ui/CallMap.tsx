"use client";

import { useEffect, useRef, useState } from "react";
import { playerStore } from "../character/playerStore";
import { CALL_MAP_FADE_MS, CALL_MAP_MS } from "../game/runStore";
import { CELL, COLS, ROWS, cellAt } from "../maze/mazeData";
import { goat } from "../game/goat";

/** The map's size on screen (px). */
const SIZE = 168;

/**
 * The goat call's map: a bare top-down sketch of the maze — just the walls,
 * Gugut (an arrow, which way he faces) and the goat (pulsing) — that pops up
 * when she's called and fades away after a few seconds. Mount it keyed by the
 * call (runStore.calledAt): each call is a fresh flash.
 */
export default function CallMap({ className = "" }: { className?: string }) {
  const mazeRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const [fading, setFading] = useState(false);
  const [gone, setGone] = useState(false);

  // Up for CALL_MAP_MS, then fade out.
  useEffect(() => {
    const fade = setTimeout(() => setFading(true), CALL_MAP_MS);
    const hide = setTimeout(() => setGone(true), CALL_MAP_MS + CALL_MAP_FADE_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(hide);
    };
  }, []);

  // The walls, once.
  useEffect(() => {
    const ctx = setup(mazeRef.current);
    if (!ctx) return;
    const cw = SIZE / COLS;
    const ch = SIZE / ROWS;
    ctx.fillStyle = "rgba(253, 243, 212, 0.55)";
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (cellAt(r, c) === "wall") ctx.fillRect(c * cw, r * ch, cw + 0.4, ch + 0.4);
      }
    }
  }, []);

  // Gugut and the goat, every frame while it's up.
  useEffect(() => {
    const ctx = setup(liveRef.current);
    if (!ctx) return;
    const cw = SIZE / COLS;
    const ch = SIZE / ROWS;
    const px = (x: number) => (x / CELL + (COLS - 1) / 2 + 0.5) * cw;
    const py = (z: number) => (z / CELL + (ROWS - 1) / 2 + 0.5) * ch;
    const unit = Math.max(cw, ch);
    let id = 0;
    const draw = (t: number) => {
      ctx.clearRect(0, 0, SIZE, SIZE);
      // (Where she is now: on Hard you may see her run — game/goat.)
      const [gx, gz] = goat.position();
      // The goat: a warm dot with a ring spreading out from it.
      const pulse = (t / 1100) % 1;
      ctx.strokeStyle = `rgba(252, 211, 77, ${0.9 * (1 - pulse)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px(gx), py(gz), unit * (0.6 + pulse * 2.2), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#fcd34d";
      ctx.beginPath();
      ctx.arc(px(gx), py(gz), Math.max(3, unit * 0.6), 0, Math.PI * 2);
      ctx.fill();
      // Gugut: an arrow pointing where he's looking.
      const { x, z, lookX, lookZ } = playerStore;
      const a = Math.atan2(lookZ, lookX);
      const size = Math.max(5, unit * 1.1);
      ctx.save();
      ctx.translate(px(x), py(z));
      ctx.rotate(a);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(size, 0);
      ctx.lineTo(-size * 0.6, size * 0.6);
      ctx.lineTo(-size * 0.3, 0);
      ctx.lineTo(-size * 0.6, -size * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      id = requestAnimationFrame(draw);
    };
    id = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(id);
  }, []);

  if (gone) return null;
  return (
    <div
      className={`pointer-events-none z-20 ui-shell p-1.5 transition-opacity ease-in ${
        fading ? "opacity-0" : "opacity-100"
      } ${className}`}
      style={{ transitionDuration: `${CALL_MAP_FADE_MS}ms`, animation: "call-map-in 220ms ease-out" }}
    >
      <div className="ui-well p-2">
        <div className="relative" style={{ width: SIZE, height: SIZE }}>
          <canvas ref={mazeRef} className="absolute inset-0" style={{ width: SIZE, height: SIZE }} />
          <canvas ref={liveRef} className="absolute inset-0" style={{ width: SIZE, height: SIZE }} />
        </div>
      </div>
    </div>
  );
}

/** Size a canvas for crisp high-DPI drawing and return its 2D context. */
function setup(canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null {
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return null;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = SIZE * dpr;
  canvas.height = SIZE * dpr;
  ctx.scale(dpr, dpr);
  return ctx;
}
