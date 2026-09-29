import * as THREE from "three/webgpu";
import { dot, uniform, vec3 } from "three/tsl";
import { grassAlbedo } from "../grass/grassColors";

/** The ivy atlas is 4 × 2 cells (see scripts/build-textures.mjs). */
export const IVY_COLS = 4;
export const IVY_ROWS = 2;
/** Mean linear luminance of the ivy atlas's leaves (measured from the atlas). */
const IVY_MEAN_LUMINANCE = 0.23;

/** Ivy look shared by the vine materials (set from the Vines controls). */
export const ivyLook = { brightness: uniform(1.1) };

/**
 * Recolour an ivy texel to the grass: its light/dark detail (veins, mottling,
 * blemishes) is kept as a luminance ratio, its hue comes from the grass
 * palette (grass/grassColors.ts) — so the ivy always matches the lawn, even
 * after retuning the grass colours.
 */
export function grassTinted(rgb: THREE.Node<"vec3">, variation: THREE.Node<"float">) {
  const luminance = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  return grassAlbedo(variation).mul(luminance.div(IVY_MEAN_LUMINANCE));
}
