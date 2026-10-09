"use client";

import { useCallback, useEffect, useState } from "react";
import { posterFont } from "../fonts";
import { runStore } from "../game/runStore";
import { mazeHint, temesgen } from "../game/temesgen";

type Step = "greet" | "invite" | "playing" | "farewell" | "listening" | "rejoin" | "hint" | "other" | "otherPlaying";

interface Choice {
  text: string;
  then: Step | "close";
  /** Run as the choice is made (before moving on). */
  act?: () => void;
  /** Only offered once Gugut has found a bottle of water. */
  afterWater?: boolean;
}

interface Line {
  /** What Gugut just said (shown above Temesgen's answer), if anything. */
  asked?: string;
  /** Temesgen's words (or made when shown), or a stage direction when `narration`. */
  says: string | (() => string);
  narration?: boolean;
  /** (Or made when shown.) */
  choices: Choice[] | (() => Choice[]);
}

/** Asking for another song: he gives in the third time. */
const GIVES_IN_AT = 3;
const askOther: Choice = { text: "Do you know any other songs?", then: "other", act: () => void temesgen.askOtherSong() };

const LINES: Record<Step, Line> = {
  greet: {
    says: "Selam, little brother. You are walking fast for such a quiet evening.",
    choices: [
      { text: "Have you seen my goat?", then: "invite" },
      { text: "You know these walls — where would a goat go?", then: "hint", afterWater: true },
      askOther,
      { text: "Goodbye", then: "close" },
    ],
  },
  other: {
    asked: "Do you know any other songs?",
    says: () =>
      [
        "Other songs? Tonight my fingers remember only the one.",
        "Again? You are as stubborn as that goat of yours.",
        "Alright, alright — don't do that to me! Here. This one is for stubborn goatherds.",
      ][Math.min(temesgen.otherSongAsks(), GIVES_IN_AT) - 1],
    choices: () =>
      temesgen.otherSongAsks() >= GIVES_IN_AT
        ? [{ text: "Sit and listen", then: "otherPlaying", act: () => temesgen.playSong("second") }]
        : [
            { text: "Please? Just one more", then: "other", act: () => void temesgen.askOtherSong() },
            { text: "Never mind", then: "greet" },
          ],
  },
  otherPlaying: {
    says: "Temesgen laughs, shakes his head, and tunes the kirar to something else entirely. You sit down in the grass to listen.",
    narration: true,
    choices: [{ text: "Listen", then: "close" }],
  },
  hint: {
    asked: "You know these walls — where would a goat go?",
    says: mazeHint,
    choices: [
      { text: "Thank you, Temesgen", then: "farewell" },
      { text: "Play me a song first", then: "playing", act: () => temesgen.playSong() },
    ],
  },
  invite: {
    asked: "Have you seen my goat?",
    says: "Your goat? No — nothing has passed this tree but the wind. But look at you: out of breath, eyes everywhere. Sit a while and listen to one of my songs. A calm heart hears what a hurried one misses. Maybe then you will find her.",
    choices: [
      { text: "Yes — play me a song", then: "playing", act: () => temesgen.playSong() },
      { text: "Not now, I have to keep looking", then: "farewell" },
    ],
  },
  playing: {
    says: "Temesgen smiles and settles the kirar on his knee. You sit down on the grass in front of him as he begins to play.",
    narration: true,
    choices: [{ text: "Listen", then: "close" }],
  },
  farewell: {
    says: "Then go well. If you hear her bleat, follow it — and come back if your heart needs a song.",
    choices: [{ text: "Goodbye", then: "close" }],
  },
  listening: {
    says: "Stay as long as you like, little brother. The song is not finished yet.",
    choices: [
      { text: "Keep playing", then: "close" },
      askOther,
      { text: "You know these walls — where would a goat go?", then: "hint", afterWater: true },
      { text: "Could you stop for now?", then: "close", act: () => temesgen.stopSong() },
    ],
  },
  rejoin: {
    says: "You came back to listen? Good. Sit — the song is not finished yet.",
    choices: [
      { text: "Sit and listen", then: "close", act: () => temesgen.sit() },
      { text: "Could you stop for now?", then: "close", act: () => temesgen.stopSong() },
    ],
  },
};

