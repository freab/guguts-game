# Gameplay

> **Status legend:** ✅ in the game today · 🧭 designed, not built yet.
> Everything marked 🧭 is a proposal, with a build plan in
> [section 8](#8-build-plan).

## 1. The pitch

You wake at the mouth of a stone maze at dawn. The walls are older than anyone
remembers; tall grass has swallowed most of the corridors, and only a worn dirt
footpath shows where others walked before you. Somewhere inside are the keys to
the exit gate. The gate shuts at **sunset**. Something else lives in the grass.

Three pressures shape every run:

| Pressure | Pushes you to… | Counter-play |
|----------|----------------|--------------|
| **The sun** (time) | move fast, sprint the footpath | knowing the maze, good routing |
| **The Griever** (threat) | stay hidden, slow down in tall grass | line-of-sight tricks, patience |
| **The maze** (navigation) | explore, backtrack | the minimap you uncover as you go |

The fun is in trading them off: the footpath is fast but exposed, the grass is
safe but slow, and the sun doesn't wait.

---

## 2. What you can do today ✅

### Controls

| Action | Input |
|--------|-------|
| Move (relative to the camera) | `W` `A` `S` `D` or arrow keys |
| Run | hold `Shift` |
| Look around | **click** the scene to capture the mouse (`Esc` releases); or drag |
| Switch first / third person | `V`, or the buttons top-left |
| Zoom (third person) | mouse wheel |
| New maze | **New maze** button, or Controls → Game → New maze |

### Views

- **Third person** — the camera orbits behind the character and pulls in when a
  wall would block the view. Wider awareness; lets you peek over walls when you
  look down steeply.
- **First person** — eye height with a subtle head bob; your body is hidden.
  Tighter and tenser: you only see what's in your corridor.

### The world

- A random, always-solvable maze every time (recursive backtracker; see
  [maze.md](maze.md)). Start: top-left cell. Exit: the glowing **green** tile
  bottom-right, next to a gap in the outer wall.
- Tall FluffyGrass-style grass fills the corridors; a dirt **footpath** runs
  down the middle of each one where the grass is trodden short.
- Sun, sky and clouds, with god rays in the air between the walls.

### The minimap (bottom-right)

Shows the whole maze, your position and view direction (red arrow), the
camera's view cone (blue), and a debug view of which grass is being drawn.

### What's missing

There is **no objective yet**. You can walk to the green exit tile, but nothing
happens: the win loop (timer + "You escaped!") was removed when the old
controllers were replaced. `atExit(x, z)` still exists in
`maze/mazeData.ts`, and `ui/Hud.tsx` still has the run timer; neither is wired
up. Re-connecting them is [Phase A](#phase-a--the-escape-loop-returns).

---

## 3. Core loop 🧭

```
      ┌──────────────────────────────────────────────────────────────┐
      ▼                                                              │
  DAWN: spawn at the entrance ── explore ── find keys (1–3) ──┐     │
                                  ▲    │                       │     │
                     spotted? ────┘    ▼                       ▼     │
                   hide in grass   Griever hunts      reach the gate │
                                       │              before sunset  │
                                       ▼                       │     │
                                  CAUGHT → run over     ESCAPED → score,
                                                        next (bigger) maze ─┘
```

A run is **5–8 minutes** at the default size: long enough to get lost, short
enough to retry immediately.

---

## 4. Mechanics 🧭

### 4.1 The day clock: the sun *is* the timer

The run starts at dawn (sun low in the east) and ends at sunset (sun low in the
west). Instead of a number, you read time from the sky: shadow direction and
length, the colour of the light, and the god rays.

- **Day length:** 6 minutes at 8×8 cells, scaled with maze size (see
  section 6).
- **Last light:** in the final 45 s the sky reddens, the god rays turn orange,
  and the gate starts to grind shut (an audio cue).
- **Sunset = the gate closes.** If you're not through, the run fails.

**Performance note.** Moving the sun re-bakes the lighting: the sun's shadow
map, the ground lightmap (~0.8 s, spread across frames so it doesn't stutter)
and the sky light. So the sun must move in **steps** (e.g. every 20 s of game
time, ~18 steps per day), never continuously. Each step starts an async re-bake,
and the new lightmap swaps in when it's done.

### 4.2 Keys and the gate

- The exit gap in the outer wall is **closed by a gate** until you hold every
  key (1–3 depending on level; see section 6).
- **Placement:** keys go at **dead ends** (cells with one open neighbour),
  chosen from the ones **farthest** from the start by BFS over the maze grid.
  This guarantees keys are off the main route, so you have to explore and
  backtrack.
- **Pickup:** walk within 0.8 m. The key floats, glows, and casts a small point
  light so you can spot it down a corridor.
- With all keys, the gate opens (sound + the exit tile brightens). Reaching the
  tile (`atExit`) wins.

### 4.3 Two lanes: footpath vs tall grass

The footpath and the grass become a **risk/reward** choice rather than just
decoration:

| | Footpath (near the centre line) | Tall grass (the verges) |
|---|---|---|
| Speed | 100% | 75% (grass drags) |
| Noise when running | loud: heard at 12 m | quiet: heard at 5 m |
| Visibility to the Griever | fully visible | hidden when crouched still, half-visible when moving |
| Footstep sound | dry crunch | soft rustle |

Which lane you're in comes from `distanceToPath(x, z)` (already in
`maze/mazeData.ts`): within the footpath half-width = path, beyond the fade
zone = grass.

### 4.4 Stamina

- Sprinting (`Shift`) drains stamina in ~6 s; walking refills it in ~8 s.
- At zero you can't sprint until it's 30% full again: no permanent sprinting
  past the Griever.
- Shown as a thin bar under the crosshair (first person) or above the character
  (third person).

### 4.5 The Griever

A single hunter at the start (more at higher levels) that lives in the maze.

**Movement.** It walks the maze's walkway graph (`pathNetwork()`, the same
network the footpath follows) using grid BFS. Speed: walk 2.0 m/s (slower than
you), chase 5.0 m/s (faster than you walk, slower than your sprint). You escape
it with stamina and corners, not by outrunning it forever.

**Senses.**
- **Sight:** a 110° cone, 14 m range, blocked by walls. The line-of-sight check
  reuses `WallCollider.raycast` (the same grid-walk raycast as the camera arm
  and grass occlusion, so it's cheap). Tall grass halves the range at which it
  spots you; standing still in tall grass makes you invisible beyond 3 m.
- **Hearing:** running and footpath footsteps within the noise radii in
  [4.3](#43-two-lanes-footpath-vs-tall-grass) put it on alert.

**States:**

| State | Behaviour | Tell |
|-------|-----------|------|
| Patrol | wanders between random dead ends | low rumble, slow steps |
| Alert | heard something: walks to the last noise | a click, then silence |
| Chase | sees you: runs your path | roar, heavy fast steps |
| Search | lost sight: checks nearby corridors for ~10 s, then patrols | sniffing |

**Caught** (within 1 m while chasing) = the run is over.

**Fairness rules:** it never spawns within 25 m of you, never camps the keys or
the gate, and always gives an audio tell before a chase starts.

### 4.6 The map is earned: fog of war

Today the minimap shows the whole maze, which makes navigation trivial. In the
game:

- Cells are revealed as you **see** them: line of sight from the camera, the
  same test as grass occlusion, so corridors you glance down count.
- Keys appear on the map once seen; the gate is always shown.
- A rare **map scroll** pickup reveals a 5×5-cell area around it.
- The debug grass overlay moves behind a developer toggle.

### 4.7 First vs third person

Both views stay available; they're a difficulty choice, not a cosmetic one.

- **Third person** sees more: wider view, and it can peek over walls when
  looking down.
- **First person** is harder and tenser, so it earns a **×1.25 score
  multiplier** if you finish the whole run in first person.

---

## 5. Win, lose and score 🧭

**Win:** hold every key and reach the exit tile before sunset.
**Lose:** caught by the Griever, or the sun sets.

**Score** (shown on the results screen):

| Part | Points |
|------|--------|
| Escape | 1000 |
| Daylight left | +10 per second |
| Never spotted | +500 |
| Each time spotted | −50 |
| First person the whole run | ×1.25 total |

**Stars:** ★ escape · ★★ plus over 60 s of daylight left · ★★★ plus never
spotted.

Best score and time per maze size are kept in `localStorage`.

---

## 6. Progression & difficulty 🧭

Each escape unlocks the next level; each level is a fresh random maze.

| Level | Maze (cells) | Keys | Griever(s) | Day length |
|-------|--------------|------|------------|------------|
| 1 | 8 × 8 | 1 | 0 (tutorial) | 6 min |
| 2 | 10 × 10 | 2 | 1 | 7 min |
| 3 | 12 × 12 | 2 | 1 | 8 min |
| 4 | 14 × 14 | 3 | 2 | 9 min |
| 5+ | +2 per level | 3 | 2–3 | +1 min |

Maze size is set through `setMazeConfig()` (already used by the size sliders).
Level 1 has no Griever, so the controls, footpath and keys are learned without
pressure.

---

## 7. HUD & feedback 🧭

- **Top centre — sun dial:** a small arc showing the sun's progress to
  sunset; pulses red in the last 45 s.
- **Top left — keys:** `🔑 1 / 3`.
- **Centre — stamina:** thin bar (only visible while not full).
- **Edge vignette — danger:** pulses when the Griever is alerted, stronger in a
  chase (reuses the post-processing vignette).
- **Bottom right — minimap:** fog of war, keys, gate.
- **Audio:** footsteps (path vs grass), wind in the grass, Griever tells, the
  gate grinding, a heartbeat that rises with proximity.

---

## 8. Build plan

Each phase ships something playable on its own.

### Phase A — The escape loop returns
Wire `atExit()` into the player loop; show the run timer (`ui/Hud.tsx`) and a
"You escaped!" results screen with **Play again** (new maze).
*Touches:* `character/PlayerController.tsx`, `scene/SceneClient.tsx`, `ui/Hud.tsx`.
*Done when:* reaching the green tile ends the run and shows the time.

### Phase B — The day clock
A run clock that steps the sun from dawn to sunset; stepped re-bakes; sunset
fails the run.
*Touches:* `scene/Scene.tsx` (sun direction from the clock instead of the
sliders during a run), `scene/bake/*`.
*Done when:* the sun visibly moves over a run with no stutter, and sunset ends it.

### Phase C — Keys and the gate
Dead-end BFS placement; key pickups; a gate mesh in the exit gap; win needs all
keys.
*Touches:* `maze/mazeData.ts` (dead ends, BFS distances), new `maze/Keys.tsx`,
`maze/Maze.tsx` (gate).
*Done when:* keys spawn in far dead ends and the exit only opens with all of them.

### Phase D — Lanes and stamina
Speed and noise from `distanceToPath`; stamina drain/refill; footstep audio.
*Touches:* `character/PlayerMotor.ts`, `character/config.ts`, new HUD bar.
*Done when:* running the path is fast but loud; the grass is slow and quiet.

### Phase E — The Griever
Graph pathfinding on `pathNetwork()`; sight (cone + `WallCollider.raycast`) and
hearing; patrol / alert / chase / search; the caught state.
*Touches:* new `enemy/` module (controller, senses, model), `playerStore`
(noise level, lane).
*Done when:* it can be evaded by hiding in grass and breaking line of sight.

### Phase F — Fog-of-war minimap
Reveal seen cells; show keys once seen; move the grass debug overlay behind a
toggle.
*Touches:* `ui/Minimap.tsx`, a `revealStore` fed by line-of-sight checks.
*Done when:* a fresh run shows only the corridors you've looked down.

### Phase G — Levels, score, best times
The level table, results screen with score and stars, `localStorage` bests.
*Touches:* `scene/SceneClient.tsx`, new `game/progression.ts`.
*Done when:* escaping advances the level and bests persist across reloads.

### Performance budget for gameplay

The renderer is already tuned (baked lighting, culled grass). Gameplay must not
undo that:

- **AI:** BFS distances computed once per maze; per-frame work is steering
  plus a handful of grid raycasts (≈ microseconds each).
- **Sun:** stepped, never continuous (see [4.1](#41-the-day-clock-the-sun-is-the-timer)).
- **Fog of war:** reveal checks a few frames apart, not every frame.
- **Keys / gate:** a few meshes and one small light each; no extra shadows.

---

## 9. Tuning reference (current values ✅)

| Setting | Value | Where |
|---------|-------|-------|
| Walk / run speed | 2.2 / 5.5 m/s | Controls → Player; `character/config.ts` |
| Collision radius | 0.3 m | `character/config.ts` |
| Character height | 1.8 m (auto-fitted) | `character/config.ts` |
| First-person eye height | 1.65 m | `character/config.ts` |
| Third-person distance | 4.2 m (scroll to zoom) | Controls → Player |
| Maze size | 8 × 8 cells, 2 m corridors | Controls → Game → Size |
| Wall height / thickness | 2.5 m / 0.64 m | `maze/mazeData.ts` |
| Footpath half-width | 0.45 m | Controls → Game → Footpath |
