"use client";

import { useEffect, useState } from "react";

/**
 * GUGUT and STUDIOS in the studio's wordmark lettering, as SVG outlines (no
 * font file or font name ships): one path per letter, at 100px on a
 * baseline of 0. `box`: the word's bounds (x, y, w, h).
 */
const WORDMARK = {
  GUGUT: {
    box: [2, -70, 295.5, 70],
    letters: [
      "M48 0L2-34.8L2-35L46-70L57.3-61.5L24.5-35.5L24.5-35.3L48-17.1L48-28L44.9-28L44.9-41L62-41L62 0L48 0Z",
      "M119-16L93.4 0L93.3 0L67-16L67-70L81-70L81-23.4L93.3-15.7L93.4-15.7L105-23.3L105-70L119-70L119-16Z",
      "M168.5 0L122.5-34.8L122.5-35L166.5-70L177.8-61.5L145-35.5L145-35.3L168.5-17.1L168.5-28L165.4-28L165.4-41L182.5-41L182.5 0L168.5 0Z",
      "M239.5-16L213.9 0L213.8 0L187.5-16L187.5-70L201.5-70L201.5-23.4L213.8-15.7L213.9-15.7L225.5-23.3L225.5-70L239.5-70L239.5-16Z",
      "M263.5-57L243.5-57L243.5-70L297.5-70L297.5-57L277.5-57L277.5 0L263.5 0L263.5-57Z",
    ],
  },
  STUDIOS: {
    box: [2.5, -71, 357.4, 72],
    letters: [
      "M54.7-17.7L19.1 1L2.5-15L11.5-25.6L21.2-16.3L31.6-21.7L31.6-21.8L6.5-47.7L6.5-47.8L33.7-71L33.8-71L54.1-53.7L45.2-43.1L33.8-52.4L26.5-46.6L26.5-46.5L54.7-17.8L54.7-17.7Z",
      "M75.7-57L55.7-57L55.7-70L109.7-70L109.7-57L89.7-57L89.7 0L75.7 0L75.7-57Z",
      "M165.7-16L140.1 0L140 0L113.7-16L113.7-70L127.7-70L127.7-23.4L140-15.7L140.1-15.7L151.7-23.3L151.7-70L165.7-70L165.7-16Z",
      "M186.2-50.6L186.2-19.3L201.9-34.8L201.9-35L186.2-50.6ZM172.2 0L172.2-70L186.2-70L221.2-35L221.2-34.8L186.2 0L172.2 0Z",
      "M225.2 0L225.2-70L239.2-70L239.2 0L225.2 0Z",
      "M278.2 0L243.2-35L278.2-70L313.2-35L278.2 0ZM278.3-19.4L293.6-35L278.1-50.6L262.8-35L278.3-19.4Z",
      "M359.9-17.7L324.3 1L307.7-15L316.7-25.6L326.4-16.3L336.8-21.7L336.8-21.8L311.7-47.7L311.7-47.8L338.9-71L339-71L359.3-53.7L350.4-43.1L339-52.4L331.7-46.6L331.7-46.5L359.9-17.8L359.9-17.7Z",
    ],
  },
} as const;

/**
 * One wordmark word as an SVG: each letter's outline draws on, then fills,
 * one after another `stagger` ms apart from `start`.
 */
function Wordmark({
  word,
  start,
  stagger,
  color,
  className,
}: {
  word: keyof typeof WORDMARK;
  start: number;
  stagger: number;
  color: string;
  className: string;
}) {
  const { box, letters } = WORDMARK[word];
  const pad = 2;
  return (
    <svg
      viewBox={`${box[0] - pad} ${box[1] - pad} ${box[2] + pad * 2} ${box[3] + pad * 2}`}
      className={className}
      fill={color}
      stroke={color}
      strokeWidth={1.2}
      strokeLinejoin="round"
      aria-hidden
    >
      {letters.map((d, i) => (
        <path key={i} d={d} pathLength={1} className="studio-glyph" style={{ animationDelay: `${start + i * stagger}ms` }} />
      ))}
    </svg>
  );
}

/**
 * "MADE BY" in hand-built monoline letters on a 20 × 30 grid, each stroke
 * drawn on in turn (stroke-dashoffset over pathLength 1).
 */
