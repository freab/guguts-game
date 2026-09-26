"use client";

import { Suspense, useEffect, useMemo, useRef, type RefObject } from "react";
import { Canvas, extend, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Stats } from "@react-three/drei";
import { useControls, folder, monitor } from "leva";
import * as THREE from "three/webgpu";
import Maze from "../maze/Maze";
import Footpath from "./Footpath";
import Grass from "./Grass";
import InfiniteGrid from "./InfiniteGrid";
import SkyEnvironment from "./SkyEnvironment";

// Register the three/webgpu class catalog with R3F's JSX reconciler so every
// <mesh>/<meshLambertMaterial>/etc. uses the same classes the WebGPURenderer
// understands (avoids duplicate-module identity issues between three builds).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
extend(THREE as any);

/** Sun light distance from the maze centre (|[40, 32, 40]|, the original spot). */
const SUN_DISTANCE = Math.hypot(40, 32, 40);

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

/** Render a light's shadow map on the next frame, then never again. */
function bakeShadowOnce(light: THREE.DirectionalLight) {
  light.shadow.autoUpdate = false;
  light.shadow.needsUpdate = true;
}

/**
 * Bake the sun's shadow map once per sun position. The walls never move (grass
 * and the footpath don't cast), so re-rendering the shadow pass every frame is
 * wasted work. The scene also remounts on New maze / resize, which re-bakes.
 */
function BakeShadows({
  light,
  sunDirection,
}: {
  light: RefObject<THREE.DirectionalLight | null>;
  sunDirection: THREE.Vector3;
}) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (light.current) bakeShadowOnce(light.current);
    invalidate();
  }, [light, sunDirection, invalidate]);
  return null;
}

