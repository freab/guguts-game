"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, extend, useFrame, useThree } from "@react-three/fiber";
import { KeyboardControls } from "@react-three/drei";
import { useControls, folder, monitor, button } from "leva";
import * as THREE from "three/webgpu";
import PlayerController, { KEYBOARD_MAP } from "../character/PlayerController";
import Goat from "../maze/Goat";
import CoffeeBush from "../maze/CoffeeBush";
import Temesgen from "../maze/Temesgen";
import WaterBottles from "../maze/WaterBottles";
import Birds from "./atmosphere/Birds";
import Particles from "./atmosphere/Particles";
import Maze from "../maze/Maze";
import { CELL, COLS, ROWS } from "../maze/mazeData";
import LightmapBaker from "./bake/LightmapBaker";
import { allBakesSettled, nextFrames } from "./bake/bakeTracker";
import { setLightmapStrength } from "./bake/lightmap";
import { setLoading, useLoading } from "./bake/loadingStore";
import { audio } from "../audio/audioEngine";
import PostEffects from "./post/PostEffects";
import GpuProfiler from "./perf/GpuProfiler";
import { requestProfile } from "./perf/perfStore";
import Flowers from "./Flowers";
import MapleTree from "./MapleTree";
import MazeGround from "./MazeGround";
import Footsteps from "../audio/Footsteps";
import GoalWatcher from "../game/GoalWatcher";
import GoatVoice from "../game/GoatVoice";
import Vines from "./Vines";
import Grass from "./Grass";
import InfiniteGrid from "./InfiniteGrid";
import SkyEnvironment from "./SkyEnvironment";
import { setSun as setSunUniforms } from "./sunUniforms";
import { SHADOW_ONLY_LAYER } from "./layers";
import { tier } from "../quality";

// Register the three/webgpu class catalog with R3F's JSX reconciler so every
// <mesh>/<meshLambertMaterial>/etc. uses the same classes the WebGPURenderer
// understands (avoids duplicate-module identity issues between three builds).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
extend(THREE as any);

const TONE_MAPPINGS = {
  ACES: THREE.ACESFilmicToneMapping,
  AgX: THREE.AgXToneMapping,
  Neutral: THREE.NeutralToneMapping,
  Reinhard: THREE.ReinhardToneMapping,
  Cineon: THREE.CineonToneMapping,
  None: THREE.NoToneMapping,
} as const;
type ToneMappingName = keyof typeof TONE_MAPPINGS;

// Live render stats for the leva "Perf" monitors. Module-level so the monitors
// keep reading the same objects when the scene remounts (New maze / resize).
const perfCalls = { current: 0 };
const perfTris = { current: 0 };

/** Copies the renderer's per-frame draw calls / triangles into the monitors. */
function PerfProbe() {
  useFrame(({ gl }) => {
    const info = (
      gl as unknown as {
        info: { render: { drawCalls?: number; calls?: number; triangles: number } };
      }
    ).info.render;
    perfCalls.current = info.drawCalls ?? info.calls ?? 0;
    perfTris.current = info.triangles;
  });
  return null;
}

const SHADOW_MAP_SIZE = 2048;

/**
 * Aim the sun at the maze centre, size its shadow camera to cover the whole
 * maze from any sun direction (half-diagonal + margin), and render the shadow
 * map once: only the walls cast, and they never move. The character uses a
 * blob shadow instead, so nothing dynamic needs the map re-rendered.
 */
function bakeShadows(light: THREE.DirectionalLight, direction: THREE.Vector3) {
  const half = ((Math.max(COLS, ROWS) * CELL) / 2) * Math.SQRT2 + 2;
  const distance = half * 2 + 20;
  light.position.copy(direction).multiplyScalar(distance);
  light.target.position.set(0, 0, 0);
  light.target.updateMatrixWorld();

  const cam = light.shadow.camera;
  cam.left = -half;
  cam.right = half;
  cam.top = half;
  cam.bottom = -half;
  cam.near = 1;
  cam.far = distance * 2;
  cam.updateProjectionMatrix();
  // Also the full copies of things culled in the view (every wall: WallBatch).
  cam.layers.enable(SHADOW_ONLY_LAYER);

  light.shadow.autoUpdate = false;
  light.shadow.needsUpdate = true;
}

