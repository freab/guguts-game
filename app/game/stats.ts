"use client";

import posthog from "posthog-js";
import { getPreferences } from "./preferences";

/**
 * The game's own stats, as PostHog events (set up in instrumentation-client;
 * visits, countries, devices, errors and load speed come with it). Never
 * anything about the player beyond what's here (no names):
 *
 * - `level_chosen`: a level picked on the title screen;
 * - `run_start`: a maze begun (first step), with the setup;
 * - `goat_call`, `throat_dry`, `water_drunk`: calling her, and the water;
 * - `goat_seen`: the first sight of her (seconds in);
 * - `temesgen_song`: one of his songs starts (which);
 * - `jebena_found`, `buna`: the secrets;
 * - `photo_taken`;
 * - `goat_found`: a maze finished (time, calls, average frame rate);
 * - `run_abandoned`: the page left mid-maze (how far in);
 * - `share`: a result shared, and how.
 *
 * Every event also carries (registered once): the browser's language, touch or
 * mouse (instrumentation-client) and the renderer, WebGPU or WebGL (Scene).
 * Nothing is sent from /present (the deck plays the game too).
 */
type Props = Record<string, string | number | boolean | null>;

/** PostHog is set up and sending (a key, and not blocked), and this is the game (not the /present deck, which plays it too). */
const live = () => typeof window !== "undefined" && posthog.__loaded && !location.pathname.startsWith("/present");

export function stat(name: string, props: Props = {}, beacon = false) {
  if (!live()) return;
  try {
    posthog.capture(name, props, beacon ? { transport: "sendBeacon" } : undefined);
  } catch {
    // Stats never get in the way of the game.
  }
}

/** Properties sent with every event from now on. */
export function statContext(props: Props) {
  if (!live()) return;
  try {
    posthog.register(props);
  } catch {
    // As above.
  }
}

/** The player's setup, for run_start: graphics, voice, subtitles. */
export function setupProps(): Props {
  const prefs = getPreferences();
  return { graphics: prefs.graphics ?? "default", voice: prefs.voice, subtitles: prefs.subtitles };
}

/* ---------- frame rate over a run ---------- */

let frames = 0;
let since = 0;
let raf = 0;

/** Count frames from now (a run starts), for the run's average frame rate. */
export function startFrameCount() {
  stopFrameCount();
  frames = 0;
  since = performance.now();
  const tick = () => {
    frames++;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

/** Stop counting: the average frames per second since startFrameCount. */
export function stopFrameCount(): number | null {
  if (!raf) return null;
  cancelAnimationFrame(raf);
  raf = 0;
  const seconds = (performance.now() - since) / 1000;
  return seconds > 1 ? Math.round(frames / seconds) : null;
}
