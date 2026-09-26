import * as THREE from "three/webgpu";
import {
  dot,
  exp,
  float,
  mix,
  mx_noise_float,
  positionLocal,
  sin,
  texture,
  transformNormalToView,
  uniform,
  uv,
  vec2,
  vec3,
  vertexStage,
} from "three/tsl";

/** Live-tunable grass look (no shader rebuild needed). */
export interface GrassLook {
  /** Extra fluff: blades stretch by up to 1 + e·height, varied by noise. */
  height: number;
  windStrength: number;
  brightness: number;
  baseColor: string;
  tipColor1: string;
  tipColor2: string;
}

/** Reference blade height (world units) at which sway equals windStrength. */
const SWAY_REF_HEIGHT = 0.6;

/**
 * FluffyGrass-style grass as a WebGPU node material (TSL).
 *
 * Recreates the look of FluffyGrass by Ebenezer (MIT, see FLUFFYGRASS_LICENSE —
 * https://github.com/thebenezer/FluffyGrass): tufts drawn with a blade alpha
 * mask, a dark base fading to a noise-varied tip colour, a travelling sine wind,
 * and noise-driven height. Differences, for performance and the footpath:
 * - The perlin texture is replaced by procedural `mx_noise_float`, so the vertex
 *   stage never samples a texture; colour noise is per vertex (`vertexStage`),
 *   not per pixel, which matters under heavy grass overdraw.
 * - Height lift and sway scale with each blade's own (instance-scaled) height
 *   instead of a fixed amount, so short trodden grass on the footpath stays
 *   short and nearly still while the verges stay tall and fluffy.
 */
export function createGrassMaterial(alphaMap: THREE.Texture) {
  alphaMap.colorSpace = THREE.NoColorSpace; // a mask, not colour data

  const uniforms = {
    time: uniform(0),
    windStrength: uniform(0.08),
    windSpeed: uniform(1),
    height: uniform(0.6),
    noiseScale: uniform(1.5),
    brightness: uniform(1),
    baseColor: uniform(new THREE.Color("#313f1b")),
    tipColor1: uniform(new THREE.Color("#9bd38d")),
    tipColor2: uniform(new THREE.Color("#1f352a")),
  };

  // 0 at the blade base, 1 at the tip (the GLB has uv.y = 1 at the base).
  const tip = float(1).sub(uv().y);

  // Instancing runs before positionNode, and the grass meshes sit at the origin,
  // so positionLocal is already world-space here. FluffyGrass's "terrain UV":
  const terrainUV = vec2(100).sub(positionLocal.xz).div(100);

  // Slowly evolving gust field, and a static patch field (height + tip hue).
  const gust = mx_noise_float(vec3(terrainUV.mul(8), uniforms.time.mul(0.05)))
    .mul(0.5)
    .add(0.5);
  const patch = mx_noise_float(vec3(terrainUV.mul(uniforms.noiseScale).mul(6), 0))
    .mul(0.5)
    .add(0.5);

  // Height: stretch this vertex's own height (already scaled per instance).
  const lifted = positionLocal.y.mul(exp(patch).mul(uniforms.height).add(1));

  // Wind: a diagonal travelling wave, phase-jittered by the gust field, with
  // displacement proportional to height (base anchored, tall blades sway most).
  const phase = dot(vec2(0.7071, 0.7071), terrainUV)
    .mul(50)
    .add(gust.mul(5.5))
    .add(uniforms.time.mul(uniforms.windSpeed));
  const sway = sin(phase)
    .mul(uniforms.windStrength)
    .mul(lifted.div(SWAY_REF_HEIGHT));

  const material = new THREE.MeshLambertNodeMaterial({
    side: THREE.DoubleSide,
  });
  material.positionNode = vec3(
    positionLocal.x.add(sway),
    lifted,
    positionLocal.z.add(sway)
  );

  // Colour: base -> tip gradient, tip hue picked by the patch noise.
  const tipColor = mix(uniforms.tipColor1, uniforms.tipColor2, vertexStage(patch));
  material.colorNode = mix(uniforms.baseColor, tipColor, tip).mul(
    uniforms.brightness
  );

  // Blade silhouettes from the alpha mask (same UV flip as FluffyGrass),
  // as an opaque alpha-clip: no blending, depth-write + early-Z stay on.
  material.opacityNode = texture(alphaMap, vec2(uv().x, tip)).r;
  material.alphaTest = 0.1;

  // Lawn lighting: every fragment (both faces) shades with a straight-up normal,
  // so tufts light evenly and darken only where the walls cast shadow.
  material.normalNode = transformNormalToView(vec3(0, 1, 0));

  return {
    material,
    setLook(look: GrassLook) {
      uniforms.height.value = look.height;
      uniforms.windStrength.value = look.windStrength;
      uniforms.brightness.value = look.brightness;
      uniforms.baseColor.value.set(look.baseColor);
      uniforms.tipColor1.value.set(look.tipColor1);
      uniforms.tipColor2.value.set(look.tipColor2);
    },
    /** Advance the wind clock (clamped, so a long idle gap doesn't jump). */
    advance(delta: number) {
      uniforms.time.value += Math.min(delta, 0.1);
    },
    dispose() {
      material.dispose();
    },
  };
}

export type GrassMaterialHandle = ReturnType<typeof createGrassMaterial>;
