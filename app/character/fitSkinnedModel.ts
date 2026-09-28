import * as THREE from "three/webgpu";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

/**
 * Clone a rigged glTF scene (with its own skeleton, so it animates
 * independently) and fit it: uniformly scaled to `height` with its lowest point
 * on y = 0, measured from its actual bounds rather than hard-coded numbers.
 *
 * Meshes receive shadows but don't cast: the sun's shadow map is baked (walls
 * only), so anything that moves would leave a frozen "ghost" shadow — moving
 * things use a BlobShadow instead.
 *
 * Returns `root` (add to the scene; position/rotate this) and `animated` (the
 * clone to give an AnimationMixer).
 */
export function fitSkinnedModel(source: THREE.Object3D, height: number) {
  const animated = cloneSkinned(source);
  animated.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false; // skinned bounds don't follow the animation
    }
  });

  const fit = new THREE.Group();
  fit.add(animated);
  fit.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(fit);
  const scale = height / Math.max(box.max.y - box.min.y, 1e-3);
  fit.scale.setScalar(scale);
  fit.position.y = -box.min.y * scale;

  const root = new THREE.Group();
  root.add(fit);
  return { root, animated };
}
