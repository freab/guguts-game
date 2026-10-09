# Architecture

The code lives under `app/` (Next.js 16 App Router) and is grouped into
folders by responsibility. Rendering is three.js on the WebGPU renderer
(`three/webgpu`, with a WebGL2 fallback), through React Three Fiber. Shaders
are TSL node materials; there is no GLSL.

```
app/
├── page.tsx, layout.tsx, globals.css, fonts.ts, site.ts, manifest.ts
├── quality.ts             # Low / Medium / High graphics presets
├── opengraph-image.tsx    # the site's link-preview card
│
├── scene/                 # The client shell and the 3D scene
│   ├── SceneClient.tsx    # UI shell: title screen, HUD, dialogs, keys, leva (#debug)
│   ├── Scene.tsx          # The <Canvas>: lights, sky, fog, mounts everything below
│   ├── IntroFlight.tsx    # Intro camera flight
│   ├── WinShot.tsx        # Camera on reaching the goat
│   ├── dusk.ts, Sunset.tsx  # The sunset over the run
│   ├── wind.ts            # Shared gust curve (audio + vegetation)
│   ├── sunUniforms.ts     # Sun direction / colour for shaders
│   ├── Grass.tsx, Flowers.tsx, Vines.tsx, MapleTree.tsx, MazeGround.tsx, InfiniteGrid.tsx, SkyEnvironment.tsx
│   ├── grass/ flowers/ vines/ tree/ sky/ textures/   # Their geometry, materials and culling
│   ├── atmosphere/        # Birds, Particles (dust, fireflies), GustLeaves
│   ├── bake/              # Ground lightmap, bake tracking, loading stages
│   ├── post/              # Post-processing (god rays, bloom, vignette, lens flare)
│   └── perf/              # GPU profiler for #debug
│
├── character/             # The first-person player (see controllers.md)
│
├── maze/                  # The maze and what's in it
│   ├── mazeData.ts        # Grid generation, clearing, world↔grid helpers (source of truth)
│   ├── levels.ts          # Easy / Medium / Hard
│   ├── Maze.tsx, WallBatch.ts, wallRelief.ts   # Walls (chunked, stone material)
│   ├── Goat.tsx, CoffeeBush.tsx, GoatReveal.tsx
│   ├── Temesgen.tsx       # Temesgen and his song's 3D level
│   └── WaterBottles.tsx
│
├── game/                  # Game state and logic, outside React rendering
│   ├── runStore.ts        # Run phases, clock, pauses, calls, bottles, notices
│   ├── intro.ts           # Intro fly-in phases
│   ├── temesgen.ts        # Temesgen: near / talking / song / seated / calm, mazeHint
│   ├── bottles.ts, bottleFocus.ts   # Where the water is, and drinking it
│   ├── goat.ts            # Where the goat is; on Hard she runs from calls
│   ├── goatAnswer.ts      # Where and when the goat's last answer came from
│   ├── GoalWatcher.tsx    # Starts the clock, detects reaching her
│   ├── GoatVoice.tsx      # Calls, bleats, first sight of her, her flight on Hard
│   ├── Monologue.tsx      # Gugut's voiceover triggers
│   ├── preferences.ts     # Call key, captions, voice, graphics (localStorage)
│   └── profile.ts         # Player id and name
│
├── audio/                 # audioEngine.ts (see audio.md), Footsteps.tsx
├── ui/                    # HTML overlays (see ui.md)
├── hooks/                 # useDisposable, useHashRoute, useDefaultsVersion
│
├── leaderboard/           # store (Upstash Redis or .data/ JSON), shared rules, client, rate limit
├── api/                   # leaderboard, player (rename), share (share id) routes
├── share/                 # Share card drawing, share links, OG card
└── s/[id]/                # A player's public page and its link-preview card
```

Build scripts are in `scripts/`: `build-audio.mjs` (`npm run audio`, see
[audio.md](audio.md)) and `build-textures.mjs` (`npm run textures`, KTX2).

## Data flow

- **Small stores, not React state.** Game state lives in module stores with a
  `subscribe` and a `useX()` hook built on `useSyncExternalStore`:
  `runStore`, `intro`, `temesgen`, `bottleFocus`, `goatAnswer`,
  `preferences`, `profile`, `loadingStore`. The 3D loop reads them with
  `get()` each frame; the UI re-renders only when they change.

- **Per-frame values skip React.** `character/playerStore.ts` holds the
  player's position, facing and speed, written by the `PlayerController` every
  frame and read by the goal check, footsteps, vegetation culling (grass,
  flowers, ivy, tree), Temesgen, the bottles, the minimap, the call map, the
  bleat indicator and Monologue. Shaders read uniforms (`dusk`, `windTime`, `revealGlow`, sun
  uniforms).

- **One maze, many readers.** `maze/mazeData.ts` holds the grid in a module
  variable. Walls, collision, grass, flowers, bottles, the minimap, the call
  map and the intro flight all read it, so they always agree.

- **One goat position.** `game/goat.ts` holds where the goat is (the exit
  tile, until she runs on Hard). The goal check, her bleat, first sight, the
  call map, the reveal and the win shot read `goat.position()`;
  `maze/Goat.tsx` resets it per maze and moves her each frame
  (`goat.update`).

- **Level pick and restart remount the scene.** `SceneClient` keeps a `runId`
  that is part of `<Scene key>`. Picking a level calls `setMazeConfig()`;
  *Play again* calls `regenerateMaze()`. Both call `applyGraphicsToPanel()`,
  reset the loading stage and bump `runId`. The preloader runs again, and once
  it is entered, `runStore.arm()` starts a fresh run.

- **Watchers inside the Canvas.** Components that render `null` drive the
  game from `useFrame` or store subscriptions: `GoalWatcher`, `GoatVoice`,
  `IntroFlight`, `WinShot`, `Sunset`. `IntroFlight` and `WinShot` are mounted
  after `PlayerController`, so each frame they start from the player's camera
  and override it.

- **Monologue is outside the Canvas.** `game/Monologue.tsx` is mounted by
  `SceneClient` per run and listens to `runStore` and `temesgen`.

## Loading

`ui/LoadingOverlay.tsx` covers the scene until `loadingStore.stage` is
`ready`. The stages are `assets` → `baking` (the ground lightmap, sliced
across frames) → `compiling` → `warming` → `ready`, weighted 55 / 25 / 15 / 5%
on the counter. The player then presses **Enter the maze**; `entered` plus
`ready` lets the intro play, the ambience start and the run arm.

## Rendering notes

- The scene is imported with `dynamic(() => import("./Scene"), { ssr: false })`.
  `SceneClient` also prefetches it on the title screen.
- Lighting is mostly baked: the sun's shadow map (walls only) and the ground
  lightmap (`scene/bake/lightmap.ts`). This is why the sun's direction never
  changes during a run (see the sunset in [gameplay.md](gameplay.md#8-the-living-world)).
  Moving things use a `BlobShadow`.
- Dispose GPU resources with `hooks/useDisposable`, never `useMemo` plus an
  effect cleanup. StrictMode would otherwise destroy resources still in use.
- When a leva default changes, bump `DEFAULTS_VERSION`
  (`hooks/useDefaultsVersion.ts`) so open pages reload once and pick it up.
- `/#debug` (`hooks/useHashRoute.ts`) shows leva, the minimap, Stats, the
  perf readout and the maze buttons. The normal game shows none of them.