const MONO: Record<string, { w: number; d: string[] }> = {
  M: { w: 20, d: ["M2 29 L2 1 L10 18 L18 1 L18 29"] },
  A: { w: 20, d: ["M1 29 L10 1 L19 29", "M4.6 18.5 L15.4 18.5"] },
  D: { w: 20, d: ["M2 1 L2 29 L8 29 C15 29 18 23 18 15 C18 7 15 1 8 1 Z"] },
  E: { w: 18, d: ["M17 1 L2 1 L2 29 L17 29", "M2 15 L13 15"] },
  B: {
    w: 20,
    d: ["M2 15 L10 15 C15 15 18 18 18 22 C18 26 15 29 10 29 L2 29 L2 1 L9 1 C13.5 1 16 4 16 8 C16 12 13.5 15 9 15"],
  },
  Y: { w: 20, d: ["M1 1 L10 15 L19 1", "M10 15 L10 29"] },
};

function MadeBy({ start, className }: { start: number; className: string }) {
  const tracking = 9;
  const stagger = 70;
  const strokes: { d: string; x: number; delay: number }[] = [];
  let x = 0;
  [..."MADE BY"].forEach((ch, i) => {
    if (ch === " ") {
      x += 10;
      return;
    }
    MONO[ch].d.forEach((d, j) => strokes.push({ d, x, delay: start + i * stagger + j * stagger * 0.4 }));
    x += MONO[ch].w + tracking;
  });
  const width = x - tracking;
  return (
    <svg
      viewBox={`-2.4 -2.4 ${width + 4.8} 34.8`}
      className={className}
      fill="none"
      stroke="#fdf3d4"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {strokes.map((s, i) => (
        <path
          key={i}
          d={s.d}
          transform={`translate(${s.x} 0)`}
          pathLength={1}
          className="studio-stroke"
          style={{ animationDelay: `${s.delay}ms` }}
        />
      ))}
    </svg>
  );
}

/** Total time on screen before the fade, and the fade itself (ms). */
const HOLD_MS = 3600;
const FADE_MS = 700;

/**
 * "made by GUGUT STUDIOS": the first thing on the page — black, the studio's
 * name drawn on letter by letter, then it fades to the title screen. Any
 * click, tap or key skips it. Rendered on the server too, so the title screen
 * never flashes first.
 */
export default function StudioSplash() {
  const [phase, setPhase] = useState<"show" | "fade" | "gone">("show");

  useEffect(() => {
    if (phase !== "show") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = window.setTimeout(() => setPhase("fade"), reduced ? 1600 : HOLD_MS);
    const skip = () => setPhase("fade");
    window.addEventListener("pointerdown", skip);
    window.addEventListener("keydown", skip);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("pointerdown", skip);
      window.removeEventListener("keydown", skip);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "fade") return;
    const t = window.setTimeout(() => setPhase("gone"), FADE_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  if (phase === "gone") return null;

  return (
    <div
      role="img"
      aria-label="Made by Gugut Studios"
      className={`fixed inset-0 z-[200] flex items-center justify-center bg-black transition-opacity ease-out ${
        phase === "fade" ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
      style={{ transitionDuration: `${FADE_MS}ms` }}
    >
      <div className="studio-rise flex flex-col items-center gap-[clamp(0.9rem,2.6vmin,1.6rem)]">
        <MadeBy start={150} className="h-[clamp(0.75rem,2vmin,1.05rem)] w-auto opacity-70" />
        <Wordmark word="GUGUT" start={550} stagger={130} color="#fdf3d4" className="h-[clamp(3rem,11vmin,6.5rem)] w-auto" />
        <div className="flex items-center gap-[clamp(0.6rem,2vmin,1.2rem)]">
          <span className="studio-rule h-px w-[clamp(1.5rem,6vmin,3.5rem)] origin-right bg-[#c9a45c]" />
          <Wordmark word="STUDIOS" start={1300} stagger={70} color="#c9a45c" className="h-[clamp(0.8rem,2.4vmin,1.3rem)] w-auto" />
          <span className="studio-rule h-px w-[clamp(1.5rem,6vmin,3.5rem)] origin-left bg-[#c9a45c]" />
        </div>
      </div>
    </div>
  );
}
