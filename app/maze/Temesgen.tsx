"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three/webgpu";
import {
  abs,
  clamp,
  dot,
  float,
  length,
  materialColor,
  positionLocal,
  rotate,
  sin,
  smoothstep,
  uniform,
  vec3,
} from "three/tsl";
import BlobShadow from "../character/BlobShadow";
import { fitSkinnedModel } from "../character/fitSkinnedModel";
import { playerStore } from "../character/playerStore";
import { WallCollider } from "../character/WallCollider";
import { temesgen } from "../game/temesgen";
import { restingSpot } from "./mazeData";
import { useDisposable } from "../hooks/useDisposable";
import { audio } from "../audio/audioEngine";

/**
 * Temesgen: one static, textured scan (no rig, no clips) of a man sitting
 * cross-legged with a kirar, authored facing +Z in a box about 1.66 tall
 * (y −0.83 … +0.83). The body points below are in those model units (found by
 * rendering markers on the scan).
 */
const TEMESGEN_URL = "/models/temegsgen.glb";
/** Seated height (top of the head), metres. */
const SEATED_HEIGHT = 1.02;

/** Left arm: the elbow and the middle of the hand that strums, over the strings. */
const LEFT_ELBOW = new THREE.Vector3(0.58, -0.02, -0.07);
const LEFT_HAND = new THREE.Vector3(0.1, -0.03, 0.19);
/** Right arm: the elbow and the hand holding the kirar's upright, fingers on the strings. */
const RIGHT_ELBOW = new THREE.Vector3(-0.44, -0.16, -0.02);
const RIGHT_HAND = new THREE.Vector3(-0.2, -0.05, 0.28);
/** Along the kirar's upright: the right hand slides along it (so the wood it grips slides along itself, unbent). */
const UPRIGHT = new THREE.Vector3(0.42, 0.906, -0.04).normalize();
/** Where the head turns and nods from (inside the neck), and the body sways from (the hips). */
const NECK = new THREE.Vector3(0, 0.4, -0.12);
const HIPS = new THREE.Vector3(0, -0.45, -0.12);

/** The strum's swing at the hand (radians about the elbow, at full stroke). */
const STRUM_SWING = 0.18;
/** How far the right hand moves along the upright (model units, at full reach). */
const FRET_SLIDE = 0.035;
/** Seconds per breath, and how much the chest swells. */
const BREATH_PERIOD = 4.2;
const BREATH_SWELL = 0.012;

/**
 * Light. He sits at the foot of the tree, mostly turned away from the low
 * sun, where the scene's sky light alone leaves his face and the dark wood of
 * the kirar nearly black. FILL is a faint, warm light that would bounce up
 * from the sunlit clearing (added as a share of his own colour, so it lifts
 * the shadows without flattening the scan's detail) — kept small: much more
 * and he glows against the dusk. ROUGHNESS scales the scan's roughness:
 * cloth and skin are matte, not the scan's slight plastic shine.
 */
const FILL = new THREE.Color(1, 0.9, 0.78).multiplyScalar(0.05);
const ROUGHNESS = 1.4;

/** Talking: within TALK_RANGE m (feet to where he sits) and looking at him (within TALK_CONE). */
const TALK_RANGE = 2.3;
const TALK_CONE = 0.72;
/** His song: full level within SONG_NEAR m of him, silent past SONG_FAR. */
const SONG_NEAR = 2.5;
const SONG_FAR = 20;
/** Seconds between "is there a wall between us?" checks for the song. */
const OCCLUSION_EVERY = 0.2;
/** He turns his head to Gugut within this distance (m), up to this far round (radians). */
const LOOK_RANGE = 8;
const LOOK_MAX = 0.5;
/** His eyes' height (m, seated), and how far his head tips up / down to meet Gugut's (radians). */
const EYE_LEVEL = SEATED_HEIGHT * 0.86;
const LOOK_UP_MAX = 0.32;
const LOOK_DOWN_MAX = 0.15;

const v = (p: THREE.Vector3) => vec3(p.x, p.y, p.z);
const v3 = (c: THREE.Color) => vec3(c.r, c.g, c.b);

