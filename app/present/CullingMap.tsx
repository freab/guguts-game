"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three/webgpu";
import { playerStore } from "../character/playerStore";
import { WallCollider } from "../character/WallCollider";
import { CELL, COLS, ROWS, cellAt } from "../maze/mazeData";
import { ChunkState, grassMapStore } from "../scene/grass/grassMapStore";

/** What the map explains: the view cone (frustum), or the walls (occlusion). */
export type CullingMode = "frustum" | "occlusion";

const DRAWN = "rgba(74, 222, 128, 0.6)";
const DRAWN_EDGE = "rgba(134, 239, 172, 0.95)";
const HIDDEN = "rgba(239, 68, 68, 0.6)";
const HIDDEN_EDGE = "rgba(252, 165, 165, 0.95)";
const SKIPPED = "rgba(148, 163, 184, 0.16)";
const CONE = "rgba(147, 197, 253, 0.16)";
const CONE_EDGE = "rgba(147, 197, 253, 0.85)";
/** Metres of ground around the maze shown on the frustum map. */
const MARGIN = 1;
/** The occlusion map's close-up: this many metres across, round the camera. */
const CLOSE_SPAN = 26;

/** Size a canvas for crisp high-DPI drawing and return its 2D context. */
function setup(canvas: HTMLCanvasElement, size: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  ctx.scale(dpr, dpr);
  return ctx;
}

/** Diagonal stripes: "skipped", not just a colour. */
function stripes(ctx: CanvasRenderingContext2D, color: string) {
  const tile = document.createElement("canvas");
  tile.width = tile.height = 8;
  const t = tile.getContext("2d")!;
  t.strokeStyle = color;
  t.lineWidth = 1.5;
  t.beginPath();
  t.moveTo(0, 8);
  t.lineTo(8, 0);
  t.stroke();
  return ctx.createPattern(tile, "repeat")!;
}

/**
 * The culling, from above, for the presentation's culling slide, live, with
 * counts. The grass chunks are coloured by what the culler (scene/grass/
 * ChunkCuller) decided this frame.
 * - "frustum": the whole maze; chunks in the camera's view cone (drawn) or
 *   outside it (skipped, striped).
 * - "occlusion": a close-up round the camera, everything outside its view
 *   darkened; only the chunks in view, green where the camera sees them
 *   (drawn), red where a wall hides them (not drawn) — each red one with its
 *   line of sight stopping at that wall (the grid ray walk the culler uses).
 */
