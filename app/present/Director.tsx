"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import { abs, float, floor, fract, max, mix, positionWorld, smoothstep, uniform, uv, vec3 } from "three/tsl";
import { EYE_HEIGHT } from "../character/config";
import { spawnYaw } from "../character/PlayerController";
import { playerStore } from "../character/playerStore";
import { WallCollider } from "../character/WallCollider";
import { goat } from "../game/goat";
import { CELL, COLS, ROWS, WALL_HEIGHT, cellAt, clearingRadius, restingSpot, startPosition, treeScale } from "../maze/mazeData";
import { useLoading } from "../scene/bake/loadingStore";
import { lightmapBounds, lightmapView } from "../scene/bake/lightmap";
import { sceneLayers } from "../scene/sceneLayers";
import { presentLive, presentStore } from "./presentStore";
import type { Shot, Slide } from "./slides";

/** How long the sky takes to fade up from black as it comes on (s). */
const SKY_FADE = 1.6;

/**
 * The glide from one shot to the next: a curve through a raised middle (a
 * crane move), its length setting its time — short hops quick, long flights
 * slower — the aim sweeping from the old subject to the new one and the lens
 * opening a little mid-flight.
 */
const glideSeconds = (distance: number) => Math.min(3.2, Math.max(1.2, 1.1 + distance * 0.045));
const FOV_BREATH = 7;
/** How far through the move (0..1) the new slide's parts start coming in: the camera has nearly landed. */
const LANDED = 0.7;
/** Never closer to a wall than this (m) while below the wall tops: it rises over them instead. */
const WALL_CLEARANCE = 0.3;
/** How far over the wall tops the camera goes when it has to (m). */
const OVER_WALLS = WALL_HEIGHT + 0.7;

interface Pose {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
/** Ease in and out (quintic): a glide that starts and lands softly. */
const ease = (t: number) => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2);
const follow = (from: number, to: number, rate: number, dt: number) => from + (to - from) * (1 - Math.exp(-rate * dt));

/** Which way the maze runs from the exit tile (the goat's): the open neighbour, as a world direction. */
function exitCorridor(): [number, number] {
  const r = ROWS - 2;
  const c = COLS - 2;
  for (const [dr, dc] of [[-1, 0], [0, -1], [1, 0], [0, 1]]) {
    const rr = r + dr;
    const cc = c + dc;
    // (Not the gap in the border: that's outside.)
    if (rr > 0 && rr < ROWS - 1 && cc > 0 && cc < COLS - 1 && cellAt(rr, cc) !== "wall") return [dc, dr];
  }
  return [-1, 0];
}

/**
 * Where the camera is for a shot, `t` s into it. Positions come from the
 * maze itself (its size, the start, the goat, the tree, Temesgen's seat), so
 * every shot fits whatever maze was generated.
 */
