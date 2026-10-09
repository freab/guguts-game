import { levaStore } from "leva";
import { getPreferences, type Graphics } from "./game/preferences";

export type { Graphics };

/**
 * Graphics quality: Low, Medium or High, chosen on the title screen (or in
 * Settings) — before a level loads, so the scene is built for it.
 * - Low is what phones always ran: lighter post-processing, sparser grass,
 *   flowers and ivy, smaller bakes, no parallax on the walls.
 * - Medium is the PC look as it was tuned — unchanged.
 * - High is everything on and more of it: denser flowers, grass and ivy,
 *   sharper rays and shadows, a finer ground bake, a sharper image.
 * Not chosen yet: Low on phones and tablets, Medium everywhere else.
 *
 * Read when the scene mounts (never at module load: the choice can change
 * between levels). leva keeps a control's value across remounts, so the
 * values that live in the panel are also written to it (applyGraphicsToPanel).
 */

/**
 * A touch screen with no mouse (no fine pointer that can hover): a phone or
 * tablet. Evaluated once, in the browser. The UI uses the same test in CSS
 * (`pointer-coarse:` / the media query in globals.css).
 */
export const MOBILE =
  typeof window !== "undefined" && window.matchMedia("(pointer: coarse) and (hover: none)").matches;

export const GRAPHICS_LEVELS: readonly Graphics[] = ["low", "medium", "high"];

/** The level the player hasn't chosen yet: Low on phones, Medium on a PC. */
export const defaultGraphics = (): Graphics => (MOBILE ? "low" : "medium");

/** The graphics level in use. */
export function graphics(): Graphics {
  return getPreferences().graphics ?? defaultGraphics();
}

/** The value for the graphics level in use. */
export function quality<T>(low: T, medium: T, high: T): T {
  const g = graphics();
  return g === "low" ? low : g === "high" ? high : medium;
}

/**
 * The quality settings that are leva controls, by path suffix (the panel's
 * folder and key): [low, medium, high]. Their defaults in the schemas read
 * the same values via quality().
 */
export const PANEL_QUALITY: Record<string, [unknown, unknown, unknown]> = {
  "Grass.density": [5, 8, 11],
  "Flowers.density": [5, 8, 11],
  "Flowers.headsPerPlant": [7, 11, 12],
  "Flowers.drawDistance": [6, 8, 12],
  "Tree.lodNear": [10, 16, 24],
  "Tree.lodMin": [0.12, 0.2, 0.3],
  "Vines.leafDensity": [15, 24, 30],
  viewDistance: [12, 15, 18],
  msaa: [2, 4, 4],
  raysSteps: [24, 40, 64],
  raysResolution: [0.25, 0.5, 0.5],
  flare: [false, true, true],
};

/** A panel quality setting's value for the level in use (for a schema default). */
export function panelQuality<T>(key: keyof typeof PANEL_QUALITY): T {
  const [low, medium, high] = PANEL_QUALITY[key];
  return quality(low, medium, high) as T;
}

/**
 * Write the level in use into the panel's quality controls that already
 * exist (a scene was loaded before): leva would otherwise keep their old
 * values when the next scene mounts. Controls not created yet take theirs
 * from the schema defaults.
 */
export function applyGraphicsToPanel() {
  const paths = Object.keys(levaStore.getData());
  for (const [key, [low, medium, high]] of Object.entries(PANEL_QUALITY)) {
    const path = paths.find((p) => p === key || p.endsWith(`.${key}`));
    if (path) levaStore.setValueAtPath(path, quality(low, medium, high), false);
  }
}
