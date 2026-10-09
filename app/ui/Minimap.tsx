"use client";

import { useEffect, useRef } from "react";
import { playerStore } from "../character/playerStore";
import { CELL, COLS, ROWS, cellAt, exitPosition, worldToCell } from "../maze/mazeData";
import { mapleTreeLayout } from "../scene/tree/mapleTree";
import { jebenaPlace } from "../game/jebena";
import { carvingPlace } from "../game/carving";
import { ChunkState, grassMapStore } from "../scene/grass/grassMapStore";

// A 2D top-down minimap. The maze is static between regenerations, so it's
// drawn once on mount (SceneClient remounts this via `key` on a new maze or
// resize). A second, transparent canvas on top redraws the live layers every
// frame: grass chunks (drawn vs culled), the draw-distance ring, the camera's
// view cone and the player marker — from the playerStore / grassMapStore.
const SIZE = 180; // px

const COLOR_DRAWN = "rgba(74, 222, 128, 0.55)";
const COLOR_CULLED = "rgba(74, 222, 128, 0.14)";
const COLOR_OCCLUDED = "rgba(192, 132, 252, 0.35)";

/** Size a canvas for crisp high-DPI drawing and return its 2D context. */
function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = SIZE * dpr;
  canvas.height = SIZE * dpr;
  ctx.scale(dpr, dpr);
  return ctx;
}

const formatCount = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

