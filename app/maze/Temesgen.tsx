"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three/webgpu";
import { clamp, dot, float, length, positionLocal, rotate, sin, smoothstep, uniform, vec3 } from "three/tsl";
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
 * (y −0.83 … +0.83). The arm points below are in those model units.
 */
const TEMESGEN_URL = "/models/temegsgen.glb";
/** Seated height (top of the head), metres. */
const SEATED_HEIGHT = 1.02;

/** His left elbow and the middle of his left hand, resting over the strings. */
const ELBOW = new THREE.Vector3(0.58, -0.02, -0.07);
const HAND = new THREE.Vector3(0.1, -0.03, 0.19);
/** The forearm, as a capsule around elbow → hand: fully moved inside R_IN, not at all past R_OUT. */
const R_IN = 0.075;
const R_OUT = 0.11;
/** The strum: strokes per second, and the swing at the hand (radians about the elbow). */
const STRUM_RATE = 1.7;
const STRUM_SWING = 0.15;

/** Talking: within TALK_RANGE m (feet to where he sits) and looking at him (within TALK_CONE). */
const TALK_RANGE = 2.3;
const TALK_CONE = 0.72;
/** His song: full level within SONG_NEAR m of him, silent past SONG_FAR. */
const SONG_NEAR = 2.5;
const SONG_FAR = 20;
/** Seconds between "is there a wall between us?" checks for the song. */
const OCCLUSION_EVERY = 0.2;

/**
 * His material with the strumming in the vertex shader — no skeleton needed:
 * the left forearm and hand (a capsule from the elbow to the hand, easing in
 * from the elbow so the sleeve bends rather than tears) swing about the elbow,
 * across the strings and a little up and down, in a loose down-up rhythm with
 * a lighter off-beat. The rest of him stays put.
 */
function createTemesgenMaterial(source: THREE.MeshStandardMaterial) {
  const time = uniform(Math.random() * 100);
  const material = new THREE.MeshStandardNodeMaterial();
  material.map = source.map;
  material.color.copy(source.color);
  material.roughnessMap = source.roughnessMap;
  material.metalnessMap = source.metalnessMap;
  material.roughness = source.roughness;
  material.metalness = source.metalness;
  material.normalMap = source.normalMap;

  const p = positionLocal;
  const elbow = vec3(ELBOW.x, ELBOW.y, ELBOW.z);
  const seg = HAND.clone().sub(ELBOW);
  const along = vec3(seg.x, seg.y, seg.z);
  // How far along the forearm (0 at the elbow, 1 at the hand) and how far from it.
  const t = dot(p.sub(elbow), along).div(seg.lengthSq());
  const d = length(p.sub(elbow.add(along.mul(clamp(t, 0, 1.25)))));
  const weight = smoothstep(R_OUT, R_IN, d).mul(smoothstep(0, 0.7, t));

  // Down-up strokes with a lighter off-beat, so it reads as playing, not a metronome.
  const phase = time.mul(STRUM_RATE * 2 * Math.PI);
  const swing = sin(phase).add(sin(phase.mul(2).add(0.6)).mul(0.3)).mul(STRUM_SWING).mul(weight);
  const turned = rotate(p.sub(elbow), vec3(float(0), swing, swing.mul(0.35))).add(elbow);

  material.positionNode = turned;
  return {
    material,
    advance: (dt: number) => void (time.value += dt),
    dispose: () => material.dispose(),
  };
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
 * and playing his kirar — the left hand strumming in a loop. Walk up and look
 * at him to talk (ui/TemesgenDialog); he'll play his song if asked, heard
 * from where he sits.
 */
export default function Temesgen() {
  const { scene } = useGLTF(TEMESGEN_URL);
  const model = useMemo(() => fitSkinnedModel(scene, SEATED_HEIGHT), [scene]);
  const life = useDisposable(() => {
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
    return material;
  }, [model]);

  const presence = useMemo(() => new Presence(), []);
  useFrame(({ camera }, dt) => {
    life.advance(Math.min(dt, 0.1));
    presence.update(camera, dt);
  });
  // Leaving the maze (a new one, or the level chooser) ends the song and any conversation.
  useEffect(() => () => temesgen.reset(), []);

  const spot = restingSpot();
  return (
    <group name="Temesgen" position={[spot.x, 0, spot.z]} rotation={[0, spot.facing, 0]}>
      <primitive object={model.root} />
      <BlobShadow size={1.2} height={0.03} />
    </group>
  );
}

useGLTF.preload(TEMESGEN_URL);
