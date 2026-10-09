"use client";

import { useFrame } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import { sun } from "./sunUniforms";
import { DUSK, duskForRun, setDusk } from "./dusk";
import { photo } from "../game/photo";

export interface SunsetBase {
  sunColor: string;
  sunIntensity: number;
  ambientColor: string;
  ambientIntensity: number;
  skyFill: string;
  groundFill: string;
  hemisphereIntensity: number;
}

const _base = new THREE.Color();

/** Move each light from its tuned value (base) towards dusk's, by `d`. */
function applyDusk(
  d: number,
  base: SunsetBase,
  light: THREE.DirectionalLight | null,
  ambient: THREE.AmbientLight | null,
  hemisphere: THREE.HemisphereLight | null
) {
  if (light) {
    light.color.copy(_base.set(base.sunColor)).lerp(DUSK.sunColor, d);
    light.intensity = base.sunIntensity * THREE.MathUtils.lerp(1, DUSK.sunIntensity, d);
    // (The materials that react to the sun directly: backlit grass and leaves, dust.)
    sun.color.value.copy(light.color);
  }
  if (ambient) {
    ambient.color.copy(_base.set(base.ambientColor)).lerp(DUSK.ambientColor, d);
    ambient.intensity = base.ambientIntensity * THREE.MathUtils.lerp(1, DUSK.ambientIntensity, d);
  }
  if (hemisphere) {
    hemisphere.color.copy(_base.set(base.skyFill)).lerp(DUSK.skyFill, d);
    hemisphere.groundColor.copy(_base.set(base.groundFill)).lerp(DUSK.groundFill, d);
    hemisphere.intensity = base.hemisphereIntensity * THREE.MathUtils.lerp(1, DUSK.hemisphereIntensity, d);
  }
}

/**
 * Drives the sunset (scene/sunset) every frame: works out dusk from the run
 * (or the #debug preview), and moves the lights from their tuned values
 * (`base`, the leva panel's) towards dusk's. The sky and the god rays read
 * the same dusk (Scene, post/PostEffects); the fireflies too.
 */
export default function Sunset({
  light,
  ambient,
  hemisphere,
  base,
  enabled,
  preview,
}: {
  light: THREE.DirectionalLight | null;
  ambient: THREE.AmbientLight | null;
  hemisphere: THREE.HemisphereLight | null;
  base: SunsetBase;
  enabled: boolean;
  /** 0..1 to hold dusk there (#debug); below 0 = follow the run. */
  preview: number;
}) {
  useFrame(() => {
    // (Photo mode can hold the sun anywhere from the start to full dusk.)
    const held = photo.get().active ? photo.get().dusk : null;
    const d = held !== null ? held : !enabled ? 0 : preview >= 0 ? preview : duskForRun();
    setDusk(d);
    applyDusk(d, base, light, ambient, hemisphere);
  });
  return null;
}
