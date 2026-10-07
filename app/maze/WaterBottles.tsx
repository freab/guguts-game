"use client";

import { useFrame } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import { attribute, float, instanceIndex, sin, smoothstep, uniform, vec3 } from "three/tsl";
import { audio } from "../audio/audioEngine";
import { bottleFocus } from "../game/bottleFocus";
import { bottlePositions } from "../game/bottles";
import { runStore } from "../game/runStore";
import { playerStore } from "../character/playerStore";
import { WallCollider } from "../character/WallCollider";
import { viewTilt } from "../character/viewTilt";
import { useDisposable } from "../hooks/useDisposable";

/** Seconds between glints (each bottle on its own beat). */
const GLINT_PERIOD = 2.6;
/**
 * A bottle can be picked up within FOCUS_RANGE (m, feet to bottle) while
 * looking at it (the view within FOCUS_CONE of it — wider right at your feet,
 * where it's hard to centre).
 */
const FOCUS_RANGE = 1.8;
const FOCUS_CONE = 0.8;
const FOCUS_CONE_CLOSE = 0.45;
/**
 * The drink, in seconds from the grab: the bottle flies up to Gugut, he
 * drinks (the calls come back as it reaches him), then it lowers and fades.
 */
const FLY = 0.45;
const DRINK_END = 3.2;
const FADE_END = 3.6;
/** Where the bottle is held while drinking, camera-relative (m): low, just ahead. */
const HELD = new THREE.Vector3(0.03, -0.14, -0.33);
/** How far his head tips back while he drinks (radians). */
const HEAD_TILT = 0.12;

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

const easeOutCubic = (t: number) => 1 - (1 - THREE.MathUtils.clamp(t, 0, 1)) ** 3;
const easeInOut = (t: number) => THREE.MathUtils.smootherstep(t, 0, 1);

/**
 * The hidden water (game/bottles): small glass bottles standing on the worn
 * path at the end of dead ends, catching the light now and then with a soft
 * glint so a sharp-eyed player can spot one down a corridor.
 *
 * Picking one up: close by and looking at it, it glows (and ui/DrinkPrompt
 * offers "Drink"); on E / the Drink button (game/bottleFocus) a copy of it
 * flies up to the bottom of the view, tips towards Gugut's mouth as the water
 * drains, and fades — with a clink, the cork, gulps and a breath
 * (audio.drink), his head tipping back a little, and the calls coming back as
 * it reaches him (runStore.drink; ui/DrinkVignette, CallButton). The held
 * copy is drawn over everything, so it never dips into a wall.
 *
 * Three draws (glass, water, cork) for the bottles on the ground, three more
 * while one is being drunk.
 */
class Bottles {
  readonly group = new THREE.Group();
  private readonly positions = bottlePositions();
  /** For "is there a wall between him and the bottle?" (no drinking through walls). */
  private readonly walls = new WallCollider();
  private readonly meshes: THREE.InstancedMesh[];
  private readonly focusAttrs: THREE.InstancedBufferAttribute[] = [];
  private readonly time = uniform(0);
  private shown: boolean[];
  private focused = -1;
  /** The bottle being drunk, as a separate group drawn over everything. */
  private readonly held = new THREE.Group();
  private readonly heldWater: THREE.Mesh;
  private readonly heldMaterials: THREE.Material[] = [];
  private grabAt = -1;
  private grabIndex = -1;
  private drank = false;
  private readonly from = new THREE.Vector3();
  private readonly disposables: { dispose(): void }[] = [];
  private readonly v = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly tilt = new THREE.Quaternion();
  private readonly forward = new THREE.Vector3();