/**
 * Talking to Temesgen by the maple (E / the Talk button when close and
 * looking at him — game/temesgen): Gugut asks about his goat; Temesgen hasn't
 * seen her, but offers a song to calm him — and plays it if Gugut says yes
 * (heard in 3D from where he sits), Gugut sitting down in front of him to
 * listen. Back while he's playing, Gugut can sit again or ask him to stop.
 * Once Gugut has found water, Temesgen also tells him which way he heard a
 * goat this morning (game/temesgen mazeHint). Choices by click / tap or the
 * number keys (Enter = the first, Esc = leave). The game is paused while it's open; `onClose` returns to it.
 */
export default function TemesgenDialog({ onClose }: { onClose: () => void }) {
  const [turn, setTurn] = useState(0);
  const [step, setStep] = useState<Step>(() => {
    const { song, seated } = temesgen.get();
    return song !== "playing" ? "greet" : seated ? "listening" : "rejoin";
  });
  // (Asked once, when the conversation opens.)
  const [foundWater] = useState(() => runStore.get().bottlesTaken.some(Boolean));
  const line = LINES[step];
  const choices = (typeof line.choices === "function" ? line.choices() : line.choices).filter(
    (c) => !c.afterWater || foundWater
  );
  const says = typeof line.says === "function" ? line.says() : line.says;

  useEffect(() => {
    runStore.setPaused("talk", true);
    if (document.pointerLockElement) document.exitPointerLock();
    return () => runStore.setPaused("talk", false);
  }, []);

  const pick = useCallback(
    (choice: Choice | undefined) => {
      if (!choice) return;
      choice.act?.();
      if (choice.then === "close") {
        temesgen.endTalk();
        onClose();
      } else {
        setStep(choice.then);
        // (A turn on the same step — asking him again — still shows his new answer.)
        setTurn((n) => n + 1);
      }
    },
    [onClose]
  );

  // 1, 2… pick a choice, Enter the first, Esc leaves. (Handled here, so the
  // focused button doesn't also click: preventDefault.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (digit) pick(choices[Number(digit[1]) - 1]);
      else if (e.code === "Enter" || e.code === "NumpadEnter") pick(choices[0]);
      else if (e.code === "Escape") pick({ text: "", then: "close" });
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choices, pick]);

  return (
    <div className="absolute inset-x-0 bottom-0 z-[64] flex justify-center p-4 pb-6">
      <div
        role="dialog"
        aria-label="Talking to Temesgen"
        className="ui-shell flex w-full max-w-xl flex-col gap-1.5 p-1.5"
        style={{ animation: "notice-in 200ms ease-out" }}
      >
        <div key={turn} className="ui-well px-5 py-4" style={{ animation: "notice-in 260ms ease-out" }}>
          {line.asked && <p className="mb-2 text-sm text-cream/50">You: “{line.asked}”</p>}
          {!line.narration && <p className={`${posterFont.className} mb-1 text-2xl leading-none text-gold`}>Temesgen</p>}
          <p className={`font-poster text-2xl leading-snug tracking-wide ${line.narration ? "italic text-cream/70" : "text-cream"}`}>
            {line.narration ? says : `“${says}”`}
          </p>
        </div>
        <div className="flex flex-col gap-1.5 sm:flex-row">
          {choices.map((choice, i) => (
            <button
              key={choice.text}
              type="button"
              autoFocus={i === 0}
              onClick={() => pick(choice)}
              className={`flex min-h-11 flex-1 items-center gap-2.5 rounded-2xl! px-3.5 py-2 text-left font-poster text-lg leading-tight tracking-wide ${
                i === 0 ? "ui-cta" : "ui-tile"
              }`}
            >
              <kbd className="ui-key hidden px-1.5 text-xs pointer-fine:inline">{i + 1}</kbd>
              {choice.text}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
