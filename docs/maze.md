# Maze System

All of this lives in **`app/maze/`**. `mazeData.ts` is the single source of
truth; everything else (walls, collision, grass, bottles, maps, the intro
flight) reads it.

## The grid model

The maze is a 2D grid where each value is a wall (`1`) or open path (`0`). It is
sized in **cells**, and a cell grid of `N` needs `2N + 1` rows/columns of the
wall grid (walls sit between and around cells).

```ts
let cellsW = 8, cellsH = 8;              // maze size in cells (set per level)
export let ROWS = 2 * cellsH + 1;
export let COLS = 2 * cellsW + 1;
export let CELL = 2;                     // world units per grid cell (corridor width)
export const WALL_HEIGHT = 2.5;
```

`ROWS`, `COLS` and `CELL` are `let` exports (live bindings).
`setMazeConfig({ cellsW, cellsH, cell })` changes them and regenerates; the
scene is then remounted. The level sizes are in `levels.ts`: Easy 8 × 8,
Medium 14 × 14, Hard 20 × 20, all with 2 m corridors.

Landmarks:

- **Start**: top-left interior cell `[1, 1]`.
- **Exit**: the goat's tile at `[ROWS-2, COLS-2]`, with an opening through
  the border at `[ROWS-2, COLS-1]`. The goat (`Goat.tsx`) and the coffee bush
  (`CoffeeBush.tsx`) are here.
- **Clearing**: a round meadow at the centre (the origin) where the maple
  grows and Temesgen sits.

`cellAt(row, col)` returns `"wall" | "path" | "start" | "exit"`.

## Generation

`generate()` runs a **recursive backtracker** (iterative, using an explicit
stack so it can't overflow):

1. Start at cell `(0, 0)`, mark it visited, open it.
2. Repeatedly look at the top of the stack, shuffle the four neighbours
   (Fisher–Yates), and carve into the first unvisited one, knocking down the
   wall between them.
3. If a cell has no unvisited neighbours, pop it and backtrack.
4. When the stack empties, every cell is connected, so the maze is **always
   solvable**. Then punch the exit opening in the border.
5. **Carve the clearing** (`carveClearing`): open every cell within
   `clearingRadius()` of the centre (0.17 × the smaller side, kept within
   5–8 m), then knock down wall cells left standing alone near its edge.
   Opening cells only adds connections, so the maze stays solvable.
6. Pick a new `treeSeed`. It seeds the maple, the capstones and the bottle
   placement, so one maze always looks and plays the same.

`regenerateMaze()` replaces the module's grid. It runs at module load (so the
first render has a maze) and on every restart.

## Helpers

```ts
cellToWorld(row, col)   // → [x, z]  grid cell → world position (maze centred on the origin)
worldToCell(x, z)       // → [row, col]
startPosition()         // spawn point
exitPosition()          // the goat's tile
clearingRadius(), inClearing(x, z), treeScale()
restingSpot()           // where Temesgen sits: back to the trunk, facing the start corner
obstacles()             // round obstacles: the trunk, then Temesgen
wallSlabs()             // every wall cell as a slim slab (32% of a cell thick)
pathNetwork(), distanceToPath(x, z)   // the walkway centrelines (the footpath)
```

`isWalkable`, `exitRadius` and `atExit` (and `isWallAtWorld`, used only by
`isWalkable`) are still exported but unused: collision is done by `character/WallCollider.ts`, and reaching the
goat by `game/GoalWatcher.tsx` (see below).

## Collision

There is no physics engine. `character/WallCollider.ts` builds a box for each
wall slab (from `wallSlabs()`), bucketed by grid cell, plus circles from
`obstacles()`. The player's 0.3 m circle is pushed out of anything it
overlaps, removing only the part of the move into the wall, so it slides.
`WallCollider.raycast()` answers "is a wall between these points?" for sound
and sight checks. See [controllers.md](controllers.md).

The run is won within 1.4 m of `exitPosition()` (`game/GoalWatcher.tsx`).

## Rendering

- **`Maze.tsx`** draws the wall slabs (instanced, one part per shape) and
  capstones along the tops (varied, some missing; seeded per maze). The stone
  material (Poly Haven old_stone_wall, KTX2) is projected in world space, with
  parallax occlusion and a bulge from the height map (`wallRelief.ts`, shared
  with the ivy), worn edges, damp bases, moss and sun-bleached tops.
- **`WallBatch.ts`** culls the walls in 6 m chunks around the camera, one draw
  per part. Walls draw first (`WALL_RENDER_ORDER`) so the vegetation behind
  them fails the depth test. A full copy of every part sits on
  `SHADOW_ONLY_LAYER`, drawn only by the shadow camera (its map is baked
  once and must see every wall).
- **`scene/MazeGround.tsx`** draws the forest-floor ground inside the maze,
  with the baked lightmap on it. Grass, flowers and ivy are in `scene/`; the
  grass and flowers keep off the footpath with `distanceToPath`.
- What's in the maze: `Goat.tsx`, `CoffeeBush.tsx`, `GoatReveal.tsx`,
  `Temesgen.tsx`, `WaterBottles.tsx` (see [gameplay.md](gameplay.md)).

> Verified: running the generator + a BFS solvability check over 200 mazes gave
> **200/200 solvable** and **200/200 unique** layouts.
