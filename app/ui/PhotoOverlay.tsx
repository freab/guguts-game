"use client";

import { useEffect, useState } from "react";
import { posterFont } from "../fonts";
import { duskForRun } from "../scene/dusk";
import { PHOTO_FOV_DEFAULT, photo, usePhoto } from "../game/photo";

/** How long the "saved" flash and note stay (ms). */
const SAVED_MS = 1800;

/**
 * Photo mode's panel (game/photo): the lens (field of view), the time of day
 * (the sunset held anywhere from the start to full dusk, or as the run has
 * it), save, hide the panel, leave. Keys: Enter saves, H hides the panel, F
 * or Esc leaves. A white flash and a note when a photo is saved.
 */
export default function PhotoOverlay({ touch }: { touch: boolean }) {
  const p = usePhoto();

  // Enter saves, H hides the panel, F / Esc leave. (Caught first, so Esc
  // doesn't also reach the pause menu, nor F the game.)
  useEffect(() => {
    if (!p.active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === "Enter" || e.code === "NumpadEnter") photo.capture();
      else if (e.code === "KeyH") photo.togglePanel();
      else if (e.code === "Escape" || e.code === "KeyF") photo.close();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [p.active]);

  // The flash and the note, for a moment after each save.
  const [flash, setFlash] = useState(0);
  useEffect(() => {
    if (!p.savedAt) return;
    const show = setTimeout(() => setFlash(p.savedAt), 0);
    const hide = setTimeout(() => setFlash(0), SAVED_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [p.savedAt]);

  if (!p.active) return null;
  const dusk = p.dusk ?? duskForRun();
  const label = "text-xs uppercase tracking-wider text-cream/50";
  return (
    <div className="pointer-events-none absolute inset-0 z-[58]">
      {/* The saved flash. */}
      {flash > 0 && (
        <div key={flash} className="absolute inset-0 bg-white" style={{ animation: "photo-flash 500ms ease-out forwards" }} />
      )}

      {p.panel ? (
        <div className="ui-shell pointer-events-auto absolute bottom-4 left-1/2 w-[min(46rem,94vw)] -translate-x-1/2 p-1.5">
          <div className="ui-well flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3">
            <div className={`${posterFont.className} text-3xl leading-none tracking-wide`}>Photo mode</div>

            <label className="flex min-w-[9rem] flex-1 flex-col gap-1">
              <span className={label}>Lens · {Math.round(p.fov)}°</span>
              <input
                type="range"
                min={25}
                max={100}
                step={1}
                value={p.fov}
                onChange={(e) => photo.setFov(Number(e.target.value))}
                onDoubleClick={() => photo.setFov(PHOTO_FOV_DEFAULT)}
                className="accent-amber-300"
              />
            </label>

            <label className="flex min-w-[9rem] flex-1 flex-col gap-1">
              <span className={label}>
                Sun · {dusk < 0.15 ? "golden hour" : dusk < 0.65 ? "sunset" : "dusk"}
                {p.dusk === null ? " (as now)" : ""}
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={dusk}
                onChange={(e) => photo.setDusk(Number(e.target.value))}
                onDoubleClick={() => photo.setDusk(null)}
                className="accent-amber-300"
              />
            </label>

            <div className="flex items-center gap-2">
              <button type="button" onClick={() => photo.capture()} className="ui-cta px-4 py-2 ui-label">
                Save photo
              </button>
              <button type="button" onClick={() => photo.togglePanel()} className="ui-tile px-3 py-2 ui-label" title="Hide panel (H)">
                Hide
              </button>
              <button type="button" onClick={() => photo.close()} className="ui-tile px-3 py-2 ui-label" title="Leave (F / Esc)">
                Done
              </button>
            </div>

            {!touch && (
              <p className="w-full text-xs text-cream/45">
                WASD fly · Space / Q up and down · Shift faster · click and move the mouse to look · Enter saves · H hides
                this · F or Esc leaves
              </p>
            )}
          </div>
        </div>
      ) : (
        touch && (
          <button
            type="button"
            onClick={() => photo.togglePanel()}
            className="ui-tile pointer-events-auto absolute right-4 bottom-4 px-3 py-2 ui-label"
          >
            Show panel
          </button>
        )
      )}

      {flash > 0 && (
        <div className="ui-shell absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 text-sm" style={{ animation: "notice-in 300ms ease-out both" }}>
          Photo saved to your downloads
        </div>
      )}
    </div>
  );
}
