import * as THREE from "three/webgpu";
import { mix, uniform } from "three/tsl";

/**
 * The grass palette as shared TSL uniforms. The grass material writes them
 * (from its leva controls) and anything that should match the grass — the ivy
 * on the walls — reads the same nodes, so retuning the grass recolours both.
 */
export const grassColors = {
  base: uniform(new THREE.Color("#638332")),
  tip1: uniform(new THREE.Color("#89c47b")),
  tip2: uniform(new THREE.Color("#056535")),
  brightness: uniform(1.75),
};

export function setGrassColors(look: { baseColor: string; tipColor1: string; tipColor2: string; brightness: number }) {
  grassColors.base.value.set(look.baseColor);
  grassColors.tip1.value.set(look.tipColor1);
  grassColors.tip2.value.set(look.tipColor2);
  grassColors.brightness.value = look.brightness;
}

/**
 * A grass-coloured albedo at `variation` (0..1): the grass's base colour
 * blended part-way to one of its two tip colours — the mid-blade colour a
 * glance at the lawn gives.
 */
export function grassAlbedo(variation: THREE.Node<"float">) {
  return mix(grassColors.base, mix(grassColors.tip1, grassColors.tip2, variation), 0.55);
}
