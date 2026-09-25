"use client";

import { Suspense } from "react";
import { Canvas, extend } from "@react-three/fiber";
import { OrbitControls, Stats } from "@react-three/drei";
import { useControls, folder } from "leva";
import * as THREE from "three/webgpu";
import Maze from "../maze/Maze";
import SkyEnvironment from "./SkyEnvironment";

// Register the three/webgpu class catalog with R3F's JSX reconciler so every
// <mesh>/<meshStandardMaterial>/etc. uses the same classes the WebGPURenderer
// understands (avoids duplicate-module identity issues between three builds).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
extend(THREE as any);

/**
 * Free-navigation viewer running on WebGPU. Sky + maze, flown around with
 * OrbitControls. The renderer is three's WebGPURenderer (forced on — it uses the
 * WebGPU backend where available). Standard materials + instancing auto-convert
 * to node materials; the sky is a plain vertex-coloured mesh (no GLSL). drei's
 * <Stats> shows FPS/ms.
 */
export default function Scene() {
  // Leva: live lighting controls (grouped under a "Lighting" folder).
  const { ambient, directional, hemisphere } = useControls({
    Lighting: folder(
      {
        ambient: { value: 0.55, min: 0, max: 3, step: 0.05 },
        directional: { value: 1.8, min: 0, max: 5, step: 0.05 },
        hemisphere: { value: 0.6, min: 0, max: 3, step: 0.05 },
      },
      { collapsed: true }
    ),
  });

  return (
    <Canvas
      camera={{ position: [0, 24, 34], fov: 50 }}
      shadows
      // Cap the pixel ratio: on a 2–3x HiDPI display this is a big fillrate win.
      dpr={[1, 1.75]}
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
      {/* Perf panel (FPS / ms), top-left. */}
      <Stats />

      {/* Fallback clear colour behind the gradient sky. */}
      <color attach="background" args={["#8cb6e8"]} />
      <SkyEnvironment />
      <ambientLight intensity={ambient} />
      <hemisphereLight args={["#bcd4ff", "#5a5442", hemisphere]} />
      <directionalLight
        position={[40, 32, 40]}
        intensity={directional}
        color="#fff4e0"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-near={1}
        shadow-camera-far={140}
        shadow-camera-left={-24}
        shadow-camera-right={24}
        shadow-camera-top={24}
        shadow-camera-bottom={-24}
      />

      <Suspense fallback={null}>
        <Maze />
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
