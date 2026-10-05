"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Stats } from "@react-three/drei";
import { Leva, useControls, button, folder } from "leva";
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
import GameOver from "../ui/GameOver";
import LeaderboardDialog from "../ui/LeaderboardDialog";
import RunTimer from "../ui/RunTimer";
import SettingsDialog from "../ui/SettingsDialog";
import { runStore, useRun } from "../game/runStore";
import ControlsHelp, { controlsSeen } from "../ui/ControlsHelp";
import PauseMenu from "../ui/PauseMenu";
import RotatePrompt from "../ui/RotatePrompt";
import CallButton from "../ui/CallButton";
import CallMap from "../ui/CallMap";
import GameNotice from "../ui/GameNotice";
import BleatIndicator from "../ui/BleatIndicator";
import { getPreferences } from "../game/preferences";
import { enterFullscreen, exitFullscreen, fullscreenSupported, useIsFullscreen, useIsPortrait } from "../ui/fullscreen";
import { setLoading, useLoading } from "./bake/loadingStore";

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
  // null = on the title screen, choosing a level (no scene mounted).
  const [level, setLevel] = useState<LevelId | null>(null);
  const ready = useLoading().stage === "ready" && level !== null;
  // The game shows no UI over the view. The dev/debug UI — leva controls,
  // minimap, FPS meter, view / maze buttons and the key hints — lives on the
  // `/#debug` route (toggles live when the hash changes).
  const debug = useHashRoute("debug");
  // Phones and tablets get on-screen controls (stick, look drag, view button).
  const touch = useIsTouch();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const closeBoard = useCallback(() => setBoardOpen(false), []);
  // Pause menu, controls help, and the phone "turn sideways" prompt.
  const run = useRun();
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpDismissed, setHelpDismissed] = useState(false);
  const [rotateDismissed, setRotateDismissed] = useState(false);
  const closeHelp = useCallback(() => {
    setHelpOpen(false);
    setHelpDismissed(true); // (the auto-shown help isn't driven by helpOpen)
  }, []);
  const portrait = useIsPortrait();
  const fullscreen = useIsFullscreen();
  const canFullscreen = useSyncExternalStore(noSubscribe, fullscreenSupported, () => false);
  const playing = ready && (run.phase === "armed" || run.phase === "running");
  // The controls are shown on the first run on this device (then from the menu).
  const showHelp = helpOpen || (playing && run.phase === "armed" && !helpDismissed && !controlsSeen());

  // Pause when the game loses the mouse (Esc while it's captured: the browser
  // swallows the key and just releases the mouse) or the tab is left.
  useEffect(() => {
    const pauseIfPlaying = () => {
      const { phase } = runStore.get();
      if ((phase === "armed" || phase === "running") && !runStore.isPaused()) setMenuOpen(true);
    };
    const onLock = () => {
      if (!document.pointerLockElement) pauseIfPlaying();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") pauseIfPlaying();
    };
    document.addEventListener("pointerlockchange", onLock);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("pointerlockchange", onLock);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  /** Back to the game: close the menu and (on desktop) capture the mouse again. */
  const resume = () => {
    setMenuOpen(false);
    if (touch) return;
    const canvas = [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    void canvas?.requestPointerLock()?.catch?.(() => {});
  };

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

  // M toggles the music; C (or the key set in Settings) calls the goat;
  // Esc / P pause.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || isTyping(e.target)) return;
      if (e.code === "KeyM") audio.toggleMusic();
      else if (e.code === getPreferences().callKey && !runStore.isPaused()) runStore.callGoat();
      else if ((e.code === "Escape" || e.code === "KeyP") && !e.defaultPrevented) {
        // (A dialog or the controls help handles its own Esc and marks it.)
        const { phase } = runStore.get();
        if (phase !== "armed" && phase !== "running") return;
        setMenuOpen((open) => (open ? false : !runStore.isPaused()));
      }
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

  // A run starts once the level's scene is ready (the clock itself waits for
  // the first step — game/runStore). Only the level's own maze is ranked: a
  // size changed in #debug isn't.
  useEffect(() => {
    if (!ready || !level) {
      runStore.reset();
      return;
    }
    const preset = LEVELS.find((l) => l.id === level)!;
    const a = applied.current;
    runStore.arm(level, a.w === preset.cellsW && a.h === preset.cellsH && a.c === preset.cell);
  }, [ready, level, runId]);

  // Title screen: build the chosen level's maze, then mount the scene.
  const chooseLevel = (next: Level) => {
    // Phones: fullscreen and landscape, while this tap still counts as a gesture.
    if (touch) void enterFullscreen(true);
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
            <b className="text-zinc-100">WASD / Arrows</b> move · <b className="text-zinc-100">Shift</b> run
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
      {level && <Scene key={`scene-${runId}`} />}

      {/* Touch controls, while playing on a touch device. */}
      {ready && touch && <TouchControls />}

      {/* Title screen (story + level chooser), then the preloader: covers
          everything until assets, bakes, shaders and post-processing are ready. */}
      <LoadingOverlay choosing={level === null} onChoose={chooseLevel} />

      {/* The run: its clock, and the finish screen when you reach the goat. */}
      {ready && <RunTimer />}
      {ready && <GameNotice />}
      {ready && <BleatIndicator />}

      {/* Calling the goat (also its key and the pause menu), and the map it
          flashes. On phones the button sits bottom right, under the thumb. */}
      {playing && (
        <div className={`absolute left-3 flex flex-col items-start gap-2 ${debug ? "top-28" : "top-3"}`}>
          {!touch && <CallButton showKey />}
          {run.calledAt > 0 && <CallMap key={`${runId}-${run.calledAt}`} />}
        </div>
      )}
      {playing && touch && <CallButton showKey={false} large className="absolute bottom-8 right-6" />}
      {ready && (
        <GameOver
          onPlayAgain={restart}
          onChangeLevel={() => setLevel(null)}
          onChangeName={() => setSettingsOpen(true)}
        />
      )}

      {/* Leaderboard, settings and music — always shown (above the title
          screen too); below the leva panel on #debug. */}
      <div className={`absolute right-3 z-[60] flex items-center gap-2 ${debug ? "top-14" : "top-3"}`}>
        {playing && (
          <IconButton label="Pause (Esc)" onClick={() => setMenuOpen(true)}>
            <path d="M9 5v14M15 5v14" />
          </IconButton>
        )}
        {canFullscreen && (
          <IconButton
            label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            onClick={() => void (fullscreen ? exitFullscreen() : enterFullscreen(touch))}
          >
            {fullscreen ? (
              <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
            ) : (
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
            )}
          </IconButton>
        )}
        <IconButton label="Leaderboard" onClick={() => setBoardOpen(true)}>
          <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" />
        </IconButton>
        <IconButton label="Settings" onClick={() => setSettingsOpen(true)}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
        </IconButton>
        <MusicToggle />
      </div>

      {menuOpen && ready && (
        <PauseMenu
          onResume={resume}
          onCallGoat={() => {
            resume();
            runStore.callGoat();
          }}
          onRestart={() => {
            setMenuOpen(false);
            restart();
          }}
          onControls={() => setHelpOpen(true)}
          onLeaderboard={() => setBoardOpen(true)}
          onSettings={() => setSettingsOpen(true)}
          onChangeLevel={() => {
            setMenuOpen(false);
            setLevel(null);
          }}
        />
      )}
      {showHelp && <ControlsHelp touch={touch} onClose={closeHelp} />}
      {ready && touch && portrait && !rotateDismissed && run.phase !== "won" && (
        <RotatePrompt onDismiss={() => setRotateDismissed(true)} />
      )}
      {settingsOpen && <SettingsDialog onClose={closeSettings} />}
      {boardOpen && <LeaderboardDialog initial={level ?? "easy"} onClose={closeBoard} />}
    </div>
  );
}

const noSubscribe = () => () => {};

/** A round icon button for the top-right cluster. */
function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-zinc-100 backdrop-blur transition-colors hover:bg-white/15"
    >
      <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  );
}
