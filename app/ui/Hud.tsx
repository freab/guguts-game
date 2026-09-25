"use client";

import { useEffect, useState, type RefObject } from "react";

// Live run-timer readout (top-right). Runs its own interval so ticking doesn't
// re-render the 3D scene. Reads the shared start time from a ref owned by the
// parent, and freezes when `paused` (i.e. after the player escapes).
function format(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return m > 0 ? `${m}:${s.toFixed(1).padStart(4, "0")}` : `${s.toFixed(1)}s`;
}

export default function Hud({
  startRef,
  paused,
}: {
  startRef: RefObject<number>;
  paused: boolean;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      setElapsed((performance.now() - startRef.current) / 1000);
    }, 100);
    return () => clearInterval(id);
  }, [paused, startRef]);

  return (
    <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-black/50 px-4 py-1.5 font-mono text-lg font-semibold tabular-nums text-zinc-100 backdrop-blur">
      {format(elapsed)}
    </div>
  );
}