/**
 * 0..1: how much of a limb a vertex is — inside a capsule around elbow →
 * hand (fully within rIn, not at all past rOut), easing in from the elbow so
 * the sleeve bends there rather than tearing.
 */
function limb(p: typeof positionLocal, elbow: THREE.Vector3, hand: THREE.Vector3, rIn: number, rOut: number) {
  const seg = hand.clone().sub(elbow);
  const e = v(elbow);
  const t = dot(p.sub(e), v(seg)).div(seg.lengthSq());
  const d = length(p.sub(e.add(v(seg).mul(clamp(t, 0, 1.25)))));
  return smoothstep(rOut, rIn, d).mul(smoothstep(0, 0.7, t));
}

/**
 * His material, alive in the vertex shader — no skeleton needed. Driven by
 * uniforms the Performer sets each frame:
 * - strum: the left forearm swings about the elbow across the strings;
 * - fret: the right hand moves up and down the kirar's upright;
 * - breathing: the chest swells and settles (on its own clock);
 * - head: turns (yaw) and nods, from inside the neck;
 * - sway: the upper body — arms and kirar with it — rocks and leans from
 *   the hips; the crossed legs stay planted.
 */
function createTemesgenMaterial(source: THREE.MeshStandardMaterial) {
  const u = {
    time: uniform(Math.random() * 100),
    strum: uniform(0),
    fret: uniform(0),
    yaw: uniform(0),
    nod: uniform(0),
    swayX: uniform(0),
    swayZ: uniform(0),
  };
  const material = new THREE.MeshStandardNodeMaterial();
  material.map = source.map;
  material.color.copy(source.color);
  material.roughnessMap = source.roughnessMap;
  material.metalnessMap = source.metalnessMap;
  material.roughness = source.roughness * ROUGHNESS;
  material.metalness = source.metalness;
  material.normalMap = source.normalMap;

  // The bounce fill (see FILL).
  material.emissiveNode = materialColor.rgb.mul(v3(FILL));

  // Which part of him each vertex is (from where it sits in the scan).
  const p0 = positionLocal;
  const leftArm = limb(p0, LEFT_ELBOW, LEFT_HAND, 0.075, 0.11);
  const rightArm = limb(p0, RIGHT_ELBOW, RIGHT_HAND, 0.07, 0.1);
  const chest = smoothstep(-0.25, -0.05, p0.y).mul(smoothstep(0.42, 0.25, p0.y)).mul(smoothstep(0.2, 0.08, p0.z));
  const head = smoothstep(0.37, 0.45, p0.y).mul(smoothstep(0.24, 0.16, abs(p0.x))).mul(smoothstep(0.2, 0.13, p0.z));
  const body = smoothstep(-0.5, 0.1, p0.y);

  // Strum: about the left elbow, across the strings and a little up.
  const swing = u.strum.mul(STRUM_SWING).mul(leftArm);
  const leftElbow = v(LEFT_ELBOW);
  const p1 = rotate(p0.sub(leftElbow), vec3(float(0), swing, swing.mul(0.35))).add(leftElbow);
  // Fret: the right hand along the upright.
  const p2 = p1.add(v(UPRIGHT).mul(u.fret.mul(FRET_SLIDE).mul(rightArm)));
  // Breath: out from the spine, with a short rest after each out-breath.
  const breath = smoothstep(-0.6, 1, sin(u.time.mul((2 * Math.PI) / BREATH_PERIOD)));
  const p3 = p2.add(vec3(p2.x, 0, p2.z.add(0.1)).mul(breath.mul(BREATH_SWELL).mul(chest)));
  // Head: turn and nod.
  const neck = v(NECK);
  const p4 = rotate(p3.sub(neck), vec3(u.nod.mul(head), u.yaw.mul(head), float(0))).add(neck);
  // Body: rock and lean from the hips.
  const hips = v(HIPS);
  const p5 = rotate(p4.sub(hips), vec3(u.swayX.mul(body), float(0), u.swayZ.mul(body))).add(hips);

  material.positionNode = p5;
  return { material, uniforms: u, dispose: () => material.dispose() };
}

type Uniforms = ReturnType<typeof createTemesgenMaterial>["uniforms"];

