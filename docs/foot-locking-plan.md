# Foot Locking + IK — Implementation Plan

> **History.** This was for the old animated character (`Character.tsx`,
> `twoBoneIK.ts`), which has been removed. The game is now first person only
> (see [controllers.md](controllers.md)). Kept as a record of the work.

Re-implementing Daniel Holden's foot-locking method
(<https://theorangeduck.com/page/inverse-kinematics-foot-locking>) in this
three.js / React Three Fiber project.

## Core idea

Detect foot contacts by **velocity**, "lock" the toe to a fixed world position
while contact holds, blend that lock in/out with **inertialization**, and use a
**two-bone IK** solver to re-pose the leg so the foot stays put — all while
preserving the source animation's velocity. Prefer minor sliding over lowering
the hips (avoids the over-bent-knee "t-rex" look).

## Stages

- [x] **Stage 0 — Foundations.** Mixamo rig loaded (`Soldier.glb`), walk clip
  playing, ground grid, OrbitControls, fullscreen canvas. Client-only render
  (`ssr: false`) so drei's GLTF loader never runs on the server.
- [x] **Stage 1 — Contact detection.** Per-toe global velocity magnitude;
  contact = `velocity < VEL_THRESHOLD` AND `toe.y < HEIGHT_THRESHOLD`, denoised
  with a 5-frame majority-vote filter. Debug spheres: green = contact, red =
  free.
- [x] **Stage 2 — Foot lock state machine.** `FootTrack` per foot; lock when
  `inContact && dist(output,input) < LOCK_DISTANCE` (0.2 m), pins the toe at
  `CONTACT_HEIGHT` (0.02 m); unlock when `!inContact || drift > UNLOCK_DISTANCE`
  (0.35 m). Cyan wireframe box marks the frozen lock point while locked.
- [x] **Stage 3 — Inertialization blend.** `BLEND_TIME = 0.15 s`. On each
  lock/unlock switch, capture `offsetPos = output − target` and
  `offsetVel = outputVel` (target velocity taken as 0 at the switch to avoid the
  jump/dt spike) and restart the timer. Cubic weights
  `w0=2t³−3t²+1`, `w1=(t³−2t²+t)·bt`, `w2=(6t²−6t)/bt`, `w3=3t²−4t+1`,
  `t=min(elapsed,bt)/bt` (so the switch frame is exactly `t=0`, output continuous).
  `outputPos = target + w0·offsetPos + w1·offsetVel`;
  `outputVel = targetVel + w2·offsetPos + w3·offsetVel`.
  Yellow sphere = smoothed output (what Stage 4 IK will chase). Verified by
  sim: transition step 0.090 m raw → 0.038 m smoothed (2.4× gentler), switch
  frame exactly continuous.
- [x] **Stage 4 — Two-bone IK.** `app/character/twoBoneIK.ts` (Holden "simple
  two joint"): `targetHeel = targetToe + (ankle−toe)_input`; bend-plane normal
  `axis0 = (c−a)×(b−a)`; law-of-cosines angle deltas `r0,r1` about `axis0`;
  swing `r2 = QuaternionBetween(heelDir, targetDir)`; local rotations
  `localHip = inv(pelvis)·r2·r0·hip`, `localKnee = inv(hip_old)·r1·knee`. Then a
  foot-orientation pass re-points the toe: `localAnkle = inv(knee)·rot·ankle`.
  IK runs only when `|output − input| > IK_EPSILON` (else the animation is left
  untouched). Verified: unit test reaches heel+toe targets to 0.00000 m; e2e
  test pins a planted foot to 3.3 mm while the body moves 0.30 m (89× less
  slide), no instability.
  (Soft-clamp extension `maxExtension`/`softening` deferred to Stage 6 tuning.)
- [x] **Stage 5 — Ground clamp.** Toe goal clamped to `TOE_MIN_HEIGHT` (0.02 m),
  heel goal to `HEEL_MIN_HEIGHT` (0.05 m), before the IK — so the foot never
  sinks through a flat floor at y=0, and source-animation penetration is caught
  even with no active lock. Verified: source toe at −0.14 m → clamped toe held
  at 0.02 m, no penetration. (Uneven-terrain raycast + toe-end flat re-orient
  deferred to a later pass.)
- [x] **Stage 6 — Root/hip policy & tuning.** Root/hip policy is structural: we
  never move the pelvis (only rotate hip/knee/ankle), so hips are never dropped.
  Added the **soft extension clamp** in `twoBoneIK.ts` (`MAX_EXTENSION = 0.98`,
  `SOFTENING = 0.08`): reach saturates exponentially toward 0.98 of full leg
  length, always leaving a slight bend — no knee-snap. Exact inside the
  reachable zone (reachable IK unchanged, verified 0.00000 m). An unreachable
  lock degrades to minor sliding (+ eventual release via `UNLOCK_DISTANCE`)
  instead of a "t-rex" crouch. Thresholds tuned for the in-place walk; a
  root-translating clip wants a higher `VEL_THRESHOLD`.
- [ ] **Stage 7 (optional) — Offline baking.** Particle-constraint solver
  (inter-frame `hardFactor=0.9`, non-contact `softFactor=0.05`, in-frame
  hip-to-toe preservation, ~25k iterations), then run Stage 4 IK on baked poses.

## Reference values (from the article)

- Contact velocity threshold: 0.1–0.5 m/s; height sanity check: ~0.1 m.
- Majority-vote window: 5 frames.
- Toe joint takes priority over heel (locomotion biomechanics).
- IK is a *minimal modification* preserving source-animation nuance, not a
  procedural replacement.

## Files

- `app/character/Character.tsx` — model load, walk clip, contact detection (Stages 0–1).
- `app/Scene.tsx` — Canvas, lights, grid, OrbitControls.
- `app/SceneClient.tsx` — `ssr: false` dynamic wrapper.

## Fidelity to the article (theorangeduck.com foot-locking)

The runtime solver now mirrors the article's C code:
- **`solveTwoBoneIK`** uses the side-vector axis (`axisDwn/axisFwd/axisRot`),
  the soft clamp applied to the **target point** with `maxExtension = current
  hip→heel distance` + `softening`, cosine-rule `acab/babc`, `r0/r1` about
  `axisRot`, `r2 = QuaternionBetween`, and the exact local-rotation composition.
- **`boneOrientTowards`** = the article's `BoneOrientTowards` / `QuaternionBetween`.
- **`SolveLegChain`**: toe clamp → heel target (ankle−toe offset) → heel clamp →
  two-bone IK → heel look-at (toe→toe target) → toe look-at (toe-end→clamped
  toe-end). Knee side vector cached from the bind pose; heel/toe/toe-end **min
  heights from the bind pose**.
- Contact detection, the lock/unlock hysteresis, and the cubic inertialization
  weights match the article; the inertialization is structured slightly
  differently from `InertializeCubicUpdate/Transition` but produces the same
  result (verified).

Not implemented: **offline foot locking** (the 25k-iteration particle baker,
`hardFactor`/`softFactor`) — that's the offline Stage 7 tool, separate from the
runtime path.

Verified by Node tests against real three.js: IK exact within reach (0.00000 m),
soft-clamp caps over-reach, toe look-at aligns to 0.000°, plus the lock / blend /
integration / ground-clamp suites.

## Model

Local: `public/models/Xbot.glb` (2.79 MB, three.js sample, MIT), served at
`/models/Xbot.glb`. Bones resolve as `mixamorigLeftToeBase`, `…LeftUpLeg`,
`…LeftLeg`, `…LeftFoot`. No remote CDN dependency.