  constructor() {
    this.group.name = "Water";
    const count = Math.max(1, this.positions.length);

    const glassGeometry = new THREE.LatheGeometry(
      BOTTLE_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)),
      14
    );
    const waterGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.15, 12).translate(0, 0.087, 0);
    const corkGeometry = new THREE.CylinderGeometry(0.017, 0.015, 0.03, 8).translate(0, 0.305, 0);

    // A glint: a short bright pulse every GLINT_PERIOD, offset per bottle;
    // and a steady, breathing glow on the one Gugut is looking at.
    const focus = attribute<"float">("bottleFocus", "float");
    const glow = focus.mul(sin(this.time.mul(5)).mul(0.25).add(0.6));
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
    glass.emissiveNode = vec3(0.75, 0.88, 1).mul(glint(0).add(0.04).add(glow));
    const water = new THREE.MeshStandardNodeMaterial({ color: "#3d8fd1", roughness: 0.1, metalness: 0 });
    water.emissiveNode = vec3(0.2, 0.45, 0.7).mul(glint(0.3).mul(0.5).add(float(0.06)).add(glow.mul(0.8)));
    const cork = new THREE.MeshLambertNodeMaterial({ color: "#8a6a45" });

    const parts: [THREE.BufferGeometry, THREE.Material, boolean][] = [
      [waterGeometry, water, true],
      [corkGeometry, cork, false],
      [glassGeometry, glass, true],
    ];
    this.meshes = parts.map(([geometry, material, focusable]) => {
      if (focusable) {
        const attr = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
        geometry.setAttribute("bottleFocus", attr);
        this.focusAttrs.push(attr);
      }
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.disposables.push(geometry, material, mesh);
      return mesh;
    });

    // The held bottle: the same shapes (their own geometry, so no focus
    // attribute is needed), drawn last and over everything, fading out.
    const heldPart = (geometry: THREE.BufferGeometry, color: string, opacity: number, order: number) => {
      const material = new THREE.MeshStandardNodeMaterial({ color, roughness: 0.08, metalness: 0, transparent: true, opacity });
      material.depthTest = false;
      material.depthWrite = false;
      material.fog = false;
      material.userData.opacity = opacity;
      const mesh = new THREE.Mesh(geometry.clone(), material);
      mesh.renderOrder = order;
      mesh.frustumCulled = false;
      this.held.add(mesh);
      this.heldMaterials.push(material);
      this.disposables.push(mesh.geometry, material);
      return mesh;
    };
    this.heldWater = heldPart(waterGeometry, "#3d8fd1", 0.9, 1000);
    heldPart(corkGeometry, "#8a6a45", 1, 1001);
    heldPart(glassGeometry, "#cfeaff", 0.45, 1002);
    this.held.visible = false;
    this.held.name = "Held bottle";
    this.group.add(this.held);

    this.shown = this.positions.map(() => true);
    this.place();
  }

  /** Write the instance matrices: a drunk (or being drunk) bottle is scaled to nothing. */
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

  private setFocus(index: number) {
    if (index === this.focused) return;
    this.focused = index;
    for (const attr of this.focusAttrs) {
      (attr.array as Float32Array).fill(0);
      if (index >= 0) (attr.array as Float32Array)[index] = 1;
      attr.needsUpdate = true;
    }
    bottleFocus.setFocused(index);
  }

  update(camera: THREE.Camera, delta: number) {
    this.time.value += Math.min(delta, 0.1);
    const run = runStore.get();
    const playing = run.phase === "armed" || run.phase === "running";
    const grab = bottleFocus.get().grab;

    // A new run (or the end of one) cancels a drink in progress.
    if (grab && !playing) bottleFocus.done();

    // Start a drink: hide the bottle on the ground, take over with the held one.
    if (grab && grab.index !== this.grabIndex) {
      this.grabIndex = grab.index;
      this.grabAt = this.time.value;
      this.drank = false;
      const [x, z] = this.positions[grab.index];
      this.from.set(x, 0, z);
      this.held.visible = true;
      audio.drink();
    }

    // Which bottle (if any) Gugut is close to and looking at.
    let focus = -1;
    if (playing && !grab && !runStore.isPaused()) {
      camera.getWorldDirection(this.forward);
      let best = 0;
      this.positions.forEach(([x, z], i) => {
        if (run.bottlesTaken[i]) return;
        const d = Math.hypot(playerStore.x - x, playerStore.z - z);
        if (d > FOCUS_RANGE) return;
        this.v.set(x, 0.15, z).sub(camera.position);
        const reach = this.v.length();
        this.v.normalize();
        const facing = this.v.dot(this.forward);
        const cone = d < 0.9 ? FOCUS_CONE_CLOSE : FOCUS_CONE;
        if (facing > cone && facing > best && this.walls.raycast(camera.position, this.v, reach) >= reach - 0.1) {
          best = facing;
          focus = i;
        }
      });
    }
    this.setFocus(focus);

    if (this.grabIndex >= 0) this.animateHeld(camera);

    // Hide what's been drunk or is being drunk (and show them all again for a new run).
    const shown = this.positions.map((_, i) => !run.bottlesTaken[i] && i !== this.grabIndex);
    if (shown.some((v, i) => v !== this.shown[i])) {
      this.shown = shown;
      this.place();
    }
  }

  /** The held bottle: fly up to him, drink (tipping, draining), lower and fade. */
  private animateHeld(camera: THREE.Camera) {
    const t = this.time.value - this.grabAt;
    if (t >= FADE_END || bottleFocus.get().grab === null) {
      this.held.visible = false;
      this.grabIndex = -1;
      viewTilt.pitch = 0;
      bottleFocus.done();
      return;
    }
    // The calls come back as it reaches his mouth.
    if (!this.drank && t >= FLY) {
      this.drank = true;
      runStore.drink(this.grabIndex);
    }
    const drinking = THREE.MathUtils.clamp((t - FLY) / (DRINK_END - FLY), 0, 1);
    const fade = THREE.MathUtils.clamp((t - DRINK_END) / (FADE_END - DRINK_END), 0, 1);

    // Where it's held, in the world: camera-relative, rising a little towards
    // his mouth as he drinks, dropping away as it fades.
    this.v.copy(HELD);
    this.v.y += easeInOut(drinking) * 0.035 - fade * 0.12;
    this.v.applyQuaternion(camera.quaternion).add(camera.position);
    const fly = easeOutCubic(t / FLY);
    this.held.position.lerpVectors(this.from, this.v, fly);

    // Tipped towards him (about the camera's right axis), more as he drinks.
    const tipAngle = 0.25 + easeInOut(drinking) * 1.25 - fade * 0.6;
    this.tilt.setFromAxisAngle(new THREE.Vector3(1, 0, 0), tipAngle);
    this.q.copy(camera.quaternion).multiply(this.tilt);
    this.held.quaternion.identity().slerp(this.q, fly);
    this.held.scale.setScalar(THREE.MathUtils.lerp(1, 0.85, fly) * (1 - fade * 0.3));

    // The water drains; everything fades at the end.
    this.heldWater.scale.y = 1 - easeInOut(drinking) * 0.85;
    for (const m of this.heldMaterials) m.opacity = (m.userData.opacity as number) * (1 - fade);

    // His head tips back while he drinks.
    viewTilt.pitch = HEAD_TILT * Math.sin(Math.PI * drinking) * (1 - fade);
  }

  dispose() {
    viewTilt.pitch = 0;
    for (const d of this.disposables) d.dispose();
  }
}

export default function WaterBottles() {
  const bottles = useDisposable(() => new Bottles(), []);
  useFrame(({ camera }, delta) => bottles.update(camera, delta));
  return <primitive object={bottles.group} />;
}