function applyToneMapping(gl: THREE.WebGPURenderer, mode: THREE.ToneMapping, exposure: number) {
  gl.toneMapping = mode;
  gl.toneMappingExposure = exposure;
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
 * Free-navigation viewer running on WebGPU: sky with clouds, maze and
 * FluffyGrass-style grass inside the maze, flown around with OrbitControls.
 *
 * Performance setup:
 * - frameloop="demand": frames render only when something changes (camera,
 *   controls, the grass wind clock), so an idle scene costs ~nothing.
 * - Shadow map and sky light baked only when the sun / sky change.
 * - Pixel ratio capped at 1.5.
 * - Walls are one instanced draw call; grass is chunked, culled and LOD'd.
 */
export default function Scene() {
  const sun = useRef<THREE.DirectionalLight>(null);

  // Leva: lighting, sun & sky, environment, tone mapping, perf readouts.
  // Defaults reproduce the original look (sun at [40, 32, 40], ACES @ 1).
  const {
    ambient,
    directional,
    hemisphere,
    elevation,
    azimuth,
    turbidity,
    rayleigh,
    mieCoefficient,
    mieDirectionalG,
    clouds,
    cloudDensity,
    skyBrightness,
    haze,
    skyLight,
    skyLightIntensity,
    toneMapping,
    exposure,
  } = useControls({
    Lighting: folder(
      {
        ambient: { value: 0.55, min: 0, max: 3, step: 0.05 },
        directional: { value: 1.8, min: 0, max: 5, step: 0.05 },
        hemisphere: { value: 0.6, min: 0, max: 3, step: 0.05 },
      },
      { collapsed: true }
    ),
    "Sun & Sky": folder(
      {
        elevation: { value: 29.5, min: 1, max: 89, step: 0.5, label: "Sun elevation°" },
        azimuth: { value: 45, min: 0, max: 360, step: 1, label: "Sun azimuth°" },
        turbidity: { value: 2.5, min: 1, max: 20, step: 0.1, label: "Turbidity" },
        rayleigh: { value: 1.2, min: 0, max: 4, step: 0.05, label: "Rayleigh" },
        mieCoefficient: { value: 0.005, min: 0, max: 0.1, step: 0.001, label: "Mie coeff." },
        mieDirectionalG: { value: 0.8, min: 0, max: 0.999, step: 0.01, label: "Mie direct. G" },
        clouds: { value: 0.35, min: 0, max: 1, step: 0.01, label: "Cloud cover" },
        cloudDensity: { value: 0.5, min: 0, max: 1, step: 0.01, label: "Cloud density" },
        skyBrightness: { value: 0.5, min: 0.1, max: 1.5, step: 0.05, label: "Sky brightness" },
        haze: { value: 0, min: 0, max: 0.03, step: 0.001, label: "Haze" },
      },
      { collapsed: true }
    ),
    Environment: folder(
      {
        skyLight: { value: true, label: "Sky light" },
        skyLightIntensity: { value: 0.6, min: 0, max: 3, step: 0.05, label: "Intensity" },
      },
      { collapsed: true }
    ),
    "Tone mapping": folder(
      {
        toneMapping: {
          value: "ACES" as ToneMappingName,
          options: Object.keys(TONE_MAPPINGS) as ToneMappingName[],
          label: "Operator",
        },
        exposure: { value: 1, min: 0.1, max: 3, step: 0.01, label: "Exposure" },
      },
      { collapsed: true }
    ),
    Perf: folder(
      {
        "Draw calls": monitor(perfCalls, { graph: false, interval: 300 }),
        Triangles: monitor(perfTris, { graph: false, interval: 300 }),
      },
      { collapsed: true }
    ),
  });

  // Footpath down the middle of every corridor: worn-down grass + dirt strip.
  const { footpath, pathWidth, pathGrass, dirt } = useControls("Game", {
    Footpath: folder(
      {
        footpath: { value: true, label: "Footpath" },
        pathWidth: { value: 0.45, min: 0.1, max: 1.2, step: 0.05, label: "Half-width" },
        pathGrass: { value: 0.15, min: 0, max: 1, step: 0.05, label: "Grass on path" },
        dirt: { value: true, label: "Dirt" },
      },
      { collapsed: true }
    ),
  });

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
  const sunPosition = useMemo(
    () => sunDirection.clone().multiplyScalar(SUN_DISTANCE),
    [sunDirection]
  );

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
    <Canvas
      frameloop="demand"
      camera={{ position: [0, 24, 34], fov: 50 }}
      // PCF shadows (WebGPU dropped PCFSoft, R3F's default, and warns about it).
      shadows="percentage"
      // Cap the pixel ratio: on a 2–3x HiDPI display this is a big fillrate win.
      dpr={[1, 1.5]}
      // Force the WebGPU renderer. forceWebGL:false = use the WebGPU backend when
      // the browser supports it; init() is async, so R3F awaits the promise.
      gl={async (props) => {
        const renderer = new THREE.WebGPURenderer({
          ...(props as object),
          antialias: true,
          forceWebGL: false,
          powerPreference: "high-performance",
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
      {/* Perf panel (FPS / ms), top-left. Draw calls + triangles: Controls → Perf. */}
      <Stats />
      <PerfProbe />
      <ToneMapping mode={TONE_MAPPINGS[toneMapping]} exposure={exposure} />

      {/* Physically based sky with clouds + the ambient sky light baked from it. */}
      <SkyEnvironment params={skyParams} skyLight={skyLight ? skyLightIntensity : 0} />
      {haze > 0 && <fogExp2 attach="fog" args={["#c3d3e3", haze]} />}

      <ambientLight intensity={ambient} />
      <hemisphereLight args={["#bcd4ff", "#5a5442", hemisphere]} />
      <directionalLight
        ref={sun}
        position={sunPosition}
        intensity={directional}
        color="#fff4e0"
        castShadow
        // Baked only when the sun moves, so a sharp 2048² map costs ~nothing.
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={1}
        shadow-camera-far={140}
        shadow-camera-left={-24}
        shadow-camera-right={24}
        shadow-camera-top={24}
        shadow-camera-bottom={-24}
      />
      <BakeShadows light={sun} sunDirection={sunDirection} />

      {/* Walls first and outside the grass Suspense, so they are in place when
          the shadow map is baked (the grass loads its model asynchronously). */}
      <InfiniteGrid />
      <Maze />
      <Footpath halfWidth={pathWidth} visible={footpath && dirt} />
      <Suspense fallback={null}>
        <Grass pathWidth={footpath ? pathWidth : 0} pathGrass={pathGrass} />
      </Suspense>

      <OrbitControls
        makeDefault
        target={[0, 0, 0]}
        enableDamping
        dampingFactor={0.08}
        enablePan
        maxDistance={200}
        maxPolarAngle={Math.PI * 0.495}
      />
    </Canvas>
  );
}