const follow = (from: number, to: number, rate: number, dt: number) => from + (to - from) * (1 - Math.exp(-rate * dt));
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * Plays him, each frame. While his song plays, his hands follow the actual
 * music (audio.songEnergy): each pluck in the recording — a jump in its
 * level — flips the strum (down, up, down…) and nods his head on the beat;
 * the louder the passage, the bigger the strokes and the more he sways; the
 * right hand moves along the upright now and then. Resting, he idly picks at
 * the strings. He turns his head to Gugut when he's near, and looks about
 * otherwise.
 */
class Performer {
  private t = Math.random() * 100;
  private fast = 0;
  private slow = 0;
  private stroke = 1;
  private sinceStroke = 1;
  private beat = 0;
  private fretTarget = 0;
  private fretIn = 1;
  private readonly spot = restingSpot();

  update(u: Uniforms, camera: THREE.Camera, dt: number) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    u.time.value = this.t;
    const playing = temesgen.get().song === "playing";

    // The music's level: a quick follower (plucks) against a slow one (the passage).
    const energy = playing ? audio.songEnergy() : 0;
    this.fast = follow(this.fast, energy, 30, dt);
    this.slow = follow(this.slow, energy, 2.5, dt);
    const loud = Math.min(1, this.slow * 8);
    this.sinceStroke += dt;
    this.beat *= Math.exp(-7 * dt);

    let strum: number;
    if (playing) {
      if (this.fast > this.slow * 1.25 && this.fast > 0.015 && this.sinceStroke > 0.12) {
        this.stroke = -this.stroke;
        this.sinceStroke = 0;
        this.beat = 1;
      } else if (this.sinceStroke > 0.55 && this.slow > 0.01) {
        // A passage without clear plucks still keeps him playing.
        this.stroke = -this.stroke;
        this.sinceStroke = 0;
        this.beat = 0.4;
      }
      strum = follow(u.strum.value, this.stroke * (0.55 + loud * 0.45), 26, dt);
    } else {
      // Resting: idly picking at the strings.
      const tau = 2 * Math.PI;
      strum = follow(u.strum.value, Math.sin(this.t * tau * 0.8) * 0.3 + Math.sin(this.t * tau * 1.7) * 0.08, 10, dt);
    }
    u.strum.value = strum;

    // The right hand moves along the upright now and then.
    this.fretIn -= dt;
    if (this.fretIn <= 0) {
      this.fretTarget = playing ? rand(-1, 1) : rand(-0.3, 0.3);
      this.fretIn = playing ? rand(0.8, 2.5) : rand(2, 5);
    }
    u.fret.value = follow(u.fret.value, this.fretTarget, 9, dt);

    // Head: at Gugut — his eyes, up or down — when he's near and in front;
    // otherwise looking about, and down at the kirar while playing.
    const dx = camera.position.x - this.spot.x;
    const dz = camera.position.z - this.spot.z;
    const across = Math.hypot(dx, dz);
    const f = this.spot.facing;
    const angle = Math.atan2(dx * Math.cos(f) - dz * Math.sin(f), dx * Math.sin(f) + dz * Math.cos(f));
    const watching = across < LOOK_RANGE && Math.abs(angle) < 1.4;
    let yaw: number;
    let nod: number;
    if (watching) {
      yaw = THREE.MathUtils.clamp(angle, -LOOK_MAX, LOOK_MAX);
      // Up (negative nod) to the camera's height from his eyes; a small dip on each beat.
      const up = Math.atan2(camera.position.y - EYE_LEVEL, Math.max(across, 0.3));
      nod = THREE.MathUtils.clamp(-up, -LOOK_UP_MAX, LOOK_DOWN_MAX) + (playing ? this.beat * 0.04 : 0);
    } else {
      yaw = Math.sin(this.t * 0.21) * 0.25 + Math.sin(this.t * 0.53 + 1) * 0.1 + (playing ? Math.sin(this.t * 1.1) * 0.06 : 0);
      nod = (playing ? 0.06 + this.beat * 0.06 : 0.02) + Math.sin(this.t * 0.37) * 0.025;
    }
    u.yaw.value = follow(u.yaw.value, yaw, 2.2, dt);
    u.nod.value = follow(u.nod.value, nod, playing && !watching ? 14 : 3, dt);

