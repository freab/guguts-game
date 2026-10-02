import { useMemo } from "react";
import { useLoader, useThree } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import { normalMap, texture } from "three/tsl";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

/**
 * GPU-compressed (KTX2 / Basis Universal) PBR textures, built from CC0 sources
 * by `scripts/build-textures.mjs` (see public/textures/LICENSE.md). Basis files
 * are transcoded in a worker to whatever the GPU supports (BC7 / ASTC / ETC2),
 * so they stay compressed in video memory as well as on the wire.
 */
const TEXTURE_DIR = "/textures/";
/** Basis transcoder (copied from three/examples/jsm/libs/basis). */
const TRANSCODER_PATH = "/basis/";

/** A tiling PBR set: colour (sRGB), OpenGL normal map, AO/roughness/metal (ARM). */
export interface PbrSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  arm: THREE.Texture;
}

function configure(textures: THREE.Texture[], colorIndex: number, wrap: THREE.Wrapping) {
  textures.forEach((t, i) => {
    t.colorSpace = i === colorIndex ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = wrap;
    t.anisotropy = 8;
    t.needsUpdate = true;
  });
}

/** Load KTX2 files (suspends until they are transcoded). */
function useKtx2(urls: string[]): THREE.Texture[] {
  const gl = useThree((s) => s.gl) as unknown as THREE.WebGPURenderer;
  return useLoader(KTX2Loader, urls, (loader) => {
    loader.setTranscoderPath(TRANSCODER_PATH).detectSupport(gl);
  }) as THREE.Texture[];
}

/** `<name>_color / _normal / _arm .ktx2`, set up to tile. */
export function usePbrSet(name: string): PbrSet {
  const [map, normal, arm] = useKtx2([
    `${TEXTURE_DIR}${name}_color.ktx2`,
    `${TEXTURE_DIR}${name}_normal.ktx2`,
    `${TEXTURE_DIR}${name}_arm.ktx2`,
  ]);
  return useMemo(() => {
    configure([map, normal, arm], 0, THREE.RepeatWrapping);
    return { map, normalMap: normal, arm };
  }, [map, normal, arm]);
}

/** `<name>_height.ktx2`: a tiling height map (linear, grey), e.g. for parallax and displacement. */
export function useHeightMap(name: string): THREE.Texture {
  const [height] = useKtx2([`${TEXTURE_DIR}${name}_height.ktx2`]);
  return useMemo(() => {
    configure([height], -1, THREE.RepeatWrapping);
    return height;
  }, [height]);
}

/** A leaf atlas (`maple_leaves` or `ivy_leaves`): RGBA colour + opacity, and its normal map (clamped). */
export function useLeafAtlas(name = "maple_leaves"): { map: THREE.Texture; normalMap: THREE.Texture } {
  const [map, normal] = useKtx2([`${TEXTURE_DIR}${name}_color.ktx2`, `${TEXTURE_DIR}${name}_normal.ktx2`]);
  return useMemo(() => {
    configure([map, normal], 0, THREE.ClampToEdgeWrapping);
    return { map, normalMap: normal };
  }, [map, normal]);
}

/**
 * The surface a PBR set gives at `uv`: albedo, a normal-mapped (view-space)
 * normal, roughness and ambient occlusion from the ARM channels. Metalness is
 * always 0 for these natural materials.
 */
export function pbrSurface(set: PbrSet, uv: THREE.Node<"vec2">) {
  const arm = texture(set.arm, uv);
  return {
    color: texture(set.map, uv).rgb,
    normal: normalMap(texture(set.normalMap, uv)),
    roughness: arm.g,
    ao: arm.r,
  };
}
