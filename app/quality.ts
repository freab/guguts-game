/**
 * The phone / tablet quality tier. A touch screen with no mouse (no fine
 * pointer that can hover) gets lighter settings everywhere it counts — pixel
 * ratio, post-processing, vegetation density, bake sizes — so it runs smooth
 * on a phone GPU. Desktops never take these paths: every `MOBILE ? a : b`
 * keeps the desktop value as `b`, unchanged.
 *
 * Evaluated once, in the browser (the 3D scene is client-only). The UI uses
 * the same test in CSS (`pointer-coarse:` / the media query in globals.css).
 */
export const MOBILE =
  typeof window !== "undefined" && window.matchMedia("(pointer: coarse) and (hover: none)").matches;

/** `mobile` on phones and tablets, `desktop` everywhere else. */
export function tier<T>(desktop: T, mobile: T): T {
  return MOBILE ? mobile : desktop;
}
