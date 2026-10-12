"use client";

import { useEffect, useMemo, useState } from "react";
import PresentClient from "../present/PresentClient";
import { usePresent } from "../present/presentStore";
import type { Shot, Slide } from "../present/slides";
import { THANKS_CARDS } from "./thanksCard";

/** Every shot there is to choose from, by kind. */
const SHOTS: { shot: Shot; name: string; kind: string }[] = [
  { shot: "portrait", name: "Maple at golden hour", kind: "Hero" },
  { shot: "flowerMacro", name: "Adey Abeba macro", kind: "Hero" },
  { shot: "goatHero", name: "Goat, eye level", kind: "Hero" },
  { shot: "temesgen", name: "Temesgen, close", kind: "Hero" },
  { shot: "stone", name: "Stone, close", kind: "Hero" },
  { shot: "carving", name: "ጉጉት carving", kind: "Hero" },
  { shot: "lantern", name: "Lantern in the maple", kind: "Hero" },
  { shot: "jebena", name: "The jebena", kind: "Hero" },
  { shot: "aerial", name: "Aerial over the maze", kind: "Wide" },
  { shot: "orbit", name: "High, angled", kind: "Wide" },
  { shot: "top", name: "Straight down", kind: "Wide" },
  { shot: "sky", name: "The sky", kind: "Wide" },
  { shot: "wormsEye", name: "Worm's-eye, up the walls", kind: "Dramatic" },
  { shot: "vanishing", name: "Vanishing point", kind: "Dramatic" },
  { shot: "silhouette", name: "Silhouette of the maple", kind: "Dramatic" },
  { shot: "fromMaze", name: "From the maze", kind: "Dramatic" },
  { shot: "overShoulder", name: "Over Temesgen's shoulder", kind: "Dramatic" },
  { shot: "corridor", name: "First corridor", kind: "Dramatic" },
];

/** The light, as the sunset's moment (leva "Dusk preview": 0 … 1). */
const MOODS = [
  { name: "Golden", dusk: 0.3 },
  { name: "Sunset", dusk: 0.6 },
  { name: "Dusk", dusk: 0.85 },
  { name: "Night", dusk: 1 },
];

/** Each card's shot and mood to start with. */
const START: { shot: number; mood: number }[] = [
  { shot: 0, mood: 0 },
  { shot: 1, mood: 0 },
];

/**
 * The thank-you pictures (app/thanks) with a picker: for the card showing,
 * which shot and which light. The picker is the page's, not the picture's:
 * the download is the 3D frame and the card only. H hides it.
 */
export default function ThanksClient() {
  const [choice, setChoice] = useState(START);
  const [hidden, setHidden] = useState(false);
  const { slide: index } = usePresent();

  // H hides and shows the picker, wherever the focus is.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.code !== "KeyH" || el?.tagName === "INPUT" || el?.tagName === "TEXTAREA") return;
      setHidden((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const slides = useMemo<Slide[]>(
    () =>
      THANKS_CARDS.map((card, i) => ({
        shot: SHOTS[choice[i]?.shot ?? 0].shot,
        title: card.title ?? "Thank you",
        lines: [],
        post: true,
        thanks: card,
        set: [["duskPreview", MOODS[choice[i]?.mood ?? 0].dusk]],
      })),
    [choice]
  );

  const mine = choice[index] ?? START[0];
  const pick = (patch: Partial<{ shot: number; mood: number }>) =>
    setChoice((all) => all.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  const step = (by: number) => pick({ shot: (mine.shot + by + SHOTS.length) % SHOTS.length });

  return (
    <>
      <PresentClient slides={slides} still />
      <div className="absolute top-4 left-1/2 z-[40] w-max max-w-[calc(100vw-2rem)] -translate-x-1/2">
        {hidden ? (
          <button type="button" onClick={() => setHidden(false)} className="rounded-full bg-black/60 px-3 py-1 text-xs text-[#fdf3d4]/70">
            Show picker
          </button>
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-2xl border border-[#fdf3d4]/15 bg-black/75 px-3 py-2 text-sm text-[#fdf3d4]">
            <span className="text-xs uppercase tracking-[0.2em] text-[#c9a45c]">Card {index + 1}</span>
            <button type="button" onClick={() => step(-1)} className="rounded-lg px-2 py-1 hover:bg-white/10" aria-label="Previous shot">
              ◀
            </button>
            <select
              value={mine.shot}
              onChange={(e) => pick({ shot: Number(e.target.value) })}
              className="max-w-[16rem] rounded-lg bg-[#111] px-2 py-1"
            >
              {["Hero", "Wide", "Dramatic"].map((kind) => (
                <optgroup key={kind} label={kind}>
                  {SHOTS.map((s, i) =>
                    s.kind === kind ? (
                      <option key={s.shot} value={i}>
                        {s.name}
                      </option>
                    ) : null
                  )}
                </optgroup>
              ))}
            </select>
            <button type="button" onClick={() => step(1)} className="rounded-lg px-2 py-1 hover:bg-white/10" aria-label="Next shot">
              ▶
            </button>
            <span className="mx-1 h-5 w-px bg-white/15" />
            {MOODS.map((m, i) => (
              <button
                key={m.name}
                type="button"
                onClick={() => pick({ mood: i })}
                className={`rounded-lg px-2.5 py-1 ${i === mine.mood ? "bg-[#c9a45c] text-[#2a2312]" : "hover:bg-white/10"}`}
              >
                {m.name}
              </button>
            ))}
            <span className="mx-1 h-5 w-px bg-white/15" />
            <button type="button" onClick={() => setHidden(true)} className="rounded-lg px-2 py-1 text-[#fdf3d4]/60 hover:bg-white/10" title="Hide the picker">
              ✕
            </button>
          </div>
        )}
      </div>
    </>
  );
}
