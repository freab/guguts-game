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
  <kbd className="ui-key inline-flex min-w-7 items-center justify-center px-1.5 py-0.5 text-xs">
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
        [<span key="c">Call button</span>, "Bottom right — call the goat: she bleats back, and a map shows where she is"],
        [<span key="d">Drink / Talk</span>, "Shows up when you look at a bottle of water or a person close by — tap it"],
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
        [<Key key="c">{keyLabel(callKey)}</Key>, "Call the goat — she bleats back, and a map shows where she is for a moment"],
        [<Key key="e">E</Key>, "Drink / talk — look at a bottle of water or a person close by"],
        [<Key key="p">P</Key>, "Pause"],
        [<Key key="esc">Esc</Key>, "Free the mouse — click the view to look around again"],
        [<Key key="m">M</Key>, "Music on / off"],
      ];

  return (
    <div className="absolute inset-0 z-[66] flex items-center justify-center bg-black/60 p-4">
      <div className="ui-shell flex max-h-[92vh] w-full max-w-md flex-col p-1.5">
        <div className="ui-well min-h-0 overflow-y-auto p-6">
          <h2 className={`${posterFont.className} text-center text-4xl tracking-wide`}>Find the goat</h2>
          <p className="mt-2 text-center text-sm text-white/70">
            Gugut&apos;s goat is somewhere in the maze. Find her and bring her home. The clock starts on your first
            step, and stops while you&apos;re paused. You can call her three times; after that your throat is dry
            until you find water — two bottles are hidden in the maze: walk up to one, look at it and drink.
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
              className="ui-cta px-6 py-2.5 text-sm"
            >
              Got it — let&apos;s go
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
