"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import {
  attribute,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  dot,
  float,
  length,
  mod,
  positionLocal,
  sin,
  smoothstep,
  uniform,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import { useDisposable } from "../../hooks/useDisposable";
import { tier } from "../../quality";
import { sun } from "../sunUniforms";

interface FieldOptions {
  count: number;
  /** Half-width of the box of particles kept around the camera (m). */
  radius: number;
  /** Heights the particles float between (m above the ground). */
  minY: number;
  maxY: number;
  /** Billboard size (m). */
  size: number;
  /** Wander: drift speed (m/s) and sway amplitude (m). */
  speed: number;
  sway: number;
  seed: number;
}

function rand(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A field of camera-facing particles that always surrounds the camera: each
 * particle's home is a random point in a box, wrapped around the camera
 * position, so the field follows the player with nothing ever spawned or
 * freed. All motion is in the vertex shader (one draw, no CPU work).
 * Returns the mesh's geometry plus the per-particle world position and the
 * random numbers, for the material to colour.
 */
function particleField(o: FieldOptions, time: THREE.UniformNode<"float", number>) {
  const quad = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute("position", quad.getAttribute("position"));
  geometry.setAttribute("uv", quad.getAttribute("uv"));
  const rng = rand(o.seed);
  const seeds = new Float32Array(o.count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rng();
  geometry.setAttribute("seed", new THREE.InstancedBufferAttribute(seeds, 4));
  geometry.instanceCount = o.count;

  const s = attribute<"vec4">("seed", "vec4");
  const span = o.radius * 2;
  const height = o.maxY - o.minY;
  // Drift (each particle its own direction) plus a slow sway.
  const t = time.add(s.w.mul(100));
  const drift = vec3(s.x.sub(0.5), s.w.sub(0.5).mul(0.4), s.y.sub(0.5)).mul(o.speed).mul(time);
  const swayed = vec3(sin(t.mul(0.7).add(s.x.mul(6.28))), sin(t.mul(0.5).add(s.y.mul(6.28))), sin(t.mul(0.6).add(s.z.mul(6.28)))).mul(o.sway);
  const home = vec3(s.x.mul(span), s.z.mul(height), s.y.mul(span)).add(drift).add(swayed);
  // Wrap around the camera on the ground plane; float in the height band.
  const world = vec3(
    mod(home.x.sub(cameraPosition.x).add(o.radius), span).sub(o.radius).add(cameraPosition.x),
    mod(home.y, height).add(o.minY),
    mod(home.z.sub(cameraPosition.z).add(o.radius), span).sub(o.radius).add(cameraPosition.z)
  );
  // Camera-facing quad around that point.
  const viewCenter = cameraViewMatrix.mul(vec4(world, 1));
  const vertex = cameraProjectionMatrix.mul(viewCenter.add(vec4(positionLocal.xy.mul(o.size), 0, 0)));

  // Fade in near the camera (no motes in your eye), out at the box edge.
  const toCamera = world.sub(cameraPosition);
  const distance = length(toCamera);
  const fade = smoothstep(0.4, 1.2, distance).mul(smoothstep(o.radius, o.radius * 0.6, distance));
  // A soft round dot.
  const r = length(uv().sub(0.5)).mul(2);
  const dot2 = smoothstep(1, 0, r).pow(2);

  return { geometry, vertex, world, toCamera, seed: s, fade, dot: dot2, dispose: () => (geometry.dispose(), quad.dispose()) };
}

function additive(material: THREE.MeshBasicNodeMaterial) {
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.fog = false; // they fade out by distance themselves
  return material;
}

/**
 * Atmosphere: dust and pollen drifting in the air, glinting when they're
 * between you and the low sun (it's what makes shafts of light read), and a
 * few fireflies blinking low over the grass as dusk comes on. Two draws.
 */
export default function Particles() {
  // The shared particle clock (advanced each frame, clamped across stalls).
  const clock = useMemo(() => {
    const time = uniform(0);
    return { time, advance: (delta: number) => void (time.value += Math.min(delta, 0.1)) };
  }, []);
  const time = clock.time;

  const dust = useDisposable(() => {
    const f = particleField({ count: tier(260, 120), radius: 6, minY: 0.15, maxY: 3.2, size: 0.022, speed: 0.06, sway: 0.25, seed: 11 }, time);
    // Faint everywhere; bright in the forward-scattering lobe towards the sun.
    const view = f.toCamera.negate().normalize();
    const glint = dot(view.negate(), sun.direction).clamp(0, 1).pow(10);
    const material = additive(new THREE.MeshBasicNodeMaterial());
    material.vertexNode = f.vertex;
    material.colorNode = sun.color.mul(float(0.05).add(glint.mul(1.4)));
    material.opacityNode = f.dot.mul(f.fade).mul(f.seed.z.mul(0.5).add(0.5));
    const mesh = new THREE.Mesh(f.geometry, material);
    mesh.frustumCulled = false;
    mesh.name = "Dust";
    return { mesh, dispose: () => (f.dispose(), material.dispose()) };
  }, [time]);

  const fireflies = useDisposable(() => {
    const f = particleField({ count: 40, radius: 9, minY: 0.25, maxY: 1.5, size: 0.07, speed: 0.12, sway: 0.5, seed: 23 }, time);
    // Each blinks on its own rhythm: long dark, a soft glow up and down.
    const blink = smoothstep(0.55, 1, sin(time.mul(f.seed.x.mul(0.8).add(0.6)).add(f.seed.y.mul(40))));
    const material = additive(new THREE.MeshBasicNodeMaterial());
    material.vertexNode = f.vertex;
    // Bright enough to catch the bloom: a warm yellow-green spark.
    material.colorNode = vec3(0.85, 1.0, 0.35).mul(blink.mul(3.2));
    material.opacityNode = f.dot.mul(f.fade);
    const mesh = new THREE.Mesh(f.geometry, material);
    mesh.frustumCulled = false;
    mesh.name = "Fireflies";
    return { mesh, dispose: () => (f.dispose(), material.dispose()) };
  }, [time]);

  useFrame((_, delta) => clock.advance(delta));

  return (
    <>
      <primitive object={dust.mesh} />
      <primitive object={fireflies.mesh} />
    </>
  );
}
