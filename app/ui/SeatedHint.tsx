"use client";

import { temesgen, useTemesgen } from "../game/temesgen";

/**
 * While Gugut sits listening to Temesgen (game/temesgen `seated`): how calm
 * the song has made him (a bar filling over CALM_AFTER s — when it's full he
 * hears the goat bleat on her own), and how to get up — any move key on
 * desktop, a "Stand up" button (or the stick) on phones, above the Talk
 * button (both show while sat facing him). The song plays on, fading as he
 * walks away.
 */
export default function SeatedHint({ touch }: { touch: boolean }) {
  const { calm, calmed } = useTemesgen();
  const meter = (
    <span className="ui-well flex min-w-40 flex-col justify-center gap-1.5 px-3.5 py-2">
      <span className="text-xs text-cream/70">{calmed ? "Calm — you heard her" : "Listening… calming down"}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <span
          className={`block h-full rounded-full transition-[width] duration-500 ${calmed ? "bg-sky-300" : "bg-amber-200"}`}
          style={{ width: `${Math.round(calm * 100)}%` }}
        />
      </span>
    </span>
  );

  if (touch) {
    return (
      <div
        style={{ animation: "notice-in 400ms ease-out 1.2s both" }}
        className="ui-shell absolute bottom-50 right-6 z-20 flex items-stretch gap-1.5 p-1.5 text-base font-medium"
      >
        {meter}
        <button
          type="button"
          onClick={() => temesgen.standUp()}
          className="ui-cta flex min-h-12 touch-manipulation select-none items-center px-5 active:scale-95"
        >
          Stand up
        </button>
      </div>
    );
  }
  return (
    <div
      style={{ animation: "notice-in 400ms ease-out 1.2s both" }}
      className="ui-shell pointer-events-none absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-stretch gap-1.5 p-1.5 text-sm"
    >
      {meter}
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
