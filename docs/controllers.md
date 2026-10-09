# The player controller

There is one controller: Gugut in **first person**. It lives in
**`app/character/`**. No physics engine; collision is against the maze's wall
boxes. (The old ecctrl physics controller, the foot-lock IK showcase and the
third-person camera were removed. See
[foot-locking-plan.md](foot-locking-plan.md) for the IK work, kept as history.)

## The frame loop — `PlayerController.tsx`

Each frame, in this order:

1. **Input.** Keyboard (`KEYBOARD_MAP`: WASD / arrows, Shift to run) through
   drei's `KeyboardControls`, merged with the touch stick and look drag from
   `touchInput.ts` (written by `ui/TouchControls.tsx`).
2. **Blocked?** While paused or won (`runStore.inputBlocked()`), all movement
   is dropped.
3. **Seat** (`Seat.ts`). While sitting to listen to Temesgen, or sitting down,
   walking is off.
4. **Motor** (`PlayerMotor.ts`): move and collide.
5. **Body** (a group with a `BlobShadow`) follows the motor.
6. **Camera** (`CameraRig.ts`).
7. **Shared state**: position, yaw, speed and camera into `playerStore.ts`.

The leva *Player* folder (`#debug`) tunes walk speed (2.2 m/s), run speed
(5.5 m/s), mouse sensitivity, invert Y, head bob and FOV (75°).

The spawn is the start cell, `startPosition()`, looking down whichever
corridor leaves it.

## Pieces

- **`PlayerMotor.ts`** eases ground speed up and down (`ACCELERATION` 10,
  `DECELERATION` 12 per second) and moves in sub-steps of at most 0.1 m so
  fast moves can't pass through walls. On the stick, a partial push walks
  slowly, more walks faster, and a full push runs. `speed` is the real ground
  speed after collisions; it starts the clock (`game/GoalWatcher.tsx`) and
  drives footsteps and the head bob.
- **`WallCollider.ts`** holds every wall slab as a box, bucketed by grid cell,
  plus round obstacles (the maple trunk and Temesgen, from
  `mazeData.obstacles()`). It pushes the player's 0.3 m circle out of
  whatever it overlaps, removing only the part of the move into the wall, so
  you slide along walls. Its `raycast()` (a grid walk) is also used for "is a
  wall between?" checks: the goat's answer, first sight of the goat and of
  Temesgen, and his song's muffling.
- **`LookInput.ts`**: click the canvas to capture the mouse (pointer lock;
  Esc releases it). While not captured, dragging looks around. Touch drags
  turn 2.2× more per pixel.
- **`CameraRig.ts`**: the camera at eye height (1.35 m, a young goatherd) over
  the feet, turned by the look input, with a head bob scaled by speed. It adds
  `viewTilt.ts`: `pitch` (head tipped back while drinking) and `drop` (eyes
  lowered while sitting).
- **`Seat.ts`**: when Temesgen starts his song, Gugut walks to a spot 1.45 m
  in front of him, turns to face him and sits (the view drops 0.55 m over
  1.3 s). Any move gets him up (0.6 s). He also gets up when the song ends or
  stops.
- **`config.ts`**: collision radius, eye height, bob, pitch limits and other
  tuning.

## Who else moves the camera

`scene/IntroFlight.tsx` and `scene/WinShot.tsx` are mounted after the
`PlayerController`. Each frame they start from its camera and override it:
the intro flies from the tree to Gugut's eyes, and the win shot turns onto
the goat and flies out.
