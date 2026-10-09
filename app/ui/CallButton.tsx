"use client";

import { useEffect, useState } from "react";
import { keyLabel, usePreferences } from "../game/preferences";
import { GOAT_CALLS, runStore, useRun } from "../game/runStore";

/**
 * "Call the goat": a button on the HUD (also its key — C unless changed in
 * Settings — and the pause menu), with Gugut's calls left as pips — empty
 * and showing a water drop when his throat is dry (runStore.callGoat
 * explains, and to go find water). `large` for thumbs on touch screens.
 * After a drink the pips fill back up one at a time, each with a pop.
 */
export default function CallButton({
  showKey,
  large = false,
  className = "",
}: {
  showKey: boolean;
  large?: boolean;
  className?: string;
}) {
  const { calls: left } = useRun();
  const { callKey } = usePreferences();
  // The pips shown: a call spent shows at once, a refill steps up to `left`.
  const [shown, setShown] = useState(left);
  const [popped, setPopped] = useState(-1);
  useEffect(() => {
    if (shown === left) return;
    const down = left < shown;
    const t = setTimeout(() => {
      if (down) {
        setShown(left);
        setPopped(-1);
      } else {
        setPopped(shown);
        setShown(shown + 1);
      }
    }, down ? 0 : 220);
    return () => clearTimeout(t);
  }, [left, shown]);
  const calls = Math.min(shown, left);
  const dry = calls <= 0;
  return (
    <button
      type="button"
      onClick={() => runStore.callGoat()}
      title={dry ? "Too thirsty to call — find water" : `Call the goat (${keyLabel(callKey)})`}
      aria-label={`Call the goat — ${left} of ${GOAT_CALLS} calls left`}
      className={`ui-shell z-20 flex touch-manipulation select-none items-stretch gap-1.5 p-1.5 font-medium transition active:scale-95 ${
        large ? "text-base" : "text-sm"
      } ${className}`}
    >
      {/* A cupped-hands call: a horn shape with sound lines. */}
      <span className={`ui-mark flex items-center justify-center ${large ? "h-12 w-12" : "h-10 w-10"} ${dry ? "text-cream/45!" : ""}`}>
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 10v4h3l6 4V6L6 10H3Z" />
          <path d="M16 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11" />
        </svg>
      </span>
      <span className={`ui-tile flex items-center gap-2.5 px-3.5 ${dry ? "text-cream/60!" : ""}`}>
        <span className="ui-label whitespace-nowrap">Call the goat</span>
        <span className="flex items-center gap-1" aria-hidden>
          {dry ? (
            // A water drop: go find a bottle.
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-sky-300" fill="currentColor">
              <path d="M12 3s6 6.4 6 10.5A6 6 0 0 1 6 13.5C6 9.4 12 3 12 3Z" />
            </svg>
          ) : (
            Array.from({ length: GOAT_CALLS }, (_, i) => (
              <span
                key={i}
                className={`h-2 w-2 rounded-full ${i < calls ? "bg-gold" : "bg-cream/15"}`}
                style={i === popped && i < calls ? { animation: "pip-pop 320ms ease-out" } : undefined}
              />
            ))
          )}
        </span>
      </span>
      {showKey && (
        <kbd className="ui-cta flex min-w-10 items-center justify-center px-2 font-mono text-sm">{keyLabel(callKey)}</kbd>
      )}
    </button>
  );
}