function shotPose(shot: Shot, t: number, out: Pose) {
  const half = (COLS * CELL) / 2;
  out.fov = 55;
  switch (shot) {
    case "orbit": {
      const a = 0.6 + t * 0.04;
      out.pos.set(Math.sin(a) * half * 1.35, half * 0.75, Math.cos(a) * half * 1.35);
      out.target.set(0, 1.5, 0);
      out.fov = 50;
      return;
    }
    case "top": {
      const a = t * 0.05;
      out.pos.set(Math.sin(a) * half * 0.35, half * 2.1, Math.cos(a) * half * 0.35);
      out.target.set(0, 0, 0);
      out.fov = 50;
      return;
    }
    case "walls": {
      const a = 0.9 + t * 0.03;
      out.pos.set(Math.sin(a) * half * 0.95, 6.5, Math.cos(a) * half * 0.95);
      out.target.set(0, 0.5, 0);
      return;
    }
    case "lightmap": {
      out.pos.set(-half * 0.55 + Math.sin(t * 0.05) * 2, 11, half * 0.55);
      out.target.set(0, 0, 0);
      out.fov = 50;
      return;
    }
    case "grass": {
      // Low, circling inside the clearing (never out past its edge, into the walls).
      const r = clearingRadius() * 0.72;
      const a = 2 + t * 0.06;
      out.pos.set(Math.sin(a) * r, 2.1, Math.cos(a) * r);
      out.target.set(-Math.sin(a) * r * 0.4, 0.5, -Math.cos(a) * r * 0.4);
      out.fov = 62;
      return;
    }
    case "goat": {
      const [gx, gz] = goat.position();
      const [dx, dz] = exitCorridor();
      // A slow drift side to side, across the corridor.
      const sway = Math.sin(t * 0.3) * 0.25;
      out.pos.set(gx + dx * 1.6 - dz * sway, 1.05, gz + dz * 1.6 + dx * sway);
      out.target.set(gx, 0.55, gz);
      out.fov = 45;
      return;
    }
    case "corridor":
    case "listen": {
      const [sx, , sz] = startPosition();
      // Down the first corridor, edging forward; or turning on the spot, listening.
      const yaw = spawnYaw() + (shot === "listen" ? t * 0.25 : 0);
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const walk = shot === "corridor" ? Math.min(t * 0.25, 1.2) : 0;
      out.pos.set(sx + fx * walk, EYE_HEIGHT, sz + fz * walk);
      out.target.set(out.pos.x + fx * 5, 1.2, out.pos.z + fz * 5);
      out.fov = 70;
      return;
    }
    case "temesgen":
    case "temesgenWide": {
      const spot = restingSpot();
      // His front (the scan faces +Z, turned by `facing`), swinging slowly round him.
      const a = spot.facing + Math.sin(t * 0.25) * 0.35;
      const wide = shot === "temesgenWide";
      const d = wide ? 3.2 : 2.1;
      out.pos.set(spot.x + Math.sin(a) * d, wide ? 1.4 : 1.15, spot.z + Math.cos(a) * d);
      out.target.set(spot.x, 0.75, spot.z);
      out.fov = wide ? 50 : 42;
      return;
    }
    case "sky": {
      // Standing in the clearing, turning slowly, looking up at the horizon.
      const a = 0.8 + t * 0.05;
      out.pos.set(0, 2.5, 0);
      out.target.set(Math.sin(a) * 40, 9, Math.cos(a) * 40);
      out.fov = 60;
      return;
    }
    case "tree": {
      const r = clearingRadius() * 1.6;
      const a = 1.2 + t * 0.08;
      out.pos.set(Math.sin(a) * r, 3.2, Math.cos(a) * r);
      out.target.set(0, 3.2 * treeScale(), 0);
      return;
    }
    case "stone": {
      // Close on the border wall behind the start (row 0 is always wall), sliding along it.
      const [sx, , sz] = startPosition();
      const slide = Math.sin(t * 0.3) * 0.5;
      out.pos.set(sx + slide, 1.4, sz + 0.3);
      out.target.set(sx + slide * 0.6, 1.3, sz - CELL);
      out.fov = 50;
      return;
    }
    case "soundStage": {
      // In the clearing, a few steps out from Temesgen, turning slowly on the
      // spot: his kirar and her bleat stay where they are as the view turns.
      const spot = restingSpot();
      const len = Math.hypot(spot.x, spot.z) || 1;
      const ox = spot.x / len;
      const oz = spot.z / len;
      // (Still inside the clearing, however small it is.)
      const out4 = Math.max(1.5, Math.min(4, clearingRadius() - Math.hypot(spot.x, spot.z) - 0.9));
      out.pos.set(spot.x + ox * out4, EYE_HEIGHT, spot.z + oz * out4);
      const a = Math.atan2(-ox, -oz) + t * 0.12;
      out.target.set(out.pos.x + Math.sin(a) * 5, 1.1, out.pos.z + Math.cos(a) * 5);
      out.fov = 65;
      return;
    }
    case "spin": {
      // In the clearing, turning steadily on the spot: the view cone sweeps the map.
      const [sx, , sz] = startPosition();
      const len = Math.hypot(sx, sz) || 1;
      const r = clearingRadius() * 0.6;
      out.pos.set((sx / len) * r, EYE_HEIGHT + 0.4, (sz / len) * r);
      const a = t * 0.3;
      out.target.set(out.pos.x + Math.sin(a) * 5, 1.2, out.pos.z + Math.cos(a) * 5);
      out.fov = 60;
      return;
    }
    case "intro": {
      // The intro fly-in's first shot (scene/IntroFlight): low by the tree, on the start's side.
      const [sx, , sz] = startPosition();
      const len = Math.hypot(sx, sz) || 1;
      const near = clearingRadius() * 0.8;
      out.pos.set((sx / len) * near, 2, (sz / len) * near);
      out.target.set(0, 4 * treeScale(), 0);
      out.fov = 70;
      return;
    }
  }
}

