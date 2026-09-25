"use client";

import { useMemo } from "react";
import * as THREE from "three/webgpu";

/**
 * WebGPU-safe gradient sky: a large inward-facing sphere with baked vertex
 * colours (horizon -> zenith). No custom GLSL/ShaderMaterial, so it runs on the
 * WebGPURenderer (MeshBasicMaterial auto-converts to a node material). This
 * replaces drei's <Sky>/<Cloud>, which are GLSL and unsupported on WebGPU.
 */
export default function SkyEnvironment() {
  const geometry = useMemo(() => {
    const geo = new THREE.SphereGeometry(600, 32, 20);
    const zenith = new THREE.Color("#2f6fc6");
    const horizon = new THREE.Color("#cfe3f7");
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      const t = THREE.MathUtils.clamp(v.y * 0.5 + 0.5, 0, 1);
      c.copy(horizon).lerp(zenith, Math.pow(t, 0.7));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geo;
  }, []);

  return (
    <mesh geometry={geometry} frustumCulled={false}>
      <meshBasicMaterial
        vertexColors
        side={THREE.BackSide}
        toneMapped={false}
        fog={false}
        depthWrite={false}
      />
    </mesh>
  );
}
