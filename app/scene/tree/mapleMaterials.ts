import * as THREE from "three/webgpu";
import {
  attribute,
  cameraPosition,
  clamp,
  color,
  cos,
  float,
  fract,
  hash,
  instanceIndex,
  inverseSqrt,
  length,
  mix,
  mx_noise_float,
  normalize,
  positionLocal,
  positionWorld,
  rotate,
  sin,
  smoothstep,
  transformNormalToView,
  uniform,
  vec3,
  vertexColor,
} from "three/tsl";
import { lightmapFactor } from "../bake/lightmap";
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
 * The maple's node materials (TSL), sharing one wind clock:
 * - bark: streaky procedural bark, mossy at the foot;
 * - leaves: per-instance colour, shaded as one soft crown (normals point out
 *   from the canopy centre), swaying in gusts and fluttering;
 * - fallen leaves: flat on the ground, darkened by the baked lightmap;
 * - falling leaves: spawn in the crown and spin down, all in the shader;
 * - lantern: a warm emissive pane that blooms.
 */
export function createMapleMaterials(tree: MapleTreeLayout) {
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

  // Bark: dark grey-brown streaks running along the wood, moss at the foot.
  const bark = new THREE.MeshLambertNodeMaterial();
  const streak = mx_noise_float(positionWorld.mul(vec3(3.2, 0.7, 3.2))).mul(0.5).add(0.5);
  const moss = smoothstep(0.9, 0.1, positionWorld.y).mul(
    smoothstep(0.45, 0.7, mx_noise_float(positionWorld.mul(2.5)).mul(0.5).add(0.5))
  );
  bark.colorNode = mix(mix(color("#2a2420"), color("#6b5f55"), streak), color("#4d5a2c"), moss.mul(0.8));

  // Leaves (instanced; positionLocal is world-space after instancing).
  const leaves = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide });
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
  leaves.colorNode = vec3(uniforms.leafBrightness);
  // One soft, rounded crown: normals from the canopy centre, tipped upward.
  leaves.normalNode = transformNormalToView(
    normalize(normalize(positionWorld.sub(uniforms.canopyCenter)).add(vec3(0, 0.7, 0)))
  );

  // Fallen leaves: lawn-lit like the grass, shaded by the baked lightmap.
  const fallen = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide });
  fallen.colorNode = vec3(uniforms.leafBrightness).mul(lightmapFactor);
  fallen.normalNode = transformNormalToView(vec3(0, 1, 0));

  // Falling leaves: each spins down from its spawn point over its period,
  // drifting with the wind, and shrinks away as it lands.
  const falling = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide });
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
  falling.colorNode = vertexColor().mul(uniforms.leafBrightness);
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
