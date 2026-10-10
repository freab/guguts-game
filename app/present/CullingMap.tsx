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
const DRAWN_EDGE = "rgba(134, 239, 172, 0.9)";
const HIDDEN = "rgba(239, 68, 68, 0.42)";
const HIDDEN_EDGE = "rgba(252, 165, 165, 0.9)";
const SKIPPED = "rgba(148, 163, 184, 0.16)";
const CONE = "rgba(147, 197, 253, 0.16)";
const CONE_EDGE = "rgba(147, 197, 253, 0.85)";
/** Metres of ground around the maze shown on the map. */
const MARGIN = 1;

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

/** Diagonal stripes: "skipped" or "hidden", not just a colour. */
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
 * The culling, from above, for the presentation's two culling slides: the
 * maze, the camera and its view cone, and every grass chunk coloured by what
 * the culler (scene/grass/ChunkCuller) decided this frame — with live counts.
 * - "frustum": in the view cone (drawn) or outside it (skipped);
 * - "occlusion": in view and seen (drawn), or in view but behind a wall
 *   (hidden) — with a line of sight from the camera to each chunk, stopping
 *   red at the wall that blocks it (the same grid ray walk the culler uses).
 */
export default function CullingMap({ mode, size }: { mode: CullingMode; size: number }) {
  const mazeRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const countsRef = useRef<HTMLDivElement>(null);

  // World → map: the whole maze, north up (+z down the map, as the grid's rows).
  const span = Math.max(COLS, ROWS) * CELL + MARGIN * 2;
  const scale = size / span;
  const toX = (x: number) => (x + span / 2) * scale;
  const toY = (z: number) => (z + span / 2) * scale;

  // The maze: drawn once.
  useEffect(() => {
    const ctx = mazeRef.current && setup(mazeRef.current, size);
    if (!ctx) return;
    ctx.fillStyle = "#0b0d08";
    ctx.fillRect(0, 0, size, size);
    const half = (CELL * scale) / 2;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = toX((c - (COLS - 1) / 2) * CELL);
        const y = toY((r - (ROWS - 1) / 2) * CELL);
        ctx.fillStyle = cellAt(r, c) === "wall" ? "#7d7464" : "#1b1e16";
        ctx.fillRect(x - half, y - half, half * 2 + 0.5, half * 2 + 0.5);
      }
    }
    // (toX / toY only change with the size.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  // The live layer and the counts, every frame.
  useEffect(() => {
    const ctx = liveRef.current && setup(liveRef.current, size);
    if (!ctx) return;
    const skipped = stripes(ctx, "rgba(148, 163, 184, 0.45)");
    const hidden = stripes(ctx, "rgba(252, 165, 165, 0.6)");
    const walls = new WallCollider();
    const origin = new THREE.Vector3();
    const dir = new THREE.Vector3();
    let raf = 0;

    const draw = () => {
      ctx.clearRect(0, 0, size, size);
      const p = playerStore;
      const g = grassMapStore;
      const cx = toX(p.camX);
      const cy = toY(p.camZ);
      const look = Math.atan2(p.lookZ, p.lookX);
      let drawn = 0;
      let behind = 0;
      let outside = 0;

      // The view cone, out to the edge of the map.
      const reach = span * scale * 1.5;
      ctx.fillStyle = CONE;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(look - p.halfFovX) * reach, cy + Math.sin(look - p.halfFovX) * reach);
      ctx.lineTo(cx + Math.cos(look + p.halfFovX) * reach, cy + Math.sin(look + p.halfFovX) * reach);
      ctx.closePath();
      ctx.fill();

      // The chunks, as the culler left them this frame.
      for (const ch of g.chunks) {
        if (ch.state === ChunkState.OutOfRange) continue;
        const x = toX(ch.x - ch.half);
        const y = toY(ch.z - ch.half);
        const w = ch.half * 2 * scale;
        const seen = ch.state === ChunkState.Drawn;
        const inView = seen || ch.state === ChunkState.Occluded;
        if (seen) drawn++;
        else if (inView) behind++;
        else outside++;
        // Frustum: in view (drawn, behind a wall or not) vs out of it. Occlusion: drawn vs hidden.
        const asDrawn = mode === "frustum" ? inView : seen;
        if (asDrawn) {
          ctx.fillStyle = DRAWN;
          ctx.fillRect(x + 1, y + 1, w - 2, w - 2);
          ctx.strokeStyle = DRAWN_EDGE;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 1, y + 1, w - 2, w - 2);
        } else if (mode === "occlusion" && inView) {
          ctx.fillStyle = HIDDEN;
          ctx.fillRect(x + 1, y + 1, w - 2, w - 2);
          ctx.fillStyle = hidden;
          ctx.fillRect(x + 1, y + 1, w - 2, w - 2);
          ctx.strokeStyle = HIDDEN_EDGE;
          ctx.strokeRect(x + 1, y + 1, w - 2, w - 2);
        } else {
          ctx.fillStyle = SKIPPED;
          ctx.fillRect(x + 1, y + 1, w - 2, w - 2);
          if (mode === "frustum") {
            ctx.fillStyle = skipped;
            ctx.fillRect(x + 1, y + 1, w - 2, w - 2);
          }
        }
      }

      // Occlusion: a line of sight to each chunk in view — green through, red to the wall that stops it.
      if (mode === "occlusion") {
        origin.set(p.camX, 0.3, p.camZ);
        for (const ch of g.chunks) {
          if (ch.state !== ChunkState.Drawn && ch.state !== ChunkState.Occluded) continue;
          dir.set(ch.x - p.camX, 0, ch.z - p.camZ);
          const length = dir.length();
          if (length < 0.01) continue;
          dir.divideScalar(length);
          const hit = walls.raycast(origin, dir, length);
          const blocked = hit < length;
          const end = blocked ? hit : length;
          ctx.strokeStyle = blocked ? "rgba(248, 113, 113, 0.8)" : "rgba(134, 239, 172, 0.55)";
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(toX(p.camX + dir.x * end), toY(p.camZ + dir.z * end));
          ctx.stroke();
          if (blocked) {
            const hx = toX(p.camX + dir.x * end);
            const hy = toY(p.camZ + dir.z * end);
            ctx.strokeStyle = "#fca5a5";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(hx - 3, hy - 3);
            ctx.lineTo(hx + 3, hy + 3);
            ctx.moveTo(hx + 3, hy - 3);
            ctx.lineTo(hx - 3, hy + 3);
            ctx.stroke();
          }
        }
      }

      // The cone's edges, over the chunks.
      ctx.strokeStyle = CONE_EDGE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(look - p.halfFovX) * reach, cy + Math.sin(look - p.halfFovX) * reach);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + Math.cos(look + p.halfFovX) * reach, cy + Math.sin(look + p.halfFovX) * reach);
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
        const row = (swatch: string, label: string, n: number) =>
          `<div class="flex items-center justify-between gap-4"><span class="flex items-center gap-2"><span class="inline-block h-3 w-3 rounded-sm" style="background:${swatch}"></span>${label}</span><b class="tabular-nums">${n}</b></div>`;
        el.innerHTML =
          (mode === "frustum"
            ? row(DRAWN, "In view: drawn", drawn + behind) + row("rgba(148,163,184,0.5)", "Out of view: skipped", outside)
            : row(DRAWN, "Seen: drawn", drawn) + row(HIDDEN, "Behind walls: skipped", behind) + row("rgba(148,163,184,0.35)", "Out of view", outside)) +
          `<div class="mt-2 border-t border-white/10 pt-2 text-[#fdf3d4]/70">Grass drawn: <b class="text-[#fdf3d4] tabular-nums">${g.drawnTufts.toLocaleString()}</b> of ${g.totalTufts.toLocaleString()} tufts (${pct}%)</div>`;
      }

      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, mode]);

  return (
    <div className="rounded-2xl border border-[#fdf3d4]/15 bg-black/60 p-3 backdrop-blur-md" style={{ width: size + 24 }}>
      <p className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-[#fdf3d4]/60">
        <span>From above, live</span>
        <span>{mode === "frustum" ? "Frustum culling" : "Occlusion culling"}</span>
      </p>
      <div className="relative" style={{ width: size, height: size }}>
        <canvas ref={mazeRef} className="block rounded-lg" style={{ width: size, height: size }} />
        <canvas ref={liveRef} className="absolute inset-0 block" style={{ width: size, height: size }} />
      </div>
      <div ref={countsRef} className="mt-3 flex flex-col gap-1 text-sm text-[#fdf3d4]" />
      <div className="mt-2 flex flex-wrap gap-x-3 text-xs text-[#fdf3d4]/50">
        <span><span className="text-[#93c5fd]">◢</span> camera view</span>
        <span><span className="text-[#facc15]">- -</span> draw distance</span>
        {mode === "occlusion" && <span><span className="text-[#f87171]">✕</span> ray stopped by a wall</span>}
      </div>
    </div>
  );
}