/**
 * The sun, with a baked shadow map: rendered once when the scene mounts (the
 * scene remounts on New maze / resize) and again only if the sun direction
 * changes — no shadow pass in the per-frame cost at all.
 */
function SunLight({
  direction,
  intensity,
  color,
  onLight,
}: {
  direction: THREE.Vector3;
  intensity: number;
  color: string;
  /** Receives the light object (the godrays pass needs it). */
  onLight: (light: THREE.DirectionalLight | null) => void;
}) {
  const light = useRef<THREE.DirectionalLight | null>(null);
  const setLight = useCallback(
    (l: THREE.DirectionalLight | null) => {
      light.current = l;
      onLight(l);
    },
    [onLight]
  );
  useEffect(() => {
    if (light.current) bakeShadows(light.current, direction);
  }, [direction]);
  return (
    <directionalLight
      ref={setLight}
      intensity={intensity}
      color={color}
      castShadow
      shadow-mapSize={[SHADOW_MAP_SIZE, SHADOW_MAP_SIZE]}
      shadow-bias={-0.0004}
      shadow-normalBias={0.02}
    />
  );
}

/**
 * The preloader's driver. It sits in the same Suspense boundary as everything
 * else, so it mounts only once every asset has loaded. Then, in order:
 * wait for all bakes (lightmap, sky, light probe; the first frames render the
 * baked shadow map) → precompile every shader pipeline → switch on
 * post-processing (it needs the shadow map) and let it render a few frames →
 * "ready", which fades the loading screen out.
 */
function Readiness({ onPostReady }: { onPostReady: () => void }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    let cancelled = false;
    const started = performance.now();
    (async () => {
      setLoading({ stage: "baking" });
      await nextFrames(3); // bake effects register; shadow map renders once
      const t0 = performance.now();
      await allBakesSettled();
      const t1 = performance.now();
      if (cancelled) return;

      setLoading({ stage: "compiling" });
      await (gl as unknown as THREE.WebGPURenderer).compileAsync(scene, camera);
      const t2 = performance.now();
      if (cancelled) return;

      setLoading({ stage: "warming" });
      onPostReady();
      await nextFrames(6); // post-processing compiles + first frames
      await audio.preloadSong(); // (started at the level pick; usually done by now)
      if (!cancelled) {
        setLoading({ stage: "ready" });
        console.info(
          `[gugut] ready in ${Math.round(performance.now() - started)} ms ` +
            `(bakes ${Math.round(t1 - t0)} · shader compile ${Math.round(t2 - t1)} · ` +
            `post warm-up ${Math.round(performance.now() - t2)})`
        );
      }
    })().catch((err) => {
      console.warn("[gugut] preload step failed, showing scene anyway:", err);
      if (!cancelled) setLoading({ stage: "ready" });
    });
    return () => {
      cancelled = true;
    };
  }, [gl, scene, camera, onPostReady]);

  return null;
}

function applyToneMapping(gl: THREE.WebGPURenderer, mode: THREE.ToneMapping, exposure: number) {
  gl.toneMapping = mode;
  gl.toneMappingExposure = exposure;
}

function applyCameraFar(camera: THREE.Camera, far: number) {
  const cam = camera as THREE.PerspectiveCamera;
  cam.far = far;
  cam.updateProjectionMatrix();
}

/**
 * The draw-distance cut: the camera's far plane sits just past the end of the
 * view-distance fog, so nothing further away is rasterised at all (the GPU
 * clips it) and nothing pops — it is already fully fogged by then. The sky is
 * unaffected: both the baked background and the live SkyMesh pin themselves
 * to the far plane.
 */
function CameraFar({ far }: { far: number }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => applyCameraFar(camera, far), [camera, far]);
  return null;
}

