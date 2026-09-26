# Gugut Maze

A 3D **maze-escape game** (Maze Runner style) built with Next.js and React
Three Fiber. A rigged character spawns in a randomly generated maze and has to
find the exit; a timer tracks how fast you escape.

![modes: Maze (physics) + Foot-lock IK](docs/foot-locking-plan.md)

## Play

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

## Credits

The grass look, tuft model (`public/grassLODs.glb`) and blade alpha mask
(`public/grass.jpeg`) come from [FluffyGrass](https://github.com/thebenezer/FluffyGrass)
by Ebenezer, MIT License. See `FLUFFYGRASS_LICENSE`. The shading here is a TSL
(WebGPU node material) re-implementation.

- **Move:** `W` `A` `S` `D` or arrow keys
- **Run:** hold `Shift`
- **Jump:** `Space` (physics mode only)
- **Goal:** reach the glowing **green** tile → "You escaped!"
- **New maze:** the toolbar button, the leva panel button, or "Play again" after escaping

## Two character controllers

The toolbar switches between two ways of driving the character in the same maze:

| Mode | Engine | Notes |
|------|--------|-------|
| **Maze** | [ecctrl](https://github.com/pmndrs/ecctrl) physics capsule | The main game mode: gravity, jump, physics wall-collision, follow camera. |
| **Foot-lock IK** | Custom controller + two-bone IK | An animation-quality showcase: grid-based collision, foot-locking IK so feet don't slide. Orbit camera. |

## Tech stack

- **Next.js 16** (App Router, client-only WebGL via `dynamic({ ssr: false })`)
- **React Three Fiber** + **drei** — the 3D scene
- **Rapier** (`@react-three/rapier`) — physics for the Maze mode
- **ecctrl** — third-person physics character controller
- **leva** — live tuning panel (lighting, player speed, minimap toggle)
- **Tailwind CSS v4** — HUD / overlay styling

## Documentation

See [`docs/`](docs/README.md) for a full write-up:

- [Architecture](docs/architecture.md) — folder-by-folder map of the code
- [Gameplay & phases](docs/gameplay.md) — controls, win loop, and the build roadmap
- [Maze system](docs/maze.md) — generation, collision, coordinate helpers
- [Controllers](docs/controllers.md) — the two character controllers compared
- [UI & leva](docs/ui.md) — HUD, minimap, and the controls panel
- [Foot-locking plan](docs/foot-locking-plan.md) — the IK implementation notes
