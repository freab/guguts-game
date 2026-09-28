import type * as THREE from "three/webgpu";
import { CELL, COLS, ROWS, WALL_HEIGHT, obstacles, wallSlabs, worldToCell } from "../maze/mazeData";

/** A wall's footprint on the ground plane (walls run from y = 0 to WALL_HEIGHT). */
interface WallBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * Push a circle (centre p, radius r) out of one wall box. Returns true if it
 * overlapped. Only the component into the wall is removed, so the player slides
 * along walls instead of sticking to them.
 */
function pushOut(p: THREE.Vector3, r: number, b: WallBox): boolean {
  const dx = p.x - clamp(p.x, b.minX, b.maxX);
  const dz = p.z - clamp(p.z, b.minZ, b.maxZ);
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;

  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    const k = (r - d) / d;
    p.x += dx * k;
    p.z += dz * k;
    return true;
  }

  // Centre inside the box: leave through the nearest face.
  const left = p.x - b.minX;
  const right = b.maxX - p.x;
  const back = p.z - b.minZ;
  const front = b.maxZ - p.z;
  const m = Math.min(left, right, back, front);
  if (m === left) p.x = b.minX - r;
  else if (m === right) p.x = b.maxX + r;
  else if (m === back) p.z = b.minZ - r;
  else p.z = b.maxZ + r;
  return true;
}

/** Slab-method ray vs wall box (0..WALL_HEIGHT tall). Distance, or Infinity. */
function rayBox(o: THREE.Vector3, d: THREE.Vector3, b: WallBox, maxDist: number): number {
  let tMin = 0;
  let tMax = maxDist;
  const axes: [number, number, number, number][] = [
    [o.x, d.x, b.minX, b.maxX],
    [o.y, d.y, 0, WALL_HEIGHT],
    [o.z, d.z, b.minZ, b.maxZ],
  ];
  for (const [origin, dir, lo, hi] of axes) {
    if (Math.abs(dir) < 1e-9) {
      if (origin < lo || origin > hi) return Infinity;
      continue;
    }
    let t1 = (lo - origin) / dir;
    let t2 = (hi - origin) / dir;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return Infinity;
  }
  return tMin;
}

/**
 * Collision against the maze walls. Every wall slab sits inside its own grid
 * cell, so walls are bucketed per cell and a query only touches nearby cells —
 * constant cost however big the maze is. The player is also kept out of the
 * few round obstacles (the clearing's tree trunk).
 */
export class WallCollider {
  private readonly cells: WallBox[][] = Array.from({ length: ROWS * COLS }, () => []);
  private readonly circles = obstacles();

  constructor() {
    for (const s of wallSlabs()) {
      this.cells[s.r * COLS + s.c].push({
        minX: s.x - s.w / 2,
        maxX: s.x + s.w / 2,
        minZ: s.z - s.d / 2,
        maxZ: s.z + s.d / 2,
      });
    }
  }

  /** Move a circle at (p.x, p.z) out of every wall it overlaps (mutates p). */
  resolveCircle(p: THREE.Vector3, radius: number): void {
    // A few passes settle corners where two walls push at once.
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      const [r0, c0] = worldToCell(p.x, p.z);
      for (let r = Math.max(0, r0 - 1); r <= Math.min(ROWS - 1, r0 + 1); r++) {
        for (let c = Math.max(0, c0 - 1); c <= Math.min(COLS - 1, c0 + 1); c++) {
          for (const box of this.cells[r * COLS + c]) {
            if (pushOut(p, radius, box)) moved = true;
          }
        }
      }
      for (const o of this.circles) {
        const dx = p.x - o.x;
        const dz = p.z - o.z;
        const d = Math.hypot(dx, dz);
        const min = o.r + radius;
        if (d >= min) continue;
        // Out along the line from its centre (any way out if exactly on it).
        const k = d > 1e-6 ? min / d : 0;
        p.x = d > 1e-6 ? o.x + dx * k : o.x + min;
        p.z = d > 1e-6 ? o.z + dz * k : o.z;
        moved = true;
      }
      if (!moved) return;
    }
  }

  /**
   * Ground-plane distance from (x, z) to the nearest wall face, checking the
   * surrounding 3×3 cells (so results beyond ~one cell are capped at `cap`).
   * 0 inside a wall. Used to bake ambient occlusion.
   */
  distanceToWalls(x: number, z: number, cap = CELL): number {
    const [r0, c0] = worldToCell(x, z);
    let best = cap;
    for (let r = Math.max(0, r0 - 1); r <= Math.min(ROWS - 1, r0 + 1); r++) {
      for (let c = Math.max(0, c0 - 1); c <= Math.min(COLS - 1, c0 + 1); c++) {
        for (const b of this.cells[r * COLS + c]) {
          const dx = Math.max(b.minX - x, 0, x - b.maxX);
          const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
          best = Math.min(best, Math.hypot(dx, dz));
        }
      }
    }
    return best;
  }

  /**
   * Distance along a unit ray to the first wall within maxDist, else Infinity.
   *
   * Walks the grid cell by cell along the ray (Amanatides–Woo DDA). Every wall
   * slab lies inside its own cell, so only the cells the ray crosses can be hit,
   * and it returns at the first cell with a hit — cost grows with ray length,
   * not with the area around it. (Used by the camera arm and grass occlusion.)
   */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number {
    // Continuous grid coordinates: cell (row, col) spans [col, col+1) × [row, row+1).
    const gx = origin.x / CELL + (COLS - 1) / 2 + 0.5;
    const gz = origin.z / CELL + (ROWS - 1) / 2 + 0.5;
    let col = Math.floor(gx);
    let row = Math.floor(gz);
    const dgx = dir.x / CELL; // grid units per world unit along the ray
    const dgz = dir.z / CELL;
    const stepX = Math.sign(dgx);
    const stepZ = Math.sign(dgz);
    const tDeltaX = dgx !== 0 ? Math.abs(1 / dgx) : Infinity;
    const tDeltaZ = dgz !== 0 ? Math.abs(1 / dgz) : Infinity;
    let tMaxX = dgx > 0 ? (col + 1 - gx) / dgx : dgx < 0 ? (gx - col) / -dgx : Infinity;
    let tMaxZ = dgz > 0 ? (row + 1 - gz) / dgz : dgz < 0 ? (gz - row) / -dgz : Infinity;

    let t = 0;
    let nearest = Infinity;
    while (t <= maxDist) {
      if (row >= 0 && row < ROWS && col >= 0 && col < COLS) {
        for (const box of this.cells[row * COLS + col]) {
          nearest = Math.min(nearest, rayBox(origin, dir, box, maxDist));
        }
        // A hit before the ray leaves this cell can't be beaten further on.
        if (nearest <= Math.min(tMaxX, tMaxZ)) return nearest;
      }
      if (tMaxX < tMaxZ) {
        col += stepX;
        t = tMaxX;
        tMaxX += tDeltaX;
      } else {
        row += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
      }
    }
    return nearest;
  }
}
