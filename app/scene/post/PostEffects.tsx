"use client";

import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import { float, int, length, pass, screenUV, smoothstep, uniform, vec4 } from "three/tsl";
import { bilateralBlur } from "three/examples/jsm/tsl/display/BilateralBlurNode.js";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";
import { depthAwareBlend } from "three/examples/jsm/tsl/display/depthAwareBlend.js";
import { godrays } from "three/examples/jsm/tsl/display/GodraysNode.js";
import type GodraysNode from "three/examples/jsm/tsl/display/GodraysNode.js";
import { useDisposable } from "../../hooks/useDisposable";

/** Structural options — changing these rebuilds the effect graph. */
export interface PostToggles {
  bloom: boolean;
  godrays: boolean;
  vignette: boolean;
  /** Godrays render-target scale (0.25 / 0.5 / 1). */
  raysResolution: number;
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
  vignetteStrength: number;
}

function createUniforms() {
  return {
    bloomStrength: uniform(0.3),
    bloomRadius: uniform(0.4),
    bloomThreshold: uniform(0.9),
    raysColor: uniform(new THREE.Color("#ffe2a8")),
    vignette: uniform(0.35),
  };
}
type PostUniforms = ReturnType<typeof createUniforms>;

/**
 * The effect graph:
 *   scene pass (colour + depth)
 *   → godrays: raymarched through the sun's *baked* shadow map at reduced
 *     resolution, bilateral-blurred, composited with a depth-aware blend
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
  const scenePass = pass(scene, camera);
  const color = scenePass.getTextureNode("output");
  const depth = scenePass.getTextureNode("depth");
  const disposables: { dispose(): void }[] = [scenePass];

  let output: THREE.Node<"vec4"> = vec4(color);
  let rays: GodraysNode | null = null;

  if (t.godrays) {
    rays = godrays(depth, camera, light);
    rays.resolutionScale = t.raysResolution;
    const blurred = bilateralBlur(rays.getTextureNode());
    output = vec4(
      depthAwareBlend(color, blurred.getTextureNode(), depth, camera, {
        blendColor: u.raysColor,
        edgeRadius: int(2),
        edgeStrength: float(2),
      })
    );
    disposables.push(rays, blurred);
  }

  if (t.bloom) {
    const glow = bloom(color, u.bloomStrength, u.bloomRadius, u.bloomThreshold);
    output = output.add(glow);
    disposables.push(glow);
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

function applyParams(graph: PostGraph, u: PostUniforms, p: PostParams) {
  u.bloomStrength.value = p.bloomStrength;
  u.bloomRadius.value = p.bloomRadius;
  u.bloomThreshold.value = p.bloomThreshold;
  u.raysColor.value.set(p.raysColor);
  u.vignette.value = p.vignetteStrength;
  if (graph.rays) {
    graph.rays.density.value = p.raysDensity;
    graph.rays.maxDensity.value = p.raysMaxDensity;
    graph.rays.distanceAttenuation.value = p.raysFalloff;
    graph.rays.raymarchSteps.value = Math.round(p.raysSteps);
  }
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
  const { bloom: bloomOn, godrays: raysOn, vignette: vignetteOn, raysResolution } = toggles;
  const graph = useDisposable(
    () =>
      buildGraph(scene, camera, light, { bloom: bloomOn, godrays: raysOn, vignette: vignetteOn, raysResolution }, uniforms),
    [scene, camera, light, bloomOn, raysOn, vignetteOn, raysResolution, uniforms]
  );
  useEffect(() => {
    setPipelineOutput(pipeline, graph.output);
  }, [pipeline, graph]);

  useEffect(() => {
    applyParams(graph, uniforms, params);
  }, [graph, uniforms, params]);

  useFrame(() => pipeline.render(), 1);
  return null;
}
