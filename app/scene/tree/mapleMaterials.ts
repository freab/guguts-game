import * as THREE from "three/webgpu";
import {
  attribute,
  cameraPosition,
  clamp,
  color,
  cos,
  float,
  floor,
  fract,
  hash,
  instanceIndex,
  inverseSqrt,
  length,
  mix,
  mod,
  mx_noise_float,
  normalMap,
  normalize,
  positionLocal,
  positionWorld,
  rotate,
  sin,
  smoothstep,
  texture,
  transformNormalToView,
  uniform,
  uv,
  vec2,
  vec3,
  vertexColor,
} from "three/tsl";
import { lightmapFactor } from "../bake/lightmap";
import { pbrSurface, type PbrSet } from "../textures/pbrTextures";
import { LEAF_ATLAS } from "./treeGeometry";
import type { MapleTreeLayout } from "./mapleTree";

/** Live-tunable tree look. */
export interface MapleLook {
  leafBrightness: number;
  wind: number;
  lanternGlow: number;
}

/**
 * Canopy distance LOD: at distance d only `clamp(near / d, min, 1)` of each
 * sector's leaves are drawn (TreeCuller sets the instance count); the shader
 * scales the survivors up by 1/sqrt of that so the crown stays just as full.
 */
export interface LeafLod {
  near: number;
  min: number;
  /** Off until loading is done, so the baked shadow map sees the full crown. */
  enabled: boolean;
}

/** Fraction of leaves drawn at distance `d` (CPU twin of the shader's). */
export function leafLodFraction(lod: LeafLod, d: number): number {
  return lod.enabled ? Math.min(1, Math.max(lod.min, lod.near / Math.max(d, 1e-3))) : 1;
}

/**
 * The maple's node materials (TSL), sharing one wind clock. Bark and leaves
 * are PBR (MeshStandard) with KTX2 textures:
 * - bark: Poly Haven bark_brown_02 (colour / normal / AO-roughness), mossy at
 *   the foot;
 * - leaves: cut-out cards from the maple leaf atlas (ambientCG LeafSet027),
 *   per-instance tint, the leaf's own normal map blended with one soft crown
 *   shape (normals out from the canopy centre), swaying and fluttering;
 * - fallen leaves: autumn cards flat on the ground, darkened by the lightmap;
 * - falling leaves: spawn in the crown and spin down, all in the shader;
 * - lantern: a warm emissive pane that blooms.
 */
