import * as THREE from "three/webgpu";
import { cos, float, length, mix, positionWorld, sin, smoothstep as smoothstepNode, texture, uniform, vec2, vec3 } from "three/tsl";
import { WallCollider } from "../../character/WallCollider";
import { CELL, COLS, ROWS, WALL_HEIGHT, cellToWorld, clearingRadius } from "../../maze/mazeData";
import { mapleTreeLayout, treeTransmittance } from "../tree/mapleTree";
import { nextFrames } from "./bakeTracker";
import { quality } from "../../quality";
import { gustScale, windTime } from "../wind";

/**
 * Baked ground lighting ("lightmap") for everything lying on the floor — the
 * grid floor, the footpath and the grass. Per ground texel, two channels:
 *   R = sun visibility (a ray towards the sun, tested against the walls, and
 *       filtered through the clearing's tree for dappled shade),
 *   G = ambient occlusion (darker close to wall bases).
 * Materials multiply by `lightmapFactor`: one texture fetch instead of
 * shadow-map filtering per pixel, and it gives the grass wall shadows for free.
 */

/**
 * Resolution: texels per metre (capped; read per bake), plus a margin around the maze.
 * Low bakes a coarser one, High a finer one: it is baked on the CPU while the loading
 * screen is up, and the shadows on the ground are soft anyway.
 */
const texelsPerMetre = () => quality(7, 10, 14);
const MAX_SIZE = 2048;
const MARGIN = 4;
/** Rows baked per frame, so the page (and loading screen) stays responsive. */
const ROWS_PER_SLICE = 24;
/**
 * Penumbra softness (metres), and how far the darkening at wall bases reaches
 * across the ground (High: wider, so the walls sit deeper in the grass).
 */
const PENUMBRA = 0.14;
const aoReach = () => quality(0.9, 0.9, 1.25);

function makeTexture(data: Uint8Array, width: number, height: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// Fully lit 1×1 placeholder until the first bake lands (same format/filtering
// as the real one, so swapping textures never changes the shader layout).
const placeholder = makeTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);

/** World-space rectangle the lightmap covers: (minX, minZ, sizeX, sizeZ). */
const bounds = uniform(new THREE.Vector4(-1, -1, 2, 2));
/** One shared texture node — every material samples it, swaps update them all. */
/**
 * Dappled shade that moves: under the maple (the clearing, round the origin)
 * the lightmap is read a little off where it should be, the offset swaying
 * with the wind (harder in the gusts — scene/wind) and differently from spot
 * to spot, so the baked patches of leaf shadow and sun shift and shimmer as
 * if the crown were moving. Nothing changes away from the tree (no walls are
 * in reach). The radius and sway are set per bake (Low: no sway).
 */
const clearing = uniform(6);
const leafSway = uniform(0.07);
const groundXZ = positionWorld.xz;
const underTree = float(1).sub(smoothstepNode(clearing.mul(0.55), clearing.mul(0.9), length(groundXZ)));
const swayed = vec2(
  sin(windTime.mul(1.3).add(groundXZ.x.mul(0.9)).add(groundXZ.y.mul(0.4))),
  cos(windTime.mul(1.05).add(groundXZ.y.mul(0.8)).sub(groundXZ.x.mul(0.3)))
)
  .mul(leafSway)
  .mul(gustScale(groundXZ))
  .mul(underTree);
const lightmapNode = texture(placeholder, groundXZ.add(swayed).sub(bounds.xy).div(bounds.zw));

export const lightmapStrength = {
  /** How dark baked wall shadows are (0 = off). */
  shadow: uniform(0.55),
  /** How dark ambient occlusion near walls is (0 = off). */
  ao: uniform(0.6),
};

/** Baked light multiplier at this fragment's ground position (1 = fully lit). */
export const lightmapFactor = mix(float(1).sub(lightmapStrength.shadow), float(1), lightmapNode.r).mul(
  mix(float(1).sub(lightmapStrength.ao), float(1), lightmapNode.g)
);

