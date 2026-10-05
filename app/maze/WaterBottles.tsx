"use client";

import { useFrame } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import { float, instanceIndex, sin, smoothstep, uniform, vec3 } from "three/tsl";
import { bottlePositions } from "../game/bottles";
import { runStore } from "../game/runStore";
import { playerStore } from "../character/playerStore";
import { useDisposable } from "../hooks/useDisposable";

/** How close (m, feet to bottle) drinks it. */
const REACH = 0.9;
/** Seconds between glints (each bottle on its own beat). */
const GLINT_PERIOD = 2.6;

/** A glass bottle's outline (radius, height in m), base to lip, for a lathe. */
const BOTTLE_PROFILE: [number, number][] = [
  [0, 0],
  [0.05, 0],
  [0.056, 0.012],
  [0.058, 0.17],
  [0.052, 0.205],
  [0.03, 0.235],
  [0.019, 0.255],
  [0.019, 0.295],
  [0.022, 0.3],
];

/**
 * The hidden water (game/bottles): small glass bottles standing on the worn
 * path at the end of dead ends, catching the light now and then with a soft
 * glint so a sharp-eyed player can spot one down a corridor. Walking up to a
 * bottle drinks it (runStore.drink) and it's gone. Three draws (glass, water,
 * cork) for all of them.
 */
class Bottles {
  readonly group = new THREE.Group();
  private readonly positions = bottlePositions();
  private readonly meshes: THREE.InstancedMesh[];
  private readonly time = uniform(0);
  private shown: boolean[];
  private readonly disposables: { dispose(): void }[] = [];

  constructor() {
    this.group.name = "Water";
    const count = Math.max(1, this.positions.length);

    const glassGeometry = new THREE.LatheGeometry(
      BOTTLE_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)),
      14
    );
    const waterGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.15, 12).translate(0, 0.087, 0);
    const corkGeometry = new THREE.CylinderGeometry(0.017, 0.015, 0.03, 8).translate(0, 0.305, 0);

    // A glint: a short bright pulse every GLINT_PERIOD, offset per bottle.
    const glint = (phase: number) =>
      smoothstep(0.93, 1, sin(this.time.mul((2 * Math.PI) / GLINT_PERIOD).add(instanceIndex.toFloat().mul(2.3)).add(phase))).mul(1.6);
    const glass = new THREE.MeshStandardNodeMaterial({
      color: "#cfeaff",
      roughness: 0.06,
      metalness: 0,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    glass.emissiveNode = vec3(0.75, 0.88, 1).mul(glint(0).add(0.04));
    const water = new THREE.MeshStandardNodeMaterial({ color: "#3d8fd1", roughness: 0.1, metalness: 0 });
    water.emissiveNode = vec3(0.2, 0.45, 0.7).mul(glint(0.3).mul(0.5).add(float(0.06)));
    const cork = new THREE.MeshLambertNodeMaterial({ color: "#8a6a45" });

    const parts: [THREE.BufferGeometry, THREE.Material][] = [
      [waterGeometry, water],
      [corkGeometry, cork],
      [glassGeometry, glass],
    ];
    this.meshes = parts.map(([geometry, material]) => {
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.disposables.push(geometry, material, mesh);
      return mesh;
    });
    this.shown = this.positions.map(() => true);
    this.place();
  }

  /** Write the instance matrices: a drunk bottle is scaled to nothing. */
  private place() {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    this.positions.forEach(([x, z], i) => {
      // A slight, fixed lean and turn, so they don't look placed by a robot.
      q.setFromEuler(new THREE.Euler(0.06 * (i % 2 ? 1 : -1), i * 2.1, 0.04));
      const s = this.shown[i] ? 1 : 0;
      m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s, s));
      for (const mesh of this.meshes) mesh.setMatrixAt(i, m);
    });
    for (const mesh of this.meshes) {
      mesh.count = this.positions.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  update(delta: number) {
    this.time.value += Math.min(delta, 0.1);
    const { bottlesTaken, phase } = runStore.get();
    if (phase === "armed" || phase === "running") {
      this.positions.forEach(([x, z], i) => {
        if (!bottlesTaken[i] && Math.hypot(playerStore.x - x, playerStore.z - z) < REACH) runStore.drink(i);
      });
    }
    // Hide what's been drunk (and show them all again for a new run).
    const shown = this.positions.map((_, i) => !runStore.get().bottlesTaken[i]);
    if (shown.some((v, i) => v !== this.shown[i])) {
      this.shown = shown;
      this.place();
    }
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
  }
}

export default function WaterBottles() {
  const bottles = useDisposable(() => new Bottles(), []);
  useFrame((_, delta) => bottles.update(delta));
  return <primitive object={bottles.group} />;
}
