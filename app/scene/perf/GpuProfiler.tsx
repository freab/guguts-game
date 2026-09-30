"use client";

import { useEffect, useRef } from "react";
import { addAfterEffect, addEffect, useFrame, useThree } from "@react-three/fiber";
import { levaStore } from "leva";
import type * as THREE from "three/webgpu";
import { getPerf, setPerf, type GeometryRow, type ProfileRow } from "./perfStore";

/**
 * The profiling run: a baseline, then each costly feature switched off in
 * turn (through the same leva controls the panel shows), so each one's cost is
 * the difference in frame / GPU time — how studios attribute frame cost when
 * passes can't be timed by name. Stand still while it runs.
 */
const STEPS: { name: string; controls?: [path: string, value: unknown][]; dpr?: number }[] = [
  { name: "Baseline (everything on)" },
  { name: "Post-processing off", controls: [["postEnabled", false]] },
  { name: "God rays off", controls: [["godrays", false]] },
  { name: "Bloom off", controls: [["bloom", false]] },
  { name: "MSAA off", controls: [["msaa", 0]] },
  { name: "God rays at quarter res", controls: [["raysResolution", 0.25]] },
  { name: "Grass off", controls: [["Grass.enabled", false]] },
  { name: "Ivy off", controls: [["Vines.show", false]] },
  { name: "Flowers off", controls: [["Flowers.enabled", false]] },
  { name: "Tree off", controls: [["Tree.show", false]] },
  { name: "Pixel ratio 1.0", dpr: 1 },
];
/** Frames to let a change settle (pipelines rebuild), then frames measured. */
const SETTLE_FRAMES = 45;
const MEASURE_FRAMES = 90;
/** Read the GPU timer every this many frames (reading back is not free). */
const GPU_SAMPLE_EVERY = 5;

/** The leva path whose last segments are `suffix` (e.g. "Grass.enabled"). */
function levaPath(suffix: string): string | undefined {
  return Object.keys(levaStore.getData()).find((k) => k === suffix || k.endsWith(`.${suffix}`));
}

type Renderer = THREE.WebGPURenderer & { backend: { trackTimestamp?: boolean } };

interface CpuTimes {
  start: number;
  render: number;
  updateEma: number;
  renderEma: number;
  updateSum: number;
  renderSum: number;
}

/**
 * Times the main thread every frame into `c`: from before R3F runs any frame
 * callback to after it has rendered, split into three encoding draws (every
 * gl.render, including the post-processing passes) and everything else (our
 * updates). Returns the undo.
 */
function timeMainThread(gl: Renderer, c: CpuTimes) {
  const render = gl.render;
  let depth = 0; // renders nest (the post pipeline renders the scene pass): time the outermost
  gl.render = function (...args: Parameters<typeof render>) {
    const t = depth++ === 0 ? performance.now() : 0;
    try {
      return render.apply(this, args);
    } finally {
      if (--depth === 0) c.render += performance.now() - t;
    }
  };
  const before = addEffect(() => {
    c.start = performance.now();
    c.render = 0;
  });
  const after = addAfterEffect(() => {
    if (!c.start) return;
    const update = performance.now() - c.start - c.render;
    c.updateEma = c.updateEma * 0.9 + update * 0.1;
    c.renderEma = c.renderEma * 0.9 + c.render * 0.1;
    c.updateSum += update;
    c.renderSum += c.render;
  });
  return () => {
    gl.render = render;
    before();
    after();
  };
}

/**
 * Triangles and draw calls per system this frame: every visible mesh, summed
 * under its nearest named ancestor (the systems name their root objects).
 * Counts what is submitted, before the GPU's own clipping.
 */
function geometryBySystem(scene: THREE.Scene): GeometryRow[] {
  const rows = new Map<string, GeometryRow>();
  scene.traverseVisible((o) => {
    const mesh = o as THREE.Mesh & { isInstancedMesh?: boolean; count?: number };
    if (!mesh.isMesh) return;
    const g = mesh.geometry;
    const elements = Math.min(g.index ? g.index.count : (g.attributes.position?.count ?? 0), g.drawRange.count);
    // (Meshes that thin themselves in the shader report what they draw.)
    const instances = mesh.isInstancedMesh
      ? ((mesh.userData.drawnInstances as number | undefined) ?? mesh.count ?? 0)
      : 1;
    if (!instances || !elements) return;
    const perInstance = (mesh.userData.trianglesPerInstance as number | undefined) ?? elements / 3;
    let name = "Other";
    for (let a: THREE.Object3D | null = o; a; a = a.parent) {
      if (a.name) {
        name = a.name;
        break;
      }
    }
    const row = rows.get(name) ?? { name, triangles: 0, draws: 0 };
    row.triangles += perInstance * instances;
    row.draws++;
    rows.set(name, row);
  });
  return [...rows.values()].sort((a, b) => b.triangles - a.triangles);
}

