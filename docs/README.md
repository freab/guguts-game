# Gugut Maze — Documentation

Everything about the project, organized by area. Start with the
[main README](../README.md) for how to run and play.

## Index

| Doc | What it covers |
|-----|----------------|
| [architecture.md](architecture.md) | The `app/` folder structure and how the pieces fit together. |
| [gameplay.md](gameplay.md) | Controls, the win/restart loop, and the phased build roadmap. |
| [maze.md](maze.md) | Maze generation, the grid model, collision, and world↔grid math. |
| [controllers.md](controllers.md) | The two character controllers (physics vs. foot-lock IK). |
| [ui.md](ui.md) | HUD timer, minimap, and the leva controls panel. |
| [foot-locking-plan.md](foot-locking-plan.md) | The two-bone IK / foot-locking implementation. |

## Quick mental model

```
page.tsx → scene/SceneClient.tsx (UI shell + overlays + leva)
                    │
                    └── scene/Scene.tsx (Canvas, lights, camera)
                            ├── character/ (the player)
                            ├── maze/      (walls + data + collision)
                            └── ui/        (drawn as HTML over the canvas)
```

The maze lives in a small module (`maze/mazeData.ts`) that every part reads
from, so the walls, collision, minimap, spawn point, and win check all agree on
one layout.