/** The UV test grid's size (m) and how many squares across it. */
const UV_PLANE = 80;
const UV_SQUARES = 40;
/** How long the texture takes to sweep across, replacing the grid (s). */
const UV_SWEEP = 1.4;
/** 0 = all grid … 1 = all texture: where the sweep is. */
const uvWipe = uniform(1);

/**
 * The ground as a UV test grid: u in red, v in green, a checker of texture
 * tiles, lines between them. A glowing edge sweeps across it (uvWipe), the
 * textured ground showing behind.
 */
function uvGridMaterial() {
  const material = new THREE.MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.fog = false;
  const cell = uv().mul(UV_SQUARES);
  const checker = fract(floor(cell.x).add(floor(cell.y)).mul(0.5)).mul(2);
  const base = vec3(uv().x, uv().y, float(0.55));
  const color = mix(base.mul(0.55), base, checker);
  const f = fract(cell);
  const line = max(smoothstep(0.06, 0, abs(f.x.sub(0.5)).sub(0.47)), smoothstep(0.06, 0, abs(f.y.sub(0.5)).sub(0.47)));
  // The sweep: a line across the plane (in x); the grid only beyond it.
  const edge = float(-UV_PLANE / 2).add(uvWipe.mul(UV_PLANE + 4));
  const beyond = smoothstep(edge, edge.add(0.4), positionWorld.x);
  const glow = smoothstep(1.2, 0, abs(positionWorld.x.sub(edge)));
  material.colorNode = mix(color, vec3(1, 1, 1), line.mul(0.6)).mul(beyond).add(vec3(1, 0.75, 0.35).mul(glow.mul(1.6)));
  material.opacityNode = max(beyond, glow);
  return material;
}

/** The ground's grid: there while asked for, swept away (or back) when not. */
function placeUvGrids(grid: THREE.Mesh, dt: number) {
  const flags = sceneLayers.debug();
  const step = dt / UV_SWEEP;
  const sweep = (wipe: typeof uvWipe, on: boolean) => {
    const target = on ? 0 : 1;
    // (A slide coming or going: no sweep.)
    if (flags.uvGridInstant) wipe.value = target;
    else wipe.value = target > wipe.value ? Math.min(target, wipe.value + step) : Math.max(target, wipe.value - step);
  };
  sweep(uvWipe, flags.uvGrid.ground);
  flags.uvGridInstant = false;
  grid.visible = uvWipe.value < 1;
}

/** How fast the lightmap x-ray fades in and out (per second). */
const LIGHTMAP_FADE = 3;

/** The lightmap x-ray: fading in when asked, laid over the ground the lightmap covers. */
function placeLightmapView(view: THREE.Mesh, dt: number) {
  const material = view.material as THREE.MeshBasicNodeMaterial;
  const target = sceneLayers.debug().lightmap ? 1 : 0;
  material.opacity = target > material.opacity ? Math.min(1, material.opacity + dt * LIGHTMAP_FADE) : Math.max(0, material.opacity - dt * LIGHTMAP_FADE);
  view.visible = material.opacity > 0;
  if (!view.visible) return;
  const b = lightmapBounds.value;
  view.position.set(b.x + b.z / 2, 0.06, b.y + b.w / 2);
  view.scale.set(b.z, b.w, 1);
}

