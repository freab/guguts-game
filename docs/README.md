# Gugut & the Goat — Documentation

Everything about the project, organized by area. Start with the
[main README](../README.md) for the story, how to play and how to run it.
The code is the source of truth; these docs point into it.

## Index

| Doc | What it covers |
|-----|----------------|
| [gameplay.md](gameplay.md) | A run start to finish: setup and levels, controls, the run store, goat calls, water bottles, Temesgen, the intro fly-in, the goat reveal and win shot, results and sharing, the sunset, wind and leaf shadows, voiceovers, graphics presets. Old unbuilt ideas at the end. |
| [audio.md](audio.md) | The Web Audio graph, every sound, Gugut's voice (`say` / `hush`), the music swell, and building the audio sprites with `npm run audio`. |
| [architecture.md](architecture.md) | The `app/` folder structure, the stores and how the pieces fit together, loading, rendering notes, `#debug`. |
| [ui.md](ui.md) | Title screen and preloader, intro overlay, HUD, dialogs, the end of a run, and the `#debug` tools (leva, minimap). |
| [maze.md](maze.md) | Maze generation, the clearing, the grid model, world↔grid helpers, collision, wall rendering. |
| [controllers.md](controllers.md) | The first-person player controller: input, motor, collision, look, camera, sitting. |
| [foot-locking-plan.md](foot-locking-plan.md) | History: the two-bone IK / foot-locking work for an old third-person controller that is no longer in the game. |

## Quick mental model

```
page.tsx → scene/SceneClient.tsx   (UI shell: title screen, HUD, dialogs, keys)
              │
              ├── ui/              (HTML over the canvas)
              ├── game/Monologue   (voiceover triggers)
              └── scene/Scene.tsx  (Canvas: lights, sky, post)
                      ├── character/   (first-person player)
                      ├── maze/        (walls, goat, bush, Temesgen, bottles)
                      ├── scene/…      (grass, flowers, ivy, tree, atmosphere, bakes)
                      └── game/        (GoalWatcher, GoatVoice: the run from inside the loop)

game/runStore.ts — the run's state, read by both sides
audio/audioEngine.ts — all sound
```

The maze lives in one module (`maze/mazeData.ts`) that every part reads, so
the walls, collision, maps, spawn point, bottles and goal check all agree on
one layout.
