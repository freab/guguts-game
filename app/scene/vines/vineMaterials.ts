import * as THREE from "three/webgpu";
import {
  attribute,
  dot,
  float,
  floor,
  hash,
  instanceIndex,
  mod,
  normalMap,
  positionLocal,
  sin,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import { grassAlbedo } from "../grass/grassColors";
import { pbrSurface, type PbrSet } from "../textures/pbrTextures";
import { IVY_COLS, IVY_ROWS, grassTinted, ivyLook } from "./ivySurface";

/** Mean linear luminance of the bark texture (measured), for recolouring it. */
const BARK_MEAN_LUMINANCE = 0.107;

/**
 * Ivy node materials (TSL), PBR with KTX2 textures:
 * - leaves: cut-out cards from the ivy atlas (ambientCG LeafSet017, CC0) —
 *   opacity, normal map and the leaf's light/dark detail, recoloured to the
 *   grass palette (like the ivy skin on the walls); glossy (ivy is waxy), a
 *   faint flutter strongest at the leaf tip;
 * - stems: the bark set (Poly Haven bark_brown_02)'s relief and detail in a
 *   dark grass green.
 */
export function createVineMaterials(ivy: { map: THREE.Texture; normalMap: THREE.Texture }, bark: PbrSet) {
  const uniforms = {
    time: uniform(0),
    wind: uniform(1),
  };

  const cell = attribute<"float">("leafCell", "float");
  const atlasUv = uv()
    .add(vec2(mod(cell, IVY_COLS), floor(cell.div(IVY_COLS))))
    .div(vec2(IVY_COLS, IVY_ROWS));
  const texel = texture(ivy.map, atlasUv);

  const leaves = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, metalness: 0, roughness: 0.38 });
  leaves.colorNode = grassTinted(texel.rgb, hash(instanceIndex.add(7))).mul(ivyLook.brightness);
  leaves.opacityNode = texel.a;
  leaves.alphaTest = 0.5;
  leaves.normalNode = normalMap(texture(ivy.normalMap, atlasUv));
  // Flutter: the stem end is pinned, the tip (uv.y → 0 at the tip) moves.
  const tipWeight = uv().y.oneMinus();
  const flutter = sin(uniforms.time.mul(4.3).add(hash(instanceIndex).mul(6.283)))
    .mul(0.006)
    .mul(tipWeight)
    .mul(uniforms.wind);
  leaves.positionNode = positionLocal.add(vec3(flutter, flutter.mul(0.4), flutter.mul(0.7)));

  const stems = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
  const s = pbrSurface(bark, uv());
  const barkDetail = dot(s.color, vec3(0.2126, 0.7152, 0.0722)).div(BARK_MEAN_LUMINANCE);
  stems.colorNode = grassAlbedo(float(0.35)).mul(barkDetail).mul(0.55).mul(ivyLook.brightness);
  stems.normalNode = s.normal;
  stems.roughnessNode = s.roughness;
  stems.aoNode = s.ao;

  return {
    leaves,
    stems,
    setLook(look: { brightness: number; wind: number }) {
      ivyLook.brightness.value = look.brightness;
      uniforms.wind.value = look.wind;
    },
    /** Advance the flutter clock (clamped, so a long idle gap doesn't jump). */
    advance(delta: number) {
      uniforms.time.value += Math.min(delta, 0.1);
    },
    dispose() {
      leaves.dispose();
      stems.dispose();
    },
  };
}

export type VineMaterials = ReturnType<typeof createVineMaterials>;
