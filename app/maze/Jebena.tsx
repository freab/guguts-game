"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import {
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  float,
  length,
  mod,
  modelWorldMatrix,
  positionLocal,
  sin,
  smoothstep,
  uniform,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import { audio } from "../audio/audioEngine";
import { playerStore } from "../character/playerStore";
import { jebenaPlace } from "../game/jebena";
import { runStore } from "../game/runStore";
import { useDisposable } from "../hooks/useDisposable";

/** Walk this close (m, feet to the pot) to pick it up. */
const PICK_UP = 0.9;
/** Steam: puffs rising from the spout, how high (m) and how long each lives (s). */
const PUFFS = 14;
const STEAM_RISE = 0.55;
const STEAM_LIFE = 3;

/** The steam's clock (s). */
const steamTime = uniform(0);

/**
 * The pot's outline, turned on a lathe (radius, height in m): a round, squat
 * belly, a long narrow neck and a lip — a jebena, the clay coffee pot.
 */
const PROFILE: [number, number][] = [
  [0, 0],
  [0.06, 0.004],
  [0.1, 0.035],
  [0.112, 0.075],
  [0.1, 0.115],
  [0.06, 0.148],
  [0.032, 0.17],
  [0.027, 0.235],
  [0.034, 0.265],
  [0.04, 0.275],
];

/** The pot on its stone, two little cups beside it, and steam: built once, around (0, 0, 0). */
function buildJebena() {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, place: (m: THREE.Mesh) => void) => {
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    place(mesh);
    group.add(mesh);
    return mesh;
  };

  const stone = new THREE.MeshStandardNodeMaterial({ color: "#8a8173", roughness: 0.95 });
  const clay = new THREE.MeshStandardNodeMaterial({ color: "#2e1d14", roughness: 0.7 });
  const cupClay = new THREE.MeshStandardNodeMaterial({ color: "#e6dccb", roughness: 0.55 });
  materials.push(stone, clay, cupClay);

  // A flat stone to sit on.
  add(new THREE.DodecahedronGeometry(0.26, 0), stone, (m) => {
    m.scale.set(1.15, 0.28, 0.85);
    m.position.y = 0.04;
  });
  const top = 0.1;
  // The pot: belly, neck and lip; a spout off the belly; a handle from neck to belly.
  add(new THREE.LatheGeometry(PROFILE.map(([r, y]) => new THREE.Vector2(r, y)), 20), clay, (m) => {
    m.position.y = top;
  });
  add(new THREE.CylinderGeometry(0.011, 0.017, 0.12, 8), clay, (m) => {
    m.position.set(0.1, top + 0.13, 0);
    m.rotation.z = -0.75;
  });
  add(new THREE.TorusGeometry(0.055, 0.008, 6, 14, Math.PI), clay, (m) => {
    m.position.set(-0.06, top + 0.15, 0);
    m.rotation.set(0, 0, Math.PI / 2 + 0.25);
  });
  // Two little cups (sini).
  for (const [x, z] of [
    [0.16, 0.13],
    [0.2, 0.02],
  ]) {
    add(new THREE.CylinderGeometry(0.026, 0.019, 0.034, 12), cupClay, (m) => m.position.set(x, top + 0.017, z));
  }

  // Steam: soft puffs drifting up from the spout and spreading as they fade.
  const quad = new THREE.PlaneGeometry(1, 1);
  const steamGeometry = new THREE.InstancedBufferGeometry();
  steamGeometry.index = quad.index;
  steamGeometry.setAttribute("position", quad.getAttribute("position"));
  steamGeometry.setAttribute("uv", quad.getAttribute("uv"));
  const seeds = new Float32Array(PUFFS * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  steamGeometry.setAttribute("seed", new THREE.InstancedBufferAttribute(seeds, 4));
  steamGeometry.instanceCount = PUFFS;
  geometries.push(quad, steamGeometry);
  const s = attribute<"vec4">("seed", "vec4");
  const life = mod(steamTime.div(STEAM_LIFE).add(s.x), 1);
  const spout = vec3(0.15, top + 0.18, 0);
  const drift = vec3(sin(steamTime.mul(0.9).add(s.y.mul(6.28))).mul(0.04).mul(life), life.mul(STEAM_RISE), s.z.sub(0.5).mul(0.06).mul(life));
  const steam = new THREE.MeshBasicNodeMaterial();
  steam.transparent = true;
  steam.depthWrite = false;
  steam.fog = false;
  // (In the pot's own space: its world matrix places it.)
  const world = modelWorldMatrix.mul(vec4(spout.add(drift), 1));
  const view = cameraViewMatrix.mul(world);
  steam.vertexNode = cameraProjectionMatrix.mul(view.add(vec4(positionLocal.xy.mul(life.mul(0.12).add(0.03)), 0, 0)));
  steam.colorNode = vec3(1, 0.98, 0.95);
  const puff = smoothstep(1, 0, length(uv().sub(0.5)).mul(2)).pow(1.5);
  steam.opacityNode = puff.mul(smoothstep(0, 0.15, life)).mul(smoothstep(1, 0.5, life)).mul(float(0.22));
  materials.push(steam);
  const steamMesh = new THREE.Mesh(steamGeometry, steam);
  steamMesh.frustumCulled = false;
  group.add(steamMesh);

  return {
    group,
    dispose: () => {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}

/** Hide it once picked up; pick it up when Gugut walks up to it. */
function tend(group: THREE.Group, place: { x: number; z: number }) {
  const run = runStore.get();
  group.visible = !run.jebenaFound;
  if (run.jebenaFound || run.phase !== "running" || runStore.isPaused()) return;
  if (Math.hypot(playerStore.x - place.x, playerStore.z - place.z) < PICK_UP) {
    runStore.findJebena();
    audio.swell(0.5);
  }
}

/**
 * The monks' jebena, a secret in some mazes (game/jebena): a blackened clay
 * coffee pot on a flat stone at the end of a dead end, two little cups beside
 * it, steam curling from the spout. Walk up to it to take it (the "First
 * buna" badge). Nothing at all in mazes without one.
 */
export default function Jebena() {
  const place = useMemo(() => jebenaPlace(), []);
  const jebena = useDisposable(() => buildJebena(), []);
  useFrame((_, dt) => {
    steamTime.value += Math.min(dt, 0.1);
    if (place) tend(jebena.group, place);
  });
  if (!place) return null;
  return <primitive object={jebena.group} position={[place.x, 0, place.z]} rotation={[0, place.facing, 0]} />;
}
