# Architecture

The code lives under `app/` (Next.js App Router). Source is grouped into
**categorized folders** by responsibility.

```
app/
├── page.tsx              # Next.js route — renders <SceneClient/>
├── layout.tsx            # Root HTML layout + fonts
├── globals.css           # Tailwind + global styles
│
├── scene/                # Scene composition & the client shell
│   ├── SceneClient.tsx   # UI shell: mode toggle, overlays, timer, minimap, leva
│   └── Scene.tsx         # The R3F <Canvas>: lights, camera, mounts a controller + maze
│
├── character/            # The player controllers
│   ├── EcctrlPlayer.tsx  # Physics controller (ecctrl capsule) — the main game mode
│   ├── Character.tsx     # Foot-lock IK controller (custom movement + two-bone IK)
│   ├── twoBoneIK.ts      # The IK solver used by Character.tsx
│   └── _archive/         # Backups of earlier IK experiments (.bak, not compiled)
│
├── maze/                 # Everything about the maze itself
│   ├── mazeData.ts       # Grid generation + all world↔grid helpers (source of truth)
│   ├── Maze.tsx          # Renders the floor + walls (with or without physics colliders)
│   └── playerState.ts    # Tiny store for the player's live position (read by the minimap)
│
└── ui/                   # HTML overlays drawn on top of the canvas
    ├── Hud.tsx           # Run timer (top-center)
    └── Minimap.tsx       # 2D top-down minimap (bottom-right)
```

## Data flow

- **One maze, many readers.** `maze/mazeData.ts` holds the current grid in a
  module variable. `Maze.tsx` reads it to draw walls; the controllers read it for
  collision and the win check; `Minimap.tsx` reads it to draw the map. Because
  everyone imports the same module, they always agree.

- **Restart = regenerate + remount.** `SceneClient` keeps a `runId`. Clicking
  *New maze* / *Play again* calls `regenerateMaze()` then bumps `runId`, which is
  part of the `<Scene key={...}>`. Changing the key remounts the whole scene, so
  the player respawns at the start of the fresh maze.

- **Player position → minimap.** Each controller writes its `(x, z)` to
  `playerState` every frame; the minimap reads it on its own animation loop, so
  the dot tracks the player without triggering React re-renders.

- **Win signal bubbles up.** A controller detects `atExit(x, z)` and calls the
  `onWin` prop → `Scene` → `SceneClient`, which shows the overlay and freezes the
  timer.

## Rendering notes

- The scene is imported with `dynamic(() => import("./Scene"), { ssr: false })`
  because drei's GLTF loader touches browser-only globals — it must not run
  during server-side rendering.
- Physics (Rapier `<Physics>`) wraps only the Maze mode. The foot-lock mode has
  no physics, so `Maze` renders plain meshes there and the controller collides
  against the grid instead.
