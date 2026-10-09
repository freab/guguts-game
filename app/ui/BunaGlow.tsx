"use client";

import { useEffect, useState } from "react";
import { BUNA_SECONDS, useBunaUntil } from "../game/secrets";

/**
 * The BUNA secret's glow (game/secrets): a warm coffee-gold light pulsing
 * round the edge of the screen while the coffee lasts, fading as it wears off.
 */
export default function BunaGlow() {
  const until = useBunaUntil();
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!until) return;
    const left = until - performance.now();
    if (left <= 0) return;
    const start = setTimeout(() => setOn(true), 0);
    const stop = setTimeout(() => setOn(false), left);
    return () => {
      clearTimeout(start);
      clearTimeout(stop);
    };
  }, [until]);
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[15] transition-opacity duration-1000"
      style={{
        opacity: on ? 1 : 0,
        background: "radial-gradient(ellipse at center, transparent 55%, rgba(201, 120, 40, 0.38) 100%)",
        animation: on ? `buna-pulse 900ms ease-in-out ${Math.ceil((BUNA_SECONDS * 1000) / 900)}` : undefined,
      }}
    />
  );
}
