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
  grid = g;
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

/** Is the given world point inside a wall cell (or outside the maze)? */
export function isWallAtWorld(x: number, z: number): boolean {
  const [row, col] = worldToCell(x, z);
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return true;
  return cellAt(row, col) === "wall";
}

/**
 * Can a disc of `radius` centered at (x, z) stand here without touching a wall?
 * Used by the non-physics (foot-lock) controller for grid collision. Samples the
 * disc's four extremes plus its center.
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

/** World-space spawn point for the player, lifted slightly so it drops in. */
export function startPosition(): [number, number, number] {
  const [x, z] = cellToWorld(START_RC[0], START_RC[1]);
  return [x, 2, z];
}

/** World-space (x, z) of the exit tile. */
export function exitPosition(): [number, number] {
  return cellToWorld(EXIT_RC[0], EXIT_RC[1]);
}

/** How close (world units) the player must get to the exit tile to escape. */
export function exitRadius(): number {
  return CELL * 0.6;
}

/** Has the player (at world x, z) reached the exit tile? */
export function atExit(x: number, z: number): boolean {
  const [ex, ez] = exitPosition();
  const dx = x - ex;
  const dz = z - ez;
  const r = exitRadius();
  return dx * dx + dz * dz <= r * r;
}
