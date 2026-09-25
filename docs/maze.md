# Maze System

All of this lives in **`app/maze/`**. `mazeData.ts` is the single source of
truth; `Maze.tsx` draws it; `playerState.ts` tracks the player for the minimap.

## The grid model

The maze is a 2D grid where each value is a wall (`1`) or open path (`0`). It is
sized in **cells**, and a cell grid of `N` needs `2N + 1` rows/columns of the
wall grid (walls sit between and around cells).

```ts
const CELLS_W = 8, CELLS_H = 8;      // maze size in cells
export const ROWS = 2 * CELLS_H + 1; // 17
export const COLS = 2 * CELLS_W + 1; // 17
export const CELL = 2;               // world units per grid cell (corridor width)
export const WALL_HEIGHT = 2.5;
```

Landmarks are fixed so every helper stays stable across regenerations:

- **Start** — top-left interior cell `[1, 1]`.
- **Exit** — a marker tile at `[ROWS-2, COLS-2]`, with an opening punched through
  the border at `[ROWS-2, COLS-1]`.

`cellAt(row, col)` returns `"wall" | "path" | "start" | "exit"`.

## Generation (Phase 3)

`generate()` runs a **recursive backtracker** (iterative, using an explicit
stack so it can't overflow):

1. Start at cell `(0, 0)`, mark it visited, open it.
2. Repeatedly look at the top of the stack, shuffle the four neighbours
   (Fisher–Yates), and carve into the first unvisited one — knocking down the
   wall between them.
3. If a cell has no unvisited neighbours, pop it and backtrack.
4. When the stack empties, every cell is connected → the maze is **always
   solvable**. Finally, punch the exit opening in the border.

`regenerateMaze()` replaces the module's current grid. It is called at module
load (so the first render has a maze) and on every restart.

> Verified: running the generator + a BFS solvability check over 200 mazes gave
> **200/200 solvable** and **200/200 unique** layouts.

## World ↔ grid coordinates

The maze is centered on the origin so camera framing stays balanced.

```ts
cellToWorld(row, col) // → [x, z]  grid cell → world position
worldToCell(x, z)     // → [row, col]  world position → grid cell (rounded)
```

## Collision

Two collision strategies, because the two controllers work differently:

- **Physics (Maze mode):** `Maze.tsx` wraps the floor and each wall box in fixed
  Rapier `RigidBody` colliders. The ecctrl capsule collides with them natively.
- **Grid (Foot-lock mode):** `Maze.tsx` renders plain meshes (no physics), and
  the controller calls `isWalkable(x, z, radius)`. That samples the disc's four
  extremes plus its center against the grid; the controller tests each axis
  independently so you **slide** along a wall instead of sticking.

```ts
isWallAtWorld(x, z)         // is this world point a wall (or out of bounds)?
isWalkable(x, z, radius)    // can a disc of `radius` stand here?
```

## Rendering — `Maze.tsx`

Takes a `colliders` prop:

- `colliders={true}` (default, Maze mode): floor + walls wrapped in fixed Rapier
  bodies.
- `colliders={false}` (Foot-lock mode): the same geometry as plain meshes.

It also draws the glowing green **exit marker** (an emissive plane) at the exit
tile.
