# Character Controllers

Both live in **`app/character/`** and drive the same `Xbot.glb` model through the
same maze. The toolbar switches between them; `Scene.tsx` mounts one at a time.

## Maze mode — `EcctrlPlayer.tsx` (the main game)

A physics controller built on [ecctrl](https://github.com/pmndrs/ecctrl), a
floating-capsule third-person controller for R3F + Rapier.

- **Physics:** gravity, jumping, and native wall collision against the maze's
  Rapier colliders.
- **Camera:** ecctrl brings its own follow camera (drei `CameraControls` under
  the hood).
- **Animation:** `XbotModel` maps ecctrl's animation states (idle/walk/run/jump)
  to the model's clips via ecctrl's animation store.
- **Spawn:** receives `position={startPosition()}`.
- **Win + minimap:** each frame it reads the capsule's `currPos`, writes it to
  `playerState`, and checks `atExit`.
- **Leva:** a *Player (Ecctrl)* folder tunes `maxWalkVel` / `maxRunVel` live.

## Foot-lock mode — `Character.tsx` (animation showcase)

A custom, **non-physics** controller focused on animation quality. It moves its
own group directly and re-poses the legs with inverse kinematics so the feet stay
planted (no sliding). See [foot-locking-plan.md](foot-locking-plan.md) and
`twoBoneIK.ts`.

- **Movement:** camera-relative WASD; ground speed is damped so start/stop glide;
  idle→walk→run animation weights blend continuously with speed.
- **Collision:** grid-based via `isWalkable`, tested per-axis so the character
  slides along walls (see [maze.md](maze.md)).
- **Camera:** drei `OrbitControls`; the camera + orbit target follow the
  character rigidly. Zoom is capped at 30 units so you can pull back to orient.
- **Foot-locking IK:** detects foot contacts by velocity, "locks" the toe to a
  world position while planted, blends the lock in/out with inertialization, and
  solves a two-bone IK chain to keep the foot put.
- **Spawn:** the group is positioned at the maze start on the floor (`y = 0`).
- **Win + minimap:** writes `group.position` to `playerState` and checks
  `atExit` each frame.
- **Leva:** a *Player (Foot-lock)* folder tunes `walkSpeed` / `runSpeed` /
  `turnRate` live.

## Shared wiring

- Both accept an `onWin?: () => void` prop and fire it **once** (guarded by a
  `wonRef`).
- Both report position through `maze/playerState.ts` for the minimap.
- One `KeyboardControls` map in `Scene.tsx` serves both (`forward`, `backward`,
  `leftward`, `rightward`, `jump`, `run`).

## Why keep both?

The foot-lock controller is an animation-quality experiment (planted feet, no
physics), great for walking a flat maze. The ecctrl controller is the real game
engine (gravity, jump, collision). If you want a single "real" mode, build on
**Maze/ecctrl**.
