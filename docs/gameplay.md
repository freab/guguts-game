# Gameplay

Gugut's goat ate the red berries and ran into the maze. You play Gugut, in
first person, and you have to find her. There is no time limit: the clock only
measures how long it took. Everything here is in the game today; the last
section lists old ideas that were never built.

## 1. A run, start to finish

```
title screen ── Graphics + Voiceovers ── Easy / Medium / Hard
      │
      ▼
story + loading counter ── "Enter the maze"
      │
      ▼
intro fly-in (skippable) ── first step starts the clock
      │
      ▼
search: call the goat, find water, visit Temesgen
      │
      ▼
first sight of her (glow + swell) ── reach her ── win shot + outro story
      │
      ▼
results: time, stars, badges, leaderboard, share
```

1. **Title screen** (`ui/LoadingOverlay.tsx`). First, once a visit, the
   `SetupChooser` asks for **Graphics** (Low / Medium / High) and
   **Voiceovers** (On / Off). Continue saves both (`game/preferences.ts`) and
   goes on to the level chooser. The chooser has a small
   "Medium graphics · Voice on · change" link back to the setup step.
2. **Levels** (`maze/levels.ts`): Easy 8 × 8, Medium 14 × 14, Hard 20 × 20
   cells, all with 2 m corridors. On Hard the goat runs when you call (see
   [section 4.4](#44-hard-she-runs-when-you-call--gamegoatts)). Picking one
   burns the title picture away (`ui/DissolveCanvas.tsx`) to the story, while
   the scene loads, bakes and compiles behind it. At 100% the counter becomes **Enter the maze**.
3. **Intro fly-in** (see [section 5](#5-the-intro-fly-in)). The game is
   paused while it plays.
4. **The search.** The run is *armed*; the clock starts on the first step.
5. **The goat** starts on the exit tile at the far corner, next to the coffee
   bush. On Easy and Medium she stays there; on Hard she moves. Seeing her and reaching her both get a reveal (see
   [section 6](#6-finding-her)).
6. **Results** (`ui/GameOver.tsx`), after the outro story.

## 2. Controls

| Action | Computer | Phone / tablet |
|--------|----------|----------------|
| Walk | `W` `A` `S` `D` or arrow keys | left thumb stick |
| Run | hold `Shift` | push the stick all the way |
| Look | mouse (click the view to capture it, `Esc` lets go); or drag | right thumb drag |
| Call the goat | `C` (rebindable in Settings), or the Call button | Call button, bottom right |
| Drink / Talk | `E`, or click the prompt | Drink / Talk button |
| Pause | `P` or the pause button (also when the tab is hidden) | pause button |
| Music on / off | `M` or the speaker button | speaker button |
| Skip the intro | `Space`, `Enter`, `Esc`, a click | tap |

Keys live in `scene/SceneClient.tsx` (C, E, P, M, Esc),
`character/PlayerController.tsx` (`KEYBOARD_MAP`: movement and run) and
`ui/IntroOverlay.tsx` (skip). Keys the call can't be rebound to are in
`RESERVED_KEYS` in `game/preferences.ts`. Phones also get a "turn sideways"
prompt in portrait (`ui/RotatePrompt.tsx`), which pauses the game.

The controls help (`ui/ControlsHelp.tsx`) shows on the first run on a device,
and from the pause menu.

## 3. The run state — `game/runStore.ts`

```
idle ─(scene ready)→ armed ─(first step)→ running ─(reach the goat)→ won
```

- `arm(level, ranked)` is called by `SceneClient` once the scene is ready.
  `ranked` is false when the maze size was changed in `#debug`: only a
  level's own size goes on the leaderboard.
- `game/GoalWatcher.tsx` starts the clock when the player's ground speed goes
  over 0.3 m/s, and finishes the run within 1.4 m of the goat, wherever she
  is (`goat.position()`).
- **Pausing.** `setPaused(reason, on)` with reasons `menu`, `dialog`, `help`,
  `rotate`, `talk` and `intro`. The clock stops while any reason holds, and
  `elapsed()` leaves the paused time out. `inputBlocked()` is true while
  paused or won.
- **Timestamps.** `calledAt` (last call), `dryAt` (last call with no voice),
  `heardAt` (heard her while calm at Temesgen's), `sawAt` (first sight of
  her), `startedAt` / `finishedAt`. Other parts of the game watch these
  change through `runStore.subscribe`.
- **Notices.** `notice` is a short message (calls used up, water found, heard
  her) shown by `ui/GameNotice.tsx`. `notify(text)` posts any other one
  (the goat bolting on Hard).
- `WIN_SHOT_MS = 3800`: how long after reaching her the outro story starts to
  burn in.

## 4. Search tools

### 4.1 Calling the goat

`GOAT_CALLS = 3`. `runStore.callGoat()` (the C key, the HUD button
`ui/CallButton.tsx`, or the pause menu) uses one call and sets `calledAt`.

- **The map.** `ui/CallMap.tsx` flashes a bare top-down map of the walls,
  Gugut (an arrow) and the goat (pulsing). It stays up for `CALL_MAP_MS`
  (3.2 s) and fades over `CALL_MAP_FADE_MS` (1.2 s).
- **Her answer.** `game/GoatVoice.tsx` plays the call, then her bleat from
  where she is now: HRTF-panned, later and quieter with distance, muffled
  if a wall is in the way (a `WallCollider` raycast). With voiceovers on, the
  call is Gugut shouting her name; otherwise it is a two-note whistle.
- **On screen.** `ui/BleatIndicator.tsx` draws an arc on a ring around the
  centre of the view pointing to her, and, if captions are on (Settings), a
  caption like "Goat bleats — behind you, to the left, far away". It works
  without sound: with no audio she "answers" after 1.2 s.
- **Running dry.** The last call posts "That was your last call…". A call
  with no voice left plays a dry rasp (`audio.dryCall`), sets `dryAt` and
  posts "Your throat is too dry to call…". The call button's pips go empty
  and show a water drop.

### 4.2 Water bottles

`BOTTLES = 2`. `game/bottles.ts` hides them at dead ends (cells with one open
neighbour, not in the clearing), each far from the start, the goat and the
other bottle. The placement is seeded by the maze's `treeSeed`, so one maze
always hides them in the same places.

`maze/WaterBottles.tsx` draws small glass bottles on the path that glint every
2.6 s. Within 1.8 m and looking at one, it glows and `ui/DrinkPrompt.tsx`
offers **Drink** (`game/bottleFocus.ts`). Drinking flies the bottle up to the
view, tips Gugut's head back (`character/viewTilt.ts`), plays the cork, gulps
and breath (`audio.drink`), and flashes a cool blue edge
(`ui/DrinkVignette.tsx`). `runStore.drink(i)` puts the calls back to 3.

### 4.3 Temesgen — `game/temesgen.ts`, `maze/Temesgen.tsx`

Temesgen sits with his back to the maple in the central clearing, facing the
start corner (`mazeData.restingSpot()`), playing his kirar. He is a static
scan animated in the vertex shader: he strums, breathes, looks at you and
sways, in time with the song's energy (`audio.songEnergy()`).

- **Seen.** The first time he is in view, 3–18 m away with no wall between,
  `temesgen.see()` runs (Gugut's "Temesgen" voiceover).
- **A phrase.** Walking into the clearing while he isn't playing, he plays a
  few bars (from 21 s, for 7 s), at most once a minute.
- **Talk.** Within 2.3 m and looking at him, `ui/TalkPrompt.tsx` shows; `E`
  opens `ui/TemesgenDialog.tsx` (the game pauses). Choices by click, number
  keys, Enter (first) or Esc (leave).
  - "Have you seen my goat?" — he hasn't, but offers a song.
  - "Yes — play me a song" — `temesgen.playSong()`: the whole song, heard
    from where he sits, full volume within 2.5 m and silent past 20 m. Gugut
    walks to a spot in front of him and sits on the grass
    (`character/Seat.ts`; the view drops 0.55 m).
  - After finding a bottle, a third question appears: "You know these walls
    — where would a goat go?". His answer (`mazeHint()`) gives her direction
    from the tree relative to the setting sun: towards it, away from it, or
    on your left or right hand.
  - Coming back while he plays: sit again, or ask him to stop.
- **Calm.** Sitting and listening fills a calm bar (`ui/SeatedHint.tsx`) over
  `CALM_AFTER` = 30 s. Time adds up if you get up and sit again. When it is
  full, `runStore.hearGoat()` sets `heardAt`: her bleat plays from where she is
  (the song dips under it) and the direction arc shows, without using a call.
  It happens once a run.
- **Standing up.** Any move key, the stick, or the "Stand up" button. The
  song keeps playing behind you.

### 4.4 Hard: she runs when you call — `game/goat.ts`

The goat's position lives in a small module, `goat`. `goat.reset()` puts
her on the exit tile facing back into the maze (`maze/Goat.tsx` calls it per
maze). On Easy and Medium she never moves.

On **Hard**, each call makes her run (`GoatVoice` `fleeAfter`):

- 0.6 s after her answer is heard, unless Gugut is within 4 m of her.
- `goat.flee(px, pz)` walks the maze from her tile, out to 10 tiles, and
  picks the tile that is furthest from Gugut by walking distance. Her route
  never comes within 3 tiles of him, so she may dart a little his way into a
  side passage but never runs past him. She never leaves through the exit gap
  or enters the clearing. Cornered in a dead end with him at its mouth, she
  stays.
- She trots there at 1.9 m/s, turning to face her way, with a small bob
  (`maze/Goat.tsx`). A call while she is already running does nothing more.
- The first time she bolts, a notice says "She heard you — and bolted deeper
  into the maze. Call less, follow more."
- Hearing her while calm at Temesgen's does **not** make her run.

Everything that needs her reads `goat.position()`: reaching her, her bleat,
first sight, the call map, the reveal and the win shot. Three things stay with
the exit tile, where she started: the coffee bush, the bottle placement, and
Temesgen's hint (`mazeHint()` points from the tree to the exit, so on Hard
it tells you where she began, not where she is).

## 5. The intro fly-in

`game/intro.ts` is a small store:

```
idle ─(scene mounts)→ ready ─(preloader gone)→ playing ─(flight ends)→ done
                                                  └─(skip)→ skipping ─(fade to black)→ done
```

- `scene/IntroFlight.tsx` (mounted after the `PlayerController`, so each frame
  starts from the player's own view) flies a Catmull-Rom curve. It starts low
  in the clearing looking up at the maple, pulls back over the walls, glides
  to the start corner and lands in Gugut's eyes. It turns from the tree to his
  view over 35–92% of the flight. The flight takes 5–7.5 s, longer for bigger
  mazes. It stays just over the walls because the fog ends the world at the
  view distance.
- `ready` holds the first shot so the preloader's last burn reveals it.
- `ui/IntroOverlay.tsx` draws the cinematic bars, the level's name and blurb,
  and a skip prompt after 0.7 s. Skipping fades to black over 350 ms, then
  `intro.finish()`.
- While `playing` or `skipping`, `SceneClient` pauses the run (`"intro"`) and
  hides the HUD and touch controls.

## 6. Finding her

- **First sight** (`game/GoatVoice.tsx`): her current position within 16 m, in view, with no wall
  between, checked every 0.2 s while running. `runStore.seeGoat()` sets
  `sawAt`. Gugut says "found her!" (interrupting anything else), and the music
  swells (`audio.swell(1)`).
- **The reveal** (`maze/GoatReveal.tsx`): a warm pool of light on the ground,
  a faint shaft from above and 70 motes drifting up around her. While she is
  home it is centred between her and the coffee bush; once she has run, it
  follows her. All of it is additive and shader-driven, scaled by `revealGlow`. The
  glow rises over 2.5 s after first sight and settles to 0.6. The goat gets a
  matching rim light (`revealRim()`, used by `maze/Goat.tsx`). These meshes
  are always drawn (black until needed) so the loading warm-up compiles them.
- **Reaching her** sets `won`. The glow blooms to 2.2 over 1.6 s and a bigger
  swell plays (`audio.swell(1.4)`). Gugut says "found her!" if he hadn't seen
  her yet, then "congrats".
- **The win shot** (`scene/WinShot.tsx`, mounted after the
  `PlayerController`, which holds Gugut still): the view turns onto her face
  (where she is now) over 1.6 s and pushes in 0.3 m (never closer than 0.85 m), then flies up 8 m
  and back 6 m over 5 s, looking down at the two of them.
- **The outro story** (`ui/OutroStory.tsx`): `GameOver` waits `WIN_SHOT_MS`,
  then the preloader's sky picture burns in over the maze (`DissolveCanvas`,
  mode `"in"`). The end of the story writes itself in word by word (the
  berries, the monks, buna) and **See how you did** goes to the results. The
  text and button pieces are shared with the preloader in
  `ui/storyParts.tsx`.

## 7. Results, leaderboard, sharing

`ui/GameOver.tsx` shows:

- **Time:** `finishedAt − startedAt − pausedTotal`.
- **Stars** for calls used: 0 calls = 3 stars, 1–2 = 2, 3 or more = 1.
- **Badges:** *Silent tracker* (no calls), *Well watered* (both bottles),
  *Parched* (calls used, none left, no water found).
- **Leaderboard:** ranked runs are submitted at once, while the story is
  read (`leaderboard/client.ts` → `POST /api/leaderboard`). Each player keeps
  their best time per level. The store is Upstash Redis when its env vars are
  set, otherwise a JSON file in `.data/` (`leaderboard/store.ts`).
- **Buttons:** Play again (a new maze), Share, Change level, Change name,
  Credits.
- **Share** (`ui/ShareDialog.tsx`, `share/shareCard.ts`): a card image in
  three shapes (post 4:5, story 9:16, wide), the phone's share sheet, save,
  X / Telegram / WhatsApp / Facebook links and copy link. Links point to the
  player's public page `/s/<share id>`. The share id is a one-way hash of the
  secret player id, so links can't be used to rename or submit. The link
  preview card is drawn on the server from the leaderboard
  (`share/ogCard.tsx`), so a shared time can't be faked.

## 8. The living world

### The sunset over the run — `scene/dusk.ts`, `scene/Sunset.tsx`

`dusk` goes from 0 when the run starts to 1 at the level's sunset time (Easy
240 s, Medium 420 s, Hard 600 s; eased), then holds. It never gets dark and
you can't lose to it.

The sun's direction is baked (its shadow map, the ground lightmap), so **the
sun never moves**. Only the colours, the sky and the rays change:

- Every frame (`Sunset.tsx`): the sun light deepens to orange and dims, the
  ambient warms, the hemisphere fill turns pink-violet. Each light moves from
  its tuned leva value towards the `DUSK` target.
- The god rays warm and thicken (`post/PostEffects.tsx` reads `dusk`).
- More fireflies come out and get brighter (`atmosphere/Particles.tsx`).
- The sky is re-baked hazier and more orange in `DUSK_STEPS` = 10 steps
  (`useDuskStep()` in `Scene.tsx`). Each step is a small, one-frame cost.

`#debug` has a *Dusk preview* slider to hold it at a value.

### Wind gusts — `scene/wind.ts`

One gust curve, `gustAt(t)`, on one clock, shared by sound and picture:

- The wind recording swells with it (`audio/audioEngine.ts`).
- Grass, flowers, the maple and the ivy sway by `gustScale()`: 0.35× in a lull
  to 1.65× in a strong gust. The curve is delayed by how far downwind of the
  player each spot is, so a gust rolls across the field at 6 m/s and reaches
  the player as it is heard.
- Strong gusts blow leaves past (`atmosphere/GustLeaves.tsx`): 16 / 28 / 40
  leaves (Low / Medium / High). Each leaf has its own threshold between 0.62
  and 0.9 on the gust curve, so a gust brings a few and a strong one a
  flurry. `GustLeaves` also ticks the wind clock (`tickWind()`) every frame.

### Swaying leaf shadows — `scene/bake/lightmap.ts`

Under the maple, the baked lightmap is sampled slightly off its real
position. The offset sways with the wind and the gusts, so the dappled shade
shifts as if the crown were moving. It fades out towards the clearing's edge
and is off on Low (`leafSway` is 0 / 0.07 / 0.08).

## 9. Voiceovers — `game/Monologue.tsx`

On only when chosen on the title screen or in Settings
(`audio.setVoice`). Each line has a few takes, never the same twice in a row
(`audio.say`):

| Line | When |
|------|------|
| `call` | every call (instead of the whistle) |
| `murmur` / `hum` | walking: first after 40 s of run, then every 60–120 s; 30% hums; never within 15 s of another line, or while sitting or talking |
| `parched` | 3.5 s after the last call (once she has answered), or 0.6 s after a dry try; not again for 20 s |
| `temesgen` | first sight of Temesgen |
| `found` | first sight of the goat (interrupts), or on reaching her unseen |
| `congrats` | reaching her, after `found` ends |

One line at a time: a line that comes up while he speaks waits up to 8 s,
then is dropped. Nothing is said while paused. The ambience and the song dip
under his voice. See [audio.md](audio.md) for the sprite.

## 10. Graphics presets — `app/quality.ts`

Low, Medium or High, chosen before a level loads (title screen or Settings,
where it "takes effect on your next maze"). With no choice made: Low on
phones and tablets (`MOBILE`: coarse pointer, no hover), Medium elsewhere.

- **Low** is the old phone tier: lighter post-processing, sparser grass,
  flowers and ivy, smaller bakes, no wall parallax, no leaf-shadow sway.
- **Medium** is the tuned PC look.
- **High** has more of everything: denser flowers, grass and ivy, sharper rays
  and shadows, a finer ground bake (14 texels/m against 7 / 10).

Code reads values with `quality(low, medium, high)` when the scene mounts.
Values that are also leva controls are listed in `PANEL_QUALITY` (grass and
flower density, flower heads and draw distance, tree LOD, ivy leaf density,
view distance, MSAA, ray steps and resolution, lens flare).
`applyGraphicsToPanel()` writes them into the leva store before each maze,
because leva keeps a control's old value across remounts.

## 11. Tuning reference

| Setting | Value | Where |
|---------|-------|-------|
| Walk / run speed | 2.2 / 5.5 m/s | `character/PlayerController.tsx` (leva *Player*) |
| Eye height | 1.35 m | `character/config.ts` |
| Collision radius | 0.3 m | `character/config.ts` |
| Calls / bottles | 3 / 2 | `game/runStore.ts` |
| Reach the goat | 1.4 m | `game/GoalWatcher.tsx` |
| Goat runs (Hard) | 0.6 s after her answer, if you are 4 m+ away; up to 10 tiles; keeps 3 tiles from you; 1.9 m/s | `game/GoatVoice.tsx`, `game/goat.ts` |
| See the goat | 16 m | `game/GoatVoice.tsx` |
| Talk to Temesgen | 2.3 m | `maze/Temesgen.tsx` |
| Calm after | 30 s | `game/temesgen.ts` |
| Sunset | 240 / 420 / 600 s | `scene/dusk.ts` |
| Wall height | 2.5 m | `maze/mazeData.ts` |
| Clearing radius | 0.17 × the maze's smaller side, kept within 5–8 m | `maze/mazeData.ts` (`clearingRadius`) |

## Old ideas, not built

> These were in the first design and are **not in the game**. Kept here
> only so the history makes sense.

- **Keys and a gate.** 1–3 keys at the farthest dead ends, a gate across the
  exit gap that opened with all of them.
- **The Griever.** A hunter walking the path network, with sight and hearing,
  patrol / alert / chase / search states, and a "caught" lose state.
- **A sunset lose condition.** The sun moving across the sky over the run and
  the gate closing at sunset. The real sunset is cosmetic and the sun never
  moves (see [section 8](#8-the-living-world)).
- **Footpath vs tall grass lanes, stamina, and fog of war on the minimap.**
- **Third person.** Removed; the game is first person only.
- **Scores and multi-level progression.** Replaced by the time, stars,
  badges and the per-level leaderboard.