/**
 * Pauses rendering while the preloader burns away over the scene (see
 * loadingStore `sceneHeld`): the last frame stays on screen and the burn gets
 * the GPU to itself. Every useFrame clamps its delta, so nothing jumps after.
 */
function HoldWhileRevealing() {
  const held = useLoading().sceneHeld;
  const setFrameloop = useThree((s) => s.setFrameloop);
  useEffect(() => setFrameloop(held ? "never" : "always"), [held, setFrameloop]);
  return null;
}

/** Tone mapping operator + exposure from leva. */
function ToneMapping({ mode, exposure }: { mode: THREE.ToneMapping; exposure: number }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    applyToneMapping(gl as unknown as THREE.WebGPURenderer, mode, exposure);
    invalidate();
  }, [gl, mode, exposure, invalidate]);
  return null;
}

/**
 * The maze on WebGPU — sky with clouds, grid ground, walls, footpath and grass —
 * explored by a playable character in first- or third-person view.
 *
 * Performance setup — bake everything that doesn't depend on the view:
 * - Sun shadow map (walls only; the character has a blob shadow), the sky
 *   (cube background) and sky light probe: baked, re-baked only when the sun /
 *   sky change. The ground lightmap bakes wall shadows + AO for the floor,
 *   footpath and grass; walls get analytic base AO.
 * - View-dependent effects (godrays, bloom, vignette) run live; godrays at
 *   reduced resolution, raymarching the baked shadow map.
 * - A preloader reveals the scene only after assets, bakes, shader compilation
 *   and post-processing warm-up are done.
 * - Pixel ratio capped at 1.5; walls are one instanced draw call; grass is
 *   chunked, distance / frustum / occlusion culled and LOD'd.
 */
