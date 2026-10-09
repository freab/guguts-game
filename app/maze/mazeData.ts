// Phase 3 maze data. The maze is generated at runtime with a recursive-
// backtracker, so every run is a new (always-solvable) layout. The grid
// DIMENSIONS are fixed — only the interior wall pattern changes — which keeps
// the start/exit and all the world<->grid helpers stable across runs.
//
// Grid values: 1 = wall, 0 = open path. Start is the top-left interior cell;
// the exit is an opening punched through the bottom-right border.

/**
 * Maze size in *cells* (each cell becomes a 1-wide path with walls around it).
 * These are mutable so the UI can grow the maze at runtime; ROWS/COLS/CELL are
 * `let` exports (ES module live bindings) so every importer sees the new values
 * once setMazeConfig() has run and the scene has remounted.
 */
let cellsW = 8;
let cellsH = 8;

/** Full wall-grid size: a cell grid of N needs 2N+1 rows/cols of walls+paths. */
export let ROWS = 2 * cellsH + 1;
export let COLS = 2 * cellsW + 1;

/** World size of one grid cell (a corridor is this wide — raise it for wider halls). */
export let CELL = 2;
/** How tall the walls stand. */
export const WALL_HEIGHT = 2.5;

// Landmarks. START is fixed at the top-left interior cell; the exit tracks the
// bottom-right corner, so it is recomputed whenever the grid is resized.
const START_RC: [number, number] = [1, 1];
let EXIT_RC: [number, number] = [ROWS - 2, COLS - 2]; // marker tile
let EXIT_OPENING: [number, number] = [ROWS - 2, COLS - 1]; // gap in the border

/**
 * Resize the maze and regenerate it. `cell` (corridor width) is optional.
 * Call before remounting the scene so the new dimensions take effect.
 */
export function setMazeConfig(opts: {
  cellsW?: number;
  cellsH?: number;
  cell?: number;
}): void {
  if (opts.cellsW != null) cellsW = Math.max(2, Math.round(opts.cellsW));
  if (opts.cellsH != null) cellsH = Math.max(2, Math.round(opts.cellsH));
  if (opts.cell != null) CELL = opts.cell;
  ROWS = 2 * cellsH + 1;
  COLS = 2 * cellsW + 1;
  EXIT_RC = [ROWS - 2, COLS - 2];
  EXIT_OPENING = [ROWS - 2, COLS - 1];
  generate();
}

export type Cell = "wall" | "path" | "start" | "exit";

// Mutable current layout (1 = wall, 0 = path), filled by generate().
let grid: number[][] = [];

/** Recursive-backtracker maze generation into the module `grid`. */
function generate(): void {
  const g: number[][] = Array.from({ length: ROWS }, () =>
    Array(COLS).fill(1)
  );
  const visited: boolean[][] = Array.from({ length: cellsH }, () =>
    Array(cellsW).fill(false)
  );

  // Iterative stack (avoids deep recursion for larger mazes).
  const stack: [number, number][] = [[0, 0]];
  visited[0][0] = true;
  g[1][1] = 0;

  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const dirs: [number, number][] = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ];
    // Fisher-Yates shuffle for an unbiased random neighbour order.
    for (let i = dirs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }

    let carved = false;
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx >= 0 && nx < cellsW && ny >= 0 && ny < cellsH && !visited[ny][nx]) {
        visited[ny][nx] = true;
        // Knock down the wall between the two cells, and open the new cell.
        g[2 * cy + 1 + dy][2 * cx + 1 + dx] = 0;
        g[2 * ny + 1][2 * nx + 1] = 0;
        stack.push([nx, ny]);
        carved = true;
        break;
      }
    }
    if (!carved) stack.pop();
  }

  // Punch the exit through the border.
  g[EXIT_OPENING[0]][EXIT_OPENING[1]] = 0;
  carveClearing(g);
  grid = g;
  treeSeed = (Math.random() * 0x7fffffff) | 0;
}

/**
 * Open the round clearing in the middle of the maze (where the maple grows).
 * Opening cells only ever adds connections, so the maze stays solvable. Wall
 * cells left standing on their own around its edge — thin pillars, once their
 * neighbours are gone — are knocked down too.
 */
