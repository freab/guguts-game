"use client";

import { temesgen } from "../game/temesgen";

/**
 * While Gugut sits listening to Temesgen (game/temesgen `seated`): how to get
 * up — any move key on desktop, a "Stand up" button (or the stick) on phones,
 * above the Talk button (both show while sat facing him).
 * The song plays on, fading as he walks away.
 */
export default function SeatedHint({ touch }: { touch: boolean }) {
  if (touch) {
    return (
      <button
        type="button"
        onClick={() => temesgen.standUp()}
        style={{ animation: "notice-in 400ms ease-out 1.2s both" }}
        className="ui-shell absolute bottom-50 right-6 z-20 flex touch-manipulation select-none p-1.5 text-base font-medium active:scale-95"
      >
        <span className="ui-cta flex min-h-12 items-center px-5">Stand up</span>
      </button>
    );
  }
  return (
    <div
      style={{ animation: "notice-in 400ms ease-out 1.2s both" }}
      className="ui-shell pointer-events-none absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-stretch gap-1.5 p-1.5 text-sm"
    >
      <span className="ui-well flex items-center gap-1 px-2">
        {["W", "A", "S", "D"].map((k) => (
          <kbd key={k} className="ui-key px-1.5 py-0.5 text-xs">
            {k}
          </kbd>
        ))}
      </span>
      <span className="ui-tile flex items-center px-3.5 py-2">Move to stand up</span>
    </div>
  );
}
