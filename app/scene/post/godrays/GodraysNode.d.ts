import type BaseGodraysNode from "three/examples/jsm/tsl/display/GodraysNode.js";
import type { Camera, DirectionalLight, PointLight, TextureNode } from "three/webgpu";

/** three's GodraysNode with a cheaper, same-look ray march (see GodraysNode.js). */
declare class GodraysNode extends BaseGodraysNode {
  /** The fewest raymarch steps any ray gets (short rays scale down to this). */
  minSteps: number;
}

export default GodraysNode;

export const godrays: (depthNode: TextureNode, camera: Camera, light: DirectionalLight | PointLight) => GodraysNode;
