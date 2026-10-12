import posthog from "posthog-js";

/**
 * PostHog (the game's stats: game/stats, plus visits, countries, devices,
 * languages, errors, load speed and, if switched on in PostHog, session replays). Only with a project key
 * (NEXT_PUBLIC_POSTHOG_KEY, see .env.example); without one, nothing is sent.
 * Sent through this site (/ingest, next.config), so ad blockers don't drop it.
 */
const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
if (key) {
  try {
    posthog.init(key, {
      api_host: "/ingest",
      ui_host: process.env.NEXT_PUBLIC_POSTHOG_HOST?.includes("eu.") ? "https://eu.posthog.com" : "https://us.posthog.com",
      defaults: "2026-08-30",
      // Anonymous players: no person profiles (nobody signs in).
      person_profiles: "identified_only",
      // Not on a dev machine.
      opt_out_capturing_by_default: location.hostname === "localhost",
      // Errors (Error tracking) and load speed (Web vitals), both in the free tier.
      capture_exceptions: true,
      capture_performance: { web_vitals: true },
    });
    // On every event: the player's language and how they play.
    posthog.register({
      language: navigator.language,
      input: matchMedia("(pointer: coarse)").matches ? "touch" : "mouse",
    });
  } catch {
    // Stats never get in the way of the game.
  }
}
