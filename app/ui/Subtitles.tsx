"use client";

import { useEffect, useState } from "react";
import { audio } from "../audio/audioEngine";
import { SUBTITLES } from "../audio/subtitles";
import { usePreferences } from "../game/preferences";

/**
 * What Gugut is saying, in English, while he says it (audio/subtitles): for
 * players who don't speak Amharic. Sits above the sound captions
 * (ui/BleatIndicator), and on touch screens between and above the joystick
 * and the call button. Off in Settings.
 */
export default function Subtitles() {
  const { subtitles } = usePreferences();
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!subtitles) return;
    const id = setInterval(() => {
      const now = audio.speakingTake();
      setText(now ? (SUBTITLES[now.line][now.take]?.en ?? null) : null);
    }, 100);
    return () => {
      clearInterval(id);
      setText(null);
    };
  }, [subtitles]);

  if (!subtitles || !text) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute bottom-28 left-1/2 z-20 w-max max-w-[min(90vw,44rem)] -translate-x-1/2 rounded-md bg-black/60 px-4 py-2 text-center text-base leading-snug text-[#fdf3d4] sm:bottom-24 sm:text-lg pointer-coarse:bottom-[max(6.5rem,24svh)] pointer-coarse:max-w-[min(56vw,30rem)] pointer-coarse:text-base"
      style={{ textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}
    >
      {text}
    </div>
  );
}
