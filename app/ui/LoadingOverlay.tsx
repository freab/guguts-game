"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import { useProgress } from "@react-three/drei";
import { posterFont } from "../fonts";
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
 * Preloader: the "GUGUT & THE GOAT" poster on the left, the story and a
 * counting-up percentage on the right, in the poster's lettering. It covers
 * the scene (and blocks input) until everything is loaded, baked, compiled
 * and warmed up, then fades out.
 */
export default function LoadingOverlay() {
  const { stage, bakeProgress } = useLoading();
  const { progress: assetProgress } = useProgress();
  const ready = stage === "ready";
  const target = overallProgress(stage, assetProgress / 100, bakeProgress) * 100;

  // The number eases towards the real progress every frame (written straight
  // to the DOM, no re-render per frame), so it counts up smoothly instead of
  // jumping between stages.
  const counterRef = useRef<HTMLSpanElement>(null);
  const targetRef = useRef(0);
  useEffect(() => {
    targetRef.current = target;
  }, [target]);
  useEffect(() => {
    let shown = 0;
    let raf = 0;
    const tick = () => {
      shown += (targetRef.current - shown) * 0.08;
      if (targetRef.current - shown < 0.5) shown = targetRef.current;
      if (counterRef.current) counterRef.current.textContent = String(Math.floor(shown));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      aria-hidden={ready}
      className={`${posterFont.className} absolute inset-0 z-50 flex flex-col bg-[#0b0d08] text-[#fdf3d4] transition-opacity duration-1000 md:flex-row ${
        ready ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      {/* Left: the poster. */}
      <div className="relative h-[42vh] w-full shrink-0 md:h-full md:w-[46%]">
        <Image
          src="/GGP (2).png"
          alt="Gugut & the Goat"
          fill
          preload
          sizes="(min-width: 768px) 46vw, 100vw"
          // Keep the "GUGUT & THE GOAT" title (bottom of the poster) in frame.
          className="object-cover object-center md:object-bottom"
        />
        {/* Blend the poster's edge into the story panel. */}
        <div className="absolute inset-0 bg-linear-to-b from-transparent via-transparent to-[#0b0d08] md:bg-linear-to-r" />
      </div>

      {/* Right: the story and the counter. */}
      <div className="flex flex-1 flex-col justify-between gap-8 px-8 py-8 md:px-14 md:py-16">
        <div className="max-w-2xl space-y-5 text-[clamp(1.35rem,2.1vw,2.1rem)] leading-[1.18] tracking-wide">
          {STORY.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>

        <div className="self-end leading-none text-[#fdf3d4]">
          <span ref={counterRef} className="text-[clamp(5rem,13vw,11rem)] tabular-nums">
            0
          </span>
          <span className="text-[clamp(2rem,5vw,4.5rem)] text-[#fdf3d4]/70">%</span>
        </div>
      </div>
    </div>
  );
}