/**
 * Frame and GPU timing for #debug (the renderer is created with
 * `trackTimestamp` only there): a live readout a few times a second, and the
 * profiling run above when requested from the panel. Lives in the Canvas.
 */
export default function GpuProfiler() {
  const gl = useThree((s) => s.gl) as unknown as Renderer;
  const setDpr = useThree((s) => s.setDpr);
  const scene = useThree((s) => s.scene);
  const dpr = useThree((s) => s.viewport.dpr);

  const last = useRef(0);
  const frame = useRef(0);
  const frameEma = useRef(16.7);
  const gpuEma = useRef<number | null>(null);
  const waiters = useRef<{ at: number; resolve: () => void }[]>([]);
  const running = useRef(false);

  const cpu = useRef<CpuTimes>({ start: 0, render: 0, updateEma: 0, renderEma: 0, updateSum: 0, renderSum: 0 });
  useEffect(() => timeMainThread(gl, cpu.current), [gl]);

  const sampleGpu = () => {
    if (!gl.backend.trackTimestamp) return;
    void gl.resolveTimestampsAsync("render").then((ms) => {
      if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return;
      gpuEma.current = gpuEma.current === null ? ms : gpuEma.current * 0.8 + ms * 0.2;
    });
  };

  /** Resolves after `n` more frames. */
  const frames = (n: number) =>
    new Promise<void>((resolve) => waiters.current.push({ at: frame.current + n, resolve }));

  const run = async () => {
    running.current = true;
    const rows: ProfileRow[] = [];
    const startDpr = dpr;
    for (const step of STEPS) {
      setPerf({ step: step.name });
      // Apply this step's changes, remembering what to put back.
      const restore: [string, unknown][] = [];
      for (const [suffix, value] of step.controls ?? []) {
        const path = levaPath(suffix);
        if (!path) continue;
        restore.push([path, levaStore.get(path)]);
        levaStore.setValueAtPath(path, value, true);
      }
      if (step.dpr) setDpr(step.dpr);
      await frames(SETTLE_FRAMES);

      // Measure: frame intervals every frame, GPU time every few frames.
      let frameSum = 0;
      cpu.current.updateSum = 0;
      cpu.current.renderSum = 0;
      const gpuSamples: number[] = [];
      let prev = performance.now();
      for (let i = 0; i < MEASURE_FRAMES; i++) {
        await frames(1);
        const now = performance.now();
        frameSum += now - prev;
        prev = now;
        if (i % GPU_SAMPLE_EVERY === 0 && gl.backend.trackTimestamp) {
          const ms = await gl.resolveTimestampsAsync("render");
          if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) gpuSamples.push(ms);
          prev = performance.now(); // don't count the readback wait
        }
      }
      const frameMs = frameSum / MEASURE_FRAMES;
      rows.push({
        name: step.name,
        fps: 1000 / frameMs,
        frameMs,
        gpuMs: gpuSamples.length ? gpuSamples.reduce((a, b) => a + b, 0) / gpuSamples.length : null,
        updateMs: cpu.current.updateSum / MEASURE_FRAMES,
        renderMs: cpu.current.renderSum / MEASURE_FRAMES,
      });

      // Put it back.
      for (const [path, value] of restore) levaStore.setValueAtPath(path, value, true);
      if (step.dpr) setDpr(startDpr);
      await frames(20);
    }
    console.table(
      rows.map((r) => ({
        step: r.name,
        fps: r.fps.toFixed(1),
        "frame ms": r.frameMs.toFixed(2),
        "GPU ms": r.gpuMs?.toFixed(2) ?? "n/a",
        "update ms": r.updateMs.toFixed(2),
        "render ms": r.renderMs.toFixed(2),
        "saves ms (frame)": (rows[0].frameMs - r.frameMs).toFixed(2),
      }))
    );
    setPerf({ step: null, rows });
    running.current = false;
  };

  useFrame(() => {
    frame.current++;
    const now = performance.now();
    if (last.current) frameEma.current = frameEma.current * 0.9 + (now - last.current) * 0.1;
    last.current = now;

    // Wake any run steps waiting on this frame.
    if (waiters.current.length) {
      const due = waiters.current.filter((w) => w.at <= frame.current);
      waiters.current = waiters.current.filter((w) => w.at > frame.current);
      for (const w of due) w.resolve();
    }

    if (!running.current) {
      if (getPerf().requested) {
        setPerf({ requested: false });
        void run();
      } else if (frame.current % 15 === 0) {
        sampleGpu();
        setPerf({
          frameMs: frameEma.current,
          gpuMs: gpuEma.current,
          updateMs: cpu.current.updateEma,
          renderMs: cpu.current.renderEma,
          geometry: location.hash === "#debug" ? geometryBySystem(scene) : [],
          gpuTiming: !!gl.backend.trackTimestamp,
        });
      }
    }
  });

  return null;
}
