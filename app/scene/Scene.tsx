"use client";

import { Suspense, useEffect, useMemo, useRef, type RefObject } from "react";
import { Canvas, extend, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Stats } from "@react-three/drei";
import { useControls, folder, monitor } from "leva";
import * as THREE from "three/webgpu";
import Maze from "../maze/Maze";
import { CELL, COLS, ROWS } from "../maze/mazeData";
import Footpath from "./Footpath";
import Grass from "./Grass";
import SkyEnvironment from "./SkyEnvironment";

// Register the three/webgpu class catalog with R3F's JSX reconciler so every
// JSX element uses the same classes the WebGPURenderer understands.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
extend(THREE as any);

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
 * Bake the sun's shadow map once per sun position. Walls are static and grass /
 * footpath don't cast, so re-rendering the shadow pass every frame is waste.
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

const TONE_MAPPINGS = {
  ACES: THREE.ACESFilmicToneMapping,
  AgX: THREE.AgXToneMapping,
  Neutral: THREE.NeutralToneMapping,
} as const;

function applyToneMapping(gl: THREE.WebGPURenderer, mode: THREE.ToneMapping, exposure: number) {
  gl.toneMapping = mode;
  gl.toneMappingExposure = exposure;
}

/** Filmic tone mapping + exposure (the physically based sky is HDR). */
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
 * Free-navigation viewer on WebGPU: physically based sky with sun and clouds,
 * sky-derived image-based lighting, a sun light aligned with the sky's sun,
 * soft baked shadows, and realistic grass inside the maze.
 * Performance: frameloop="demand", shadows + environment baked only when the
 * sun changes, DPR capped at 1.5, instanced walls, chunked/LOD'd grass.
 */
export default function Scene() {
  const sun = useRef<THREE.DirectionalLight>(null);

  const {
    elevation,
    azimuth,
    sunIntensity,
    envIntensity,
    exposure,
    toneMapping,
    turbidity,
    rayleigh,
    clouds,
    cloudDensity,
    haze,
  } = useControls({
    "Sun & Sky": folder(
      {
        elevation: { value: 32, min: 1, max: 89, step: 1, label: "Sun elevation°" },
        azimuth: { value: 45, min: 0, max: 360, step: 1, label: "Sun azimuth°" },
        sunIntensity: { value: 4, min: 0, max: 10, step: 0.1, label: "Sun intensity" },
        envIntensity: { value: 1, min: 0, max: 3, step: 0.05, label: "Sky light" },
        exposure: { value: 0.55, min: 0.1, max: 2, step: 0.01, label: "Exposure" },
        toneMapping: { value: "ACES", options: Object.keys(TONE_MAPPINGS), label: "Tone map" },
        turbidity: { value: 2.5, min: 1, max: 20, step: 0.1, label: "Turbidity" },
        rayleigh: { value: 1.2, min: 0, max: 4, step: 0.05, label: "Rayleigh" },
        clouds: { value: 0.35, min: 0, max: 1, step: 0.01, label: "Cloud cover" },
        cloudDensity: { value: 0.5, min: 0, max: 1, step: 0.01, label: "Cloud density" },
        haze: { value: 0.006, min: 0, max: 0.03, step: 0.001, label: "Haze" },
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

  // One sun direction drives the sky, the light, the shadows and the grass.
  const sunDirection = useMemo(
    () =>
      new THREE.Vector3().setFromSphericalCoords(
        1,
        THREE.MathUtils.degToRad(90 - elevation),
        THREE.MathUtils.degToRad(azimuth)
      ),
    [elevation, azimuth]
  );
  // Low sun: warmer, dimmer light and warmer haze; high sun: white light, blue haze.
  const { sunColor, sunScale, hazeColor } = useMemo(() => {
    const t = THREE.MathUtils.smoothstep(elevation, 2, 40);
    return {
      sunColor: new THREE.Color("#ff9a55").lerp(new THREE.Color("#fff4e6"), t),
      sunScale: 0.3 + 0.7 * t,
      hazeColor: new THREE.Color("#e2b48f").lerp(new THREE.Color("#c3d3e3"), t),
    };
  }, [elevation]);

  const skyParams = useMemo(
    () => ({
      sunDirection,
      turbidity,
      rayleigh,
      mieCoefficient: 0.005,
      mieDirectionalG: 0.8,
      cloudCoverage: clouds,
      cloudDensity,
    }),
    [sunDirection, turbidity, rayleigh, clouds, cloudDensity]
  );

  // Fit the sun's shadow camera to the maze (the scene remounts on resize).
  const half = (Math.max(COLS, ROWS) * CELL) / 2 + 4;
  const sunDistance = half * 2 + 20;
  const sunPosition = useMemo(
    () => sunDirection.clone().multiplyScalar(sunDistance),
    [sunDirection, sunDistance]
  );

  return (
    <Canvas
      frameloop="demand"
      camera={{ position: [0, 24, 34], fov: 50, far: 2000 }}
      // PCF shadows (WebGPU dropped PCFSoft, R3F's default, and warns about it).
      shadows="percentage"
      dpr={[1, 1.5]}
      // Force the WebGPU renderer; init() is async, so R3F awaits the promise.
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
      <ToneMapping
        mode={TONE_MAPPINGS[toneMapping as keyof typeof TONE_MAPPINGS]}
        exposure={exposure}
      />

      {/* Physically based sky; also baked into scene.environment (sky light). */}
      <SkyEnvironment params={skyParams} envIntensity={envIntensity} />
      {haze > 0 && <fogExp2 attach="fog" args={[hazeColor, haze]} />}

      <directionalLight
        ref={sun}
        position={sunPosition}
        intensity={sunIntensity * sunScale}
        color={sunColor}
        castShadow
        // Baked only when the sun moves, so a sharp 2048² map is cheap.
        shadow-mapSize={[2048, 2048]}
        shadow-radius={3}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-camera-near={1}
        shadow-camera-far={sunDistance * 2}
        shadow-camera-left={-half}
        shadow-camera-right={half}
        shadow-camera-top={half}
        shadow-camera-bottom={-half}
      />
      <BakeShadows light={sun} sunDirection={sunDirection} />

      {/* Walls outside the grass Suspense, so they're in place for the bake. */}
      <Maze />
      <Footpath halfWidth={pathWidth} visible={footpath && dirt} />
      <Suspense fallback={null}>
        <Grass
          pathWidth={footpath ? pathWidth : 0}
          pathGrass={pathGrass}
          sunDirection={sunDirection}
          sunColor={sunColor}
        />
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
