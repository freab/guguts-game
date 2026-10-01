import type { MetadataRoute } from "next";

/**
 * The web-app manifest: "Add to Home Screen" opens the game fullscreen in
 * landscape — the only way to get fullscreen on iPhone, which has no
 * fullscreen for pages (elsewhere ui/fullscreen.ts uses the Fullscreen API).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Gugut & the Goat",
    short_name: "Gugut",
    description: "Find Gugut's runaway goat in the maze before the sun goes down.",
    start_url: "/",
    display: "fullscreen",
    orientation: "landscape",
    background_color: "#0b0d08",
    theme_color: "#0b0d08",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
