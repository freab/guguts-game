"use client";

import { useSyncExternalStore } from "react";
import { audio } from "../audio/audioEngine";

/** Speaker icon, with sound waves (on) or a cross (off). */
function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" />
      {on ? (
        <>
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M18.5 5.5a9 9 0 0 1 0 13" />
        </>
      ) : (
        <>
          <path d="m16 9 5 5" />
          <path d="m21 9-5 5" />
        </>
      )}
    </svg>
  );
}

/**
 * Music on / off (also the M key): the birds-and-wind ambience
 * (audio/audioEngine.ts), which plays once the game is running. Shown on every
 * screen, including the title screen; the choice is remembered.
 */
export default function MusicToggle({ className = "" }: { className?: string }) {
  const on = useSyncExternalStore(audio.subscribe, audio.getMusicSnapshot, audio.getServerMusicSnapshot);
  return (
    <button
      onClick={() => audio.setMusic(!on)}
      title="Music (M)"
      aria-pressed={on}
      aria-label={on ? "Turn music off" : "Turn music on"}
      className={`ui-tile flex h-8 items-center justify-center gap-2 px-3 text-sm font-medium ${className}`}
    >
      <SpeakerIcon on={on} />
      {/* Icon only on phones, to leave room for the timer. */}
      <span className="hidden sm:inline">Music {on ? "on" : "off"}</span>
    </button>
  );
}
