import { COLS, ROWS, cellAt, cellToWorld, exitPosition, inClearing, startPosition, treeSeed, worldToCell } from "../maze/mazeData";
import { bottlePositions } from "./bottles";

/**
 * A secret: in some mazes (CHANCE of them, seeded, so a maze keeps it or
 * not), the monks have left a jebena — a clay coffee pot, still steaming — on
 * a stone at the end of a dead end. Picking it up (maze/Jebena) earns the
 * hidden "First buna" badge (ui/GameOver).
 */
const CHANCE = 0.5;
/** Not this close to the start, the goat or a bottle (cells). */
const AWAY_FROM = 4;

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
 * Where this maze's jebena is (world x, z, and the way it faces — out of its
 * dead end), or null if this maze has none.
 */
export function jebenaPlace(): { x: number; z: number; facing: number } | null {
  const rng = mulberry32(treeSeed * 7919 + 104729);
  if (rng() >= CHANCE) return null;
  const [sx, , sz] = startPosition();
  const avoid: [number, number][] = [worldToCell(sx, sz), worldToCell(...exitPosition())];
  for (const [bx, bz] of bottlePositions()) avoid.push(worldToCell(bx, bz));

  const spots: { r: number; c: number; facing: number }[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!open(r, c)) continue;
      const ways = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).filter(([dr, dc]) => open(r + dr, c + dc));
      if (ways.length !== 1) continue;
      if (avoid.some(([ar, ac]) => Math.hypot(ar - r, ac - c) < AWAY_FROM)) continue;
      const [x, z] = cellToWorld(r, c);
      if (inClearing(x, z, -1)) continue;
      // Facing out of the dead end, the way someone would come in.
      const [dr, dc] = ways[0];
      spots.push({ r, c, facing: Math.atan2(dc, dr) });
    }
  }
  if (spots.length === 0) return null;
  const spot = spots[Math.floor(rng() * spots.length)];
  const [x, z] = cellToWorld(spot.r, spot.c);
  return { x, z, facing: spot.facing };
}
