"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Leva, useControls, button, folder } from "leva";
import type { ViewMode } from "../character/CameraRig";
import { regenerateMaze, setMazeConfig } from "../maze/mazeData";
import LoadingOverlay from "../ui/LoadingOverlay";
import Minimap from "../ui/Minimap";
import { setLoading } from "./bake/loadingStore";

const VIEWS: { id: ViewMode; label: string }[] = [
  { id: "third", label: "Third person" },
  { id: "first", label: "First person" },
];

/** True while the user is typing in a field (e.g. a leva number input). */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

// Load the WebGL scene only in the browser. drei's GLTF loader references
// browser-only globals (e.g. ProgressEvent), so it must not run during SSR.
const Scene = dynamic(() => import("./Scene"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-zinc-400">
      Loading scene…
    </div>
  ),
});

export default function SceneClient() {
  // Bumping runId remounts the scene (fresh maze / new dimensions).
  const [runId, setRunId] = useState(0);
  const [view, setView] = useState<ViewMode>("third");

  // V toggles first / third person.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "KeyV" || e.repeat || isTyping(e.target)) return;
      setView((v) => (v === "first" ? "third" : "first"));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // New random maze at the current size.
  const restart = () => {
    regenerateMaze();
    setLoading({ stage: "assets", bakeProgress: 0 }); // preloader runs again
    setRunId((n) => n + 1);
  };

  // Leva: minimap toggle, maze-size controls, and a regenerate button.
  const { minimap, width, height, corridor } = useControls("Game", {
    minimap: { value: true, label: "Show minimap" },
    Size: folder({
      width: { value: 8, min: 4, max: 40, step: 1, label: "Width (cells)" },
      height: { value: 8, min: 4, max: 40, step: 1, label: "Height (cells)" },
      corridor: { value: 2, min: 1.5, max: 6, step: 0.5, label: "Corridor width" },
    }),
    "New maze": button(() => restart()),
  });

  // Apply maze-size changes: reconfigure + regenerate, then remount the scene.
  // Skip the first run — the module already generated a maze at these defaults.
  const firstSize = useRef(true);
  useEffect(() => {
    if (firstSize.current) {
      firstSize.current = false;
      return;
    }
    setMazeConfig({ cellsW: width, cellsH: height, cell: corridor });
    setLoading({ stage: "assets", bakeProgress: 0 }); // preloader runs again
    setRunId((n) => n + 1);
  }, [width, height, corridor]);

  return (
    <div className="relative h-full w-full">
      {/* Leva control panel (collapsed by default, top-right). */}
      <Leva collapsed titleBar={{ title: "Controls" }} />

      <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
        <div className="flex gap-1 rounded-full bg-black/50 p-1 backdrop-blur">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                view === v.id ? "bg-white text-black" : "text-zinc-300 hover:bg-white/10"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <button
          onClick={restart}
          className="rounded-full bg-black/50 px-3 py-1.5 text-sm font-medium text-zinc-200 backdrop-blur transition-colors hover:bg-white/10"
        >
          New maze
        </button>
      </div>

      {/* Controls hint. */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-lg bg-black/50 px-3 py-2 text-xs leading-5 text-zinc-300 backdrop-blur">
        <div>
          <b className="text-zinc-100">Click</b> to look around · <b className="text-zinc-100">Esc</b> to release
        </div>
        <div>
          <b className="text-zinc-100">WASD / Arrows</b> move · <b className="text-zinc-100">Shift</b> run ·{" "}
          <b className="text-zinc-100">V</b> switch view · <b className="text-zinc-100">Scroll</b> zoom
        </div>
      </div>

      {/* Minimap (maze drawn once per maze; remounted with the scene). */}
      {minimap && <Minimap key={`minimap-${runId}`} />}

      {/* Remount the whole scene on restart / resize. */}
      <Scene key={`scene-${runId}`} view={view} />

      {/* Preloader: covers everything until assets, bakes, shaders and
          post-processing are all ready. */}
      <LoadingOverlay />
    </div>
  );
}
