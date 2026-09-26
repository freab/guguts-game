"use client";

import { useEffect, useRef } from "react";
import { COLS, ROWS, cellAt, exitPosition, worldToCell } from "../maze/mazeData";

// A 2D top-down minimap drawn to a canvas. The maze is static between
// regenerations, so it draws once on mount; SceneClient remounts it (via `key`)
// whenever a new maze is generated or resized.
const SIZE = 160; // px

export default function Minimap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Crisp on high-DPI screens.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    ctx.scale(dpr, dpr);

    const cw = SIZE / COLS;
    const ch = SIZE / ROWS;

    ctx.fillStyle = "#0d0d12";
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Walls.
    ctx.fillStyle = "#3a3a48";
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (cellAt(r, c) === "wall") {
          ctx.fillRect(c * cw, r * ch, cw + 0.5, ch + 0.5);
        }
      }
    }

    // Exit tile.
    const [ex, ez] = exitPosition();
    const [er, ec] = worldToCell(ex, ez);
    ctx.fillStyle = "#39d98a";
    ctx.fillRect(ec * cw, er * ch, cw, ch);
  }, []);

  return (
    <div className="absolute bottom-3 right-3 z-10 rounded-lg border border-white/10 bg-black/50 p-1 backdrop-blur">
      <canvas
        ref={canvasRef}
        style={{ width: SIZE, height: SIZE, display: "block" }}
      />
    </div>
  );
}
