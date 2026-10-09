"use client";

import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import {
  abs,
  clamp,
  dot,
  float,
  int,
  length,
  mix,
  normalize,
  pass,
  pow,
  reference,
  screenUV,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { bilateralBlur } from "three/examples/jsm/tsl/display/BilateralBlurNode.js";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";
import { depthAwareBlend } from "three/examples/jsm/tsl/display/depthAwareBlend.js";
import { godrays } from "./godrays/GodraysNode.js";
import type GodraysNode from "./godrays/GodraysNode.js";
import { DUSK, dusk } from "../dusk";
import { takeCapture } from "../../game/photo";
import { useDisposable } from "../../hooks/useDisposable";

/** Structural options — changing these rebuilds the effect graph. */
export interface PostToggles {
  bloom: boolean;
  godrays: boolean;
  vignette: boolean;
  /** Godrays render-target scale (0.25 / 0.5 / 1). */
  raysResolution: number;
  /** MSAA samples of the scene pass (0 = off). */
  msaa: number;
  /** Lens flare ghosts when looking towards the sun. */
  flare: boolean;
}

/** Live-tunable parameters (uniforms only). */
export interface PostParams {
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  raysDensity: number;
  raysMaxDensity: number;
  /** How much rays dim with distance from the light (node default 2). */
  raysFalloff: number;
  raysSteps: number;
  raysColor: string;
  /** How much of the rays remain looking directly away from the sun (0..1). */
  raysAway: number;
  vignetteStrength: number;
  flareStrength: number;
}

function createUniforms() {
  return {
    bloomStrength: uniform(0.3),
    bloomRadius: uniform(0.4),
    bloomThreshold: uniform(0.9),
    raysColor: uniform(new THREE.Color("#ffe2a8")),
    raysAway: uniform(0.12),
    /** Direction towards the sun, in view space (updated every frame). */
    sunView: uniform(new THREE.Vector3(0, 0, -1)),
    vignette: uniform(0.35),
    /** The sun's position on screen (uv, y down) and how much flare to draw (0 = sun behind you). */
    sunScreen: uniform(new THREE.Vector2(0.5, 0.5)),
    flareOn: uniform(0),
    flareStrength: uniform(0.6),
    aspect: uniform(1),
  };
}

const _sunWorld = new THREE.Vector3();

const _sunPoint = new THREE.Vector3();

/** Point `sunView` at the sun as seen from the camera this frame, and find it on screen. */
function updateSunView(u: PostUniforms, light: THREE.DirectionalLight, camera: THREE.Camera) {
  _sunWorld.subVectors(light.position, light.target.position).normalize();
  u.sunView.value.copy(_sunWorld).transformDirection(camera.matrixWorldInverse);
  // Where the sun is on screen: a point far along its direction, projected.
  _sunPoint.setFromMatrixPosition(camera.matrixWorld).addScaledVector(_sunWorld, 10).project(camera);
  u.sunScreen.value.set(_sunPoint.x * 0.5 + 0.5, 0.5 - _sunPoint.y * 0.5);
  // No flare with the sun behind the camera; fade it as the sun leaves the screen.
  const inFront = u.sunView.value.z < 0;
  const off = Math.max(Math.abs(_sunPoint.x), Math.abs(_sunPoint.y)) - 1;
  u.flareOn.value = inFront ? THREE.MathUtils.clamp(1 - off / 0.35, 0, 1) : 0;
  const cam = camera as THREE.PerspectiveCamera;
  u.aspect.value = cam.aspect ?? 1;
}
type PostUniforms = ReturnType<typeof createUniforms>;

/**
 * The effect graph:
 *   scene pass (colour + depth)
 *   → godrays: raymarched through the sun's *baked* shadow map at reduced
 *     resolution, bilateral-blurred, composited with a depth-aware blend and
 *     weighted by a forward-scattering phase (see below)
 *   → + bloom (bright sky / sun only, via threshold)
 *   → vignette.
 * Tone mapping / colour space are applied by the pipeline's output transform.
 */
function buildGraph(
  scene: THREE.Scene,
  camera: THREE.Camera,
  light: THREE.DirectionalLight,
  t: PostToggles,
  u: PostUniforms
) {
  const scenePass = pass(scene, camera, { samples: t.msaa });
  const color = scenePass.getTextureNode("output");
  const depth = scenePass.getTextureNode("depth");
  const disposables: { dispose(): void }[] = [scenePass];

  let output: THREE.Node<"vec4"> = vec4(color);
  let rays: GodraysNode | null = null;

  if (t.godrays) {
    rays = godrays(depth, camera, light);
    rays.resolutionScale = t.raysResolution;
    const blurred = bilateralBlur(rays.getTextureNode());
    const withRays = depthAwareBlend(color, blurred.getTextureNode(), depth, camera, {
      // (Warmer as the sun goes down: scene/dusk.)
      blendColor: mix(u.raysColor, uniform(DUSK.raysColor), dusk),
      edgeRadius: int(2),
      edgeStrength: float(2),
    });
    // Forward scattering: sunlit haze glows towards the sun and barely at all
    // away from it. Without this, every sky pixel (whose raymarch crosses all
    // the lit air to the far plane) saturates at "Rays max" and the blend
    // (mix towards the ray colour) paints a flat warm veil over the blue sky.
    // mix(base, mix(base, rays, t), w) = mix(base, rays, t·w), so weighting the
    // blended result is the same as weighting the rays.
    const ndc = screenUV.mul(2).sub(1);
    const viewRay = reference("projectionMatrixInverse", "mat4", camera).mul(vec4(ndc.x, ndc.y.negate(), 1, 1));
    const towardsSun = clamp(dot(normalize(viewRay.xyz), u.sunView), 0, 1);
    const phase = mix(u.raysAway, float(1), pow(towardsSun, 3));
    output = vec4(mix(color, withRays, phase));
    disposables.push(rays, blurred);
  }

  if (t.bloom) {
    const glow = bloom(color, u.bloomStrength, u.bloomRadius, u.bloomThreshold);
    output = output.add(glow);
    disposables.push(glow);
  }

  if (t.flare) {
    output = vec4(output.rgb.add(lensFlare(depth, u)), output.a);
  }

  if (t.vignette) {
    const edge = smoothstep(0.45, 1, length(screenUV.sub(0.5)).mul(Math.SQRT2));
    output = vec4(output.rgb.mul(float(1).sub(edge.mul(u.vignette))), output.a);
  }

  return {
    output,
    rays,
    dispose: () => disposables.forEach((n) => n.dispose()),
  };
}
type PostGraph = ReturnType<typeof buildGraph>;

function setPipelineOutput(pipeline: THREE.RenderPipeline, output: PostGraph["output"]) {
  pipeline.outputNode = output;
  pipeline.needsUpdate = true;
}

/**
 * Lens flare: soft, tinted ghosts along the line from the sun through the
 * screen centre, as a camera lens makes — only while the sun itself is in
 * view. Whether it is comes from the scene depth around the sun's screen
 * position (sky = nothing nearer than the far plane), so walls, the tree or
 * the goat hide the flare. A handful of depth reads at one spot and a little
 * maths per pixel: no extra pass.
 */
function lensFlare(depth: THREE.Node<"vec4"> | THREE.TextureNode, u: PostUniforms): THREE.Node<"vec3"> {
  const d = depth as THREE.TextureNode;
  const s = u.sunScreen;
  const tap = (x: number, y: number) => d.sample(s.add(vec2(x, y))).r.greaterThanEqual(0.9999).select(float(1), float(0));
  const visible = tap(0, 0)
    .add(tap(0.006, 0))
    .add(tap(-0.006, 0))
    .add(tap(0, 0.008))
    .add(tap(0, -0.008))
    .div(5);
  const strength = visible.mul(u.flareOn).mul(u.flareStrength);

  // Ghosts: [distance along the axis (0 = sun, 1 = centre, 2 = mirrored), radius, colour].
  const ghosts: [number, number, [number, number, number]][] = [
    [0.55, 0.035, [1.0, 0.75, 0.35]],
    [1.25, 0.07, [0.45, 0.8, 0.55]],
    [1.55, 0.025, [1.0, 0.55, 0.3]],
    [1.85, 0.12, [0.35, 0.5, 0.9]],
    [2.3, 0.05, [0.9, 0.6, 0.85]],
  ];
  const toAspect = vec2(u.aspect, 1);
  let sum: THREE.Node<"vec3"> = vec3(0);
  for (const [along, radius, [r, g, b]] of ghosts) {
    const centre = mix(s, vec2(0.5, 0.5), along);
    const dist = length(screenUV.sub(centre).mul(toAspect));
    // A soft disc with a slightly brighter rim, like a lens ghost.
    const disc = smoothstep(radius, radius * 0.55, dist).mul(0.6).add(smoothstep(radius * 0.18, 0, abs(dist.sub(radius * 0.85))).mul(0.25));
    sum = sum.add(vec3(r, g, b).mul(disc));
  }
  return sum.mul(strength).mul(0.18) as THREE.Node<"vec3">;
}

function applyParams(graph: PostGraph, u: PostUniforms, p: PostParams) {
  u.bloomStrength.value = p.bloomStrength;
  u.bloomRadius.value = p.bloomRadius;
  u.bloomThreshold.value = p.bloomThreshold;
  u.raysColor.value.set(p.raysColor);
  u.raysAway.value = p.raysAway;
  u.vignette.value = p.vignetteStrength;
  u.flareStrength.value = p.flareStrength;
  if (graph.rays) {
    graph.rays.density.value = p.raysDensity;
    graph.rays.maxDensity.value = p.raysMaxDensity;
    graph.rays.distanceAttenuation.value = p.raysFalloff;
    graph.rays.raymarchSteps.value = Math.round(p.raysSteps);
  }
}

/** Thicker rays as the sun goes down (scene/dusk): each frame, over the tuned density. */
function applyDusk(graph: PostGraph, p: PostParams) {
  if (graph.rays) graph.rays.density.value = p.raysDensity * THREE.MathUtils.lerp(1, DUSK.raysDensity, dusk.value);
}

/**
 * Post-processing on WebGPU (three's RenderPipeline). Mount only once the sun's
 * shadow map exists (the godrays read it) — the preloader handles that. While
 * mounted it owns rendering: `useFrame(..., 1)` replaces R3F's default render.
 */
export default function PostEffects({
  light,
  toggles,
  params,
}: {
  light: THREE.DirectionalLight;
  toggles: PostToggles;
  params: PostParams;
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  const pipeline = useDisposable(
    () => new THREE.RenderPipeline(gl as unknown as THREE.WebGPURenderer),
    [gl]
  );

  const uniforms = useMemo(() => createUniforms(), []);
  const { bloom: bloomOn, godrays: raysOn, vignette: vignetteOn, raysResolution, msaa, flare } = toggles;
  const graph = useDisposable(
    () =>
      buildGraph(scene, camera, light, { bloom: bloomOn, godrays: raysOn, vignette: vignetteOn, raysResolution, msaa, flare }, uniforms),
    [scene, camera, light, bloomOn, raysOn, vignetteOn, raysResolution, msaa, flare, uniforms]
  );
  useEffect(() => {
    setPipelineOutput(pipeline, graph.output);
  }, [pipeline, graph]);

  useEffect(() => {
    applyParams(graph, uniforms, params);
  }, [graph, uniforms, params]);

  useFrame(() => {
    updateSunView(uniforms, light, camera);
    applyDusk(graph, params);
    pipeline.render();
    // Photo mode: save this frame if asked (it must be read in the same task as it's drawn).
    takeCapture(gl.domElement as HTMLCanvasElement);
  }, 1);
  return null;
}
