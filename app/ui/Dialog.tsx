"use client";

import { useEffect, type ReactNode } from "react";
import { posterFont } from "../fonts";
import { runStore } from "../game/runStore";

/**
 * A modal panel over the game (settings, leaderboard). While it's open the
 * game is paused (the clock too) and the mouse is released; Esc or a click
 * outside closes it.
 */
export default function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    runStore.setPaused("dialog", true);
    if (document.pointerLockElement) document.exitPointerLock();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault(); // handled: the pause menu leaves this Esc alone
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      runStore.setPaused("dialog", false);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 p-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="ui-shell flex max-h-[90vh] w-full max-w-md flex-col p-1.5"
      >
        <div className="ui-well min-h-0 overflow-y-auto p-5">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className={`${posterFont.className} text-3xl tracking-wide`}>{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="ui-tile flex h-9 w-9 items-center justify-center"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
