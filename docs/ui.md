# UI

HTML overlays are drawn over the canvas by **`app/scene/SceneClient.tsx`**,
with the pieces in **`app/ui/`**. The normal game keeps the view almost
clear: the clock, the call button and a few buttons at the top right.
Developer tools (leva, the minimap, FPS) are only on `/#debug`.

## Title screen and preloader — `ui/LoadingOverlay.tsx`

1. **Setup step** (`SetupChooser`), first, once a visit: Graphics
   (Low / Medium / High, with a one-line blurb each) and Voiceovers
   (On / Off). Continue is focused, so Enter keeps the choices. Both are
   saved in `game/preferences.ts`.
2. **Level chooser** (`LevelChooser`): "Choose your path", Easy / Medium /
   Hard glass cards with a PLAY pill (always visible on touch), and a link
   "<graphics> graphics · Voice on/off · change" back to step 1.
3. **Preloader.** The title picture burns away in a noise dissolve
   (`ui/DissolveCanvas.tsx`) to the sky picture, where the start of the story
   writes itself in word by word (`ui/storyParts.tsx`) and a percentage
   counts up. At 100 it becomes **Enter the maze**; pressing it burns the
   picture away to the scene.

On a portrait phone the pictures are a band across the top, with the words
below. Tapping a level on a phone also goes fullscreen in landscape
(`ui/fullscreen.ts`).

## Intro — `ui/IntroOverlay.tsx`

Cinematic bars during the fly-in, the level's name and blurb in the lower
bar, and "Space Skip" / "Tap to skip". See
[gameplay.md § 5](gameplay.md#5-the-intro-fly-in).

## HUD while playing

| Piece | File | Where |
|-------|------|-------|
| Run clock | `ui/RunTimer.tsx` | top centre (below the buttons on narrow screens); updates its own text each frame, no React re-render |
| Call button with 3 pips | `ui/CallButton.tsx` | top left on desktop (with the key), large bottom right on touch |
| Call map | `ui/CallMap.tsx` | under the call button, for a few seconds after a call |
| Bleat direction arc + caption | `ui/BleatIndicator.tsx` | ring round the centre of the view |
| Notices | `ui/GameNotice.tsx` | under the clock, or at the bottom on small screens |
| Drink / Talk prompt | `ui/DrinkPrompt.tsx`, `ui/TalkPrompt.tsx` (both use `ui/InteractPrompt.tsx`) | centre on desktop ("Press E to…"), a big button on touch |
| Calm bar and how to stand up | `ui/SeatedHint.tsx` | while sitting at Temesgen's |
| Drinking flash | `ui/DrinkVignette.tsx` | screen edges |
| Touch stick and look area | `ui/TouchControls.tsx` | touch devices only |

**Top-right cluster** (always shown, the title screen too): fullscreen (where
supported), leaderboard, settings, music on/off (`ui/MusicToggle.tsx`), and
while playing the pause button.

## Dialogs and menus

All modal panels use `ui/Dialog.tsx`, which pauses the game (`"dialog"`),
releases the mouse, and closes on Esc or a click outside.

- **Pause menu** (`ui/PauseMenu.tsx`, P or the pause button; opens on its own
  when the tab is hidden): the run time so far, then Resume, Call the goat
  (with calls left), Restart (new maze), Controls, Leaderboard, Settings,
  Credits, Change level.
- **Settings** (`ui/SettingsDialog.tsx`): leaderboard name, the call key
  (press to rebind), sound captions, voiceovers, and graphics (takes effect on
  the next maze).
- **Credits** (`ui/CreditsDialog.tsx`, from the pause menu and the results):
  designs, the voice of Gugut, the music, sound effects, textures, grass,
  fonts. It is the same list as the main README's Credits.
- **Controls help** (`ui/ControlsHelp.tsx`): first run on a device, and from
  the pause menu. Touch or keyboard version.
- **Rotate prompt** (`ui/RotatePrompt.tsx`): a phone held upright.
- **Temesgen** (`ui/TemesgenDialog.tsx`): the conversation; see
  [gameplay.md § 4.3](gameplay.md#43-temesgen--gametemesgents-mazetemesgentsx).
- **Leaderboard** (`ui/LeaderboardDialog.tsx`, `ui/LeaderboardTable.tsx`,
  `ui/useBoard.ts`): a tab per level, the player's row highlighted, and a
  share card for their own time.
- **Share** (`ui/ShareDialog.tsx`): card preview in three shapes and the ways
  to share it.

## End of a run

`ui/GameOver.tsx` waits `WIN_SHOT_MS`, shows `ui/OutroStory.tsx` (the story's
end burning in over the maze), then the results: time, stars, badges, the
leaderboard and the buttons. See [gameplay.md § 6–7](gameplay.md#6-finding-her).

## `/#debug`

`hooks/useHashRoute.ts` makes `#debug` live (edit the hash, no reload). It
adds:

- the **leva** panel (`<Leva collapsed>`, top right), hidden while the
  preloader is up;
- **Level · Change** and **New maze** buttons, and a key hint (bottom left);
- drei `Stats` and `ui/PerfReadout.tsx` (frame / GPU time and the profiler);
- `ui/Minimap.tsx`: walls, exit, player, view cone, draw-distance ring and
  which grass chunks are drawn or culled.

leva controls are declared with `useControls` in the component that owns each
value and merge into one panel:

| Folder | Declared in |
|--------|-------------|
| Game: show minimap, Size, New maze | `scene/SceneClient.tsx` |
| Game → Footpath | `scene/Scene.tsx` |
| Game → Ground, Tree, Grass, Flowers, Vines | `scene/InfiniteGrid.tsx`, `scene/MapleTree.tsx`, `scene/Grass.tsx`, `scene/Flowers.tsx`, `scene/Vines.tsx` |
| Player: walk / run speed, sensitivity, invert Y, head bob, FOV | `character/PlayerController.tsx` |
| Lighting, Sun & Sky (with *Dusk preview*), Baked lighting, Environment, Tone mapping, View, Perf, Post-processing | `scene/Scene.tsx` |

Values listed in `PANEL_QUALITY` (`app/quality.ts`) are reset to the
graphics preset before each maze, so the panel always starts on the preset.
