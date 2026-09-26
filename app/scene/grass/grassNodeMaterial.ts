import * as THREE from "three/webgpu";
import {
  cameraPosition,
  dot,
  exp,
  faceDirection,
  float,
  max,
  mix,
  mx_noise_float,
  normalize,
  normalViewGeometry,
  positionLocal,
  positionWorld,
  pow,
  sin,
  smoothstep,
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
  /** Back-lit glow when looking towards the sun (0 = off). */
  translucency: number;
  /** How much of the lawn shows dry, straw-coloured patches (0 = none). */
  dryness: number;
  baseColor: string;
  tipColor1: string;
  tipColor2: string;
}

/** Reference blade height (world units) at which sway equals windStrength. */
const SWAY_REF_HEIGHT = 0.6;

/**
 * Realistic FluffyGrass-style grass as a WebGPU node material (TSL).
 *
 * Built on the look of FluffyGrass by Ebenezer (MIT, see FLUFFYGRASS_LICENSE —
 * https://github.com/thebenezer/FluffyGrass): alpha-masked tufts, a dark base
 * fading to a noise-varied tip colour, a travelling sine wind and noise-driven
 * height. On top of that, for realism:
 * - Physically based (MeshStandardNodeMaterial): lit by the sky environment map
 *   and the sun, with a soft specular sheen.
 * - Translucency: tips glow with transmitted sunlight when viewed against it.
 * - Shading normals blend "up" with each blade's own normal, so tufts get
 *   varied light/dark facets instead of one flat colour.
 * - Roots are occluded (`aoNode`), and patches of the lawn dry out to straw.
 * For performance: procedural noise (no vertex texture reads), colour noise per
 * vertex rather than per pixel, opaque alpha-clip, and height lift/sway that
 * scale with each blade's own height (short footpath grass stays short/still).
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
    translucency: uniform(0.45),
    dryness: uniform(0.35),
    normalBlend: uniform(0.35),
    sunDirection: uniform(new THREE.Vector3(0, 1, 0)),
    sunColor: uniform(new THREE.Color(1, 1, 1)),
    baseColor: uniform(new THREE.Color("#26330f")),
    tipColor1: uniform(new THREE.Color("#93ab4a")),
    tipColor2: uniform(new THREE.Color("#4e7527")),
    dryColor: uniform(new THREE.Color("#b3a468")),
  };

  // 0 at the blade base, 1 at the tip (the GLB has uv.y = 1 at the base).
  const tip = float(1).sub(uv().y);

  // Instancing runs before positionNode, and the grass meshes sit at the origin,
  // so positionLocal is already world-space here. FluffyGrass's "terrain UV":
  const terrainUV = vec2(100).sub(positionLocal.xz).div(100);

  // Slowly evolving gust field, a static patch field (height + tip hue), and a
  // separate low-frequency field for dry patches.
  const gust = mx_noise_float(vec3(terrainUV.mul(8), uniforms.time.mul(0.05)))
    .mul(0.5)
    .add(0.5);
  const patch = mx_noise_float(vec3(terrainUV.mul(uniforms.noiseScale).mul(6), 0))
    .mul(0.5)
    .add(0.5);
  const dry = smoothstep(
    0.55,
    0.85,
    mx_noise_float(vec3(terrainUV.mul(4), 17)).mul(0.5).add(0.5)
  ).mul(uniforms.dryness);

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

  const material = new THREE.MeshStandardNodeMaterial({
    side: THREE.DoubleSide,
  });
  material.roughness = 0.7;
  material.metalness = 0;
  material.positionNode = vec3(
    positionLocal.x.add(sway),
    lifted,
    positionLocal.z.add(sway)
  );

  // Colour: base -> tip gradient; the tip hue follows the patch noise and fades
  // to straw in dry patches. Noise is evaluated per vertex and interpolated.
  const tipColor = mix(
    mix(uniforms.tipColor2, uniforms.tipColor1, vertexStage(patch)),
    uniforms.dryColor,
    vertexStage(dry)
  );
  material.colorNode = mix(uniforms.baseColor, tipColor, tip).mul(
    uniforms.brightness
  );

  // Blade silhouettes from the alpha mask (same UV flip as FluffyGrass),
  // as an opaque alpha-clip: no blending, depth-write + early-Z stay on.
  material.opacityNode = texture(alphaMap, vec2(uv().x, tip)).r;
  material.alphaTest = 0.1;

  // Shading normal: mostly straight up (a lawn catches light like a surface),
  // blended with the blade's own normal — flipped on back faces — for facets.
  material.normalNode = normalize(
    mix(
      transformNormalToView(vec3(0, 1, 0)),
      normalViewGeometry.mul(faceDirection),
      uniforms.normalBlend
    )
  );

  // Roots sit in each other's shade: occlude ambient (sky) light at the base.
  material.aoNode = mix(0.35, 1, tip);

  // Translucency: sunlight transmitted through thin blades, strongest at the
  // tips and when the camera looks towards the sun.
  const viewDir = normalize(positionWorld.sub(cameraPosition));
  const backlit = pow(max(dot(viewDir, uniforms.sunDirection), 0), 6);
  material.emissiveNode = tipColor
    .mul(uniforms.sunColor)
    .mul(backlit)
    .mul(tip.mul(tip))
    .mul(uniforms.translucency);

  return {
    material,
    setLook(look: GrassLook) {
      uniforms.height.value = look.height;
      uniforms.windStrength.value = look.windStrength;
      uniforms.brightness.value = look.brightness;
      uniforms.translucency.value = look.translucency;
      uniforms.dryness.value = look.dryness;
      uniforms.baseColor.value.set(look.baseColor);
      uniforms.tipColor1.value.set(look.tipColor1);
      uniforms.tipColor2.value.set(look.tipColor2);
    },
    /** Match the translucency to the sun light's direction and colour. */
    setSun(direction: THREE.Vector3, color: THREE.Color) {
      uniforms.sunDirection.value.copy(direction).normalize();
      uniforms.sunColor.value.copy(color);
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
