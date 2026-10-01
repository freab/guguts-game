"use client";

import { useSyncExternalStore } from "react";

/**
 * Fullscreen and landscape for phones. Android (and desktop, iPad) have the
 * Fullscreen API, and in fullscreen Android can lock the screen to landscape.
 * iPhone Safari has no fullscreen for pages: there the way in is "Add to Home
 * Screen" (the web-app manifest opens it fullscreen, in landscape).
 */

type FullscreenDoc = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null };
type FullscreenEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

export function fullscreenSupported(): boolean {
  if (typeof document === "undefined") return false;
  const d = document as FullscreenDoc;
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}

function fullscreenElement(): Element | null {
  const d = document as FullscreenDoc;
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

/** Go fullscreen (must be called from a tap / click); optionally lock to landscape. */
export async function enterFullscreen(landscape = false): Promise<void> {
  if (!fullscreenSupported() || fullscreenElement()) return;
  const el = document.documentElement as FullscreenEl;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: "hide" });
    else await el.webkitRequestFullscreen?.();
  } catch {
    return; // refused (no gesture, iframe…): stay as we are
  }
  if (landscape) {
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await orientation.lock?.("landscape").catch(() => {});
  }
}

export async function exitFullscreen(): Promise<void> {
  if (fullscreenElement() && document.exitFullscreen) await document.exitFullscreen().catch(() => {});
}

export function useIsFullscreen(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      document.addEventListener("fullscreenchange", onChange);
      document.addEventListener("webkitfullscreenchange", onChange);
      return () => {
        document.removeEventListener("fullscreenchange", onChange);
        document.removeEventListener("webkitfullscreenchange", onChange);
      };
    },
    () => !!fullscreenElement(),
    () => false
  );
}

const portrait = () => window.matchMedia("(orientation: portrait)");

/** True while the screen is taller than wide. */
export function useIsPortrait(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = portrait();
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => portrait().matches,
    () => false
  );
}

/** Running as an installed home-screen app (already fullscreen, no browser bars). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
