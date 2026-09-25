"use client";

import { useEffect, useRef } from "react";
import { CELL, COLS, ROWS, cellAt, exitPosition, worldToCell } from "../maze/mazeData";
import { playerState } from "../maze/playerState";

// A 2D top-down minimap drawn to a canvas. It reads the live maze grid and the
// player's position on its own animation loop, so it reflects the current maze
// (including regenerations) and tracks the player without React re-renders.
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

    let raf = 0;

    const draw = () => {
      // Recomputed each frame so the map tracks live maze resizes.
      const cw = SIZE / COLS;
      const ch = SIZE / ROWS;

      ctx.clearRect(0, 0, SIZE, SIZE);
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

      // Player dot — fractional grid coords (inverse of cellToWorld) for smooth
      // motion between cells.
      const fc = playerState.x / CELL + (COLS - 1) / 2;
      const fr = playerState.z / CELL + (ROWS - 1) / 2;
      ctx.fillStyle = "#f87171";
      ctx.beginPath();
      ctx.arc((fc + 0.5) * cw, (fr + 0.5) * ch, Math.max(cw, ch) * 0.6, 0, Math.PI * 2);
      ctx.fill();

      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => cancelAnimationFrame(raf);
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
