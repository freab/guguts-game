# UI & leva

HTML overlays are drawn on top of the WebGL canvas from
**`app/scene/SceneClient.tsx`**, with reusable pieces in **`app/ui/`**.

## Toolbar (top-left)

- **Mode toggle:** *Maze* (physics) / *Foot-lock IK*.
- **New maze:** regenerate + restart.

Both are plain React buttons in `SceneClient`.

## Run timer — `ui/Hud.tsx` (top-center)

- Shows elapsed time since spawn; formats as `12.3s`, then `1:05.3` past a minute.
- Runs its **own `setInterval`** so ticking doesn't re-render the 3D scene.
- Reads the start time from a ref owned by `SceneClient` and freezes when
  `paused` (i.e. after you escape).

## Minimap — `ui/Minimap.tsx` (bottom-right)

- A 2D top-down `<canvas>` (160px, DPI-scaled) redrawn on its own
  `requestAnimationFrame` loop.
- Reads the **live maze grid** (`cellAt` over `ROWS`×`COLS`) so it reflects the
  current maze, including regenerations.
- Reads the player's position from `maze/playerState.ts` and draws a red dot at
  the fractional grid position (smooth motion), plus the green exit tile.
- Toggle it from the leva *Game* panel.

## Win overlay

When `won` is true, `SceneClient` renders a full-screen dimmed overlay:
**"You escaped!"**, the final **Time**, and a **Play again** button.

## leva controls panel (top-right)

[leva](https://github.com/pmndrs/leva) provides a live tuning panel. Controls are
declared with `useControls` in the component that owns each value, and they merge
into one panel grouped into folders:

| Folder | Controls | Declared in |
|--------|----------|-------------|
| **Game** | Show minimap (toggle), New maze (button) | `scene/SceneClient.tsx` |
| **Lighting** | ambient, directional, hemisphere intensity | `scene/Scene.tsx` |
| **Player (Ecctrl)** | maxWalkVel, maxRunVel | `character/EcctrlPlayer.tsx` |
| **Player (Foot-lock)** | walkSpeed, runSpeed, turnRate | `character/Character.tsx` |

The panel is `<Leva collapsed titleBar={{ title: "Controls" }} />`, rendered once
in `SceneClient`. The *Player* folders appear only when their controller is
mounted (i.e. for the active mode).

> leva is a dev/tuning tool and is currently always visible. To ship without it,
> render `<Leva hidden />` or gate it behind a dev flag.
