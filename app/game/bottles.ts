import { COLS, ROWS, cellAt, cellToWorld, exitPosition, inClearing, startPosition, treeSeed, worldToCell } from "../maze/mazeData";
import { BOTTLES } from "./runStore";

function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const open = (r: number, c: number) => r >= 0 && r < ROWS && c >= 0 && c < COLS && cellAt(r, c) !== "wall";

/**
 * Where this maze's water bottles are hidden (world x, z): at the end of dead
 * ends — where a searching player has to commit to a detour — on the worn
 * path down the middle (short grass, so a bottle can be seen once you're in
 * there), spread out: each far from the start, the goat and the other
 * bottles. Seeded per maze, so the same maze hides them in the same places.
 */
export function bottlePositions(): [number, number][] {
  const rng = mulberry32(treeSeed * 9301 + 49297);
  const [sx, , sz] = startPosition();
  const [ex, ez] = exitPosition();
  const [sr, sc] = worldToCell(sx, sz);
  const [er, ec] = worldToCell(ex, ez);

  // Dead ends: open cells with a single open neighbour (not the start or
  // the goat's tile, and not out in the clearing).
  const deadEnds: [number, number][] = [];
  const anyOpen: [number, number][] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!open(r, c) || (r === sr && c === sc) || (r === er && c === ec)) continue;
      const [x, z] = cellToWorld(r, c);
      if (inClearing(x, z)) continue;
      anyOpen.push([r, c]);
      const exits = [open(r - 1, c), open(r + 1, c), open(r, c - 1), open(r, c + 1)].filter(Boolean).length;
      if (exits === 1) deadEnds.push([r, c]);
    }
  }
  const pool = deadEnds.length >= BOTTLES ? deadEnds : anyOpen;

  // Greedy: each bottle goes to a random pick among the cells farthest from
  // everything already placed (the start, the goat, earlier bottles).
  const placed: [number, number][] = [
    [sr, sc],
    [er, ec],
  ];
  const chosen: [number, number][] = [];
  for (let b = 0; b < BOTTLES && pool.length > 0; b++) {
    const scored = pool
      .filter(([r, c]) => !chosen.some(([cr, cc]) => cr === r && cc === c))
      .map((cell) => ({ cell, d: Math.min(...placed.map(([r, c]) => Math.hypot(cell[0] - r, cell[1] - c))) }))
      .sort((a, b) => b.d - a.d);
    if (scored.length === 0) break;
    const top = scored.slice(0, Math.max(1, Math.ceil(scored.length * 0.3)));
    const { cell } = top[Math.floor(rng() * top.length)];
    chosen.push(cell);
    placed.push(cell);
  }
  return chosen.map(([r, c]) => cellToWorld(r, c));
}
