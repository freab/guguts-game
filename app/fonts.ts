import { Jolly_Lodger, Noto_Serif_Ethiopic } from "next/font/google";

/**
 * Display face matching the "GUGUT & THE GOAT" poster lettering (tall,
 * condensed, rough hand-cut strokes). Self-hosted by next/font. `display:
 * "block"` so the preloader never flashes a fallback font.
 */
export const posterFont = Jolly_Lodger({
  weight: "400",
  subsets: ["latin"],
  display: "block",
  // (Also as a CSS variable, for the UI kit in globals.css: ui-label.)
  variable: "--font-jolly",
});

/**
 * Ge'ez script for the one Amharic word in the game: "ጉጉት" (Gugut), carved
 * into a wall stone (maze/Carving). Self-hosted, so the carving reads the same
 * on every device; loaded only when the carving draws it.
 */
export const ethiopicFont = Noto_Serif_Ethiopic({
  weight: "700",
  subsets: ["ethiopic"],
  display: "swap",
  preload: false,
});
