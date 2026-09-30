"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Stats } from "@react-three/drei";
import { Leva, useControls, button, folder } from "leva";
import type { ViewMode } from "../character/CameraRig";
import { useDefaultsVersion } from "../hooks/useDefaultsVersion";
import { useHashRoute } from "../hooks/useHashRoute";
import { LEVELS, type Level, type LevelId } from "../maze/levels";
import { regenerateMaze, setMazeConfig } from "../maze/mazeData";
import { audio } from "../audio/audioEngine";
import LoadingOverlay from "../ui/LoadingOverlay";
import MusicToggle from "../ui/MusicToggle";
import Minimap from "../ui/Minimap";
import PerfReadout from "../ui/PerfReadout";
import TouchControls, { useIsTouch } from "../ui/TouchControls";
import { setLoading, useLoading } from "./bake/loadingStore";

const VIEWS: { id: ViewMode; label: string }[] = [
  { id: "first", label: "First person" },
  { id: "third", label: "Third person" },
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
  // leva only ever applies a default value on a fresh load, so a page that has
  // been open across an edit keeps rendering the old ones (see the hook): this
  // reloads it once, here on the title screen rather than mid-bake.
  useDefaultsVersion();

  // Bumping runId remounts the scene (fresh maze / new dimensions).
  const [runId, setRunId] = useState(0);
  const [view, setView] = useState<ViewMode>("first");
  // null = on the title screen, choosing a level (no scene mounted).
  const [level, setLevel] = useState<LevelId | null>(null);
  const ready = useLoading().stage === "ready" && level !== null;
  // The game shows no UI over the view. The dev/debug UI — leva controls,
  // minimap, FPS meter, view / maze buttons and the key hints — lives on the
  // `/#debug` route (toggles live when the hash changes).
  const debug = useHashRoute("debug");
  // Phones and tablets get on-screen controls (stick, look drag, view button).
  const touch = useIsTouch();

  // The ambience plays only once the game is running — after the preloader
  // has gone — and fades out when leaving for the level chooser.
  useEffect(() => {
    audio.setActive(ready);
  }, [ready]);

  // Browsers only allow audio after a user gesture: set it up on the first
  // click or key press anywhere (picking a level, clicking into the game…).
  useEffect(() => {
    const unlock = () => audio.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // Fetch the scene's code and models while the player reads the story, so
  // picking a level starts loading from a warm cache.
  useEffect(() => {
    void import("./Scene");
  }, []);

  // V toggles first / third person; M toggles the music.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || isTyping(e.target)) return;
      if (e.code === "KeyV") setView((v) => (v === "first" ? "third" : "first"));
      else if (e.code === "KeyM") audio.toggleMusic();
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

  // Leva: minimap toggle, maze-size controls (set by the level, tweakable
  // after), and a regenerate button.
  const easy = LEVELS[0];
  const [{ minimap, width, height, corridor }, setGame] = useControls("Game", () => ({
    minimap: { value: true, label: "Show minimap" },
    Size: folder({
      width: { value: easy.cellsW, min: 4, max: 40, step: 1, label: "Width (cells)" },
      height: { value: easy.cellsH, min: 4, max: 40, step: 1, label: "Height (cells)" },
      corridor: { value: easy.cell, min: 1.5, max: 6, step: 0.5, label: "Corridor width" },
    }),
    "New maze": button(() => restart()),
  }));

  // The maze size currently built (mazeData starts at the Easy size).
  const applied = useRef({ w: easy.cellsW, h: easy.cellsH, c: easy.cell });

  // Title screen: build the chosen level's maze, then mount the scene.
  const chooseLevel = (next: Level) => {
    applied.current = { w: next.cellsW, h: next.cellsH, c: next.cell };
    setMazeConfig({ cellsW: next.cellsW, cellsH: next.cellsH, cell: next.cell });
    setGame({ width: next.cellsW, height: next.cellsH, corridor: next.cell }); // keep leva in sync
    setLoading({ stage: "assets", bakeProgress: 0 });
    setRunId((n) => n + 1);
    setLevel(next.id);
  };

  // Manual maze-size changes in leva: reconfigure + regenerate, then remount.
  // Skipped when the values already match the built maze (e.g. just synced
  // from a level pick).
  useEffect(() => {
    const a = applied.current;
    if (width === a.w && height === a.h && corridor === a.c) return;
    applied.current = { w: width, h: height, c: corridor };
    setMazeConfig({ cellsW: width, cellsH: height, cell: corridor });
    setLoading({ stage: "assets", bakeProgress: 0 }); // preloader runs again
    setRunId((n) => n + 1);
  }, [width, height, corridor]);

  return (
    <div className="relative h-full w-full">
      {/* Leva control panel (collapsed by default, top-right): #debug only,
          and hidden while the preloader is up (it shows just the story). */}
      <Leva collapsed hidden={!ready || !debug} titleBar={{ title: "Controls" }} />

      {debug && (
        <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
          <div className="flex gap-1 rounded-full bg-black/50 p-1 backdrop-blur">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                className={`whitespace-nowrap rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                  view === v.id ? "bg-white text-black" : "text-zinc-300 hover:bg-white/10"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setLevel(null)}
            className="whitespace-nowrap rounded-full bg-black/50 px-3 py-1.5 text-sm font-medium text-zinc-200 backdrop-blur transition-colors hover:bg-white/10"
          >
            {LEVELS.find((l) => l.id === level)?.label ?? "Level"} · Change
          </button>
          <button
            onClick={restart}
            className="whitespace-nowrap rounded-full bg-black/50 px-3 py-1.5 text-sm font-medium text-zinc-200 backdrop-blur transition-colors hover:bg-white/10"
          >
            New maze
          </button>
        </div>
      )}

      {/* Controls hint. */}
      {debug && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-lg bg-black/50 px-3 py-2 text-xs leading-5 text-zinc-300 backdrop-blur">
          <div>
            <b className="text-zinc-100">Click</b> to look around · <b className="text-zinc-100">Esc</b> to release
          </div>
          <div>
            <b className="text-zinc-100">WASD / Arrows</b> move · <b className="text-zinc-100">Shift</b> run ·{" "}
            <b className="text-zinc-100">V</b> switch view · <b className="text-zinc-100">Scroll</b> zoom
          </div>
        </div>
      )}

      {/* Perf panel (FPS / ms), under the view buttons, while playing. It lives
          out here rather than in the Canvas so it's reliably removed from
          <body> when the scene unmounts. Draw calls + triangles: Controls → Perf. */}
      {ready && debug && <Stats className="top-14! left-3!" />}
      {ready && debug && <PerfReadout className="absolute bottom-3 left-3 z-10" />}

      {/* The game: mounted once a level is picked; remounted on restart / resize. */}
      {level && debug && minimap && <Minimap key={`minimap-${runId}`} />}
      {level && <Scene key={`scene-${runId}`} view={view} />}

      {/* Touch controls, while playing on a touch device. */}
      {ready && touch && (
        <TouchControls onToggleView={() => setView((v) => (v === "first" ? "third" : "first"))} />
      )}

      {/* Title screen (story + level chooser), then the preloader: covers
          everything until assets, bakes, shaders and post-processing are ready. */}
      <LoadingOverlay choosing={level === null} onChoose={chooseLevel} />

      {/* Music on / off — always shown (above the title screen too); below the
          leva panel on #debug. */}
      <MusicToggle className={`absolute right-3 z-[60] ${debug ? "top-14" : "top-3"}`} />
    </div>
  );
}