/**
 * The presentation's camera: each slide's shot (slides.ts), gliding from one
 * to the next. Mounted last in the scene (Scene's `director` slot), so it
 * overrides the player, the intro and photo mode. It also
 * stands the player's "feet" where it looks, so the grass, flowers and tree
 * (culled around the player) are drawn there.
 */
export default function Director({ slides }: { slides: Slide[] }) {
  const ready = useLoading().stage === "ready";
  // The sky's background, kept while it's hidden (black instead).
  const sky = useRef<{ saved: THREE.Scene["background"]; black: THREE.Color }>({ saved: null, black: new THREE.Color(0) });
  // The move between shots: when it started, and how long it takes.
  const glide = useRef({ key: "", at: 0, seconds: 0, landed: true });
  const from = useRef({ pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 55 });
  /** The curve's raised middle, and where the camera is looking now. */
  const bend = useRef(new THREE.Vector3());
  const aim = useRef(new THREE.Vector3());
  const walls = useMemo(() => new WallCollider(), []);
  const lift = useRef(0);
  const pose = useRef<Pose>({ pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 55 });
  const fwd = useRef(new THREE.Vector3());
  // The lightmap x-ray: a plane over the ground showing the baked texture as it's read there.
  const uvPlane = useMemo(() => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(UV_PLANE, UV_PLANE), uvGridMaterial());
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.04;
    mesh.renderOrder = 1;
    mesh.visible = false;
    return mesh;
  }, []);
  const lightmapPlane = useMemo(() => {
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = lightmapView;
    material.fog = false;
    material.transparent = true;
    material.depthWrite = false;
    material.opacity = 0;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    mesh.renderOrder = 1;
    return mesh;
  }, []);

  useFrame(({ camera, clock, scene, gl }, delta) => {
    presentLive.webgpu = !!(gl as unknown as { backend?: { isWebGPUBackend?: boolean } }).backend?.isWebGPUBackend;
    // The sky hidden: a black background (the sky's own put back after),
    // fading up from black as it comes on.
    const bg = sky.current;
    if (!sceneLayers.get().sky) {
      if (scene.background !== bg.black) {
        bg.saved = scene.background;
        scene.background = bg.black;
      }
    } else {
      if (scene.background === bg.black) scene.background = bg.saved;
      const since = sceneLayers.shownAt("sky");
      scene.backgroundIntensity = since ? clamp((performance.now() - since) / 1000 / SKY_FADE, 0, 1) ** 2 : 1;
    }

    placeLightmapView(lightmapPlane, Math.min(delta, 0.1));
    placeUvGrids(uvPlane, Math.min(delta, 0.1));

    const { slide, step } = presentStore.get();
    if (!ready) return;
    const cam = camera as THREE.PerspectiveCamera;
    const now = clock.elapsedTime;
    const dt = Math.min(delta, 0.1);
    // A new shot (a slide, or a step with its own): a move from wherever the camera is now.
    const name = slides[slide].steps?.[step]?.shot ?? slides[slide].shot;
    const key = `${slide}:${name}`;
    const g = glide.current;
    const p = pose.current;
    if (key !== g.key) {
      const first = g.key === "";
      shotPose(name, 0, p);
      const distance = cam.position.distanceTo(p.pos);
      const low = Math.min(cam.position.y, p.pos.y) < OVER_WALLS;
      g.key = key;
      g.at = now;
      // (The first shot just cuts in.)
      g.seconds = first ? 0 : glideSeconds(distance);
      g.landed = false;
      from.current.pos.copy(cam.position);
      from.current.target.copy(first ? p.target : aim.current);
      from.current.fov = cam.fov;
      // The curve's middle: halfway, raised (more for longer moves; over the walls when it's low).
      bend.current.lerpVectors(cam.position, p.pos, 0.5);
      bend.current.y = Math.max(bend.current.y + clamp(distance * 0.18, 0.4, 5), low ? OVER_WALLS + 0.5 : 0);
    }
    const t = now - g.at;
    shotPose(name, t, p);
    // A little life in every shot: a slow, handheld drift.
    p.pos.x += Math.sin(t * 0.37) * 0.05;
    p.pos.y += Math.sin(t * 0.29 + 1) * 0.035;
    p.pos.z += Math.cos(t * 0.31) * 0.05;

    const k = g.seconds ? Math.min(1, t / g.seconds) : 1;
    const u = ease(k);
    // Letterbox bars while it moves: in quickly, out as it lands.
    presentLive.bars = g.seconds && k < 1 ? Math.min(1, k / 0.15) * Math.min(1, (1 - k) / 0.3) : 0;
    if (u >= 1) cam.position.copy(p.pos);
    else {
      // A quadratic curve: from → the raised middle → the shot.
      const w0 = (1 - u) * (1 - u);
      const w1 = 2 * (1 - u) * u;
      const w2 = u * u;
      cam.position
        .copy(from.current.pos)
        .multiplyScalar(w0)
        .addScaledVector(bend.current, w1)
        .addScaledVector(p.pos, w2);
    }
    // And never into a wall: below the wall tops and too close to one, rise over it.
    const near = cam.position.y < OVER_WALLS && walls.distanceToWalls(cam.position.x, cam.position.z, 1) < WALL_CLEARANCE;
    lift.current = follow(lift.current, near ? OVER_WALLS - cam.position.y : 0, near ? 12 : 3, dt);
    cam.position.y += lift.current;
    // The aim sweeps from the old subject to the new one.
    aim.current.lerpVectors(from.current.target, p.target, u);
    cam.lookAt(aim.current);
    const fov = from.current.fov + (p.fov - from.current.fov) * u + Math.sin(Math.PI * u) * FOV_BREATH;
    if (Math.abs(cam.fov - fov) > 1e-3) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    // Nearly there: the slide's new parts come in now, in front of a settling camera.
    if (!g.landed && k >= LANDED) {
      g.landed = true;
      sceneLayers.release();
    }

    // The player's "feet" where the camera looks (or stands, when it's low),
    // so the things culled around the player are drawn in the shot.
    cam.getWorldDirection(fwd.current);
    const low = cam.position.y < 4;
    playerStore.x = low ? cam.position.x : p.target.x;
    playerStore.z = low ? cam.position.z : p.target.z;
    const flat = Math.hypot(fwd.current.x, fwd.current.z) || 1;
    playerStore.lookX = fwd.current.x / flat;
    playerStore.lookZ = fwd.current.z / flat;
    playerStore.speed = 0;
    playerStore.camX = cam.position.x;
    playerStore.camZ = cam.position.z;
    playerStore.halfFovX = Math.atan(Math.tan((cam.fov * Math.PI) / 360) * cam.aspect);

    // For the overlay: the camera, and where the goat is from it.
    const [gx, gz] = goat.position();
    presentLive.camX = cam.position.x;
    presentLive.camY = cam.position.y;
    presentLive.camZ = cam.position.z;
    const dx = gx - cam.position.x;
    const dz = gz - cam.position.z;
    presentLive.goatDistance = Math.hypot(dx, dz);
    const look = Math.atan2(fwd.current.x, -fwd.current.z);
    const toGoat = Math.atan2(dx, -dz);
    presentLive.goatBearing = Math.atan2(Math.sin(toGoat - look), Math.cos(toGoat - look));
  });

  return (
    <>
      <primitive object={lightmapPlane} />
      <primitive object={uvPlane} />
    </>
  );
}
