"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { preload } from "react-dom";
import { useProgress } from "@react-three/drei";
import { posterFont } from "../fonts";
import { setPreferences, usePreferences } from "../game/preferences";
import { LEVELS, type Level } from "../maze/levels";
import { defaultGraphics, type Graphics } from "../quality";
import { setLoading, useLoading, type LoadingStage } from "../scene/bake/loadingStore";
import DissolveCanvas, { DISSOLVE_MS, type DissolveStage } from "./DissolveCanvas";

/**
 * How much of the counter each preload stage accounts for (sums to 1).
 * Assets dominate; the rest is baking, shader compilation and warm-up.
 */
const STAGE_WEIGHTS: [Exclude<LoadingStage, "ready">, number][] = [
  ["assets", 0.55],
  ["baking", 0.25],
  ["compiling", 0.15],
  ["warming", 0.05],
];

/** Title screen backdrop (down the maze path), burned away on picking a level. */
const TITLE_SRC = "/preloader/first.webp";
/** Preloader backdrop (up past the tree at the sky), the story is written on it. */
const STORY_SRC = "/preloader/second.webp";

/** The "GUGUT & THE GOAT" wordmark (cream, transparent). */
const LOGO_SRC = "/logo gugut.svg";

/** Soft shadow so the cream lettering holds up over bright sky. */
const SHADOW = "[text-shadow:0_2px_14px_rgba(20,16,8,0.45)]";

const STORY = [
  "Long ago, a goat herder named Kaldi saw his goats dancing all night after they ate some red berries. People still tell that story.",
  "This morning, Gugut's goat found the same berries.",
  "Now she's gone wild. She ran past the old stones and into the maze, the one nobody goes into after dark.",
  "Follow the path. Find her. Bring her home before the sun goes down.",
];

/** Overall 0..1 progress from the current stage and its own progress. */
function overallProgress(stage: LoadingStage, assets: number, bake: number): number {
  if (stage === "ready") return 1;
  let done = 0;
  for (const [id, weight] of STAGE_WEIGHTS) {
    if (id === stage) {
      const within = id === "assets" ? assets : id === "baking" ? bake : 0.5;
      return Math.min(1, done + weight * within);
    }
    done += weight;
  }
  return done;
}

/**
 * The loading percentage. It eases towards the real progress every frame
 * (written straight to the DOM, no re-render per frame), so it counts up
 * smoothly instead of jumping between stages. Mounted per run, so it restarts
 * from 0 each time a level is picked; fades in once the dissolve has run.
 * Calls `onFull` once it shows 100 (only possible at the "ready" stage).
 */
