import * as THREE from "three/webgpu";
import {
  attribute,
  float,
  length,
  positionLocal,
  sin,
  smoothstep,
  transformNormalToView,
  uniform,
  vec3,
  vertexColor,
} from "three/tsl";
import { lightmapFactor } from "../bake/lightmap";
import { gustScale } from "../wind";

/** Live-tunable flower look (no shader rebuild needed). */
export interface FlowerLook {
  /** Highest head in metres (sway reference, and how far faded ones sink). */
  maxHeight: number;
  windStrength: number;
  brightness: number;
}

/**
 * Adey Abeba flowers as a WebGPU node material (TSL). Colour comes from the
 * baked vertex colours (petals, core) times the per-instance tint, lit
 * like the grass: a straight-up normal so the field shades evenly, darkened
 * only by the baked wall shadows / AO. Heads nod in the wind, and flowers
 * sink into the ground at the draw distance so culled chunks never pop.
 */
export function createFlowerMaterial() {
  const uniforms = {
    time: uniform(0),
    windStrength: uniform(0.05),
    brightness: uniform(1),
    maxHeight: uniform(0.7),
    // Draw-distance fade around the player (world XZ centre, start/end radius).
    fadeCenter: uniform(new THREE.Vector2()),
    fadeStart: uniform(14),
    fadeEnd: uniform(18),
  };

  // Instancing runs before positionNode and the flower meshes sit at the
  // origin, so positionLocal is world-space here (y = height above the ground).
  const fade = float(1).sub(
    smoothstep(uniforms.fadeStart, uniforms.fadeEnd, length(positionLocal.xz.sub(uniforms.fadeCenter)))
  );

  // Heads nod on their (hidden) stems: sway grows with height above the
  // ground; each head gets its own phase so a drift doesn't move in lockstep.
  const bend = positionLocal.y.div(uniforms.maxHeight).clamp(0, 1).pow(2);
  // (A fixed random phase per head, packed with it — see FlowerField.)
  const phase = attribute<"float">("headPhase", "float").mul(6.283).add(uniforms.time.mul(1.7));
  // (…harder as a gust rolls through: scene/wind.)
  const gust = gustScale(positionLocal.xz);
  const swayX = sin(phase).mul(uniforms.windStrength).mul(bend).mul(gust);
  const swayZ = sin(phase.mul(0.77).add(1.3)).mul(uniforms.windStrength).mul(bend).mul(0.6).mul(gust);

  const material = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide });
  material.positionNode = vec3(
    positionLocal.x.add(swayX),
    positionLocal.y.sub(float(1).sub(fade).mul(uniforms.maxHeight).mul(1.2)),
    positionLocal.z.add(swayZ)
  );
  material.colorNode = vertexColor().mul(uniforms.brightness).mul(lightmapFactor);
  material.normalNode = transformNormalToView(vec3(0, 1, 0));

  return {
    material,
    setLook(look: FlowerLook) {
      uniforms.maxHeight.value = look.maxHeight;
      uniforms.windStrength.value = look.windStrength;
      uniforms.brightness.value = look.brightness;
    },
    /** Centre and radii of the draw-distance fade (call every frame). */
    setFade(x: number, z: number, start: number, end: number) {
      uniforms.fadeCenter.value.set(x, z);
      uniforms.fadeStart.value = start;
      uniforms.fadeEnd.value = end;
    },
    /** Advance the wind clock (clamped, so a long idle gap doesn't jump). */
    advance(delta: number) {
      uniforms.time.value += Math.min(delta, 0.1);
    },
    dispose() {
      material.dispose();
    },
  };
}

export type FlowerMaterialHandle = ReturnType<typeof createFlowerMaterial>;
