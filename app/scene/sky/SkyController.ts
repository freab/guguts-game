import * as THREE from "three/webgpu";
import { uniform, vec4 } from "three/tsl";
import { SkyMesh } from "three/examples/jsm/objects/SkyMesh.js";
import { LightProbeGenerator } from "three/examples/jsm/lights/LightProbeGenerator.js";

/** Live sky settings (Preetham scattering + SkyMesh's procedural clouds). */
export interface SkyParams {
  /** Unit vector pointing at the sun. */
  sunDirection: THREE.Vector3;
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  cloudCoverage: number;
  cloudDensity: number;
  /** Scales only the visible sky's colour. */
  brightness: number;
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

/** Resolution of the cube the sky is captured into for the light probe. */
const PROBE_CUBE_SIZE = 32;
/** Resolution (per face) of the baked sky background. */
const BACKGROUND_CUBE_SIZE = 768;

/**
 * Owns the visible sky and the ambient "sky light" derived from it.
 *
 * `sky` is three's WebGPU SkyMesh (a TSL Preetham sky with sun disc and
 * procedural clouds); it pins itself to the far plane, so its scale doesn't
 * matter. SkyMesh is tuned for an exposure of ~0.5, so its colour is scaled by a
 * `brightness` uniform rather than dimming the whole scene.
 *
 * The environment is a LightProbe: a second SkyMesh (sun disc hidden — the sun
 * is already a directional light) is rendered into a small cube and reduced to
 * spherical harmonics. Unlike an environment map, a probe lights Lambert
 * materials too, so every surface picks up sky-coloured ambient light.
 *
 * Baked background: a third SkyMesh is rendered once into a cube texture used
 * as `scene.background`, so the per-pixel sky + cloud shader doesn't run every
 * frame (the clouds hold still). `sky` is only for the optional live clouds.
 */
export class SkyController {
  readonly sky = new SkyMesh();
  readonly probe = new THREE.LightProbe();

  private readonly brightness = uniform(0.5);
  private readonly envSky = new SkyMesh();
  private readonly envScene = new THREE.Scene();
  private readonly cubeTarget = new THREE.CubeRenderTarget(PROBE_CUBE_SIZE, {
    type: THREE.HalfFloatType,
  });
  private readonly cubeCamera = new THREE.CubeCamera(0.1, 100, this.cubeTarget);

  private readonly bgSky = new SkyMesh();
  private readonly bgScene = new THREE.Scene();
  private readonly bgTarget = new THREE.CubeRenderTarget(BACKGROUND_CUBE_SIZE, {
    type: THREE.HalfFloatType,
  });
  private readonly bgCamera = new THREE.CubeCamera(0.1, 100, this.bgTarget);

  private bakeId = 0;
  private disposed = false;

  constructor() {
    for (const s of [this.sky, this.bgSky]) {
      s.scale.setScalar(10000);
      // SkyMesh's colorNode is a vec4 (sky rgb, alpha 1); the type is a wider union.
      const base = s.material.colorNode as ReturnType<typeof vec4>;
      s.material.colorNode = vec4(base.rgb.mul(this.brightness), 1);
    }
    this.bgScene.add(this.bgSky);

    this.envSky.scale.setScalar(10000);
    this.envSky.showSunDisc.value = 0;
    this.envScene.add(this.envSky);
  }

  update(params: SkyParams) {
    applySkyParams(this.sky, params);
    applySkyParams(this.bgSky, params);
    applySkyParams(this.envSky, params);
    this.brightness.value = params.brightness;
  }

  /** Render the sky (sun disc and clouds included) into the background cube. */
  bakeBackground(renderer: THREE.WebGPURenderer): THREE.Texture {
    this.bgCamera.update(renderer, this.bgScene);
    return this.bgTarget.texture;
  }

  setProbeIntensity(intensity: number) {
    this.probe.intensity = intensity;
  }

  /**
   * Re-capture the sky into the light probe. Async (GPU readback); resolves
   * true once applied, or false if a newer bake superseded it.
   */
  async bakeProbe(renderer: THREE.WebGPURenderer): Promise<boolean> {
    const id = ++this.bakeId;
    this.cubeCamera.update(renderer, this.envScene);
    const baked = await LightProbeGenerator.fromCubeRenderTarget(renderer, this.cubeTarget);
    if (this.disposed || id !== this.bakeId) return false;
    this.probe.sh.copy(baked.sh);
    return true;
  }

  dispose() {
    this.disposed = true;
    this.cubeTarget.dispose();
    this.bgTarget.dispose();
    for (const s of [this.sky, this.envSky, this.bgSky]) {
      s.geometry.dispose();
      s.material.dispose();
    }
  }
}
