"use client";

import * as THREE from "three/webgpu";
import { float, length, smoothstep, uv, vec3 } from "three/tsl";
import { useDisposable } from "../hooks/useDisposable";

/** Diameter of the shadow under the feet (m), and its darkness at the centre. */
const SIZE = 1.2;
const OPACITY = 0.5;
/** Just above the ground / footpath, below the exit marker. */
const HEIGHT = 0.02;

/** Soft radial falloff: dark in the middle, fading to nothing at the rim. */
function createBlobMaterial() {
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  material.colorNode = vec3(0, 0, 0);
  const r = length(uv().sub(0.5).mul(2)); // 0 at centre, 1 at the edge
  material.opacityNode = float(1).sub(smoothstep(0.15, 1, r)).mul(OPACITY);
  return material;
}

/**
 * A soft "blob" contact shadow under the character. With the sun's shadow map
 * baked (walls only), this is how the moving character stays grounded — one
 * tiny transparent quad instead of re-rendering the shadow map every frame.
 * Place it inside the body group so it follows the player.
 */
export default function BlobShadow({
  size = SIZE,
  height = HEIGHT,
}: {
  /** Diameter (m). */
  size?: number;
  /** Height above the ground; raise it to sit above the exit marker. */
  height?: number;
}) {
  const material = useDisposable(() => createBlobMaterial(), []);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, height, 0]} material={material} renderOrder={1}>
      <planeGeometry args={[size, size]} />
    </mesh>
  );
}
