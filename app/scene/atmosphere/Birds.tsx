"use client";

import { useFrame } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import { attribute, hash, instanceIndex, positionLocal, sin, smoothstep, uniform, vec3 } from "three/tsl";
import { useDisposable } from "../../hooks/useDisposable";

/** Most birds in a flock. */
const MAX_BIRDS = 6;
/** Seconds between flocks (random in this range); the first comes sooner. */
const GAP: [number, number] = [18, 42];
const FIRST: [number, number] = [6, 14];
/** Flight speed (m/s) and the path: half-length, distance to the side, height. */
const SPEED = 3.2;
const HALF_PATH = 8;
const SIDE: [number, number] = [4.5, 7.5];
const HEIGHT: [number, number] = [6, 8.5];

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const between = ([a, b]: [number, number]) => a + Math.random() * (b - a);

/** A loose V: the leader in front, the rest trailing to either side, a little ragged. */
const FORMATION = Array.from({ length: MAX_BIRDS }, (_, i) => {
  const rank = Math.ceil(i / 2);
  const sign = i % 2 === 0 ? 1 : -1;
  const jitter = (k: number) => Math.sin(i * 12.9898 + k * 78.233) * 0.5;
  return new THREE.Vector3(sign * rank * 0.45 + jitter(1) * 0.2, jitter(2) * 0.3, -rank * 0.55);
});

/**
 * A bird silhouette, ~0.36 m across (it reads as a large bird far away):
 * a slim body and two swept wings, `wing` = 0 at the root to 1 at the tip
 * (how far each vertex flaps). Faces +Z.
 */
function birdGeometry(): THREE.BufferGeometry {
  // prettier-ignore
  const v = [
    // body: nose, left, tail, right
    0, 0, 0.12,   -0.018, 0, 0,   0, 0, -0.1,   0.018, 0, 0,
    // left wing: root front, mid, tip, root back
    -0.01, 0, 0.035,   -0.09, 0, 0.02,   -0.18, 0, -0.035,   -0.01, 0, -0.03,
    // right wing
    0.01, 0, 0.035,   0.09, 0, 0.02,   0.18, 0, -0.035,   0.01, 0, -0.03,
  ];
  const wing = [0, 0, 0, 0, 0, 0.5, 1, 0, 0, 0.5, 1, 0];
  // prettier-ignore
  const index = [
    0, 1, 2,   0, 2, 3,          // body
    4, 5, 7,   5, 6, 7,          // left wing
    8, 11, 9,  9, 11, 10,        // right wing
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute("wing", new THREE.Float32BufferAttribute(wing, 1));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/**
 * Now and then a small flock crosses the sky above the walls, in a loose V,
 * flapping in bursts and gliding. Dark silhouettes against the sunset; the
 * path is set when they appear (beside the player, inside the camera's short
 * far plane) and they're gone in a few seconds. One draw while flying.
 */
class BirdFlock {
  readonly mesh: THREE.InstancedMesh;
  private readonly time = uniform(0);
  private now = 0;
  private next = -1;
  private flight: {
    start: THREE.Vector3;
    dir: THREE.Vector3;
    side: THREE.Vector3;
    rotation: THREE.Quaternion;
    t0: number;
    duration: number;
    count: number;
  } | null = null;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3(1, 1, 1);

  constructor() {
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.fog = false; // far-away silhouettes: the fog would wash them out
    material.colorNode = vec3(0.09, 0.09, 0.12);
    // Wings beat in bursts (flapping, then a glide), each bird out of step.
    const phase = hash(instanceIndex).mul(6.283);
    const flapping = smoothstep(-0.3, 0.5, sin(this.time.mul(0.8).add(phase)));
    const beat = sin(this.time.mul(11).add(phase)).mul(flapping);
    const wing = attribute<"float">("wing", "float");
    material.positionNode = positionLocal.add(vec3(0, wing.mul(beat.mul(0.11).add(0.02)), 0));
    this.mesh = new THREE.InstancedMesh(birdGeometry(), material, MAX_BIRDS);
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.name = "Birds";
  }

  update(camera: THREE.Camera, delta: number) {
    this.now += Math.min(delta, 0.1);
    this.time.value = this.now;
    if (this.next < 0) this.next = this.now + between(FIRST);

    if (!this.flight && this.now >= this.next) {
      // A new flock: a straight pass beside the player, high above the walls.
      const a = Math.random() * Math.PI * 2;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const side = new THREE.Vector3().crossVectors(UP, dir);
      const start = new THREE.Vector3(camera.position.x, between(HEIGHT), camera.position.z)
        .addScaledVector(side, between(SIDE) * (Math.random() < 0.5 ? -1 : 1))
        .addScaledVector(dir, -HALF_PATH);
      this.flight = {
        start,
        dir,
        side,
        rotation: new THREE.Quaternion().setFromUnitVectors(FORWARD, dir),
        t0: this.now,
        duration: (HALF_PATH * 2) / SPEED,
        count: 3 + Math.floor(Math.random() * (MAX_BIRDS - 2)),
      };
    }

    const f = this.flight;
    if (!f) return;
    const progress = (this.now - f.t0) / f.duration;
    if (progress > 1) {
      this.flight = null;
      this.next = this.now + between(GAP);
      this.mesh.visible = false;
      return;
    }
    for (let i = 0; i < f.count; i++) {
      const o = FORMATION[i];
      this.position
        .copy(f.start)
        .addScaledVector(f.dir, progress * HALF_PATH * 2 + o.z)
        .addScaledVector(f.side, o.x)
        .setY(f.start.y + o.y + Math.sin(this.now * 1.3 + i) * 0.08);
      this.mesh.setMatrixAt(i, this.matrix.compose(this.position, f.rotation, this.scale));
    }
    this.mesh.count = f.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

export default function Birds() {
  const flock = useDisposable(() => new BirdFlock(), []);
  useFrame(({ camera }, delta) => flock.update(camera, delta));
  return <primitive object={flock.mesh} />;
}