export default function CullingMap({ mode, size }: { mode: CullingMode; size: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const countsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = canvasRef.current && setup(canvasRef.current, size);
    if (!ctx) return;
    const skipped = stripes(ctx, "rgba(148, 163, 184, 0.45)");
    const walls = new WallCollider();
    const origin = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const full = Math.max(COLS, ROWS) * CELL + MARGIN * 2;
    let raf = 0;

    const draw = () => {
      const p = playerStore;
      const g = grassMapStore;
      const close = mode === "occlusion";

      // World → map: the whole maze (frustum), or a close-up centred on the camera (occlusion). North up.
      const span = close ? CLOSE_SPAN : full;
      const scale = size / span;
      const cx0 = close ? p.camX : 0;
      const cz0 = close ? p.camZ : 0;
      const toX = (x: number) => (x - cx0 + span / 2) * scale;
      const toY = (z: number) => (z - cz0 + span / 2) * scale;

      // The maze.
      ctx.fillStyle = "#0b0d08";
      ctx.fillRect(0, 0, size, size);
      const half = (CELL * scale) / 2;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const x = toX((c - (COLS - 1) / 2) * CELL);
          const y = toY((r - (ROWS - 1) / 2) * CELL);
          if (x < -half * 2 || y < -half * 2 || x > size + half * 2 || y > size + half * 2) continue;
          ctx.fillStyle = cellAt(r, c) === "wall" ? "#7d7464" : "#1b1e16";
          ctx.fillRect(x - half, y - half, half * 2 + 0.5, half * 2 + 0.5);
        }
      }

      const cx = toX(p.camX);
      const cy = toY(p.camZ);
      const look = Math.atan2(p.lookZ, p.lookX);
      const reach = size * 2;
      const coneL: [number, number] = [cx + Math.cos(look - p.halfFovX) * reach, cy + Math.sin(look - p.halfFovX) * reach];
      const coneR: [number, number] = [cx + Math.cos(look + p.halfFovX) * reach, cy + Math.sin(look + p.halfFovX) * reach];
      let drawn = 0;
      let behind = 0;
      let outside = 0;

      if (!close) {
        ctx.fillStyle = CONE;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(...coneL);
        ctx.lineTo(...coneR);
        ctx.closePath();
        ctx.fill();
      }

      // The chunks, as the culler left them this frame.
      for (const ch of g.chunks) {
        if (ch.state === ChunkState.OutOfRange) continue;
        const seen = ch.state === ChunkState.Drawn;
        const inView = seen || ch.state === ChunkState.Occluded;
        if (seen) drawn++;
        else if (inView) behind++;
        else outside++;
        const x = toX(ch.x - ch.half);
        const y = toY(ch.z - ch.half);
        const w = ch.half * 2 * scale;
        if (close) {
          // Only what's in view: seen (green) or behind a wall (red).
          if (!inView) continue;
          ctx.fillStyle = seen ? DRAWN : HIDDEN;
          ctx.fillRect(x + 1, y + 1, w - 2, w - 2);
          ctx.strokeStyle = seen ? DRAWN_EDGE : HIDDEN_EDGE;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x + 1, y + 1, w - 2, w - 2);
        } else if (inView) {
          ctx.fillStyle = DRAWN;
          ctx.fillRect(x + 1, y + 1, w - 2, w - 2);
          ctx.strokeStyle = DRAWN_EDGE;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 1, y + 1, w - 2, w - 2);
        } else {
          ctx.fillStyle = SKIPPED;
          ctx.fillRect(x + 1, y + 1, w - 2, w - 2);
          ctx.fillStyle = skipped;
          ctx.fillRect(x + 1, y + 1, w - 2, w - 2);
        }
      }

      if (close) {
        // Outside the view: darkened (even-odd: the whole map, minus the cone).
        ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
        ctx.beginPath();
        ctx.rect(0, 0, size, size);
        ctx.moveTo(cx, cy);
        ctx.lineTo(...coneL);
        ctx.lineTo(...coneR);
        ctx.closePath();
        ctx.fill("evenodd");

        // Why a red chunk isn't drawn: its line of sight stops at a wall.
        origin.set(p.camX, 0.3, p.camZ);
        for (const ch of g.chunks) {
          if (ch.state !== ChunkState.Occluded) continue;
          dir.set(ch.x - p.camX, 0, ch.z - p.camZ);
          const length = dir.length();
          if (length < 0.01) continue;
          dir.divideScalar(length);
          const hit = Math.min(walls.raycast(origin, dir, length), length);
          const hx = toX(p.camX + dir.x * hit);
          const hy = toY(p.camZ + dir.z * hit);
          ctx.strokeStyle = "rgba(252, 165, 165, 0.75)";
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(hx, hy);
          ctx.stroke();
          ctx.strokeStyle = "#fecaca";
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(hx - 4, hy - 4);
          ctx.lineTo(hx + 4, hy + 4);
          ctx.moveTo(hx + 4, hy - 4);
          ctx.lineTo(hx - 4, hy + 4);
          ctx.stroke();
        }
      }

      // The cone's edges.
      ctx.strokeStyle = CONE_EDGE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(...coneL);
      ctx.lineTo(cx, cy);
      ctx.lineTo(...coneR);
      ctx.stroke();

      // Draw distance.
      if (g.drawDistance > 0) {
        ctx.strokeStyle = "rgba(250, 204, 21, 0.75)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.arc(toX(p.x), toY(p.z), g.drawDistance * scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // The camera.
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(look);
      ctx.fillStyle = "#fdf3d4";
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(-6, -8);
      ctx.lineTo(-2, 0);
      ctx.lineTo(-6, 8);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.fillStyle = "#fdf3d4";
      ctx.fillText("CAMERA", cx + 12, cy - 12);

      // The counts.
      const el = countsRef.current;
      if (el) {
        const pct = g.totalTufts ? Math.round((g.drawnTufts / g.totalTufts) * 100) : 0;
        const row = (swatch: string, label: string, n: number | string) =>
          `<div class="flex items-center justify-between gap-4"><span class="flex items-center gap-2"><span class="inline-block h-3 w-3 rounded-sm" style="background:${swatch}"></span>${label}</span><b class="tabular-nums">${n}</b></div>`;
        el.innerHTML =
          (close
            ? row(DRAWN, "In view, seen: drawn", drawn) + row(HIDDEN, "In view, behind a wall: not drawn", behind)
            : row(DRAWN, "In view: drawn", drawn + behind) + row("rgba(148,163,184,0.5)", "Out of view: skipped", outside)) +
          `<div class="mt-2 border-t border-white/10 pt-2 text-[#fdf3d4]/70">Grass drawn: <b class="text-[#fdf3d4] tabular-nums">${g.drawnTufts.toLocaleString()}</b> of ${g.totalTufts.toLocaleString()} tufts (${pct}%)</div>`;
      }

      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [size, mode]);

  return (
    <div className="rounded-2xl border border-[#fdf3d4]/15 bg-black/60 p-3 backdrop-blur-md" style={{ width: size + 24 }}>
      <p className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-[#fdf3d4]/60">
        <span>{mode === "frustum" ? "The whole maze, live" : "Close-up, live"}</span>
        <span>{mode === "frustum" ? "Frustum culling" : "Occlusion culling"}</span>
      </p>
      <canvas ref={canvasRef} className="block rounded-lg" style={{ width: size, height: size }} />
      <div ref={countsRef} className="mt-3 flex flex-col gap-1 text-sm text-[#fdf3d4]" />
      <div className="mt-2 flex flex-wrap gap-x-3 text-xs text-[#fdf3d4]/50">
        <span>
          <span className="text-[#93c5fd]">◢</span> camera view
        </span>
        <span>
          <span className="text-[#facc15]">- -</span> draw distance
        </span>
        {mode === "occlusion" && (
          <span>
            <span className="text-[#f87171]">✕</span> line of sight stopped by a wall
          </span>
        )}
      </div>
    </div>
  );
}
