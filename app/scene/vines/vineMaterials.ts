import * as THREE from "three/webgpu";
import {
  attribute,
  cameraPosition,
  clamp,
  dot,
  float,
  floor,
  hash,
  inverseSqrt,
  length,
  mod,
  normalMap,
  positionLocal,
  select,
  sin,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import { grassAlbedo } from "../grass/grassColors";
import { LEAF_LOD_MIN, LEAF_LOD_NEAR } from "./VineField";
import { pbrSurface, type PbrSet } from "../textures/pbrTextures";
import { BULGE_CLEARANCE, wallBulge } from "../../maze/wallRelief";
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
 * Both move out from the wall with its stone bulge (`wallHeight`, see
 * maze/wallRelief), so the ivy lies on the stone rather than inside it.
 */
export function createVineMaterials(
  ivy: { map: THREE.Texture; normalMap: THREE.Texture },
  bark: PbrSet,
  wallHeight: THREE.Texture
) {
  const uniforms = {
    time: uniform(0),
    wind: uniform(1),
    lodNear: uniform(LEAF_LOD_NEAR),
    lodMin: uniform(LEAF_LOD_MIN),
  };

  const cell = attribute<"float">("leafCell", "float");
  const atlasUv = uv()
    .add(vec2(mod(cell, IVY_COLS), floor(cell.div(IVY_COLS))))
    .div(vec2(IVY_COLS, IVY_ROWS));
  const texel = texture(ivy.map, atlasUv);

  const leaves = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, metalness: 0, roughness: 0.38 });
  // Each leaf's fixed random rank (VineField): stable however leaves are packed.
  const rank = attribute<"float">("leafRank", "float");
  leaves.colorNode = grassTinted(texel.rgb, hash(rank.mul(9973))).mul(ivyLook.brightness);
  leaves.opacityNode = texel.a;
  leaves.alphaTest = 0.5;
  leaves.normalNode = normalMap(texture(ivy.normalMap, atlasUv));
  // Flutter: the stem end is pinned, the tip (uv.y → 0 at the tip) moves.
  const tipWeight = uv().y.oneMinus();
  const flutter = sin(uniforms.time.mul(4.3).add(hash(rank.mul(7919)).mul(6.283)))
    .mul(0.006)
    .mul(tipWeight)
    .mul(uniforms.wind);
  // Distance LOD, per leaf: beyond lodNear only near/distance of the leaves
  // are drawn (those whose rank is under it; the rest collapse to their stalk
  // point — no area, never rasterised), each grown about its stalk by
  // 1/sqrt of that, so the wall stays as covered.
  const origin = attribute<"vec3">("leafOrigin", "vec3");
  const keep = clamp(uniforms.lodNear.div(length(origin.sub(cameraPosition))), uniforms.lodMin, 1);
  const grown = origin.add(positionLocal.sub(origin).mul(inverseSqrt(keep)));
  // The whole leaf moves out by the wall's bulge at its stalk.
  const leafLift = attribute<"vec3">("leafWall", "vec3").mul(wallBulge(wallHeight, origin).add(BULGE_CLEARANCE));
  leaves.positionNode = select(
    rank.greaterThanEqual(keep),
    origin,
    grown.add(vec3(flutter, flutter.mul(0.4), flutter.mul(0.7)))
  ).add(leafLift);

  const stems = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
  stems.positionNode = positionLocal.add(
    attribute<"vec3">("wallNormal", "vec3").mul(wallBulge(wallHeight, positionLocal).add(BULGE_CLEARANCE))
  );
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
