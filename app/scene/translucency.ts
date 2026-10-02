import type * as THREE from "three/webgpu";
import { cameraPosition, dot, positionWorld } from "three/tsl";
import { sun } from "./sunUniforms";

/**
 * Sunlight seen *through* thin foliage — the gold glow of grass tips and
 * leaves when you look towards a low sun. Forward scattering: strongest
 * looking straight at the sun past the leaf, falling off as `sharpness`
 * says. Returns the sun's colour times that lobe (times `strength`): the
 * caller multiplies in how thin / lit the foliage is and adds it as emissive.
 * A few instructions on materials already drawn — no pass, no texture.
 */
export function sunTranslucency(strength: THREE.Node<"float"> | number, sharpness = 5): THREE.Node<"vec3"> {
  const view = positionWorld.sub(cameraPosition).normalize();
  const forward = dot(view, sun.direction).clamp(0, 1).pow(sharpness);
  return sun.color.mul(forward).mul(strength) as THREE.Node<"vec3">;
}
