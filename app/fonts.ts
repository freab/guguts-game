import { Jolly_Lodger } from "next/font/google";

/**
 * Display face matching the "GUGUT & THE GOAT" poster lettering (tall,
 * condensed, rough hand-cut strokes). Self-hosted by next/font. `display:
 * "block"` so the preloader never flashes a fallback font.
 */
export const posterFont = Jolly_Lodger({
  weight: "400",
  subsets: ["latin"],
  display: "block",
});
