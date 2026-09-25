# Gameplay & Build Phases

## Controls

| Action | Keys |
|--------|------|
| Move | `W` `A` `S` `D` or arrow keys |
| Run | hold `Shift` |
| Jump | `Space` (Maze/physics mode only) |
| Orbit camera | drag (Foot-lock mode); Maze mode follows automatically |
| Zoom | mouse wheel |

## The loop

1. You spawn at the top-left of the maze.
2. Navigate the corridors to the glowing **green** exit tile at the bottom-right.
3. Reaching it shows **"You escaped!"** with your time.
4. **Play again** (or **New maze**) generates a brand-new maze and respawns you.

The run **timer** (top-center) starts on spawn and freezes on escape. A
**minimap** (bottom-right) shows the whole maze, your position (red dot), and the
exit (green).

## Win detection

`maze/mazeData.ts` exposes `atExit(x, z)`, true when the player is within
`EXIT_RADIUS` of the exit tile. Each controller checks it every frame and fires
`onWin` once. See [controllers.md](controllers.md).

## Build phases (roadmap)

The game was built in phases. ✅ = done.

- ✅ **Phase 1 — Maze + walls.** Grid model, walls as physics/mesh boxes, real
  floor, player spawns at the start. (See [maze.md](maze.md).)
- ✅ **Phase 2 — Win condition.** Exit tile + detection, "You escaped!" overlay,
  restart. Works in both modes.
- ✅ **Phase 3 — Random mazes.** Recursive-backtracker generation at runtime —
  every run is a new, always-solvable maze (verified 200/200 solvable & unique).
- ✅ **Phase 4 — Game feel.** Run timer/HUD, minimap, leva tuning panel, wider
  foot-lock zoom. (See [ui.md](ui.md).)

### Possible next phases

- **Enemies / hazards** that chase the player (the "Grievers").
- **Collectibles / keys** required before the exit opens.
- **Multiple levels** with increasing maze size (bump `CELLS_W`/`CELLS_H`).
- **Camera collision** so the Maze-mode follow camera never clips into walls.
- **Fog of war** — only reveal corridors near the player on the minimap.
- **Best-time leaderboard** (store fastest escape in `localStorage`).