/**
 * The lightmap itself, as a colour where it's read (red = sun, green = no
 * occlusion), and the ground it covers (x, z, width, depth): to show it
 * (app/present's x-ray, present/Director).
 */
export const lightmapView = vec3(lightmapNode.r, lightmapNode.g, 0);
export const lightmapBounds = bounds;

export function setLightmapStrength(shadow: number, ao: number): void {
  lightmapStrength.shadow.value = shadow;
  lightmapStrength.ao.value = ao;
}

/** Separable box blur (in place), `passes` times ≈ gaussian. */
function blur(values: Float32Array, w: number, h: number, radius: number, passes: number) {
  if (radius < 1) return;
  const tmp = new Float32Array(values.length);
  const span = radius * 2 + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) sum += values[y * w + Math.min(w - 1, Math.max(0, x + k))];
        tmp[y * w + x] = sum / span;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) sum += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x];
        values[y * w + x] = sum / span;
      }
    }
  }
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};

/**
 * Bake the lightmap for the current maze and sun direction, a slice of rows per
 * frame. `onProgress` gets 0..1; if `isCancelled()` turns true (e.g. the sun
 * moved again) the bake stops without replacing the current lightmap.
 */
export async function bakeLightmap(
  sunDirection: THREE.Vector3,
  onProgress?: (fraction: number) => void,
  isCancelled: () => boolean = () => false
): Promise<void> {
  const walls = new WallCollider();
  const [x0, z0] = cellToWorld(0, 0);
  const [x1, z1] = cellToWorld(ROWS - 1, COLS - 1);
  const minX = x0 - CELL / 2 - MARGIN;
  const minZ = z0 - CELL / 2 - MARGIN;
  const sizeX = x1 + CELL / 2 + MARGIN - minX;
  const sizeZ = z1 + CELL / 2 + MARGIN - minZ;
  const texels = texelsPerMetre();
  const aoDistance = aoReach();
  const w = Math.min(MAX_SIZE, Math.ceil(sizeX * texels));
  const h = Math.min(MAX_SIZE, Math.ceil(sizeZ * texels));

  const sun = new Float32Array(w * h);
  const ao = new Float32Array(w * h);
  const dir = sunDirection.clone().normalize();
  // Past the wall tops the ray can't be blocked any more.
  const reach = WALL_HEIGHT / Math.max(dir.y, 0.05) + 0.5;
  const origin = new THREE.Vector3();
  const tree = mapleTreeLayout();

  for (let y = 0; y < h; y++) {
    const z = minZ + ((y + 0.5) / h) * sizeZ;
    for (let x = 0; x < w; x++) {
      const wx = minX + ((x + 0.5) / w) * sizeX;
      const i = y * w + x;
      origin.set(wx, 0.05, z);
      sun[i] = walls.raycast(origin, dir, reach) === Infinity ? treeTransmittance(tree, origin, dir) : 0;
      ao[i] = smoothstep(0, aoDistance, walls.distanceToWalls(wx, z, aoDistance));
    }
    if (y % ROWS_PER_SLICE === ROWS_PER_SLICE - 1) {
      onProgress?.(y / h);
      await nextFrames(1);
      if (isCancelled()) return;
    }
  }

  blur(sun, w, h, Math.round(PENUMBRA * texels), 2);
  if (isCancelled()) return;

  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = Math.round(sun[i] * 255);
    data[i * 4 + 1] = Math.round(ao[i] * 255);
    data[i * 4 + 3] = 255;
  }

  const previous = lightmapNode.value;
  lightmapNode.value = makeTexture(data, w, h);
  bounds.value.set(minX, minZ, sizeX, sizeZ);
  clearing.value = clearingRadius();
  leafSway.value = quality(0, 0.07, 0.08);
  if (previous !== placeholder) previous.dispose();
  onProgress?.(1);
}
