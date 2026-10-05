"use client";

import { useEffect, type ReactNode } from "react";
import { posterFont } from "../fonts";
import { keyLabel, usePreferences } from "../game/preferences";
import { runStore } from "../game/runStore";

const SEEN_KEY = "gugut.controlsSeen";

/** Has this device been shown the controls yet? */
export function controlsSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Private mode: shown again next visit, no harm.
  }
}

const Key = ({ children }: { children: ReactNode }) => (
  <kbd className="inline-flex min-w-7 items-center justify-center rounded-md border border-white/25 bg-white/10 px-1.5 py-0.5 font-mono text-xs text-white">
    {children}
  </kbd>
);

/**
 * How to play: shown on the first run on a device, and from the pause menu.
 * Phones get the touch controls; keyboards get the keys. The game is paused
 * (the clock doesn't start) while it's up.
 */
export default function ControlsHelp({ touch, onClose }: { touch: boolean; onClose: () => void }) {
  const { callKey } = usePreferences();
  useEffect(() => {
    runStore.setPaused("help", true);
    if (document.pointerLockElement) document.exitPointerLock();
    return () => runStore.setPaused("help", false);
  }, []);

  const close = () => {
    markSeen();
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        markSeen();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows: [ReactNode, string][] = touch
    ? [
        [<span key="l">Left thumb</span>, "Drag anywhere on the left to move — push all the way to run"],
        [<span key="r">Right thumb</span>, "Drag on the right to look around"],
        [<span key="e">Eye button</span>, "Switch first / third person"],
        [<span key="c">Call button</span>, "Top left — call the goat: she bleats back, and a map shows where she is"],
        [<span key="p">Pause button</span>, "Top right — pause, restart, settings"],
      ]
    : [
        [
          <span key="m" className="flex gap-1">
            <Key>W</Key>
            <Key>A</Key>
            <Key>S</Key>
            <Key>D</Key>
          </span>,
          "Move (or the arrow keys)",
        ],
        [<span key="mouse">Mouse</span>, "Look around — click the view to capture the mouse"],
        [<Key key="shift">Shift</Key>, "Run"],
        [<Key key="v">V</Key>, "Switch first / third person"],
        [<Key key="c">{keyLabel(callKey)}</Key>, "Call the goat — she bleats back, and a map shows where she is for a moment"],
        [<Key key="esc">Esc</Key>, "Pause"],
        [<Key key="m">M</Key>, "Music on / off"],
      ];

  return (
    <div className="absolute inset-0 z-[66] flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-3xl border border-white/10 bg-[#0b0d08]/95 p-6 text-[#fdf3d4] shadow-2xl">
        <h2 className={`${posterFont.className} text-center text-4xl tracking-wide`}>Find the goat</h2>
        <p className="mt-2 text-center text-sm text-white/70">
          Gugut&apos;s goat is somewhere in the maze. Find her and bring her home. The clock starts on your first
          step, and stops while you&apos;re paused. You can call her three times; after that your throat is dry
          until you find water — two bottles are hidden in the maze.
        </p>
        <dl className="mt-5 space-y-2.5">
          {rows.map(([what, does], i) => (
            <div key={i} className="flex items-center gap-4">
              <dt className="flex w-28 shrink-0 justify-end text-sm font-semibold text-white">{what}</dt>
              <dd className="text-sm text-white/75">{does}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={close}
            autoFocus
            className="rounded-full bg-amber-300 px-6 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-amber-200"
          >
            Got it — let&apos;s go
          </button>
        </div>
      </div>
    </div>
  );
}
