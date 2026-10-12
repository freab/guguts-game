"use client";

import { useState } from "react";
import { stat } from "../game/stats";
import { SUPPORT_BIRR_URL, SUPPORT_URL } from "../support";
import Dialog from "./Dialog";

/** A coffee cup, steaming (also the top bar's support button: scene/SceneClient). */
export const CUP_PATH =
  "M17 9h1a3 3 0 0 1 0 6h-1M3 9h14v6a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V9ZM7 2.5c0 1-1 1.5-1 2.5s1 1.5 1 2.5M11 2.5c0 1-1 1.5-1 2.5s1 1.5 1 2.5";

export function CupIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={CUP_PATH} />
    </svg>
  );
}

/**
 * The ways to support the game (app/support): Buy Me a Coffee, and in birr
 * (Jami). `from`: where, for the stats (support_click).
 */
export function SupportLink({ from }: { from: string }) {
  const clicked = (via: string) => () => stat("support_click", { from, via });
  return (
    <div className="space-y-2">
      <a
        href={SUPPORT_URL}
        target="_blank"
        rel="noreferrer"
        onClick={clicked("coffee")}
        className="ui-cta flex w-full items-center justify-center gap-2 px-5 py-2.5 ui-label"
      >
        <CupIcon /> Buy me a coffee
      </a>
      <a
        href={SUPPORT_BIRR_URL}
        target="_blank"
        rel="noreferrer"
        onClick={clicked("birr")}
        className="ui-tile flex w-full items-center justify-center gap-2 px-5 py-2.5 ui-label"
      >
        In Ethiopia? Tip in birr · በብር
      </a>
    </div>
  );
}

/** "Buy Gugut a buna": a thank-you note and the link, in a dialog. */
export default function SupportDialog({ from, onClose }: { from: string; onClose: () => void }) {
  return (
    <Dialog title="Buy Gugut a buna" onClose={onClose}>
      <p className="mb-5 text-sm leading-relaxed text-cream/70">
        Gugut &amp; the Goat is free, made in Ethiopia by one person. If it made you smile, a coffee keeps the next
        maze coming. Thank you!
      </p>
      <SupportLink from={from} />
    </Dialog>
  );
}

/** The button that opens it. */
export function SupportButton({ from, className = "" }: { from: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          stat("support_open", { from });
          setOpen(true);
        }}
        className={`flex items-center justify-center gap-2 ${className}`}
      >
        <CupIcon /> Buy Gugut a buna
      </button>
      {open && <SupportDialog from={from} onClose={() => setOpen(false)} />}
    </>
  );
}