    // Sway: rocking with the music (bigger in loud passages), a slow drift at rest.
    u.swayZ.value = playing ? Math.sin(this.t * 1.3) * 0.022 * (0.5 + loud * 0.5) : Math.sin(this.t * 0.45) * 0.008;
    u.swayX.value = playing ? Math.sin(this.t * 2.6) * 0.012 + this.beat * 0.01 : Math.sin(this.t * 0.3 + 1) * 0.006;
  }
}

/**
 * Whether Gugut can talk to him (close, facing him: game/temesgen `near`),
 * and — while he plays his song — how loud it is where Gugut stands: full
 * beside him, easing to silence across the clearing, muffled behind walls.
 */
class Presence {
  private readonly spot = restingSpot();
  private readonly walls = new WallCollider();
  private readonly head = new THREE.Vector3(this.spot.x, 0.75, this.spot.z);
  private readonly forward = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private occluded = false;
  private sinceCheck = OCCLUSION_EVERY;

  update(camera: THREE.Camera, dt: number) {
    const { talking, song } = temesgen.get();
    // Near enough to talk, and looking his way.
    const feet = Math.hypot(playerStore.x - this.spot.x, playerStore.z - this.spot.z);
    let near = false;
    if (!talking && feet <= TALK_RANGE) {
      camera.getWorldDirection(this.forward);
      this.to.copy(this.head).sub(camera.position).normalize();
      near = this.to.dot(this.forward) > TALK_CONE;
    }
    temesgen.setNear(near);

    if (song !== "playing") return;
    const distance = camera.position.distanceTo(this.head);
    this.sinceCheck += dt;
    if (this.sinceCheck >= OCCLUSION_EVERY) {
      this.sinceCheck = 0;
      this.to.copy(this.head).sub(camera.position).normalize();
      this.occluded = this.walls.raycast(camera.position, this.to, distance) < distance - 0.3;
    }
    const fade = THREE.MathUtils.smoothstep(distance, SONG_NEAR, SONG_FAR);
    audio.setSongLevel((1 - fade) ** 2 * (this.occluded ? 0.6 : 1), this.occluded);
  }
}

/**
 * Temesgen, resting against the maple in the clearing (mazeData.restingSpot)
 * and playing his kirar (Performer). Walk up and look at him to talk
 * (ui/TemesgenDialog); he'll play his song if asked — heard from where he
 * sits — and Gugut sits down in front of him to listen (character/Seat).
 */
export default function Temesgen() {
  const { scene } = useGLTF(TEMESGEN_URL);
  // His copy of the scan and its living material, made together: in
  // development React runs this twice (StrictMode) and keeps the first, so
  // the material whose uniforms the Performer drives must be the one on the
  // mesh that's drawn — built apart, the second run's material would end up
  // on the mesh, frozen.
  const life = useDisposable(() => {
    const model = fitSkinnedModel(scene, SEATED_HEIGHT);
    let source: THREE.MeshStandardMaterial | null = null;
    model.animated.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !source) source = mesh.material as THREE.MeshStandardMaterial;
    });
    const material = createTemesgenMaterial(source!);
    model.animated.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.material = material.material;
        mesh.name = ""; // (counted under "Temesgen" in the #debug readout)
      }
    });
    return { root: model.root, uniforms: material.uniforms, dispose: material.dispose };
  }, [scene]);

  const performer = useMemo(() => new Performer(), []);
  const presence = useMemo(() => new Presence(), []);
  useFrame(({ camera }, dt) => {
    performer.update(life.uniforms, camera, dt);
    presence.update(camera, dt);
  });
  // Leaving the maze (a new one, or the level chooser) ends the song and any conversation.
  useEffect(() => () => temesgen.reset(), []);

  const spot = restingSpot();
  return (
    <group name="Temesgen" position={[spot.x, 0, spot.z]} rotation={[0, spot.facing, 0]}>
      <primitive object={life.root} />
      <BlobShadow size={1.2} height={0.03} />
    </group>
  );
}

useGLTF.preload(TEMESGEN_URL);
