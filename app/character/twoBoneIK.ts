import * as THREE from "three";

// Two-bone IK + orientation helpers, ported directly from Daniel Holden's
// foot-locking article (theorangeduck.com/page/inverse-kinematics-foot-locking).
// The C uses global Transforms; here bones carry their own world matrices, so
// getWorldPosition/Quaternion stand in for the global transforms and we write
// bone.quaternion (the local rotation) back out.
//
// All temporaries are module-level scratch — solvers run sequentially from the
// render loop, never re-entrantly.

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// --- scratch ---------------------------------------------------------------
const a = new THREE.Vector3();
const b = new THREE.Vector3();
const c = new THREE.Vector3();
const tClamp = new THREE.Vector3();
const aGr = new THREE.Quaternion();
const bGr = new THREE.Quaternion();
const pGr = new THREE.Quaternion();
const inv = new THREE.Quaternion();
const axisDwn = new THREE.Vector3();
const axisFwd = new THREE.Vector3();
const axisRot = new THREE.Vector3();
const ca = new THREE.Vector3();
const ba = new THREE.Vector3();
const ab = new THREE.Vector3();
const cb = new THREE.Vector3();
const heelDir = new THREE.Vector3();
const targDir = new THREE.Vector3();
const r0 = new THREE.Quaternion();
const r1 = new THREE.Quaternion();
const r2 = new THREE.Quaternion();
const q = new THREE.Quaternion();

// QuaternionBetween: rotation taking direction p onto direction q (article's
// version; three's setFromUnitVectors handles the antiparallel fallback too).
function quaternionBetween(out: THREE.Quaternion, p: THREE.Vector3, u: THREE.Vector3) {
  heelDir.copy(p);
  targDir.copy(u);
  if (heelDir.lengthSq() < 1e-12 || targDir.lengthSq() < 1e-12) {
    out.identity();
    return;
  }
  heelDir.normalize();
  targDir.normalize();
  out.setFromUnitVectors(heelDir, targDir);
}

/**
 * TwoBoneInverseKinematics: rotate hip + knee so the heel (ankle) reaches
 * targetHeel, with a soft extension clamp and a side-vector-derived rotation
 * axis (stable even when the leg straightens). `hip.parent` is the pelvis.
 *
 * @param sideVector   knee side axis in WORLD space (kneeSideVector rotated by
 *                     the knee's world rotation)
 * @param maxExtension current hip→heel distance (the soft clamp's limit)
 * @param softening    width of the soft-clamp zone (m)
 */
export function solveTwoBoneIK(
  hip: THREE.Bone,
  knee: THREE.Bone,
  heel: THREE.Bone,
  targetHeel: THREE.Vector3,
  sideVector: THREE.Vector3,
  maxExtension: number,
  softening: number
): void {
  hip.getWorldPosition(a);
  knee.getWorldPosition(b);
  heel.getWorldPosition(c);
  hip.getWorldQuaternion(aGr);
  knee.getWorldQuaternion(bGr);
  hip.parent?.getWorldQuaternion(pGr);

  // Soft extension clamping — scale the target point in toward maxExtension.
  tClamp.copy(targetHeel);
  const targetLength = targetHeel.distanceTo(a);
  if (targetLength > maxExtension - softening && targetLength > 1e-8) {
    const saturation =
      1 - Math.exp(-Math.max(targetLength - maxExtension + softening, 0) / softening);
    const scale = (maxExtension - softening + softening * saturation) / targetLength;
    tClamp.subVectors(targetHeel, a).multiplyScalar(scale).add(a);
  }

  // Rotation axis from the knee side vector (no pole vector, no degeneracy when
  // the leg is straight).
  axisDwn.subVectors(c, a).normalize(); // hip → heel
  axisFwd.crossVectors(axisDwn, sideVector).normalize();
  axisRot.crossVectors(axisDwn, axisFwd).normalize();

  // Cosine rule.
  const lab = b.distanceTo(a);
  const lcb = b.distanceTo(c);
  const lat = tClamp.distanceTo(a);
  const lca = c.distanceTo(a);

  ca.subVectors(c, a).multiplyScalar(1 / Math.max(lca, 1e-8));
  ba.subVectors(b, a).multiplyScalar(1 / Math.max(lab, 1e-8));
  ab.subVectors(a, b).multiplyScalar(1 / Math.max(lab, 1e-8));
  cb.subVectors(c, b).multiplyScalar(1 / Math.max(lcb, 1e-8));

  const acab0 = Math.acos(clamp(ca.dot(ba), -1, 1));
  const babc0 = Math.acos(clamp(ab.dot(cb), -1, 1));
  const acab1 = Math.acos(
    clamp((lab * lab + lat * lat - lcb * lcb) / (2 * lab * lat), -1, 1)
  );
  const babc1 = Math.acos(
    clamp((lab * lab + lcb * lcb - lat * lat) / (2 * lab * lcb), -1, 1)
  );

  // World-space corrective rotations. r0/r1 rotate about axisRot by the angle
  // deltas; r2 swings the limb so hip→heel points at the (clamped) target.
  r0.setFromAxisAngle(axisRot, acab1 - acab0);
  r1.setFromAxisAngle(axisRot, babc1 - babc0);
  heelDir.subVectors(c, a);
  targDir.subVectors(tClamp, a);
  quaternionBetween(r2, heelDir, targDir);

  // localHip = inv(pelvisWorld) · r2 · r0 · hipWorld
  inv.copy(pGr).invert();
  q.copy(inv).multiply(r2).multiply(r0).multiply(aGr);
  hip.quaternion.copy(q);

  // localKnee = inv(hipWorld_old) · r1 · kneeWorld
  inv.copy(aGr).invert();
  q.copy(inv).multiply(r1).multiply(bGr);
  knee.quaternion.copy(q);

  hip.updateWorldMatrix(false, true);
}

const _bonePos = new THREE.Vector3();
const _childPos = new THREE.Vector3();
const _boneGr = new THREE.Quaternion();
const _parentGr = new THREE.Quaternion();
const _between = new THREE.Quaternion();

/**
 * BoneOrientTowards: rotate `bone` so that its `child` points at `target`,
 * preserving the bone's current twist. Writes bone.quaternion (local).
 */
export function boneOrientTowards(
  bone: THREE.Bone,
  child: THREE.Object3D,
  target: THREE.Vector3
): void {
  bone.getWorldPosition(_bonePos);
  child.getWorldPosition(_childPos);
  bone.getWorldQuaternion(_boneGr);
  bone.parent?.getWorldQuaternion(_parentGr);

  heelDir.subVectors(_childPos, _bonePos);
  targDir.subVectors(target, _bonePos);
  quaternionBetween(_between, heelDir, targDir);

  // desired = between · boneWorld ; local = inv(parentWorld) · desired
  q.copy(_between).multiply(_boneGr);
  inv.copy(_parentGr).invert();
  bone.quaternion.copy(inv.multiply(q));

  bone.updateWorldMatrix(false, true);
}
