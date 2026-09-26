import * as THREE from "three/webgpu";
import {
  abs,
  float,
  length,
  mix,
  mx_noise_float,
  positionWorld,
  smoothstep,
  texture,
  uv,
  vec3,
} from "three/tsl";

/** A constant colour node (hex is sRGB; three converts to linear working space). */
const rgb = (hex: string) => vec3(...new THREE.Color(hex).toArray());

/** Maps mx_noise's ~[-1, 1] output to [0, 1]. */
const noise01 = (p: Parameters<typeof mx_noise_float>[0]) =>
  mx_noise_float(p).mul(0.5).add(0.5);

/**
 * Weathered stone for the maze walls (physically based, lit by the sky IBL).
 * World-space noise gives large blotches and fine grain, the bottom metre is
 * darker and damp-looking, and `aoNode` darkens the base's ambient light to
 * fake contact shadowing where wall meets ground.
 */
export function createWallMaterial() {
  const p = positionWorld;
  const blotch = noise01(p.mul(1.7));
  const grain = noise01(p.mul(9));
  const stone = mix(rgb("#958a73"), rgb("#bdb197"), blotch).mul(mix(0.88, 1.06, grain));
  const nearGround = float(1).sub(smoothstep(0, 0.9, p.y));

  const material = new THREE.MeshStandardNodeMaterial();
  material.colorNode = mix(stone, rgb("#57503f"), nearGround.mul(0.55));
  material.roughnessNode = mix(0.95, 0.82, grain);
  material.metalness = 0;
  material.aoNode = mix(0.55, 1, smoothstep(0, 0.6, p.y));
  return material;
}

/**
 * Lawn ground: the procedural lawn texture tiled `tiles` times, modulated by a
 * very low-frequency world-space noise so the tiling reads as natural patches.
 */
export function createGroundMaterial(lawn: THREE.Texture, tiles: number) {
  const macro = noise01(positionWorld.xz.mul(0.04));
  const material = new THREE.MeshStandardNodeMaterial();
  material.colorNode = texture(lawn, uv().mul(tiles)).rgb.mul(mix(0.72, 1.08, macro));
  material.roughness = 1;
  material.metalness = 0;
  return material;
}

/**
 * Trodden earth for the footpath quads. `radial` shapes a round joint (fading
 * from the centre); otherwise a straight link fading across its width
 * (uv.y). World-space noise roughens the edge and mottles the colour so it
 * reads as worn ground, not a painted stripe. Opaque alpha-clip.
 */
export function createDirtMaterial(radial: boolean) {
  const edgeNoise = mx_noise_float(positionWorld.xz.mul(2.5));
  const mottle = noise01(positionWorld.xz.mul(0.9));
  const centred = uv().mul(2).sub(1);
  const edge = radial ? length(centred) : abs(centred.y);

  const material = new THREE.MeshStandardNodeMaterial();
  material.colorNode = mix(rgb("#6f5b3e"), rgb("#8a7552"), mottle);
  material.roughness = 1;
  material.metalness = 0;
  material.opacityNode = float(1).sub(smoothstep(0.55, 1, edge.add(edgeNoise.mul(0.3))));
  material.alphaTest = 0.5;
  return material;
}
