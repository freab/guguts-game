import * as THREE from "three/webgpu";
import { uniform } from "three/tsl";

/**
 * The sun, as shader uniforms shared by every material that reacts to it
 * directly (backlit grass and leaves, glinting dust) — set by the Scene from
 * the same direction and colour that drive the sun light, so all agree.
 */
export const sun = {
  /** Unit vector from the ground towards the sun (world space). */
  direction: uniform(new THREE.Vector3(0, 1, 0)),
  /** The sun light's colour (linear). */
  color: uniform(new THREE.Color("#ffc27a")),
};

export function setSun(direction: THREE.Vector3, color: string) {
  sun.direction.value.copy(direction).normalize();
  sun.color.value.set(color);
}
