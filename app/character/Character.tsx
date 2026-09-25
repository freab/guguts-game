"use client";

import { useEffect, useMemo, useRef } from "react";
import { useGLTF, useAnimations, useKeyboardControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { solveTwoBoneIK, boneOrientTowards } from "./twoBoneIK";
import { useControls, folder } from "leva";
import { atExit, isWalkable, startPosition } from "../maze/mazeData";
import { setPlayerPos } from "../maze/playerState";

// WASD / arrow-key movement control names — shared with Ecctrl's expected names
// so one KeyboardControls map drives either controller (see Scene).
export type MoveControl =
  | "forward"
  | "backward"
  | "leftward"
  | "rightward"
  | "jump"
  | "run";

// Stage 0: Mixamo-rigged basic human (Xbot.glb: a plain humanoid mannequin with
// mixamorig bones and idle / walk / run clips), served locally from /public.
const MODEL_URL = "/models/Xbot.glb";

// Stage 1 tuning — contact detection
const VEL_THRESHOLD = 0.4; // m/s below which the toe is "planted"
const HEIGHT_THRESHOLD = 0.12; // m sanity check: toe must be near the ground
const VOTE_WINDOW = 5; // majority-vote filter length

// Stage 2 tuning — foot-lock state machine (hysteresis: unlock > lock)
const LOCK_DISTANCE = 0.2; // m: max output↔input gap allowed to engage a lock
const UNLOCK_DISTANCE = 0.35; // m: locked point may drift this far before release
const CONTACT_HEIGHT = 0.02; // m: floor height the locked toe is pinned to

// Stage 3 tuning — inertialization blend
const BLEND_TIME = 0.15; // s: time to smooth a lock/unlock transition

// Stage 4 tuning — IK
const IK_EPSILON = 0.002; // m: below this output↔input gap, skip IK (keep animation)

// Stage 5 tuning — ground clamp. Per-foot minimum heights are captured from the
// bind pose (see the leg-locating effect); nothing sinks below its rest height.

// IK soft-clamp softening zone (m)
const SOFTENING = 0.02;

// Debug: show the foot contact / lock / output markers. Off for a clean look.
const SHOW_DEBUG_MARKERS = false;

// Movement tuning defaults (live-adjustable via leva — see useControls below).
const DEFAULT_WALK_SPEED = 1.4; // m/s
const DEFAULT_RUN_SPEED = 3.2; // m/s (hold Shift)
const DEFAULT_TURN_RATE = 10; // rad/s: how fast the character yaws toward its heading

// Stage 6 — root/hip policy: we NEVER move the pelvis, only rotate hip/knee/
// ankle, so the hips are never dropped to help a foot reach. Combined with the
// soft extension clamp in twoBoneIK.ts and the UNLOCK_DISTANCE hysteresis, an
// unreachable lock degrades to a little sliding (and eventually releases) rather
// than an over-bent-knee "t-rex" crouch — the trade-off the article recommends.
// The thresholds above are tuned for this in-place walk (toe world velocity
// comes only from leg swing); a root-translating clip would want a higher
// VEL_THRESHOLD.

type FootKey = "left" | "right";

type FootTrack = {
  bone: THREE.Bone; // toe bone (ToeBase — contact sensor + heel look-at child)
  hip: THREE.Bone; // UpLeg
  knee: THREE.Bone; // Leg
  ankle: THREE.Bone; // Foot (the IK "heel")
  toeEnd: THREE.Bone; // Toe_End (toe look-at child)
  kneeSide: THREE.Vector3; // knee side vector in knee-LOCAL space (for IK axis)
  heelMinHeight: number; // bind-pose y of the ankle/heel
  toeMinHeight: number; // bind-pose y of the toe
  toeEndMinHeight: number; // bind-pose y of the toe-end
  prevPos: THREE.Vector3; // toe world position last frame (for contact velocity)
  velocity: number; // world-space toe speed

  // Stage 1: contact detection
  votes: boolean[]; // recent raw-contact samples for majority vote
  inContact: boolean; // filtered contact state

  // Stage 2: foot-lock state
  inputPos: THREE.Vector3; // toe world position from the source animation
  lockPos: THREE.Vector3; // frozen world position while locked ("contact")
  locked: boolean;

  // Stage 3: inertialization blend
  targetPos: THREE.Vector3; // the raw goal this frame: lockPos when locked, else inputPos
  prevTargetPos: THREE.Vector3; // previous frame's target, for target velocity
  targetVel: THREE.Vector3; // d(target)/dt
  outputPos: THREE.Vector3; // smoothed foot position (what IK will chase in Stage 4)
  outputVel: THREE.Vector3; // smoothed foot velocity
  offsetPos: THREE.Vector3; // position offset captured at the last transition
  offsetVel: THREE.Vector3; // velocity offset captured at the last transition
  transitionTime: number; // elapsed time since the last transition

  toeMarker: THREE.Mesh; // Stage 1: at the animated toe (green/red)
  lockMarker: THREE.Mesh; // Stage 2: at the frozen lock point (shown when locked)
  outputMarker: THREE.Mesh; // Stage 3: at the smoothed output (yellow)
};

// Find a bone whose lowercased name ends with `suffix` (robust to the
// "mixamorig"/"mixamorig:" prefix variations across exports).
function findBoneBySuffix(root: THREE.Object3D, suffix: string): THREE.Bone | null {
  let found: THREE.Bone | null = null;
  const s = suffix.toLowerCase();
  root.traverse((o) => {
    if (found) return;
    if ((o as THREE.Bone).isBone && o.name.toLowerCase().endsWith(s)) {
      found = o as THREE.Bone;
    }
  });
  return found;
}

// Locate a whole leg chain for one side. Mixamo names: UpLeg, Leg, Foot,
// ToeBase.
function findLeg(root: THREE.Object3D, side: "left" | "right") {
  return {
    hip: findBoneBySuffix(root, `${side}upleg`),
    knee: findBoneBySuffix(root, `${side}leg`),
    ankle: findBoneBySuffix(root, `${side}foot`),
    toe: findBoneBySuffix(root, `${side}toebase`),
    toeEnd: findBoneBySuffix(root, `${side}toe_end`),
  };
}

export default function Character({ onWin }: { onWin?: () => void }) {
  const group = useRef<THREE.Group>(null);
  const wonRef = useRef(false);

  // Leva: live movement tuning for the foot-lock controller.
  const { walkSpeed, runSpeed, turnRate } = useControls({
    "Player (Foot-lock)": folder(
      {
        walkSpeed: { value: DEFAULT_WALK_SPEED, min: 0.2, max: 6, step: 0.1 },
        runSpeed: { value: DEFAULT_RUN_SPEED, min: 0.5, max: 10, step: 0.1 },
        turnRate: { value: DEFAULT_TURN_RATE, min: 1, max: 30, step: 1 },
      },
      { collapsed: true }
    ),
  });
  const { scene, animations } = useGLTF(MODEL_URL);
  const { actions, names } = useAnimations(animations, group);

  const tracksRef = useRef<Record<FootKey, FootTrack> | null>(null);
  const tmpAnkle = useMemo(() => new THREE.Vector3(), []);
  const tmpHeel = useMemo(() => new THREE.Vector3(), []);
  const tmpToe = useMemo(() => new THREE.Vector3(), []);
  const tmpToeEnd = useMemo(() => new THREE.Vector3(), []);
  const tmpSide = useMemo(() => new THREE.Vector3(), []);
  const tmpQuat = useMemo(() => new THREE.Quaternion(), []);

  // WASD / arrow movement
  const getKeys = useKeyboardControls<MoveControl>()[1];
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as {
    target: THREE.Vector3;
  } | null;
  const moveDir = useMemo(() => new THREE.Vector3(), []);
  const lastDir = useMemo(() => new THREE.Vector3(0, 0, 1), []); // last heading
  const camFwd = useMemo(() => new THREE.Vector3(), []); // camera forward on ground
  const camRight = useMemo(() => new THREE.Vector3(), []); // camera right on ground
  const prevGroupPos = useMemo(() => new THREE.Vector3(), []);
  const yawRef = useRef(0);
  const curSpeedRef = useRef(0); // smoothed ground speed (m/s)
  const idleActionRef = useRef<THREE.AnimationAction | null>(null);
  const walkActionRef = useRef<THREE.AnimationAction | null>(null);
  const runActionRef = useRef<THREE.AnimationAction | null>(null);

  // Debug markers: a small sphere at each toe (Stage 1) and a box at each lock
  // point (Stage 2).
  const markers = useMemo(() => {
    const toe = () =>
      new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 16, 16),
        new THREE.MeshBasicMaterial({ color: "red" })
      );
    const lock = () => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.09, 0.09),
        new THREE.MeshBasicMaterial({ color: "#38bdf8", wireframe: true })
      );
      m.visible = false;
      return m;
    };
    const output = () =>
      new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 16, 16),
        new THREE.MeshBasicMaterial({
          color: "#facc15",
          transparent: true,
          opacity: 0.6,
        })
      );
    return {
      leftToe: toe(),
      rightToe: toe(),
      leftLock: lock(),
      rightLock: lock(),
      leftOutput: output(),
      rightOutput: output(),
    };
  }, []);

  // Set up the idle / walk / run locomotion clips. All three always play; the
  // frame loop cross-blends their effective weights by ground speed.
  useEffect(() => {
    if (!names.length) return;
    const idleName =
      names.find((n) => /idle/i.test(n)) ?? names.find((n) => /stand/i.test(n));
    const walkName = names.find((n) => /walk/i.test(n));
    const runName = names.find((n) => /run/i.test(n));

    const idle = idleName ? actions[idleName] : null;
    const walk = walkName ? actions[walkName] : null;
    const run = runName ? actions[runName] : null;
    idleActionRef.current = idle ?? null;
    walkActionRef.current = walk ?? null;
    runActionRef.current = run ?? null;

    [idle, walk, run].forEach((act) => act?.reset().play());
    idle?.setEffectiveWeight(1);
    walk?.setEffectiveWeight(0);
    run?.setEffectiveWeight(0);

    return () => {
      [idle, walk, run].forEach((act) => act?.stop());
    };
  }, [actions, names]);

  // Locate both leg chains once the model is ready.
  useEffect(() => {
    const left = findLeg(scene, "left");
    const right = findLeg(scene, "right");

    if (
      !left.hip || !left.knee || !left.ankle || !left.toe || !left.toeEnd ||
      !right.hip || !right.knee || !right.ankle || !right.toe || !right.toeEnd
    ) {
      // Help future debugging: dump bone names so we can adjust the matcher.
      const boneNames: string[] = [];
      scene.traverse((o) => {
        if ((o as THREE.Bone).isBone) boneNames.push(o.name);
      });
      console.warn("[Character] leg bones not found. Bones:", boneNames);
      return;
    }

    scene.updateWorldMatrix(true, true);

    type Leg = {
      hip: THREE.Bone;
      knee: THREE.Bone;
      ankle: THREE.Bone;
      toe: THREE.Bone;
      toeEnd: THREE.Bone;
    };

    // knee side vector in the knee's LOCAL frame: the bind-pose bend-plane
    // normal (hinge axis), so it stays stable when the leg straightens. Falls
    // back to the body-right axis if the bind pose is too straight to derive it.
    const computeKneeSide = (leg: Leg) => {
      const hp = leg.hip.getWorldPosition(new THREE.Vector3());
      const kp = leg.knee.getWorldPosition(new THREE.Vector3());
      const ap = leg.ankle.getWorldPosition(new THREE.Vector3());
      const normal = new THREE.Vector3()
        .subVectors(kp, hp)
        .cross(new THREE.Vector3().subVectors(ap, kp));
      if (normal.lengthSq() < 1e-6) normal.set(1, 0, 0); // straight leg fallback
      normal.normalize();
      // into knee-local space
      const kq = leg.knee.getWorldQuaternion(new THREE.Quaternion()).invert();
      return normal.applyQuaternion(kq).normalize();
    };

    const makeTrack = (
      leg: Leg,
      toeMarker: THREE.Mesh,
      lockMarker: THREE.Mesh,
      outputMarker: THREE.Mesh
    ): FootTrack => {
      const start = leg.toe.getWorldPosition(new THREE.Vector3());
      return {
        bone: leg.toe,
        hip: leg.hip,
        knee: leg.knee,
        ankle: leg.ankle,
        toeEnd: leg.toeEnd,
        kneeSide: computeKneeSide(leg),
        heelMinHeight: leg.ankle.getWorldPosition(new THREE.Vector3()).y,
        toeMinHeight: start.y,
        toeEndMinHeight: leg.toeEnd.getWorldPosition(new THREE.Vector3()).y,
        prevPos: start.clone(),
        velocity: 0,
        votes: [],
        inContact: false,
        inputPos: start.clone(),
        lockPos: new THREE.Vector3(),
        locked: false,
        targetPos: start.clone(),
        prevTargetPos: start.clone(),
        targetVel: new THREE.Vector3(),
        outputPos: start.clone(),
        outputVel: new THREE.Vector3(),
        offsetPos: new THREE.Vector3(),
        offsetVel: new THREE.Vector3(),
        transitionTime: BLEND_TIME, // start fully settled
        toeMarker,
        lockMarker,
        outputMarker,
      };
    };

    // Rebuild as non-null leg objects (the guard above narrowed each field).
    const leftLeg: Leg = {
      hip: left.hip,
      knee: left.knee,
      ankle: left.ankle,
      toe: left.toe,
      toeEnd: left.toeEnd,
    };
    const rightLeg: Leg = {
      hip: right.hip,
      knee: right.knee,
      ankle: right.ankle,
      toe: right.toe,
      toeEnd: right.toeEnd,
    };

    tracksRef.current = {
      left: makeTrack(leftLeg, markers.leftToe, markers.leftLock, markers.leftOutput),
      right: makeTrack(rightLeg, markers.rightToe, markers.rightLock, markers.rightOutput),
    };
  }, [scene, markers]);

  // Run AFTER the animation mixer has updated the pose.
  useFrame((_, delta) => {
    const g = group.current;
    const tracks = tracksRef.current;
    if (!g || !tracks || delta <= 0) return;

    // --- Movement: camera-relative WASD / arrows -------------------------
    // Input is interpreted in the CAMERA's frame projected onto the ground, so
    // "forward" always means into the screen regardless of how the view is
    // orbited — the standard third-person feel.
    const k = getKeys();
    const fwdInput = (k.forward ? 1 : 0) - (k.backward ? 1 : 0);
    const rightInput = (k.rightward ? 1 : 0) - (k.leftward ? 1 : 0);
    const moving = fwdInput !== 0 || rightInput !== 0;

    prevGroupPos.copy(g.position);

    // Ground-plane camera basis.
    camera.getWorldDirection(camFwd);
    camFwd.y = 0;
    if (camFwd.lengthSq() < 1e-6) camFwd.set(0, 0, -1);
    camFwd.normalize();
    camRight.setFromMatrixColumn(camera.matrixWorld, 0);
    camRight.y = 0;
    camRight.normalize();

    // Smoothly ramp ground speed toward the target (accelerate / decelerate),
    // so starting and stopping glide instead of snapping.
    const targetSpeed = moving ? (k.run ? runSpeed : walkSpeed) : 0;
    curSpeedRef.current = THREE.MathUtils.damp(
      curSpeedRef.current,
      targetSpeed,
      10,
      delta
    );
    const curSpeed = curSpeedRef.current;

    if (moving) {
      moveDir
        .copy(camFwd)
        .multiplyScalar(fwdInput)
        .addScaledVector(camRight, rightInput)
        .normalize();
      lastDir.copy(moveDir);
    }
    if (moving || curSpeed > 0.01) {
      // Grid collision: try each axis independently so the character slides
      // along a wall instead of sticking when moving diagonally into it.
      const step = curSpeed * delta;
      const dx = lastDir.x * step;
      const dz = lastDir.z * step;
      if (isWalkable(g.position.x + dx, g.position.z)) g.position.x += dx;
      if (isWalkable(g.position.x, g.position.z + dz)) g.position.z += dz;

      // Yaw toward the heading (Xbot rig faces +Z), shortest-arc, rate-limited.
      const targetYaw = Math.atan2(lastDir.x, lastDir.z);
      let d = targetYaw - yawRef.current;
      d = Math.atan2(Math.sin(d), Math.cos(d)); // wrap to [-π, π]
      const maxStep = turnRate * delta;
      yawRef.current += THREE.MathUtils.clamp(d, -maxStep, maxStep);
      g.rotation.y = yawRef.current;
    }

    // Report position for the minimap.
    setPlayerPos(g.position.x, g.position.z);

    // Win check: reached the exit tile (fire once).
    if (!wonRef.current && atExit(g.position.x, g.position.z)) {
      wonRef.current = true;
      onWin?.();
    }

    // Locomotion blend: idle→walk over [0, WALK_SPEED], walk→run over
    // [WALK_SPEED, RUN_SPEED]. Weights are continuous in speed, so accel/decel
    // reads as a smooth idle↔walk↔run transition.
    {
      const idle = idleActionRef.current;
      const walk = walkActionRef.current;
      const run = runActionRef.current;
      let idleW: number, walkW: number, runW: number;
      if (curSpeed <= walkSpeed) {
        const s = curSpeed / walkSpeed;
        idleW = 1 - s;
        walkW = s;
        runW = 0;
      } else {
        const s = THREE.MathUtils.clamp(
          (curSpeed - walkSpeed) / (runSpeed - walkSpeed),
          0,
          1
        );
        idleW = 0;
        walkW = 1 - s;
        runW = s;
      }
      idle?.setEffectiveWeight(idleW);
      walk?.setEffectiveWeight(walkW);
      run?.setEffectiveWeight(runW);

      // Phase-lock walk & run and scale their cadence to ground speed, so the
      // feet always step together during the blend (no "morph") and the stride
      // roughly matches how far the body travels (less sliding).
      const cadence = THREE.MathUtils.clamp(curSpeed / walkSpeed, 0.6, 2.6);
      if (walk) walk.timeScale = cadence;
      if (walk && run) {
        const wd = walk.getClip().duration;
        const rd = run.getClip().duration;
        // equal normalized-phase rate keeps the two cycles aligned over time
        run.timeScale = wd > 1e-4 ? cadence * (rd / wd) : cadence;
      }
    }

    // Keep world matrices current after moving the root, before reading feet.
    g.updateWorldMatrix(true, true);

    // Camera + orbit target follow the character rigidly: adding the same
    // translation delta to both keeps the user's orbit angle and zoom intact.
    const camDX = g.position.x - prevGroupPos.x;
    const camDZ = g.position.z - prevGroupPos.z;
    if (camDX || camDZ) {
      camera.position.x += camDX;
      camera.position.z += camDZ;
      if (controls) {
        controls.target.x += camDX;
        controls.target.z += camDZ;
      }
    }

    (Object.keys(tracks) as FootKey[]).forEach((key) => {
      const t = tracks[key];

      // --- Stage 1: contact detection -----------------------------------
      // World-space toe velocity: a properly planted foot (in-place clip cycling
      // backward + root moving forward) reads ~0 here, so contacts detect
      // correctly whether the body is still or moving.
      t.bone.getWorldPosition(t.inputPos);
      t.velocity = t.inputPos.distanceTo(t.prevPos) / delta;

      const raw =
        t.velocity < VEL_THRESHOLD && t.inputPos.y < HEIGHT_THRESHOLD;

      t.votes.push(raw);
      if (t.votes.length > VOTE_WINDOW) t.votes.shift();
      const yes = t.votes.filter(Boolean).length;
      t.inContact = yes * 2 > t.votes.length;

      // --- Stage 2: foot-lock state machine -----------------------------
      const wasLocked = t.locked;
      if (t.locked) {
        // Release when contact is lost, or the animation has pulled the toe
        // too far from the pinned point (hysteresis vs. LOCK_DISTANCE).
        const drift = t.inputPos.distanceTo(t.lockPos);
        if (!t.inContact || drift > UNLOCK_DISTANCE) {
          t.locked = false;
        }
      } else if (t.inContact) {
        // Engage a lock: output currently follows input, so the output↔input
        // gap is ~0 < LOCK_DISTANCE. Pin the toe at the floor.
        t.lockPos.copy(t.inputPos);
        t.lockPos.y = CONTACT_HEIGHT;
        t.locked = true;
      }

      // --- Stage 3: inertialization blend -------------------------------
      // The raw target this frame: the pinned point while locked, else the
      // animation toe.
      t.targetPos.copy(t.locked ? t.lockPos : t.inputPos);

      if (t.locked !== wasLocked) {
        // Lock/unlock switch: the target jumps discontinuously. Capture the
        // current output's offset from the new target (position + velocity),
        // treat the target velocity as 0 at the instant of the switch (its raw
        // per-frame derivative here is a meaningless jump/dt spike), and restart
        // the blend timer. Offsets then decay to zero over BLEND_TIME, keeping
        // the output C1-continuous — no pop.
        t.prevTargetPos.copy(t.targetPos);
        t.targetVel.set(0, 0, 0);
        t.offsetPos.subVectors(t.outputPos, t.targetPos);
        t.offsetVel.copy(t.outputVel); // outputVel - targetVel, targetVel = 0
        t.transitionTime = 0;
      } else {
        t.targetVel.subVectors(t.targetPos, t.prevTargetPos).divideScalar(delta);
      }

      const bt = BLEND_TIME;
      const tt = Math.min(t.transitionTime, bt) / bt; // 0 on the transition frame
      const tt2 = tt * tt;
      const tt3 = tt2 * tt;
      // Cubic inertialization weights (Holden): w0 decays the position offset
      // from 1→0, w1 the velocity offset; w2/w3 give the matching velocity.
      const w0 = 2 * tt3 - 3 * tt2 + 1;
      const w1 = (tt3 - 2 * tt2 + tt) * bt;
      const w2 = (6 * tt2 - 6 * tt) / bt;
      const w3 = 3 * tt2 - 4 * tt + 1;

      // outputPos = target + w0·offsetPos + w1·offsetVel
      t.outputPos
        .copy(t.targetPos)
        .addScaledVector(t.offsetPos, w0)
        .addScaledVector(t.offsetVel, w1);
      // outputVel = targetVel + w2·offsetPos + w3·offsetVel
      t.outputVel
        .copy(t.targetVel)
        .addScaledVector(t.offsetPos, w2)
        .addScaledVector(t.offsetVel, w3);

      t.prevTargetPos.copy(t.targetPos);
      t.transitionTime += delta;

      // --- Stage 4 + 5: SolveLegChain (two-bone IK + look-ats + clamp) --
      // Toe goal = smoothed output, clamped to its bind height (Stage 5); this
      // also catches source-animation penetration even with no active lock.
      tmpToe.copy(t.outputPos);
      tmpToe.y = Math.max(tmpToe.y, t.toeMinHeight);

      // Only correct when the (clamped) goal diverges from the source animation;
      // otherwise leave the animated pose untouched.
      if (tmpToe.distanceTo(t.inputPos) > IK_EPSILON) {
        // Heel (ankle) target preserves the animation's ankle→toe offset so the
        // foot keeps its shape, then clamps to the floor too.
        t.ankle.getWorldPosition(tmpAnkle);
        tmpHeel.copy(tmpToe).add(tmpAnkle).sub(t.inputPos);
        tmpHeel.y = Math.max(tmpHeel.y, t.heelMinHeight);

        // side vector = knee-local side axis rotated into world by the knee;
        // maxExtension = current hip→heel distance (per the article).
        t.knee.getWorldQuaternion(tmpQuat);
        tmpSide.copy(t.kneeSide).applyQuaternion(tmpQuat);
        t.hip.getWorldPosition(tmpAnkle); // reuse: hip pos
        const maxExtension = tmpAnkle.distanceTo(
          t.ankle.getWorldPosition(tmpToeEnd) // reuse: heel pos
        );

        solveTwoBoneIK(
          t.hip,
          t.knee,
          t.ankle,
          tmpHeel,
          tmpSide,
          maxExtension,
          SOFTENING
        );

        // Heel look-at: point the foot's toe at the toe target.
        boneOrientTowards(t.ankle, t.bone, tmpToe);

        // Toe look-at: keep the toe segment flat by aiming the toe-end at its
        // current world position, clamped to the floor.
        t.toeEnd.getWorldPosition(tmpToeEnd);
        tmpToeEnd.y = Math.max(tmpToeEnd.y, t.toeEndMinHeight);
        boneOrientTowards(t.bone, t.toeEnd, tmpToeEnd);
      }

      // --- Debug visualization (optional) -------------------------------
      if (SHOW_DEBUG_MARKERS) {
        t.toeMarker.position.copy(t.inputPos);
        (t.toeMarker.material as THREE.MeshBasicMaterial).color.set(
          t.inContact ? "#22c55e" : "#ef4444"
        );
        t.lockMarker.visible = t.locked;
        if (t.locked) t.lockMarker.position.copy(t.lockPos);
        t.outputMarker.position.copy(t.outputPos);
      }

      t.prevPos.copy(t.inputPos);
    });
  });

  return (
    <>
      {/* The moving character root (translated + yawed by the controller).
          Spawns at the maze start on the floor (y = 0). */}
      <group
        ref={group}
        position={[startPosition()[0], 0, startPosition()[2]]}
      >
        <primitive object={scene} />
      </group>
      {/* Debug markers live in world space (outside the moving root) since their
          positions are set from world coordinates. Rendered only when enabled. */}
      {SHOW_DEBUG_MARKERS && (
        <>
          <primitive object={markers.leftToe} />
          <primitive object={markers.rightToe} />
          <primitive object={markers.leftLock} />
          <primitive object={markers.rightLock} />
          <primitive object={markers.leftOutput} />
          <primitive object={markers.rightOutput} />
        </>
      )}
    </>
  );
}

useGLTF.preload(MODEL_URL);
