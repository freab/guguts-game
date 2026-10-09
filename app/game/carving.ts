import { CELL, COLS, ROWS, WALL_THICKNESS_RATIO, cellAt, cellToWorld, exitPosition, inClearing, startPosition, treeSeed, worldToCell } from "../maze/mazeData";

/**
 * Where this maze's secret carving is ("ጉጉት" — maze/Carving): one wall face,
 * seeded per maze. Also marked on the #debug minimap (ui/Minimap).
 */

export function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isWall = (r: number, c: number) => r >= 0 && r < ROWS && c >= 0 && c < COLS && cellAt(r, c) === "wall";

/**
 * Where the carving is: one wall face per maze (seeded), beside an open tile
 * away from the start, the goat and the clearing — on the wall's surface
 * (the slab's near face: walls are slim slabs, full tiles where they meet).
 */
export function carvingPlace(): { x: number; z: number; facing: number } | null {
  const rng = mulberry32(treeSeed * 4243 + 7);
  const [sx, , sz] = startPosition();
  const [sr, sc] = worldToCell(sx, sz);
  const [er, ec] = worldToCell(...exitPosition());
  const t = CELL * WALL_THICKNESS_RATIO;
  const spots: { x: number; z: number; facing: number }[] = [];
  for (let r = 1; r < ROWS - 1; r++) {
    for (let c = 1; c < COLS - 1; c++) {
      if (isWall(r, c) || Math.hypot(r - sr, c - sc) < 4 || Math.hypot(r - er, c - ec) < 4) continue;
      const [x, z] = cellToWorld(r, c);
      if (inClearing(x, z, -1)) continue;
      for (const [dr, dc] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const wr = r + dr;
        const wc = c + dc;
        if (!isWall(wr, wc)) continue;
        // How deep the wall slab reaches towards this tile (see mazeData.wallSlabs).
        const horiz = isWall(wr, wc - 1) || isWall(wr, wc + 1);
        const vert = isWall(wr - 1, wc) || isWall(wr + 1, wc);
        const extent = dr !== 0 ? (vert ? CELL : t) : horiz ? CELL : t;
        const face = CELL - extent / 2;
        // Facing back into the corridor (the plane's +Z towards the tile).
        spots.push({ x: x + dc * face, z: z + dr * face, facing: Math.atan2(-dc, -dr) });
      }
    }
  }
  return spots.length ? spots[Math.floor(rng() * spots.length)] : null;
}

