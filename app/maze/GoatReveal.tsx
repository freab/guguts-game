"use client";

import { useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import {
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  color,
  cos,
  float,
  length,
  mod,
  normalView,
  positionLocal,
  positionView,
  sin,
  smoothstep,
  uniform,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import { audio } from "../audio/audioEngine";
import { runStore } from "../game/runStore";
import { useDisposable } from "../hooks/useDisposable";
import { bushPlace } from "./CoffeeBush";
import { exitPosition } from "./mazeData";
import { goat } from "../game/goat";

/** The reveal's warm light. */
export const REVEAL_COLOR = new THREE.Color("#ffb066");
/**
 * How strongly the reveal glows (0 = not yet seen): the goat's rim light
 * (maze/Goat) and everything here scale by it. Rises as Gugut first sees her,
 * settles to a soft beacon, and blooms up as he reaches her.
 */
export const revealGlow = uniform(0);
/** The reveal's own clock (its motes drift and twinkle by it). */
const time = uniform(0);

/** Where the reveal is centred: between her and the bush while she's home, on her once she runs (game/goat). */
const revealCenter = uniform(new THREE.Vector3());

/** Centre the reveal on her (and her bush, while she's by it). */
function followGoat(group: THREE.Group) {
  const [gx, gz] = goat.position();
  const [ex, ez] = exitPosition();
  const bush = bushPlace();
  const home = Math.hypot(gx - ex, gz - ez) < 0.5;
  const x = home ? (gx + bush.x) / 2 : gx;
  const z = home ? (gz + bush.z) / 2 : gz;
  revealCenter.value.set(x, 0, z);
  group.position.set(x, 0, z);
}

/** Seeing her: up over RISE s, then settling to SETTLE over the next SETTLE_OVER s. */
const RISE = 2.5;
const SETTLE = 0.6;
const SETTLE_OVER = 6;
/** Reaching her: up to WIN_GLOW over WIN_RISE s. */
const WIN_GLOW = 2.2;
const WIN_RISE = 1.6;
/** Motes drifting up around her and the bush. */
const MOTES = 70;
const MOTE_RADIUS = 1.7;
const MOTE_HEIGHT = 2.4;

const ease = (t: number) => {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
};
/** The glow `t` s after she was first seen. */
const seenGlow = (t: number) => (t < RISE ? ease(t / RISE) : 1 - (1 - SETTLE) * ease((t - RISE) / SETTLE_OVER));

function additive<T extends THREE.NodeMaterial>(material: T): T {
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.fog = false;
  return material;
}

/**
 * The goat reveal, around her and the coffee bush: a warm glow on the
 * ground, a faint shaft of light from above, and motes drifting up through
 * it — all additive and shader-driven (a real light would make every
 * material recompile). And a swell of
 * music as she is seen, a bigger one as she is reached.
 */
export default function GoatReveal() {

  const parts = useDisposable(() => {
    const warm = color(REVEAL_COLOR);
    // Always "visible" (black, so unseen, until she has been seen): the
    // loading warm-up then compiles these with everything else — no hitch
    // at the moment of the reveal.
    const group = new THREE.Group();

    // The ground glow: a soft warm pool.
    const poolGeometry = new THREE.PlaneGeometry(5, 5);
    const pool = additive(new THREE.MeshBasicNodeMaterial());
    const r = length(uv().sub(0.5)).mul(2);
    pool.colorNode = warm.mul(revealGlow).mul(0.22);
    pool.opacityNode = smoothstep(1, 0, r).pow(2);
    const poolMesh = new THREE.Mesh(poolGeometry, pool);
    poolMesh.rotation.x = -Math.PI / 2;
    poolMesh.position.y = 0.03;
    group.add(poolMesh);

    // The shaft: an open cylinder, bright where you look through its middle, fading upward.
    const shaftGeometry = new THREE.CylinderGeometry(1.1, 1.6, 7, 32, 1, true);
    shaftGeometry.translate(0, 3.5, 0);
    const shaft = additive(new THREE.MeshBasicNodeMaterial());
    shaft.side = THREE.DoubleSide;
    const facing = normalView.z.abs().pow(2);
    shaft.colorNode = warm.mul(revealGlow).mul(0.07);
    shaft.opacityNode = facing.mul(smoothstep(1, 0.15, uv().y)).mul(smoothstep(0, 0.08, uv().y));
    group.add(new THREE.Mesh(shaftGeometry, shaft));

    // Motes: each circles slowly as it rises, fading in at the bottom and out at the top.
    const quad = new THREE.PlaneGeometry(1, 1);
    const moteGeometry = new THREE.InstancedBufferGeometry();
    moteGeometry.index = quad.index;
    moteGeometry.setAttribute("position", quad.getAttribute("position"));
    moteGeometry.setAttribute("uv", quad.getAttribute("uv"));
    const seeds = new Float32Array(MOTES * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    moteGeometry.setAttribute("seed", new THREE.InstancedBufferAttribute(seeds, 4));
    moteGeometry.instanceCount = MOTES;
    const s = attribute<"vec4">("seed", "vec4");
    const rise = mod(s.z.mul(MOTE_HEIGHT).add(time.mul(s.x.mul(0.12).add(0.06))), MOTE_HEIGHT);
    const angle = s.y.mul(Math.PI * 2).add(time.mul(s.w.sub(0.5).mul(0.6)));
    const radius = s.w.mul(MOTE_RADIUS - 0.25).add(0.25);
    const local = vec3(cos(angle).mul(radius), rise.add(0.1), sin(angle).mul(radius));
    const view = cameraViewMatrix.mul(vec4(local.add(revealCenter), 1));
    const motes = additive(new THREE.MeshBasicNodeMaterial());
    motes.vertexNode = cameraProjectionMatrix.mul(view.add(vec4(positionLocal.xy.mul(s.x.mul(0.025).add(0.02)), 0, 0)));
    const dot = smoothstep(1, 0, length(uv().sub(0.5)).mul(2)).pow(2);
    const twinkle = sin(time.mul(s.z.mul(2).add(1)).add(s.y.mul(30))).mul(0.35).add(0.65);
    motes.colorNode = warm.mul(revealGlow).mul(1.6);
    motes.opacityNode = dot.mul(twinkle).mul(smoothstep(0, 0.4, rise)).mul(smoothstep(MOTE_HEIGHT, MOTE_HEIGHT - 0.8, rise));
    const moteMesh = new THREE.Mesh(moteGeometry, motes);
    moteMesh.frustumCulled = false;
    moteMesh.name = "Reveal motes";

    return {
      group,
      moteMesh,
      dispose: () => {
        for (const g of [poolGeometry, shaftGeometry, quad, moteGeometry]) g.dispose();
        for (const m of [pool, shaft, motes]) m.dispose();
      },
    };
  }, []);

  // The swells of music: seeing her, then reaching her.
  useEffect(() => {
    revealGlow.value = 0;
    let { sawAt, phase } = runStore.get();
    return runStore.subscribe(() => {
      const run = runStore.get();
      if (run.sawAt && !sawAt) audio.swell(1);
      if (run.phase === "won" && phase !== "won") audio.swell(1.4);
      sawAt = run.sawAt;
      phase = run.phase;
    });
  }, []);

  useFrame((_, dt) => {
    time.value += Math.min(dt, 0.1);
    const run = runStore.get();
    const now = performance.now();
    let glow = 0;
    if (run.phase === "won") {
      const from = run.sawAt ? seenGlow((run.finishedAt - run.sawAt) / 1000) : 0;
      glow = from + (WIN_GLOW - from) * ease((now - run.finishedAt) / 1000 / WIN_RISE);
    } else if (run.sawAt) {
      glow = seenGlow((now - run.sawAt) / 1000);
    }
    revealGlow.value = glow;
    followGoat(parts.group);
  });

  return (
    <>
      <primitive object={parts.group} />
      <primitive object={parts.moteMesh} />
    </>
  );
}

/**
 * The goat's share of the reveal: a warm rim light, strongest on her
 * silhouette, plus a faint all-over warmth (maze/Goat adds it as emissive).
 */
export function revealRim() {
  const rim = float(1).sub(normalView.dot(positionView.normalize().negate()).clamp(0, 1)).pow(2.5);
  return color(REVEAL_COLOR).mul(revealGlow).mul(rim.mul(0.9).add(0.1));
}
