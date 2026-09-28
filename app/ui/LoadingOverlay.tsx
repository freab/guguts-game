"use client";

import { useProgress } from "@react-three/drei";
import { useLoading, type LoadingStage } from "../scene/bake/loadingStore";

const STAGES: { id: Exclude<LoadingStage, "ready">; label: string }[] = [
  { id: "assets", label: "Loading assets" },
  { id: "baking", label: "Baking lighting" },
  { id: "compiling", label: "Compiling shaders" },
  { id: "warming", label: "Warming up effects" },
];

/**
 * Full-screen preloader. It stays up (and blocks input) until the scene reports
 * "ready": assets downloaded → lighting baked → shader pipelines compiled →
 * post-processing warmed up. Then it fades out, so the first thing you see is
 * the finished, hitch-free scene.
 */
export default function LoadingOverlay() {
  const { stage, bakeProgress } = useLoading();
  const { progress: assetProgress } = useProgress();
  const ready = stage === "ready";
  const current = STAGES.findIndex((s) => s.id === stage);

  // Overall bar: each stage is a quarter; assets and baking fill smoothly.
  const within = stage === "assets" ? assetProgress / 100 : stage === "baking" ? bakeProgress : 0.5;
  const overall = ready ? 1 : Math.min(1, (Math.max(current, 0) + within) / STAGES.length);

  return (
    <div
      aria-hidden={ready}
      className={`absolute inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-[#0b0c10] transition-opacity duration-700 ${
        ready ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      <div className="text-2xl font-semibold tracking-wide text-zinc-100">Gugut Maze</div>

      <div className="h-1.5 w-72 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-emerald-400 transition-[width] duration-300"
          style={{ width: `${Math.round(overall * 100)}%` }}
        />
      </div>

      <ul className="w-72 space-y-1 text-sm">
        {STAGES.map((s, i) => {
          const done = ready || i < current;
          const active = i === current && !ready;
          const detail =
            active && s.id === "assets"
              ? ` ${Math.round(assetProgress)}%`
              : active && s.id === "baking"
                ? ` ${Math.round(bakeProgress * 100)}%`
                : "";
          return (
            <li
              key={s.id}
              className={done ? "text-emerald-400" : active ? "text-zinc-100" : "text-zinc-600"}
            >
              {done ? "✓" : active ? "•" : "○"} {s.label}
              {active ? "…" : ""}
              {detail}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
