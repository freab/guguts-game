"use client";

import { useEffect } from "react";
import { posterFont } from "../fonts";
import { runStore } from "../game/runStore";
import { enterFullscreen, fullscreenSupported, isStandalone } from "./fullscreen";

/**
 * On a phone held upright: ask for landscape (the maze needs the width). With
 * the Fullscreen API (Android) one tap goes fullscreen and turns the screen;
 * on iPhone, which has no fullscreen for pages, it suggests Add to Home Screen.
 * The game is paused while it's up; "Play in portrait" dismisses it.
 */
export default function RotatePrompt({ onDismiss }: { onDismiss: () => void }) {
  useEffect(() => {
    runStore.setPaused("rotate", true);
    return () => runStore.setPaused("rotate", false);
  }, []);

  const canFullscreen = fullscreenSupported();
  return (
    <div className="absolute inset-0 z-[67] flex items-center justify-center bg-[#1c1c1c] p-6">
      <div className="ui-shell w-full max-w-sm p-1.5">
        <div className="ui-well flex flex-col items-center gap-5 p-7 text-center">
          {/* A phone turning on its side. */}
          <svg viewBox="0 0 64 64" className="h-20 w-20 animate-[turn-sideways_2.6s_ease-in-out_infinite] text-amber-200" fill="none" stroke="currentColor" strokeWidth="2.5">
            <rect x="20" y="8" width="24" height="44" rx="4" />
            <path d="M29 46h6" strokeLinecap="round" />
          </svg>
          <h2 className={`${posterFont.className} text-4xl tracking-wide`}>Turn your phone sideways</h2>
          <p className="max-w-xs text-sm text-white/70">The maze plays best in landscape, with room for both thumbs.</p>
          {canFullscreen ? (
            <button
              type="button"
              onClick={() => void enterFullscreen(true)}
              className="ui-cta px-6 py-2.5 text-sm"
            >
              Go fullscreen
            </button>
          ) : (
            !isStandalone() && (
              <p className="max-w-xs text-xs text-white/55">
                Tip: tap Share, then “Add to Home Screen” to play fullscreen.
              </p>
            )
          )}
          <button type="button" onClick={onDismiss} className="text-sm text-white/60 underline">
            Play in portrait
          </button>
        </div>
      </div>
    </div>
  );
}