export function createMapleMaterials(
  tree: MapleTreeLayout,
  textures: { bark: PbrSet; leaves: { map: THREE.Texture; normalMap: THREE.Texture } }
) {
  const uniforms = {
    time: uniform(0),
    wind: uniform(1),
    leafBrightness: uniform(1),
    lanternGlow: uniform(2.2),
    canopyCenter: uniform(tree.canopyCenter.clone()),
    lodNear: uniform(16),
    lodMin: uniform(0.2),
    lodEnabled: uniform(0),
  };
  const crownBottom = tree.trunkTop;
  const crownTop = tree.canopyTop;

  // Bark: textured wood (UVs in metres along each branch), moss at the foot.
  const bark = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
  const barkSurface = pbrSurface(textures.bark, uv());
  const moss = smoothstep(0.9, 0.1, positionWorld.y).mul(
    smoothstep(0.45, 0.7, mx_noise_float(positionWorld.mul(2.5)).mul(0.5).add(0.5))
  );
  bark.colorNode = mix(barkSurface.color, color("#4d5a2c"), moss.mul(0.6));
  bark.normalNode = barkSurface.normal;
  bark.roughnessNode = barkSurface.roughness;
  bark.aoNode = barkSurface.ao;

  // Leaf atlas lookup: this card's cell (per-instance "leafCell") and UV in it.
  const cell = attribute<"float">("leafCell", "float");
  const atlasUv = uv()
    .add(vec2(mod(cell, LEAF_ATLAS.cols), floor(cell.div(LEAF_ATLAS.cols))))
    .div(vec2(LEAF_ATLAS.cols, LEAF_ATLAS.rows));
  const leafTexel = texture(textures.leaves.map, atlasUv);
  // NormalMapNode is a vec3 node; its typings just don't say so.
  const leafNormal = normalMap(texture(textures.leaves.normalMap, atlasUv)) as unknown as THREE.Node<"vec3">;

  // Leaves (instanced; positionLocal is world-space after instancing).
  const leaves = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, metalness: 0, roughness: 0.6 });
  const height = smoothstep(crownBottom, crownTop, positionLocal.y);
  const gust = sin(
    uniforms.time.mul(0.8).add(positionLocal.x.mul(0.3)).add(positionLocal.z.mul(0.22))
  );
  const flutter = sin(uniforms.time.mul(5.5).add(hash(instanceIndex).mul(6.283))).mul(0.018);
  // Distance LOD: fewer, bigger leaves further away (grown about each leaf's
  // own centre). Per leaf here, per sector on the CPU — close enough.
  const origin = attribute<"vec3">("leafOrigin", "vec3");
  const keep = clamp(uniforms.lodNear.div(length(origin.sub(cameraPosition))), uniforms.lodMin, 1);
  const grow = mix(float(1), inverseSqrt(keep), uniforms.lodEnabled);
  const leafPos = origin.add(positionLocal.sub(origin).mul(grow));
  leaves.positionNode = leafPos.add(
    vec3(gust.mul(0.1).mul(height).add(flutter), flutter.mul(0.5), gust.mul(0.05).mul(height).add(flutter)).mul(
      uniforms.wind
    )
  );
  leaves.colorNode = leafTexel.rgb.mul(uniforms.leafBrightness);
  leaves.opacityNode = leafTexel.a;
  leaves.alphaTest = 0.5;
  // One soft, rounded crown (normals from the canopy centre, tipped upward),
  // with each leaf's own veins and ridges from its normal map mixed in.
  const crownNormal = transformNormalToView(
    normalize(normalize(positionWorld.sub(uniforms.canopyCenter)).add(vec3(0, 0.7, 0)))
  );
  leaves.normalNode = normalize(mix(leafNormal, crownNormal, 0.55));

  // Fallen leaves: autumn cards, lawn-lit like the grass, shaded by the lightmap.
  const fallen = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, metalness: 0, roughness: 0.8 });
  fallen.colorNode = leafTexel.rgb.mul(uniforms.leafBrightness).mul(lightmapFactor);
  fallen.opacityNode = leafTexel.a;
  fallen.alphaTest = 0.5;
  fallen.normalNode = transformNormalToView(vec3(0, 1, 0));

  // Falling leaves: each spins down from its spawn point over its period,
  // drifting with the wind, and shrinks away as it lands.
  const falling = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, metalness: 0, roughness: 0.6 });
  const spawn = attribute<"vec4">("fallSpawn", "vec4");
  const period = attribute<"float">("fallPeriod", "float");
  const t = fract(uniforms.time.div(period).add(spawn.w));
  const spin = t.mul(16).add(spawn.w.mul(6.283));
  const local = rotate(positionLocal, vec3(spin, spin.mul(0.7), spin.mul(0.45)));
  const land = float(1).sub(smoothstep(0.92, 1, t));
  const drift = vec3(
    sin(t.mul(9).add(spawn.w.mul(20))).mul(0.6).add(t.mul(1.6).mul(uniforms.wind)),
    spawn.y.mul(t).negate(),
    cos(t.mul(7).add(spawn.w.mul(13))).mul(0.45)
  );
  falling.positionNode = spawn.xyz.add(drift).add(local.mul(land));
  // Falling leaves bake their atlas UVs into the geometry.
  const fallingTexel = texture(textures.leaves.map, uv());
  falling.colorNode = fallingTexel.rgb.mul(vertexColor()).mul(uniforms.leafBrightness);
  falling.opacityNode = fallingTexel.a;
  falling.alphaTest = 0.5;
  falling.normalNode = transformNormalToView(vec3(0, 1, 0));

  // Lantern: dark wooden frame, warm glowing panes (HDR, so bloom picks it up).
  const lanternFrame = new THREE.MeshLambertNodeMaterial();
  lanternFrame.colorNode = color("#241a14");
  const lanternGlow = new THREE.MeshBasicNodeMaterial();
  lanternGlow.colorNode = color("#ffcf7a").mul(uniforms.lanternGlow);

  const all = [bark, leaves, fallen, falling, lanternFrame, lanternGlow];

  return {
    bark,
    leaves,
    fallen,
    falling,
    lanternFrame,
    lanternGlow,
    setLod(lod: LeafLod) {
      uniforms.lodNear.value = lod.near;
      uniforms.lodMin.value = lod.min;
      uniforms.lodEnabled.value = lod.enabled ? 1 : 0;
    },
    setLook(look: MapleLook) {
      uniforms.leafBrightness.value = look.leafBrightness;
      uniforms.wind.value = look.wind;
      uniforms.lanternGlow.value = look.lanternGlow;
    },
    /** Advance the wind clock (clamped, so a long idle gap doesn't jump). */
    advance(delta: number) {
      uniforms.time.value += Math.min(delta, 0.1);
    },
    dispose() {
      for (const m of all) m.dispose();
    },
  };
}

export type MapleMaterials = ReturnType<typeof createMapleMaterials>;
