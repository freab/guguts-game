import * as THREE from "three/webgpu";
import {
  cameraPosition,
  cubeTexture,
  fog,
  max,
  normalize,
  positionWorld,
  rangeFogFactor,
  uniform,
  vec3,
  vec4,
  vertexStage,
} from "three/tsl";
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

/** Band-0 SH basis constant: a uniform radiance L has coefficient 0 = L / Y00. */
const SH_Y00 = 0.282095;

/** The sky colour behind this vertex: the view ray, lifted to at least the horizon. */
function skyBehind(cube: THREE.CubeTexture) {
  const view = normalize(positionWorld.sub(cameraPosition));
  return cubeTexture(cube, normalize(vec3(view.x, max(view.y, 0.03), view.z))).rgb;
}

/**
 * Rescale a baked sky probe to an average radiance of 1 (keeping its colour
 * and its sky-above / ground-below gradient). The sky shader's raw output is
 * far brighter than the rest of the scene's lighting (it is meant to be tone
 * mapped as a backdrop), so an unnormalised probe at "intensity 0.6" still
 * flooded every surface with directionless light: walls clipped flat white and
 * bloom smeared the white over everything. Normalised, the probe's intensity
 * is simply "how much sky fill", on the same scale as the other lights.
 */
function normalizeProbe(sh: THREE.SphericalHarmonics3): void {
  const c = sh.coefficients[0];
  const luminance = (0.2126 * c.x + 0.7152 * c.y + 0.0722 * c.z) * SH_Y00;
  if (luminance <= 1e-6) return;
  sh.scale(1 / luminance);
}

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
 * spherical harmonics (normalised — see normalizeProbe). Unlike an environment
 * map, a probe lights Lambert materials too, so every surface picks up
 * sky-coloured ambient light.
 *
 * Baked background: a third SkyMesh is rendered once into a cube texture used
 * as `scene.background`, so the per-pixel sky + cloud shader doesn't run every
 * frame (the clouds hold still). `sky` is only for the optional live clouds.
 *
 * View-distance fog (`fogNode`): objects fade into the colour of the sky
 * right behind them, so the world ends at the view distance without a visible
 * fog wall and the sky above stays clear. See fogNode below.
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

  private readonly fogNear = uniform(6);
  private readonly fogFar = uniform(15);

  /**
   * Distance fog in the colour of the sky behind each object — atmospheric fog
   * / aerial perspective. The colour comes from the probe cube (sun disc
   * hidden, so a wall in front of the sun doesn't turn white-hot), scaled by
   * the same brightness as the visible sky, looked up along the view ray with
   * the ray lifted to the horizon (objects dissolve into the horizon colour,
   * not into the sky's dark underside). The lookup runs per vertex (a varying)
   * rather than per fragment: the colour changes slowly across a surface, and
   * the grass has heavy overdraw. The factor is linear in view depth between
   * near and far, matching the camera's far-plane cut at `far`.
   * Assign to `scene.fogNode`.
   */
  readonly fogNode = fog(
    vertexStage(skyBehind(this.cubeTarget.texture).mul(this.brightness)),
    rangeFogFactor(this.fogNear, this.fogFar)
  );

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

  /** Fog starts at `near` and is total at `far` (view depth, metres). */
  setFogRange(near: number, far: number) {
    this.fogNear.value = near;
    this.fogFar.value = far;
  }

  setProbeIntensity(intensity: number) {
    this.probe.intensity = intensity;
  }

  /**
   * Re-capture the sky into the light probe. Async (GPU readback); resolves
   * true once applied, or false if a newer bake superseded it or the scene
   * unmounted meanwhile (e.g. back to the level chooser mid-load).
   */
  async bakeProbe(renderer: THREE.WebGPURenderer): Promise<boolean> {
    if (this.disposed) return false;
    const id = ++this.bakeId;
    this.cubeCamera.update(renderer, this.envScene);
    let baked: THREE.LightProbe;
    try {
      baked = await LightProbeGenerator.fromCubeRenderTarget(renderer, this.cubeTarget);
    } catch (err) {
      // The readback spans several frames; disposal midway breaks it.
      if (this.disposed) return false;
      throw err;
    }
    if (this.disposed || id !== this.bakeId) return false;
    this.probe.sh.copy(baked.sh);
    normalizeProbe(this.probe.sh);
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
