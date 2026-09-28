"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import { useProgress } from "@react-three/drei";
import { posterFont } from "../fonts";
import { LEVELS, type Level } from "../maze/levels";
import { useLoading, type LoadingStage } from "../scene/bake/loadingStore";

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

/** Key art (932×1368 portrait). */
const POSTER_SRC = "/GGP (2).png";
/** Full width on phones; about 0.68 × viewport height wide on desktop. */
const POSTER_SIZES = "(min-width: 768px) 45vw, 100vw";

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
 * from 0 each time a level is picked.
 */
function Counter() {
  const { stage, bakeProgress } = useLoading();
  const { progress: assetProgress } = useProgress();
  const target = overallProgress(stage, assetProgress / 100, bakeProgress) * 100;

  const counterRef = useRef<HTMLSpanElement>(null);
  const targetRef = useRef(0);
  useEffect(() => {
    targetRef.current = target;
  }, [target]);
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
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="self-end leading-none text-[#fdf3d4]">
      <span ref={counterRef} className="text-[clamp(5rem,13vw,11rem)] tabular-nums">
        0
      </span>
      <span className="text-[clamp(2rem,5vw,4.5rem)] text-[#fdf3d4]/70">%</span>
    </div>
  );
}

/** Easy / Medium / Hard buttons. */
function LevelChooser({ onChoose }: { onChoose: (level: Level) => void }) {
  return (
    <div className="space-y-4">
      <h2 className="text-[clamp(1.6rem,2.6vw,2.6rem)] leading-none text-[#fdf3d4]/80">Choose your path</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {LEVELS.map((level) => (
          <button
            key={level.id}
            onClick={() => onChoose(level)}
            className="group rounded-2xl border border-[#fdf3d4]/30 px-5 py-4 text-left transition-colors hover:border-[#f6c945] hover:bg-[#f6c945] hover:text-[#0b0d08] focus-visible:border-[#f6c945] focus-visible:outline-none"
          >
            <span className="block text-[clamp(2rem,3.4vw,3.2rem)] leading-none">{level.label}</span>
            <span className="mt-2 block text-base leading-tight text-[#fdf3d4]/60 group-hover:text-[#0b0d08]/75">
              {level.blurb}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Title screen and preloader: the "GUGUT & THE GOAT" poster on the left, the
 * story on the right, in the poster's lettering. While `choosing`, the story
 * is followed by the level chooser; once a level is picked it shows a
 * counting-up percentage and covers the scene (blocking input) until
 * everything is loaded, baked, compiled and warmed up, then fades out.
 */
export default function LoadingOverlay({
  choosing,
  onChoose,
}: {
  choosing: boolean;
  onChoose: (level: Level) => void;
}) {
  const ready = useLoading().stage === "ready";
  const hidden = ready && !choosing;

  return (
    <div
      aria-hidden={hidden}
      className={`${posterFont.className} absolute inset-0 z-50 flex flex-col bg-[#0b0d08] text-[#fdf3d4] transition-opacity duration-1000 md:flex-row ${
        hidden ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      {/* Left: the poster, whole and unzoomed. On wide screens the panel takes
          the poster's own aspect ratio (full height), so nothing is cropped. */}
      <div className="relative h-[38vh] w-full shrink-0 overflow-hidden md:aspect-932/1368 md:h-full md:w-auto md:max-w-[55%]">
        {/* Soft backdrop: the poster itself, blurred, filling any spare space. */}
        <Image
          src={POSTER_SRC}
          alt=""
          aria-hidden
          fill
          sizes={POSTER_SIZES}
          className="scale-110 object-cover opacity-40 blur-2xl"
        />
        <Image
          src={POSTER_SRC}
          alt="Gugut & the Goat"
          fill
          preload
          sizes={POSTER_SIZES}
          className="object-contain object-center"
        />
        {/* Blend the poster's edge into the story panel — only the last
            sliver, so the poster's title stays crisp. */}
        <div className="absolute inset-0 bg-linear-to-b from-transparent from-88% to-[#0b0d08] md:bg-linear-to-r md:from-85%" />
      </div>

      {/* Right: the story, then the level chooser or the counter. */}
      <div className="flex flex-1 flex-col justify-between gap-8 overflow-y-auto px-8 py-8 md:px-14 md:py-16">
        <div className="max-w-2xl space-y-5 text-[clamp(1.35rem,2.1vw,2.1rem)] leading-[1.18] tracking-wide">
          {STORY.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>

        {choosing ? <LevelChooser onChoose={onChoose} /> : <Counter />}
      </div>
    </div>
  );
}
