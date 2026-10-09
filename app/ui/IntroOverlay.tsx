"use client";

import { useEffect, useState } from "react";
import { posterFont } from "../fonts";
import { intro, useIntro } from "../game/intro";

/** How long the skip's fade to black takes (ms), before the game is handed over. */
const SKIP_FADE_MS = 350;
/** The skip prompt shows a moment into the flight. */
const PROMPT_AFTER_MS = 700;

/**
 * The intro fly-in's frame (game/intro, scene/IntroFlight): cinematic bars
 * that slide away as the flight lands, the level's name in the lower bar, and
 * a skip prompt — Space, Enter, Esc, a click or a tap skips, with a quick fade
 * through black, as games do.
 */
export default function IntroOverlay({ title, subtitle, touch }: { title: string; subtitle: string; touch: boolean }) {
  const phase = useIntro();
  const flying = phase === "playing" || phase === "skipping";
  const [prompt, setPrompt] = useState(false);

  // The prompt, a moment in.
  useEffect(() => {
    if (phase !== "playing") return;
    const t = setTimeout(() => setPrompt(true), PROMPT_AFTER_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // Skipping: any of the skip keys, a click or a tap.
  useEffect(() => {
    if (phase !== "playing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "Enter" || e.code === "Escape") {
        e.preventDefault(); // (Esc: handled here, the pause menu leaves it alone)
        intro.skip();
      }
    };
    const onPointer = () => intro.skip();
    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [phase]);

  // Skipped: once the screen is black, hand the game over (it fades back in).
  useEffect(() => {
    if (phase !== "skipping") return;
    const t = setTimeout(() => intro.finish(), SKIP_FADE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  const bar = "absolute inset-x-0 h-[9vh] bg-black transition-transform duration-700 ease-in-out";
  return (
    <div className="pointer-events-none absolute inset-0 z-[55] overflow-hidden" aria-hidden={!flying}>
      <div className={`${bar} top-0 ${flying ? "translate-y-0" : "-translate-y-full"}`} />
      <div className={`${bar} bottom-0 flex items-center justify-between px-[5vw] ${flying ? "translate-y-0" : "translate-y-full"}`}>
        <div
          className={`${posterFont.className} leading-none text-[#fdf3d4] transition-opacity duration-700 ${prompt && phase === "playing" ? "opacity-100" : "opacity-0"}`}
        >
          <span className="text-[clamp(1.4rem,min(2.4vw,4.5vh),2.4rem)]">{title}</span>
          <span className="ml-3 text-[clamp(0.9rem,min(1.2vw,2.4vh),1.2rem)] text-[#fdf3d4]/60">{subtitle}</span>
        </div>
        <div
          className={`flex items-center gap-2 text-[clamp(0.8rem,min(1vw,2.2vh),1rem)] tracking-wide text-cream/70 transition-opacity duration-500 ${prompt && phase === "playing" ? "opacity-100" : "opacity-0"}`}
        >
          {touch ? (
            "Tap to skip"
          ) : (
            <>
              <kbd className="rounded border border-cream/40 px-1.5 py-0.5 font-sans text-[0.85em] text-cream/85">Space</kbd>
              Skip
            </>
          )}
        </div>
      </div>
      {/* The skip's fade through black. */}
      <div
        className="absolute inset-0 bg-black transition-opacity ease-in-out"
        style={{ opacity: phase === "skipping" ? 1 : 0, transitionDuration: `${phase === "skipping" ? SKIP_FADE_MS : 600}ms` }}
      />
    </div>
  );
}