function carveClearing(g: number[][]): void {
  const radius = clearingRadius();
  const near = (r: number, c: number, extra: number) => {
    const [x, z] = cellToWorld(r, c);
    return Math.hypot(x, z) <= radius + extra;
  };
  for (let r = 1; r < ROWS - 1; r++) {
    for (let c = 1; c < COLS - 1; c++) {
      if (near(r, c, 0)) g[r][c] = 0;
    }
  }
  const wall = (r: number, c: number) => g[r]?.[c] === 1;
  for (let changed = true; changed; ) {
    changed = false;
    for (let r = 1; r < ROWS - 1; r++) {
      for (let c = 1; c < COLS - 1; c++) {
        if (!wall(r, c) || !near(r, c, CELL * 1.5)) continue;
        if (!wall(r - 1, c) && !wall(r + 1, c) && !wall(r, c - 1) && !wall(r, c + 1)) {
          g[r][c] = 0;
          changed = true;
        }
      }
    }
  }
}

/** Seed for the clearing's tree; changes with every generated maze. */
export let treeSeed = 1;

/** Radius (world units) of the round clearing at the maze centre (the origin). */
export function clearingRadius(): number {
  return Math.min(8, Math.max(5, Math.min(ROWS, COLS) * CELL * 0.17));
}

/** Size of the clearing's tree relative to its reference build (≈8 m tall). */
export function treeScale(): number {
  return Math.min(1.2, Math.max(0.8, clearingRadius() / 6.5));
}

/** Is world (x, z) inside the clearing (shrunk by `margin`)? */
export function inClearing(x: number, z: number, margin = 0): boolean {
  return Math.hypot(x, z) <= clearingRadius() - margin;
}

/**
 * Where Temesgen sits playing his kirar (maze/Temesgen): his back to the
 * maple's trunk, on the side facing the start corner, so a player coming in
 * from that way finds him face on. `facing` turns a model that faces +Z.
 */
export function restingSpot(): { x: number; z: number; facing: number } {
  const [sx, , sz] = startPosition();
  const len = Math.hypot(sx, sz) || 1;
  const d = 0.55 * treeScale() + 0.55;
  return { x: (sx / len) * d, z: (sz / len) * d, facing: Math.atan2(sx, sz) };
}

/** Round obstacles the player can't walk through: the tree trunk (first), then Temesgen. */
export function obstacles(): { x: number; z: number; r: number }[] {
  const rest = restingSpot();
  return [
    { x: 0, z: 0, r: 0.55 * treeScale() },
    { x: rest.x, z: rest.z, r: 0.46 },
  ];
}

/** Regenerate a fresh random maze. Call before restarting a run. */
export function regenerateMaze(): void {
  generate();
}

// Generate an initial maze at module load so the first render has a layout.
generate();

export function cellAt(row: number, col: number): Cell {
  if (row === START_RC[0] && col === START_RC[1]) return "start";
  if (row === EXIT_RC[0] && col === EXIT_RC[1]) return "exit";
  const v = grid[row]?.[col];
  return v === 1 ? "wall" : "path";
}

/**
 * Convert a grid cell to a world-space (x, z) position, centering the whole
 * maze on the origin so the camera framing stays balanced.
 */
export function cellToWorld(row: number, col: number): [number, number] {
  const x = (col - (COLS - 1) / 2) * CELL;
  const z = (row - (ROWS - 1) / 2) * CELL;
  return [x, z];
}

/** Convert a world-space (x, z) position back to the grid cell it falls in. */
export function worldToCell(x: number, z: number): [number, number] {
  const col = Math.round(x / CELL + (COLS - 1) / 2);
  const row = Math.round(z / CELL + (ROWS - 1) / 2);
  return [row, col];
}

/** Wall thickness as a fraction of a cell (walls are slim slabs, not blocks). */
export const WALL_THICKNESS_RATIO = 0.32;

/** A wall cell rendered as a slab: its cell, centre (x, z) and footprint w × d. */
export interface WallSlab {
  r: number;
  c: number;
  x: number;
  z: number;
  w: number;
  d: number;
}

/**
 * Every wall cell as a slim slab: full cell length along its run (so adjacent
 * walls tile edge-to-edge and the maze stays sealed) and thin across it. Each
 * slab stays inside its own cell. Reads the live CELL, so it tracks corridor
 * width changes. Shared by the wall renderer and the grass scatter.
 */
export function wallSlabs(): WallSlab[] {
  const t = CELL * WALL_THICKNESS_RATIO;
  const isWall = (r: number, c: number) =>
    r >= 0 && r < ROWS && c >= 0 && c < COLS && cellAt(r, c) === "wall";

  const out: WallSlab[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!isWall(r, c)) continue;
      const [x, z] = cellToWorld(r, c);
      const horiz = isWall(r, c - 1) || isWall(r, c + 1);
      const vert = isWall(r - 1, c) || isWall(r + 1, c);
      out.push({ r, c, x, z, w: horiz ? CELL : t, d: vert ? CELL : t });
    }
  }
  return out;
}