export default function Minimap() {
  const mazeRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);

  // Maze layer: walls + exit, drawn once.
  useEffect(() => {
    const ctx = mazeRef.current && setupCanvas(mazeRef.current);
    if (!ctx) return;
    const cw = SIZE / COLS;
    const ch = SIZE / ROWS;

    ctx.fillStyle = "#0d0d12";
    ctx.fillRect(0, 0, SIZE, SIZE);

    ctx.fillStyle = "#3a3a48";
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (cellAt(r, c) === "wall") ctx.fillRect(c * cw, r * ch, cw + 0.5, ch + 0.5);
      }
    }

    // The maple in the central clearing: its crown and trunk.
    const tree = mapleTreeLayout();
    const px = (x: number) => (x / CELL + (COLS - 1) / 2 + 0.5) * cw;
    const py = (z: number) => (z / CELL + (ROWS - 1) / 2 + 0.5) * ch;
    ctx.fillStyle = "rgba(90, 160, 60, 0.4)";
    ctx.beginPath();
    ctx.arc(px(tree.canopyCenter.x), py(tree.canopyCenter.z), (tree.canopySpread * cw) / CELL, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#6b4a33";
    ctx.beginPath();
    ctx.arc(px(0), py(0), Math.max(2, (tree.trunkRadius * cw) / CELL), 0, Math.PI * 2);
    ctx.fill();

    const [ex, ez] = exitPosition();
    const [er, ec] = worldToCell(ex, ez);
    ctx.fillStyle = "#39d98a";
    ctx.fillRect(ec * cw, er * ch, cw, ch);

    // The secrets (#debug only — this map is): the monks' jebena (a red
    // dot, if this maze has one) and the ጉጉት carving (a gold tick on its wall).
    const jebena = jebenaPlace();
    if (jebena) {
      ctx.fillStyle = "#e0523a";
      ctx.beginPath();
      ctx.arc(px(jebena.x), py(jebena.z), Math.max(2.5, cw * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
    const carving = carvingPlace();
    if (carving) {
      ctx.strokeStyle = "#f3c75a";
      ctx.lineWidth = 2;
      const nx = Math.sin(carving.facing);
      const nz = Math.cos(carving.facing);
      // Along the wall face (perpendicular to the way it faces).
      const half = Math.max(3, cw * 0.6);
      ctx.beginPath();
      ctx.moveTo(px(carving.x) - nz * half, py(carving.z) + nx * half);
      ctx.lineTo(px(carving.x) + nz * half, py(carving.z) - nx * half);
      ctx.stroke();
    }
  }, []);

  // Live layer + stats, every frame.
  useEffect(() => {
    const ctx = liveRef.current && setupCanvas(liveRef.current);
    if (!ctx) return;
    const cw = SIZE / COLS;
    const ch = SIZE / ROWS;
    // World -> minimap pixels (inverse of cellToWorld) and world -> pixel scale.
    const toX = (x: number) => (x / CELL + (COLS - 1) / 2 + 0.5) * cw;
    const toY = (z: number) => (z / CELL + (ROWS - 1) / 2 + 0.5) * ch;
    const sx = cw / CELL;
    const sy = ch / CELL;
    const radius = Math.max(3, Math.min(cw, ch) * 0.6);
    let raf = 0;

    const draw = () => {
      ctx.clearRect(0, 0, SIZE, SIZE);
      const p = playerStore;
      const g = grassMapStore;

      // Grass chunks: green = drawn, faint = outside the view, purple = in view
      // but hidden behind walls (occlusion-culled).
      for (const c of g.chunks) {
        if (c.state === ChunkState.OutOfRange) continue;
        ctx.fillStyle =
          c.state === ChunkState.Drawn
            ? COLOR_DRAWN
            : c.state === ChunkState.Occluded
              ? COLOR_OCCLUDED
              : COLOR_CULLED;
        ctx.fillRect(toX(c.x - c.half), toY(c.z - c.half), 2 * c.half * sx, 2 * c.half * sy);
      }

      // Draw-distance ring around the player.
      if (g.drawDistance > 0) {
        ctx.strokeStyle = "rgba(250, 204, 21, 0.8)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.ellipse(toX(p.x), toY(p.z), g.drawDistance * sx, g.drawDistance * sy, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Camera view cone (horizontal FOV), from the camera's position.
      const angle = Math.atan2(p.lookZ, p.lookX);
      const reach = Math.max(g.drawDistance, 8);
      const cx = toX(p.camX);
      const cy = toY(p.camZ);
      ctx.fillStyle = "rgba(147, 197, 253, 0.18)";
      ctx.strokeStyle = "rgba(147, 197, 253, 0.7)";
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      for (const a of [angle - p.halfFovX, angle + p.halfFovX]) {
        ctx.lineTo(cx + Math.cos(a) * reach * sx, cy + Math.sin(a) * reach * sy);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Player: heading arrow + dot.
      const px = toX(p.x);
      const py = toY(p.z);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(angle);
      ctx.fillStyle = "#fca5a5";
      ctx.beginPath();
      ctx.moveTo(radius * 2.4, 0);
      ctx.lineTo(radius * 0.6, -radius * 0.9);
      ctx.lineTo(radius * 0.6, radius * 0.9);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = "#f87171";
      ctx.strokeStyle = "#0d0d12";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Stats: how much grass is actually drawn this frame.
      if (statsRef.current) {
        const pct = g.totalTufts ? Math.round((g.drawnTufts / g.totalTufts) * 100) : 0;
        statsRef.current.textContent =
          `Grass drawn: ${formatCount(g.drawnTufts)} / ${formatCount(g.totalTufts)} tufts (${pct}%)` +
          ` · ${g.drawnChunks} / ${g.chunks.length} chunks`;
      }

      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="absolute bottom-3 right-3 z-10 w-[188px] rounded-lg border border-cream/10 bg-black/50 p-1 backdrop-blur">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <canvas ref={mazeRef} style={{ width: SIZE, height: SIZE, display: "block" }} />
        <canvas
          ref={liveRef}
          className="absolute inset-0"
          style={{ width: SIZE, height: SIZE, display: "block" }}
        />
      </div>
      <div className="px-1 pt-1 text-[10px] leading-4 text-cream/80">
        <div ref={statsRef} />
        <div className="flex flex-wrap gap-x-2 text-cream/60">
          <span>
            <span className="inline-block h-2 w-2 bg-green-400/60 align-middle" /> drawn
          </span>
          <span>
            <span className="inline-block h-2 w-2 bg-green-400/15 align-middle" /> out of view
          </span>
          <span>
            <span className="inline-block h-2 w-2 bg-purple-400/40 align-middle" /> behind walls
          </span>
          <span>
            <span className="text-yellow-400">- -</span> draw distance
          </span>
        </div>
      </div>
    </div>
  );
}
