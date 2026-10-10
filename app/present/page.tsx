import type { Metadata } from "next";
import PresentClient from "./PresentClient";
import { BUILD_SLIDES } from "./buildSlides";

export const metadata: Metadata = {
  title: "Gugut & the Goat · How it's made",
  robots: { index: false },
};

/**
 * The hackathon presentation, "How it's made": the game's own scene built up
 * from nothing, one piece per slide (present/buildSlides), then played.
 * Silent until the sound slide brings the mix in, layer by layer.
 */
export default function PresentPage() {
  return (
    <main className="h-screen w-screen">
      {/* Silent until the sound slide: the first whose steps bring in the mix. */}
      <PresentClient slides={BUILD_SLIDES} silentUntil={BUILD_SLIDES.findIndex((s) => s.steps?.some((step) => step.mix))} />
    </main>
  );
}