/** Is (row, col) an open, walkable cell inside the grid? */
function isOpen(row: number, col: number): boolean {
  return (
    row >= 0 && row < ROWS && col >= 0 && col < COLS && cellAt(row, col) !== "wall"
  );
}

/**
 * Does the worn footpath run through this cell? Every open corridor cell, but
 * not the clearing: the trails stop at its edge and it stays a meadow.
 */
function onTrail(row: number, col: number): boolean {
  if (!isOpen(row, col)) return false;
  const [x, z] = cellToWorld(row, col);
  return !inClearing(x, z, CELL * 0.5);
}

/** A walkway link between two adjacent open cells: its midpoint + direction. */
export interface PathLink {
  x: number;
  z: number;
  /** true = runs along z (between rows), false = runs along x. */
  vertical: boolean;
}

/**
 * The walkway network down the middle of every corridor: each open cell centre
 * is a joint, and every pair of edge-adjacent open cells is joined by a link one
 * CELL long (listed once, rightward / downward).
 */
export function pathNetwork(): { joints: [number, number][]; links: PathLink[] } {
  const joints: [number, number][] = [];
  const links: PathLink[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!onTrail(r, c)) continue;
      const [x, z] = cellToWorld(r, c);
      joints.push([x, z]);
      if (onTrail(r, c + 1)) links.push({ x: x + CELL / 2, z, vertical: false });
      if (onTrail(r + 1, c)) links.push({ x, z: z + CELL / 2, vertical: true });
    }
  }
  return { joints, links };
}

/**
 * Distance from world (x, z) to the nearest walkway centreline. Only links in
 * the surrounding 3×3 cells are checked, so results beyond ~one cell are upper
 * bounds — plenty for fading grass out near the path.
 */
export function distanceToPath(x: number, z: number): number {
  const [r0, c0] = worldToCell(x, z);
  let best = Infinity;
  for (let r = r0 - 1; r <= r0 + 1; r++) {
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      if (!onTrail(r, c)) continue;
      const [cx, cz] = cellToWorld(r, c);
      best = Math.min(best, Math.hypot(x - cx, z - cz));
      if (onTrail(r, c + 1)) {
        const px = Math.min(Math.max(x, cx), cx + CELL);
        best = Math.min(best, Math.hypot(x - px, z - cz));
      }
      if (onTrail(r + 1, c)) {
        const pz = Math.min(Math.max(z, cz), cz + CELL);
        best = Math.min(best, Math.hypot(x - cx, z - pz));
      }
    }
  }
  return best;
}

/** Is the given world point inside a wall cell (or outside the maze)? (Only isWalkable uses it.) */
export function isWallAtWorld(x: number, z: number): boolean {
  const [row, col] = worldToCell(x, z);
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return true;
  return cellAt(row, col) === "wall";
}

/**
 * Can a disc of `radius` centered at (x, z) stand here without touching a wall?
 * Samples the disc's four extremes plus its center. Not used by the game (the
 * player collides through character/WallCollider); kept as a grid helper.
 */
export function isWalkable(x: number, z: number, radius = 0.35): boolean {
  const pts: [number, number][] = [
    [x, z],
    [x + radius, z],
    [x - radius, z],
    [x, z + radius],
    [x, z - radius],
  ];
  return pts.every(([px, pz]) => !isWallAtWorld(px, pz));
}

/** World-space spawn point for the player: the start cell's centre (callers use only x and z). */
export function startPosition(): [number, number, number] {
  const [x, z] = cellToWorld(START_RC[0], START_RC[1]);
  return [x, 2, z];
}

/** World-space (x, z) of the exit tile. */
export function exitPosition(): [number, number] {
  return cellToWorld(EXIT_RC[0], EXIT_RC[1]);
}

/**
 * A radius round the exit tile. Not used by the game: reaching the goat is
 * game/GoalWatcher's check; kept with atExit as grid helpers.
 */
export function exitRadius(): number {
  return CELL * 0.6;
}

/** Is world (x, z) within exitRadius of the exit tile? (Unused; see exitRadius.) */
export function atExit(x: number, z: number): boolean {
  const [ex, ez] = exitPosition();
  const dx = x - ex;
  const dz = z - ez;
  const r = exitRadius();
  return dx * dx + dz * dz <= r * r;
}
