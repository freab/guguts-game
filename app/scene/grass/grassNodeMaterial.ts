import * as THREE from "three/webgpu";
import {
  Fn,
  If,
  abs,
  attribute,
  cameraPosition,
  dot,
  exp,
  float,
  length,
  mix,
  mx_noise_float,
  positionLocal,
  sin,
  smoothstep,
  texture,
  transformNormalToView,
  uniform,
  uv,
  vec2,
  select,
  vec3,
  varyingProperty,
} from "three/tsl";
import { lightmapFactor } from "../bake/lightmap";
import { grassColors, setGrassColors } from "./grassColors";
import { sunTranslucency } from "../translucency";

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
 *   stage never samples a texture; colour noise is per vertex (a varying),
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
    // Draw-distance fade around the player (world XZ centre, start/end radius).
    fadeCenter: uniform(new THREE.Vector2()),
    fadeStart: uniform(14),
    fadeEnd: uniform(18),
    // 0..1: how much the baked lightmap (wall shadows + AO) darkens the grass.
    lightmapMix: uniform(1),
    // LOD: full detail within lodNear of the camera, medium to lodFar, then
    // low; lodForced >= 0 pins one LOD.
    lodNear: uniform(5),
    lodFar: uniform(10),
    lodForced: uniform(-1),
    // Strength of the sunlight shining through the blades (see translucency.ts).
    backlight: uniform(0.9),
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

  // Distance fade: 1 near the player, 0 at the draw distance. Faded blades
  // shrink and sink below the floor, so culled chunks never visibly pop.
  const fade = float(1).sub(
    smoothstep(
      uniforms.fadeStart,
      uniforms.fadeEnd,
      length(positionLocal.xz.sub(uniforms.fadeCenter))
    )
  );

  // Height: stretch this vertex's own height (already scaled per instance),
  // scaled by the fade and pushed under the floor as it fades out.
  const lifted = positionLocal.y
    .mul(exp(patch).mul(uniforms.height).add(1))
    .mul(fade)
    .sub(float(1).sub(fade));

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
  // One draw for all the grass (GrassField): the mesh holds all three LOD
  // tufts, each vertex tagged with its LOD. Each tuft keeps the LOD for its
  // distance; the other LODs' vertices collapse onto the tuft's base, so their
  // triangles have no area and are never rasterised.
  //
  // Those collapsed vertices are most of the mesh (a tuft carries 228 vertices
  // and keeps 132, 64 or 32 of them), so they skip everything else: the noise,
  // height and wind are worked out only inside the branch for the kept LOD —
  // the same result for every drawn vertex, a fraction of the vertex work.
  // (The patch noise reaches the fragment stage through vPatch, set in the
  // branch too; collapsed vertices draw nothing, so it never matters there.)
  const origin = attribute<"vec3">("tuftOrigin", "vec3");
  const distance = length(origin.sub(cameraPosition));
  const autoLod = select(distance.lessThan(uniforms.lodNear), float(0), select(distance.lessThan(uniforms.lodFar), float(1), float(2)));
  const wantLod = select(uniforms.lodForced.greaterThanEqual(0), uniforms.lodForced, autoLod);
  const inLod = abs(attribute<"float">("grassLod", "float").sub(wantLod)).lessThan(0.5);
  const vPatch = varyingProperty("float", "vGrassPatch");
  material.positionNode = Fn(() => {
    const position = origin.toVar();
    If(inLod, () => {
      vPatch.assign(patch);
      position.assign(vec3(positionLocal.x.add(sway), lifted, positionLocal.z.add(sway)));
    });
    return position;
  })();

  // Colour: base -> tip gradient, tip hue picked by the patch noise.
  const tipColor = mix(grassColors.tip1, grassColors.tip2, vPatch);
  // Baked wall shadows + AO: one lightmap fetch per fragment instead of
  // filtering the shadow map (the grass doesn't receive realtime shadows).
  material.colorNode = mix(grassColors.base, tipColor, tip)
    .mul(grassColors.brightness)
    .mul(mix(float(1), lightmapFactor, uniforms.lightmapMix));

  // Backlight: looking towards the low sun, light shines through the thin
  // blade tips (golden, tinted by the blade) — not where the walls shade it.
  const sunlit = mix(float(1), lightmapFactor, uniforms.lightmapMix);
  // (Every NodeMaterial adds emissiveNode; Lambert's typings just omit it.)
  (material as typeof material & { emissiveNode: THREE.Node | null }).emissiveNode = sunTranslucency(uniforms.backlight)
    .mul(tipColor.mul(2.2).add(0.15))
    .mul(tip.pow(1.6))
    .mul(sunlit);

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
      // Shared with the ivy (grass/grassColors.ts), so it always matches.
      setGrassColors(look);
    },
    /** Centre and radii of the draw-distance fade (call every frame). */
    /** Whether the baked wall shadows / AO darken the grass. */
    setBakedShadows(on: boolean) {
      uniforms.lightmapMix.value = on ? 1 : 0;
    },
    setFade(x: number, z: number, start: number, end: number) {
      uniforms.fadeCenter.value.set(x, z);
      uniforms.fadeStart.value = start;
      uniforms.fadeEnd.value = end;
    },
    /** LOD distances (camera to tuft), and a forced LOD (0-2) or -1 for auto. */
    setLod(near: number, far: number, forced: number) {
      uniforms.lodNear.value = near;
      uniforms.lodFar.value = far;
      uniforms.lodForced.value = forced;
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
