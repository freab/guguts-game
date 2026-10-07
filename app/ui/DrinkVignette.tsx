"use client";

import { useRun } from "../game/runStore";

/**
 * A cool, blue rush at the edges of the view when Gugut drinks — the water
 * reaching him (runStore.drink). Keyed by how many bottles he has drunk, so
 * each drink plays it once.
 */
export default function DrinkVignette() {
  const { bottlesTaken, phase } = useRun();
  const drunk = bottlesTaken.filter(Boolean).length;
  if (drunk === 0 || phase === "idle") return null;
  return (
    <div
      key={drunk}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10"
      style={{
        background: "radial-gradient(ellipse at center, transparent 45%, rgba(110, 185, 255, 0.42) 100%)",
        animation: "drink-vignette 1.6s ease-out both",
      }}
    />
  );
}
