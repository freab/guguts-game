"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Leva, useControls, button, folder } from "leva";
import { regenerateMaze, setMazeConfig } from "../maze/mazeData";
import Minimap from "../ui/Minimap";

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

  // New random maze at the current size.
  const restart = () => {
    regenerateMaze();
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
    setRunId((n) => n + 1);
  }, [width, height, corridor]);

  return (
    <div className="relative h-full w-full">
      {/* Leva control panel (collapsed by default, top-right). */}
      <Leva collapsed titleBar={{ title: "Controls" }} />

      <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
        <button
          onClick={restart}
          className="rounded-full bg-black/50 px-3 py-1.5 text-sm font-medium text-zinc-200 backdrop-blur transition-colors hover:bg-white/10"
        >
          New maze
        </button>
      </div>

      {/* Minimap */}
      {minimap && <Minimap />}

      {/* Remount the whole scene on restart / resize. */}
      <Scene key={runId} />
    </div>
  );
}
