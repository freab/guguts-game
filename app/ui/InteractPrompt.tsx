"use client";

import type { ReactNode } from "react";

/**
 * "Press E to …": shown while Gugut is close to something he can use and
 * looking at it (a bottle of water, Temesgen) — a key prompt in the middle of
 * the view on desktop (press E, or click it), a big button above the call
 * button on phones.
 */
export default function InteractPrompt({
  touch,
  label,
  ariaLabel,
  icon,
  iconClassName = "",
  onPress,
}: {
  touch: boolean;
  label: string;
  ariaLabel: string;
  /** SVG content for the dark icon key (24 × 24 viewBox). */
  icon: ReactNode;
  iconClassName?: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={ariaLabel}
      style={{ animation: "notice-in 180ms ease-out" }}
      className={`ui-shell absolute z-20 flex touch-manipulation select-none items-stretch gap-1.5 p-1.5 font-medium active:scale-95 ${
        touch ? "bottom-30 right-6 text-base" : "left-1/2 top-[62%] -translate-x-1/2 text-sm"
      }`}
    >
      <span className={`ui-mark flex items-center justify-center ${iconClassName} ${touch ? "h-12 w-12" : "h-10 w-10"}`}>
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
          {icon}
        </svg>
      </span>
      <span className={touch ? "ui-cta ui-label flex items-center px-5" : "ui-tile ui-label flex items-center px-3.5"}>{label}</span>
      {!touch && <kbd className="ui-cta flex min-w-10 items-center justify-center px-2 font-mono text-sm">E</kbd>}
    </button>
  );
}
