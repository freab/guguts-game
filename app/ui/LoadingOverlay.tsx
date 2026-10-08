"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { preload } from "react-dom";
import { useProgress } from "@react-three/drei";
import { posterFont } from "../fonts";
import { LEVELS, type Level } from "../maze/levels";
import { useLoading, type LoadingStage } from "../scene/bake/loadingStore";
import DissolveCanvas from "./DissolveCanvas";

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

/** Soft shadow so the cream lettering holds up over bright sky. */
const SHADOW = "[text-shadow:0_2px_14px_rgba(20,16,8,0.45)]";

const STORY = [
  "They say it began with Kaldi, a goatherd of the old highlands, whose goats danced all night after eating the red berries of a strange bush.",
  "This morning, Gugut's goat found that same bush.",
  "Wild-eyed and bleating, she bolted past the old stones and into the maze, the walled labyrinth no one enters after dark.",
  "Take up your staff. Follow the worn path. Bring her home before the sun goes down.",
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

/** Easy / Medium / Hard: a glass card with a PLAY pill on hover / focus. */
function LevelChooser({ onChoose }: { onChoose: (level: Level) => void }) {
  return (
    <div className="w-[min(24rem,85vw)] md:w-[clamp(18rem,22vw,26rem)]">
      <h2 className={`mb-[2vh] pl-6 text-[clamp(1.6rem,min(2.6vw,5.5vh),2.8rem)] leading-none text-[#fdf3d4]/85 ${SHADOW}`}>
        Choose your path
      </h2>
      <div className="flex flex-col gap-[1.5vh]">
        {LEVELS.map((level) => (
          <button
            key={level.id}
            onClick={() => onChoose(level)}
            className="group flex items-end justify-between gap-4 rounded-2xl border border-transparent px-6 py-[1.6vh] text-left transition-[background-color,border-color] duration-300 hover:border-white/50 hover:bg-white/20 hover:backdrop-blur-sm focus-visible:border-white/50 focus-visible:bg-white/20 focus-visible:backdrop-blur-sm focus-visible:outline-none"
          >
            <span className={SHADOW}>
              <span className="block text-[clamp(2rem,min(3.4vw,7vh),3.6rem)] leading-none">{level.label}</span>
              <span className="mt-1 block text-[clamp(0.85rem,min(1vw,2.2vh),1.15rem)] leading-tight text-[#fdf3d4]/70">
                {level.blurb}
              </span>
            </span>
            <span className="flex shrink-0 translate-x-1 items-center gap-2 rounded-full bg-[#c9a45c] py-1.5 pr-1.5 pl-4 text-[clamp(1.1rem,min(1.4vw,3vh),1.5rem)] leading-none text-[#2a2312] opacity-0 transition-[opacity,translate] duration-300 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100">
              PLAY
              <svg viewBox="0 0 24 24" aria-hidden className="size-[1.3em]">
                <circle cx="12" cy="12" r="12" fill="#fdf3d4" />
                <path d="M9.5 7.5v9l7-4.5z" fill="#c9a45c" />
              </svg>
            </span>
          </button>
        ))}
      </div>
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
      className={`absolute top-[12vh] right-6 left-6 space-y-[2.2vh] text-[clamp(1.25rem,min(1.9vw,4.4vh),2.2rem)] leading-[1.25] tracking-wide text-[#fdf3d4] md:top-[18vh] md:right-[13vw] md:left-[41.5vw] ${SHADOW}`}
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
 * maze entrance, "GUGUT & THE GOAT" on the right and the level chooser on the
 * left. Picking a level burns that image away in a noise dissolve, revealing
 * the sky over the maze, where the story is written and the percentage counts
 * up. It covers the scene (blocking input) until everything is loaded, baked,
 * compiled and warmed up; at 100 the counter becomes an Enter button, and the
 * overlay fades out once the player presses it (`entered`).
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
  const onDissolved = () => {
    setDissolveDone(true);
    if (!picked) return;
    setPicked(null);
    onChoose(picked);
  };
  const pick = (level: Level) => {
    if (picked) return;
    onPick();
    setDissolveDone(false);
    setPicked(level);
  };
  const titleShown = choosing && !picked;
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
      <DissolveCanvas fromSrc={TITLE_SRC} toSrc={STORY_SRC} dissolved={!titleShown} onDissolved={onDissolved} />

      {/* Title screen: chooser left, title right (stacked on portrait phones). */}
      <div
        className={`absolute inset-0 flex flex-col-reverse items-center justify-between px-6 py-[6vh] transition-opacity duration-500 md:flex-row md:px-[8vw] md:py-0 ${
          titleShown ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <LevelChooser onChoose={pick} />
        <h1 className={`text-center leading-[0.82] ${SHADOW}`}>
          <span className="block text-[clamp(4.5rem,min(10vw,20vh),11rem)]">GUGUT</span>
          <span className="block text-[clamp(2rem,min(4vw,8vh),4.4rem)]">&amp; THE GOAT</span>
        </h1>
      </div>

      {/* Preloader: the story and the counter (then Enter), once the dissolve
          has finished. */}
      {!choosing && dissolveDone && <Preloader key={runId} onEnter={onEnter} />}
    </div>
  );
}