function Counter({ onFull }: { onFull: () => void }) {
  const { stage, bakeProgress } = useLoading();
  const { progress: assetProgress } = useProgress();
  const target = overallProgress(stage, assetProgress / 100, bakeProgress) * 100;

  const counterRef = useRef<HTMLSpanElement>(null);
  const targetRef = useRef(0);
  const onFullRef = useRef(onFull);
  useEffect(() => {
    targetRef.current = target;
    onFullRef.current = onFull;
  }, [target, onFull]);
  useEffect(() => {
    let shown = 0;
    let raf = 0;
    const tick = () => {
      // Never counts down: asset progress dips when a new batch of loaders
      // starts (e.g. the scene's own after the title-screen prefetch).
      const goal = Math.max(targetRef.current, shown);
      shown += (goal - shown) * 0.08;
      if (goal - shown < 0.5) shown = goal;
      if (counterRef.current) counterRef.current.textContent = String(Math.floor(shown));
      if (shown >= 100) {
        onFullRef.current();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      className={`absolute right-[6vw] bottom-[5vh] leading-none text-[#fdf3d4] opacity-0 ${SHADOW}`}
      style={{ animation: `notice-in 700ms ease-out forwards` }}
    >
      <span ref={counterRef} className="text-[clamp(4.5rem,min(11vw,22vh),11rem)] tabular-nums">
        0
      </span>
      <span className="text-[clamp(2rem,min(4.5vw,9vh),4.5rem)] text-[#fdf3d4]/70">%</span>
    </div>
  );
}

/**
 * Replaces the counter at 100: the game waits behind the story until the
 * player has read it and steps in. Focused, so Enter / Space work too.
 */
function EnterButton({ onEnter }: { onEnter: () => void }) {
  return (
    <button
      autoFocus
      onClick={onEnter}
      className="group absolute right-[6vw] bottom-[6vh] flex items-center gap-3 rounded-full bg-[#c9a45c] py-2 pr-2 pl-7 text-[clamp(1.6rem,min(2.6vw,5.5vh),2.8rem)] leading-none text-[#2a2312] opacity-0 shadow-[0_6px_30px_rgba(20,16,8,0.35)] transition-[background-color,scale] duration-300 hover:scale-105 hover:bg-[#d8b46a] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#fdf3d4]"
      style={{ animation: "notice-in 700ms ease-out forwards" }}
    >
      Enter the maze
      <svg viewBox="0 0 24 24" aria-hidden className="size-[1.3em] transition-transform duration-300 group-hover:translate-x-0.5">
        <circle cx="12" cy="12" r="12" fill="#fdf3d4" />
        <path d="M9.5 7.5v9l7-4.5z" fill="#c9a45c" />
      </svg>
    </button>
  );
}

/** The glass card the title screen's choices are made of (PLAY pill on hover / focus — always on touch). */
const CARD =
  "group flex items-end justify-between gap-4 rounded-2xl border border-transparent px-6 py-[1.6vh] text-left transition-[background-color,border-color] duration-300 hover:border-white/50 hover:bg-white/20 hover:backdrop-blur-sm focus-visible:border-white/50 focus-visible:bg-white/20 focus-visible:backdrop-blur-sm focus-visible:outline-none pointer-coarse:border-white/40 pointer-coarse:bg-white/12 pointer-coarse:active:bg-white/25";
const PILL =
  "flex shrink-0 translate-x-1 items-center gap-2 rounded-full bg-[#c9a45c] py-1.5 pr-1.5 pl-4 text-[clamp(1.1rem,min(1.4vw,3vh),1.5rem)] leading-none text-[#2a2312] opacity-0 transition-[opacity,translate] duration-300 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100 pointer-coarse:translate-x-0 pointer-coarse:opacity-100";

/** A choice on the setup step: a glass pill, gold when picked. */
const CHIP =
  "rounded-full border px-[1.1em] py-[0.45em] text-[clamp(1.1rem,min(1.8vw,4.2vh),1.8rem)] leading-none transition-colors duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fdf3d4]";
const CHIP_ON = "border-[#c9a45c] bg-[#c9a45c] text-[#2a2312]";
const CHIP_OFF = "border-white/50 bg-black/30 text-[#fdf3d4] hover:bg-white/20";
const HEADING = `pl-1 text-[clamp(1.4rem,min(2.2vw,5vh),2.4rem)] leading-none text-[#fdf3d4]/85 ${SHADOW}`;
const BLURB = `mt-[1vh] min-h-[2.4em] pl-1 text-[clamp(0.9rem,min(1vw,2.2vh),1.1rem)] leading-tight text-[#fdf3d4]/70 ${SHADOW}`;

const GRAPHICS_OPTIONS: { id: Graphics; label: string; blurb: string }[] = [
  { id: "low", label: "Low", blurb: "Smooth on phones and older laptops" },
  { id: "medium", label: "Medium", blurb: "The full look, balanced for most PCs" },
  { id: "high", label: "High", blurb: "Everything on: more flowers and ivy, sharper light and shadows. For a strong PC" },
];
const VOICE_OPTIONS = [
  { on: true, label: "On", blurb: "Hear Gugut's thoughts as he searches" },
  { on: false, label: "Off", blurb: "Just the maze, the wind and the birds" },
];

const noSubscribe = () => () => {};
/** The device's graphics level when none is chosen (the server can't tell: Medium until hydrated). */
function useDefaultGraphics(): Graphics {
  return useSyncExternalStore(noSubscribe, defaultGraphics, () => "medium");
}

/**
 * First on the title screen: graphics (Low / Medium / High) and Gugut's
 * voiceovers (on / off), both remembered and in Settings too; Continue goes
 * on to the level chooser. Continue is focused, so Enter keeps the choices.
 */
function SetupChooser({ onDone }: { onDone: (graphics: Graphics, voice: boolean) => void }) {
  const prefs = usePreferences();
  const fallback = useDefaultGraphics();
  const [graphics, setGraphics] = useState<Graphics | null>(null);
  const [voice, setVoice] = useState<boolean | null>(null);
  const g = graphics ?? prefs.graphics ?? fallback;
  const v = voice ?? prefs.voice;
  return (
    <div className="w-[min(24rem,88vw)] landscape:w-[clamp(18rem,24vw,28rem)]">
      <h2 className={HEADING}>Graphics</h2>
      <div role="radiogroup" aria-label="Graphics" className="mt-[1.4vh] flex gap-2">
        {GRAPHICS_OPTIONS.map((o) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={o.id === g}
            onClick={() => setGraphics(o.id)}
            className={`${CHIP} ${o.id === g ? CHIP_ON : CHIP_OFF}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className={BLURB}>{GRAPHICS_OPTIONS.find((o) => o.id === g)!.blurb}</p>

      <h2 className={`${HEADING} mt-[2.5vh]`}>Voiceovers</h2>
      <div role="radiogroup" aria-label="Voiceovers" className="mt-[1.4vh] flex gap-2">
        {VOICE_OPTIONS.map((o) => (
          <button
            key={o.label}
            role="radio"
            aria-checked={o.on === v}
            onClick={() => setVoice(o.on)}
            className={`${CHIP} ${o.on === v ? CHIP_ON : CHIP_OFF}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className={BLURB}>{VOICE_OPTIONS.find((o) => o.on === v)!.blurb}</p>

      <button
        autoFocus
        onClick={() => onDone(g, v)}
        className="group mt-[3vh] flex items-center gap-3 rounded-full bg-[#c9a45c] py-1.5 pr-1.5 pl-6 text-[clamp(1.3rem,min(2vw,4.6vh),2.2rem)] leading-none text-[#2a2312] shadow-[0_6px_30px_rgba(20,16,8,0.35)] transition-[background-color,scale] duration-300 hover:scale-105 hover:bg-[#d8b46a] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#fdf3d4]"
      >
        Continue
        <svg viewBox="0 0 24 24" aria-hidden className="size-[1.3em] transition-transform duration-300 group-hover:translate-x-0.5">
          <circle cx="12" cy="12" r="12" fill="#fdf3d4" />
          <path d="M9.5 7.5v9l7-4.5z" fill="#c9a45c" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Easy / Medium / Hard: a glass card with a PLAY pill on hover / focus —
 * shown all the time on touch screens, which have no hover (and no blur
 * there: a backdrop blur is costly on a phone).
 */
function LevelChooser({ onChoose, onSetup }: { onChoose: (level: Level) => void; onSetup: () => void }) {
  const prefs = usePreferences();
  const fallback = useDefaultGraphics();
  const graphics = GRAPHICS_OPTIONS.find((o) => o.id === (prefs.graphics ?? fallback))!;
  return (
    <div className="w-[min(24rem,88vw)] landscape:w-[clamp(18rem,22vw,26rem)]">
      <h2 className={`mb-[2vh] pl-6 text-[clamp(1.6rem,min(2.6vw,5.5vh),2.8rem)] leading-none text-[#fdf3d4]/85 ${SHADOW}`}>
        Choose your path
      </h2>
      <div className="flex flex-col gap-[1.5vh]">
        {LEVELS.map((level) => (
          <button key={level.id} autoFocus={level === LEVELS[0]} onClick={() => onChoose(level)} className={CARD}>
            <span className={SHADOW}>
              <span className="block text-[clamp(2rem,min(3.4vw,7vh),3.6rem)] leading-none">{level.label}</span>
              <span className="mt-1 block text-[clamp(0.95rem,min(1vw,2.2vh),1.15rem)] leading-tight text-[#fdf3d4]/70">
                {level.blurb}
              </span>
            </span>
            <span className={PILL}>
              PLAY
              <svg viewBox="0 0 24 24" aria-hidden className="size-[1.3em]">
                <circle cx="12" cy="12" r="12" fill="#fdf3d4" />
                <path d="M9.5 7.5v9l7-4.5z" fill="#c9a45c" />
              </svg>
            </span>
          </button>
        ))}
      </div>
      <button
        onClick={onSetup}
        className={`mt-[1.5vh] pl-6 text-[clamp(0.95rem,min(1vw,2.2vh),1.15rem)] text-[#fdf3d4]/60 transition-colors hover:text-[#fdf3d4] focus-visible:text-[#fdf3d4] focus-visible:outline-none ${SHADOW}`}
      >
        {graphics.label} graphics · Voice {prefs.voice ? "on" : "off"} ·{" "}
        <span className="underline underline-offset-4">change</span>
      </button>
    </div>
  );
}

/**
 * The story, written onto the second image word by word once the first has
 * burned away. Mounted per run, so it writes itself again each time.
 */
function Story() {
  let word = 0;
  return (
    <div
      className={`absolute right-6 left-6 space-y-[2.2vh] leading-[1.25] tracking-wide text-[#fdf3d4] portrait:top-[40svh] portrait:text-[clamp(1.05rem,4.6vw,1.6rem)] landscape:top-[max(18vh,4.5rem)] landscape:right-[13vw] landscape:left-[41.5vw] landscape:text-[clamp(0.95rem,min(1.9vw,4.4vh),2.2rem)] ${SHADOW}`}
    >
      {STORY.map((line) => (
        <p key={line}>
          {line.split(" ").map((w, i) => (
            <span
              key={i}
              className="inline-block opacity-0"
              style={{ animation: `story-word-in 520ms ease-out ${200 + word++ * 45}ms forwards` }}
            >
              {w}&nbsp;
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}

/** The story, and the counter until it reaches 100, then the Enter button. */
function Preloader({ onEnter }: { onEnter: () => void }) {
  const [full, setFull] = useState(false);
  const onFull = useCallback(() => setFull(true), []);
  return (
    <>
      <Story />
      {full ? <EnterButton onEnter={onEnter} /> : <Counter onFull={onFull} />}
    </>
  );
}

/**
 * Title screen and preloader, over a full-screen canvas. Title screen: the
 * maze entrance, the logo on the right and on the left voiceovers on / off
 * (first, once a visit), then the level chooser. Picking a level burns that image away in a noise dissolve, revealing
 * the sky over the maze, where the story is written and the percentage counts
 * up. It covers the scene (blocking input) until everything is loaded, baked,
 * compiled and warmed up; at 100 the counter becomes an Enter button, and the
 * story image burns away to the scene in the same dissolve when it is pressed
 * (then `entered`).
 */
export default function LoadingOverlay({
  choosing,
  runId,
  entered,
  onPick,
  onChoose,
  onEnter,
}: {
  choosing: boolean;
  /** Changes on every (re)load of the scene: restarts the story and counter. */
  runId: number;
  entered: boolean;
  /** On the tap itself (fullscreen needs the gesture). */
  onPick: () => void;
  /** Once the dissolve has played: applies the level and starts loading. */
  onChoose: (level: Level) => void;
  onEnter: () => void;
}) {
  const hidden = entered && !choosing;
  // The level tapped, held while the dissolve plays: loading only starts
  // after it (onChoose), so the main thread is free and the burn is smooth.
  const [picked, setPicked] = useState<Level | null>(null);
  // The story and counter wait for the burn to finish; reset on each pick.
  const [dissolveDone, setDissolveDone] = useState(false);
  const pick = (level: Level) => {
    if (picked) return;
    onPick();
    setDissolveDone(false);
    setPicked(level);
  };
  const titleShown = choosing && !picked;
  // Graphics and voiceovers: asked first, once a visit (then changed from the
  // chooser's link or Settings). Chosen before a level loads, so the scene is
  // built for the graphics level (SceneClient applies it as a maze starts).
  const [setupDone, setSetupDone] = useState(false);
  const finishSetup = (graphics: Graphics, voice: boolean) => {
    setPreferences({ graphics, voice });
    setSetupDone(true);
  };
  // Enter pressed: the story fades and its image burns away to the scene;
  // the game starts (onEnter) once that burn is done.
  const [leaving, setLeaving] = useState(false);
  const enter = () => {
    setLeaving(true);
    setLoading({ sceneHeld: true }); // the burn gets the GPU to itself
  };
  // (`picked`: a new level burning in — `entered` may still be set from the last game.)
  const stage: DissolveStage = titleShown ? 0 : picked ? 1 : leaving || entered ? 2 : 1;
  const onDissolved = (reached: DissolveStage) => {
    if (reached === 2) {
      if (!leaving) return;
      setLeaving(false);
      setLoading({ sceneHeld: false });
      onEnter();
      return;
    }
    setDissolveDone(true);
    if (!picked) return;
    setPicked(null);
    onChoose(picked);
  };
  // Fetch the preloader image alongside the title one, so the dissolve
  // never waits on it.
  preload(TITLE_SRC, { as: "image", fetchPriority: "high" });
  preload(STORY_SRC, { as: "image" });

  return (
    <div
      aria-hidden={hidden}
      className={`${posterFont.className} absolute inset-0 z-50 overflow-hidden text-[#fdf3d4] transition-opacity duration-1000 ${
        hidden ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      {/* Portrait phones: the wide images can't fill a tall screen without
          being blown up (and soft), so — as the old poster preloader did —
          the image is a band across the top, fading into dark, with the
          words below. The dark fades away with the last burn (Enter). */}
      <div
        className="absolute inset-0 hidden bg-[#0b0d08] transition-opacity ease-in-out portrait:block"
        style={{ opacity: stage === 2 ? 0 : 1, transitionDuration: `${DISSOLVE_MS}ms` }}
      />
      <div className="absolute inset-0 portrait:bottom-auto portrait:h-[46svh]">
        <DissolveCanvas fromSrc={TITLE_SRC} toSrc={STORY_SRC} stage={stage} onDissolved={onDissolved} />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-[35%] bg-linear-to-b from-transparent to-[#0b0d08] transition-opacity ease-in-out portrait:block"
          style={{ opacity: stage === 2 ? 0 : 1, transitionDuration: `${DISSOLVE_MS}ms` }}
        />
      </div>

      {/* Title screen: chooser left, title right (stacked on portrait: the
          title on the image, the chooser below). */}
      <div
        className={`absolute inset-0 flex flex-col-reverse items-center justify-between px-6 py-[6vh] transition-opacity duration-500 portrait:pt-[10svh] landscape:flex-row landscape:px-[8vw] landscape:py-0 ${
          titleShown ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        {/* Keyed, so each step fades in as the other goes. */}
        <div key={setupDone ? "levels" : "setup"} className="opacity-0" style={{ animation: "notice-in 500ms ease-out forwards" }}>
          {setupDone ? (
            <LevelChooser onChoose={pick} onSetup={() => setSetupDone(false)} />
          ) : (
            <SetupChooser onDone={finishSetup} />
          )}
        </div>
        <h1 className="w-[clamp(15rem,min(26vw,48vh),30rem)]">
          <Image
            src={LOGO_SRC}
            alt="Gugut & the Goat"
            width={317}
            height={210}
            preload
            className="h-auto w-full drop-shadow-[0_2px_14px_rgba(20,16,8,0.45)]"
          />
        </h1>
      </div>

      {/* Preloader: the story and the counter (then Enter), once the dissolve
          has finished; fades as Enter's burn starts. */}
      {!choosing && dissolveDone && (
        <div className={`transition-opacity duration-500 ${leaving || entered ? "pointer-events-none opacity-0" : ""}`}>
          <Preloader key={runId} onEnter={enter} />
        </div>
      )}
    </div>
  );
}