export default function Scene() {

  // Leva: lighting, sun & sky, environment, tone mapping, perf readouts.
  //
  // Look: a summer sunset. A very low (7°) sun behind the maple as seen from
  // the start corner (azimuth 47°), in a deep blue sky (Rayleigh 4, no Mie
  // haze) with soft clouds, so the crown is backlit and strong, warm-brown god
  // rays rake through it and down the corridors, even looking away from the
  // sun. Cineon tone mapping, and only a faint sky-light fill (0.1), so the
  // walls keep their lit/shadow contrast rather than flattening to white.
  //
  // Editing a number here changes nothing in a page that is already open — leva
  // keeps each control's current value. Bump DEFAULTS_VERSION in
  // hooks/useDefaultsVersion.ts when one of these defaults changes.
  const {
    ambient,
    ambientColor,
    directional,
    sunColor,
    hemisphere,
    skyFill,
    groundFill,
    elevation,
    azimuth,
    turbidity,
    rayleigh,
    mieCoefficient,
    mieDirectionalG,
    clouds,
    cloudDensity,
    skyBrightness,
    liveClouds,
    bakedShadow,
    bakedAO,
    skyLight,
    skyLightIntensity,
    toneMapping,
    exposure,
    fogEnabled,
    viewDistance,
    fogStart,
  } = useControls({
    Lighting: folder(
      {
        ambient: { value: 0.2, min: 0, max: 3, step: 0.05 },
        ambientColor: { value: "#ffd2a6", label: "ambient colour" },
        directional: { value: 3.2, min: 0, max: 6, step: 0.05, label: "sun" },
        sunColor: { value: "#ffc27a", label: "sun colour" },
        hemisphere: { value: 0.8, min: 0, max: 3, step: 0.05 },
        skyFill: { value: "#8d9fd8", label: "sky fill" },
        groundFill: { value: "#7a5434", label: "ground fill" },
      },
      { collapsed: true }
    ),
    "Sun & Sky": folder(
      {
        elevation: { value: 7, min: 1, max: 89, step: 0.5, label: "Sun elevation°" },
        azimuth: { value: 47, min: 0, max: 360, step: 1, label: "Sun azimuth°" },
        turbidity: { value: 3, min: 1, max: 20, step: 0.1, label: "Turbidity" },
        rayleigh: { value: 4, min: 0, max: 4, step: 0.05, label: "Rayleigh" },
        mieCoefficient: { value: 0, min: 0, max: 0.1, step: 0.001, label: "Mie coeff." },
        mieDirectionalG: { value: 0.89, min: 0, max: 0.999, step: 0.01, label: "Mie direct. G" },
        clouds: { value: 0.49, min: 0, max: 1, step: 0.01, label: "Cloud cover" },
        cloudDensity: { value: 1, min: 0, max: 1, step: 0.01, label: "Cloud density" },
        skyBrightness: { value: 0.55, min: 0.1, max: 1.5, step: 0.05, label: "Sky brightness" },
        liveClouds: { value: false, label: "Live clouds (costly)" },
      },
      { collapsed: true }
    ),
    "Baked lighting": folder(
      {
        bakedShadow: { value: 0.3, min: 0, max: 1, step: 0.05, label: "Shadow strength" },
        bakedAO: { value: 0.45, min: 0, max: 1, step: 0.05, label: "AO strength" },
      },
      { collapsed: true }
    ),
    Environment: folder(
      {
        skyLight: { value: true, label: "Sky light" },
        skyLightIntensity: { value: 0.1, min: 0, max: 2, step: 0.05, label: "Intensity" },
      },
      { collapsed: true }
    ),
    "Tone mapping": folder(
      {
        toneMapping: {
          value: "Cineon" as ToneMappingName,
          options: Object.keys(TONE_MAPPINGS) as ToneMappingName[],
          label: "Operator",
        },
        exposure: { value: 1, min: 0.1, max: 3, step: 0.01, label: "Exposure" },
      },
      { collapsed: true }
    ),
    // One circle for everything: the world fades into the sky colour from
    // `fogStart × viewDistance` out to `viewDistance`, where the camera's far
    // plane cuts it off; grass, flowers and the tree are CPU-culled at the same
    // distance (see SkyController.fogNode and CameraFar).
    View: folder(
      {
        fogEnabled: { value: true, label: "Fog" },
        // (Phones: a little shorter — fewer chunks of grass, ivy and walls drawn.)
        viewDistance: { value: tier(15, 12), min: 5, max: 80, step: 1, label: "View distance" },
        fogStart: { value: 0.4, min: 0, max: 0.95, step: 0.05, label: "Fog start" },
      },
      { collapsed: true }
    ),
    Perf: folder(
      {
        "Draw calls": monitor(perfCalls, { graph: false, interval: 300 }),
        Triangles: monitor(perfTris, { graph: false, interval: 300 }),
        // Switches each feature off in turn and times the frame (stand still).
        "Profile frame": button(() => requestProfile()),
      },
      { collapsed: true }
    ),
  });

  // Post-processing. Godrays read the baked shadow map, so they need no shadow
  // re-render; they still depend on the view, so they run live (at reduced
  // resolution) — as do bloom and vignette.
  const post = useControls({
    "Post-processing": folder(
      {
        postEnabled: { value: true, label: "Enabled" },
        // Multisampling of the scene pass (geometric edges; alpha-tested foliage
        // edges are not smoothed by it).
        msaa: { value: tier(4, 2), options: { Off: 0, "2×": 2, "4×": 4 }, label: "MSAA" },
        godrays: { value: true, label: "God rays" },
        // Density is per 100 m of lit air; our rays cross ~10–30 m, so it needs
        // to be high to show. Falloff dims rays far from the light (node default 2).
        raysDensity: { value: 13, min: 0, max: 20, step: 0.1, label: "Rays density" },
        raysMaxDensity: { value: 0.4, min: 0, max: 1, step: 0.01, label: "Rays max" },
        raysFalloff: { value: 0.5, min: 0, max: 3, step: 0.05, label: "Rays falloff" },
        // The view distance keeps the rays' march short, so fewer steps do.
        // (Phones: a quarter-resolution, shorter march — the rays stay.)
        raysSteps: { value: tier(40, 24), min: 8, max: 120, step: 1, label: "Rays steps" },
        raysResolution: {
          value: tier(0.5, 0.25),
          options: { Quarter: 0.25, Half: 0.5, Full: 1 },
          label: "Rays resolution",
        },
        raysColor: { value: "#896f4a", label: "Rays colour" },
        raysAway: { value: 0.83, min: 0, max: 1, step: 0.01, label: "Rays away from sun" },
        bloom: { value: true, label: "Bloom" },
        bloomStrength: { value: 0.35, min: 0, max: 2, step: 0.05, label: "Bloom strength" },
        bloomRadius: { value: 0.4, min: 0, max: 1, step: 0.05, label: "Bloom radius" },
        bloomThreshold: { value: 0.9, min: 0, max: 2, step: 0.01, label: "Bloom threshold" },
        flare: { value: tier(true, false), label: "Lens flare" },
        flareStrength: { value: 0.6, min: 0, max: 2, step: 0.05, label: "Flare strength" },
        vignette: { value: true, label: "Vignette" },
        vignetteStrength: { value: 0.4, min: 0, max: 1, step: 0.05, label: "Vignette strength" },
      },
      { collapsed: true }
    ),
  });
  const postToggles = useMemo(
    () => ({
      bloom: post.bloom,
      godrays: post.godrays,
      vignette: post.vignette,
      flare: post.flare,
      raysResolution: post.raysResolution,
      msaa: post.msaa,
    }),
    [post.bloom, post.godrays, post.vignette, post.raysResolution, post.msaa, post.flare]
  );
  const postParams = useMemo(
    () => ({
      bloomStrength: post.bloomStrength,
      bloomRadius: post.bloomRadius,
      bloomThreshold: post.bloomThreshold,
      raysDensity: post.raysDensity,
      raysMaxDensity: post.raysMaxDensity,
      raysFalloff: post.raysFalloff,
      raysSteps: post.raysSteps,
      raysColor: post.raysColor,
      raysAway: post.raysAway,
      vignetteStrength: post.vignetteStrength,
      flareStrength: post.flareStrength,
    }),
    [
      post.bloomStrength,
      post.bloomRadius,
      post.bloomThreshold,
      post.raysDensity,
      post.raysMaxDensity,
      post.raysFalloff,
      post.raysSteps,
      post.raysColor,
      post.raysAway,
      post.vignetteStrength,
      post.flareStrength,
    ]
  );

  useEffect(() => {
    setLightmapStrength(bakedShadow, bakedAO);
  }, [bakedShadow, bakedAO]);

  // The sun light object (for godrays) and whether post may switch on yet —
  // the preloader enables it once the baked shadow map exists.
  const [sun, setSun] = useState<THREE.DirectionalLight | null>(null);
  const [postReady, setPostReady] = useState(false);
  const enablePost = useCallback(() => setPostReady(true), []);

  // Footpath down the middle of every corridor: the grass worn down to the
  // forest floor beneath (the ground texture — see MazeGround).
  const { footpath, pathWidth, pathGrass } = useControls("Game", {
    Footpath: folder(
      {
        footpath: { value: true, label: "Footpath" },
        pathWidth: { value: 0.45, min: 0.1, max: 1.2, step: 0.05, label: "Half-width" },
        pathGrass: { value: 0.15, min: 0, max: 1, step: 0.05, label: "Grass on path" },
      },
      { collapsed: true }
    ),
  });

  const viewFog = useMemo(
    () => ({ near: viewDistance * fogStart, far: viewDistance }),
    [viewDistance, fogStart]
  );

  // One sun direction drives the sky, the sun light and its shadows.
  const sunDirection = useMemo(
    () =>
      new THREE.Vector3().setFromSphericalCoords(
        1,
        THREE.MathUtils.degToRad(90 - elevation),
        THREE.MathUtils.degToRad(azimuth)
      ),
    [elevation, azimuth]
  );
  // …and the materials that react to the sun directly (sunUniforms).
  useEffect(() => setSunUniforms(sunDirection, sunColor), [sunDirection, sunColor]);

  const skyParams = useMemo(
    () => ({
      sunDirection,
      turbidity,
      rayleigh,
      mieCoefficient,
      mieDirectionalG,
      cloudCoverage: clouds,
      cloudDensity,
      brightness: skyBrightness,
    }),
    [sunDirection, turbidity, rayleigh, mieCoefficient, mieDirectionalG, clouds, cloudDensity, skyBrightness]
  );

  return (
    <KeyboardControls map={KEYBOARD_MAP}>
    <Canvas
      // A live, animated character: render every frame.
      frameloop="always"
      // The player's camera rig positions this every frame.
      camera={{ position: [0, 24, 34], fov: 55, near: 0.05 }}
      // PCF shadows (WebGPU dropped PCFSoft, R3F's default, and warns about it).
      shadows="percentage"
      // Cap the pixel ratio: on a 2–3x HiDPI display this is a big fillrate win.
      // Phones get the same cap — at 1 their 2–3x screens showed the scene
      // stretched from a third of their resolution, visibly pixelated.
      dpr={[1, 1.5]}
      // Force the WebGPU renderer. forceWebGL:false = use the WebGPU backend when
      // the browser supports it; init() is async, so R3F awaits the promise.
      gl={async (props) => {
        const renderer = new THREE.WebGPURenderer({
          ...(props as object),
          antialias: true,
          forceWebGL: false,
          powerPreference: "high-performance",
          // GPU timer queries, for the #debug frame readout / profiler only.
          trackTimestamp: window.location.hash === "#debug",
        });
        await renderer.init();
        const backend = renderer.backend as { isWebGPUBackend?: boolean };
        console.log(
          "[gugut] renderer backend:",
          backend?.isWebGPUBackend ? "WebGPU" : "WebGL"
        );
        return renderer;
      }}
    >
      <PerfProbe />
      <GpuProfiler />
      <ToneMapping mode={TONE_MAPPINGS[toneMapping]} exposure={exposure} />
      <HoldWhileRevealing />

      {/* One Suspense boundary for the whole world: nothing shows until every
          asset has loaded, then Readiness runs the bake / compile / warm-up
          stages behind the loading screen. */}
      <Suspense fallback={null}>
        {/* Physically based sky (baked to a cube) + the sky light probe. */}
        <SkyEnvironment
          params={skyParams}
          skyLight={skyLight ? skyLightIntensity : 0}
          liveClouds={liveClouds}
          fog={fogEnabled ? viewFog : null}
        />
        {/* Fog off: no fog, no draw-distance cut, the tree visible from anywhere. */}
        <CameraFar far={fogEnabled ? viewDistance * 1.03 + 0.5 : 1000} />

        <ambientLight intensity={ambient} color={ambientColor} />
        <hemisphereLight args={[skyFill, groundFill, hemisphere]} />
        <SunLight direction={sunDirection} intensity={directional} color={sunColor} onLight={setSun} />
        <LightmapBaker sunDirection={sunDirection} />

        <InfiniteGrid />
        <MazeGround />
        <Maze drawDistance={fogEnabled ? viewDistance * 1.03 + 0.5 : Infinity} />
        <Vines viewDistance={fogEnabled ? viewDistance : Infinity} />
        <Goat />
        <CoffeeBush />
        <Temesgen />
        <Particles />
        <Birds />
        <MapleTree viewDistance={fogEnabled ? viewDistance : Infinity} />
        <Grass pathWidth={footpath ? pathWidth : 0} pathGrass={pathGrass} drawDistance={viewDistance} />
        <Flowers pathWidth={footpath ? pathWidth : 0} maxDistance={fogEnabled ? viewDistance : Infinity} />
        <PlayerController />
        {/* After the player: a bottle being drunk is held in front of the camera
            the controller has just placed. */}
        <WaterBottles />
        <Footsteps />
        <GoalWatcher />
        <GoatVoice />

        <Readiness onPostReady={enablePost} />
      </Suspense>

      {post.postEnabled && postReady && sun && (
        <PostEffects light={sun} toggles={postToggles} params={postParams} />
      )}
    </Canvas>
    </KeyboardControls>
  );
}
