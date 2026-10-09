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
  select,
} from "three/tsl";
import { lightmapFactor } from "../bake/lightmap";
import { pbrSurface, type PbrSet } from "../textures/pbrTextures";
import { LEAF_ATLAS } from "./treeGeometry";
import { sunTranslucency } from "../translucency";
import type { MapleTreeLayout } from "./mapleTree";
import { gustAt, gustScale, windNow } from "../wind";

/**
 * Wind on the tree — deliberately very slow: gusts take ~50 s to come and go
 * (radians per second of the gust wave), with a small sway, and each leaf's
 * own drift is slower still. Shared by the shader and its CPU twin (swayAt).
 */
const GUST_SPEED = 0.12;
const SWAY_X = 0.07;
const SWAY_Z = 0.035;
const FLUTTER_SPEED = 0.7;

/** Live-tunable tree look. */
export interface MapleLook {
  leafBrightness: number;
  wind: number;
  lanternGlow: number;
}

/**
 * Canopy distance LOD: at distance d only `clamp(near / d, min, 1)` of the
 * leaves there are drawn — the shader drops each leaf whose random rank is
 * above that (collapsing it to a point, so the whole crown stays one draw)
 * and scales the survivors up by 1/sqrt of it so the crown stays just as full.
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
  const crownTop = tree.canopyTop;
  /** Below this the trunk is rigid; the sway grows from here to the crown top. */
  const swayFrom = tree.trunkTop * 0.4;

  /**
   * The wind's push at world point `p`: nothing at the foot of the tree,
   * growing (as height²) towards the top of the crown, in slow gusts with a
   * little faster wobble on top. Wood and leaves both use it — a leaf is
   * pushed by the push at the point it hangs from — so the whole tree moves
   * as one and no leaf drifts off its branch. Very slow and gentle — a calm
   * summer evening. See swayAt for the CPU twin.
   */
  const sway = (p: THREE.Node<"vec3">) => {
    const bend = smoothstep(swayFrom, crownTop, p.y).pow(2);
    const gust = sin(uniforms.time.mul(GUST_SPEED).add(p.x.mul(0.3)).add(p.z.mul(0.22))).add(
      sin(uniforms.time.mul(GUST_SPEED * 2.4).add(p.x.mul(0.7))).mul(0.25)
    );
    // (Bigger in the gusts you hear: scene/wind.)
    return vec3(gust.mul(SWAY_X), float(0), gust.mul(SWAY_Z)).mul(bend).mul(uniforms.wind).mul(gustScale(p.xz));
  };

  // Bark: textured wood (UVs in metres along each branch), moss at the foot.
  const bark = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
  const barkSurface = pbrSurface(textures.bark, uv());
  const moss = smoothstep(0.9, 0.1, positionWorld.y).mul(
    smoothstep(0.45, 0.7, mx_noise_float(positionWorld.mul(2.5)).mul(0.5).add(0.5))
  );
  bark.colorNode = mix(barkSurface.color, color("#4d5a2c"), moss.mul(0.6));
  // The wood sways with the wind (the bark mesh sits at the origin, so its
  // local positions are world positions).
  bark.positionNode = positionLocal.add(sway(positionLocal));
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
  // Each leaf's origin is where it hangs off its twig.
  const origin = attribute<"vec3">("leafOrigin", "vec3");
  // Distance LOD, per leaf: fewer, bigger leaves further away. A leaf is
  // drawn while its random rank is under the kept fraction (else collapsed to
  // its stalk: no area, never rasterised), grown about its stalk to make up.
  const keep = clamp(uniforms.lodNear.div(length(origin.sub(cameraPosition))), uniforms.lodMin, 1);
  const grow = mix(float(1), inverseSqrt(keep), uniforms.lodEnabled);
  const dropped = hash(instanceIndex.add(7919)).greaterThanEqual(keep).and(uniforms.lodEnabled.greaterThan(0.5));
  const leafPos = origin.add(positionLocal.sub(origin).mul(grow));
  // Carried with its branch (the sway at the leaf), plus a very slow, faint
  // drift of its own that grows out from its centre.
  const flutter = sin(uniforms.time.mul(FLUTTER_SPEED).add(hash(instanceIndex).mul(6.283)))
    .mul(length(leafPos.sub(origin)))
    .mul(0.08)
    .mul(uniforms.wind)
    .mul(gustScale(origin.xz));
  leaves.positionNode = select(
    dropped,
    origin,
    leafPos.add(sway(origin)).add(vec3(flutter.mul(0.3), flutter, flutter.mul(0.3)))
  );
  leaves.colorNode = leafTexel.rgb.mul(uniforms.leafBrightness);
  // Backlight: the low sun shining through the leaves — strongest on the
  // crown's outer shell (inner leaves are shaded by the ones outside them).
  const shell = smoothstep(0.35, 1, length(origin.sub(vec3(tree.canopyCenter.x, tree.canopyCenter.y, tree.canopyCenter.z))).div(tree.canopyRadius * 0.75));
  leaves.emissiveNode = sunTranslucency(0.75).mul(leafTexel.rgb.mul(2.4)).mul(shell);
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
    /** CPU twin of the shader's sway at `p` (for things hung on the tree, like the lantern). */
    swayAt(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
      const t = THREE.MathUtils.clamp((p.y - swayFrom) / (crownTop - swayFrom), 0, 1);
      const bend = (t * t * (3 - 2 * t)) ** 2;
      const time = uniforms.time.value;
      const gust =
        Math.sin(time * GUST_SPEED + p.x * 0.3 + p.z * 0.22) + 0.25 * Math.sin(time * GUST_SPEED * 2.4 + p.x * 0.7);
      // (The gust as heard at the player — close enough for things hung on the tree.)
      const k = bend * uniforms.wind.value * (0.35 + 1.3 * gustAt(windNow()));
      return out.set(gust * SWAY_X * k, 0, gust * SWAY_Z * k);
    },
    dispose() {
      for (const m of all) m.dispose();
    },
  };
}

export type MapleMaterials = ReturnType<typeof createMapleMaterials>;
