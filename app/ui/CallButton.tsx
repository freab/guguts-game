"use client";

import { GOAT_CALLS, runStore, useRun } from "../game/runStore";

/**
 * "Call the goat": a button on the HUD (also the C key and the pause menu),
 * with Gugut's calls left as pips — empty and showing a water drop when his
 * throat is dry (runStore.callGoat explains, and to go find water).
 */
export default function CallButton({ showKey, className = "" }: { showKey: boolean; className?: string }) {
  const { calls } = useRun();
  const dry = calls <= 0;
  return (
    <button
      type="button"
      onClick={() => runStore.callGoat()}
      title={dry ? "Too thirsty to call — find water" : "Call the goat (C)"}
      aria-label={`Call the goat — ${calls} of ${GOAT_CALLS} calls left`}
      className={`z-20 flex items-center gap-2 rounded-full py-1.5 pl-2.5 pr-3 text-sm font-medium backdrop-blur transition-colors ${
        dry ? "bg-black/40 text-zinc-400 hover:bg-black/55" : "bg-black/50 text-zinc-100 hover:bg-white/15"
      } ${className}`}
    >
      {/* A cupped-hands call: a horn shape with sound lines. */}
      <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 10v4h3l6 4V6L6 10H3Z" />
        <path d="M16 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11" />
      </svg>
      <span className="whitespace-nowrap">Call the goat</span>
      <span className="flex items-center gap-1" aria-hidden>
        {dry ? (
          // A water drop: go find a bottle.
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-sky-300" fill="currentColor">
            <path d="M12 3s6 6.4 6 10.5A6 6 0 0 1 6 13.5C6 9.4 12 3 12 3Z" />
          </svg>
        ) : (
          Array.from({ length: GOAT_CALLS }, (_, i) => (
            <span key={i} className={`h-2 w-2 rounded-full ${i < calls ? "bg-amber-300" : "bg-white/20"}`} />
          ))
        )}
      </span>
      {showKey && <kbd className="rounded bg-white/10 px-1.5 font-mono text-xs text-zinc-300">C</kbd>}
    </button>
  );
}
