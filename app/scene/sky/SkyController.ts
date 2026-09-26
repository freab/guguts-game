import * as THREE from "three/webgpu";
import { SkyMesh } from "three/examples/jsm/objects/SkyMesh.js";

/** Physically based sky settings (Preetham model + SkyMesh's procedural clouds). */
export interface SkyParams {
  /** Unit vector pointing at the sun. */
  sunDirection: THREE.Vector3;
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  cloudCoverage: number;
  cloudDensity: number;
}

function applySkyParams(sky: SkyMesh, p: SkyParams) {
  sky.sunPosition.value.copy(p.sunDirection);
  sky.turbidity.value = p.turbidity;
  sky.rayleigh.value = p.rayleigh;
  sky.mieCoefficient.value = p.mieCoefficient;
  sky.mieDirectionalG.value = p.mieDirectionalG;
  sky.cloudCoverage.value = p.cloudCoverage;
  sky.cloudDensity.value = p.cloudDensity;
}

/**
 * Owns the visible sky and the image-based lighting derived from it.
 *
 * `sky` is three's WebGPU SkyMesh (a TSL port of the Preetham atmospheric
 * scattering sky, with sun disc and procedural clouds); it pins itself to the
 * far plane, so its scale doesn't matter. A second SkyMesh with the sun disc
 * hidden (the sun is a real directional light, so its disc would double-count
 * as a blinding hotspot in the IBL) is rendered by a PMREMGenerator into a
 * prefiltered environment map. Physically based materials then take their
 * ambient light and reflections from the same sky you see.
 */
export class SkyController {
  readonly sky = new SkyMesh();
  private readonly envSky = new SkyMesh();
  private readonly envScene = new THREE.Scene();
  private readonly pmrem: THREE.PMREMGenerator;
  private target: THREE.RenderTarget | null = null;

  constructor(renderer: THREE.WebGPURenderer) {
    this.sky.scale.setScalar(10000);
    this.envSky.scale.setScalar(10000);
    this.envSky.showSunDisc.value = 0;
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }

  update(params: SkyParams) {
    applySkyParams(this.sky, params);
    applySkyParams(this.envSky, params);
  }

  /**
   * Re-render the sky into the environment map (reusing one render target) and
   * return its texture. Only needed when the sun or sky settings change.
   */
  bakeEnvironment(): THREE.Texture {
    this.target = this.pmrem.fromScene(this.envScene, 0, 0.1, 100, {
      size: 256,
      renderTarget: this.target,
    });
    return this.target.texture;
  }

  dispose() {
    this.target?.dispose();
    this.pmrem.dispose();
    for (const s of [this.sky, this.envSky]) {
      s.geometry.dispose();
      s.material.dispose();
    }
  }
}
