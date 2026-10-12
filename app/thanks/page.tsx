import type { Metadata } from "next";
import ThanksClient from "./ThanksClient";

export const metadata: Metadata = {
  title: "Gugut & the Goat · Thank you",
  description: "Gugut & the Goat won Stark Hackathon. Thank you.",
};

/**
 * After winning Stark Hackathon: the thank-you pictures (thanks/thanksCard),
 * one card after another (→ / ←), each with its shot and light picked from
 * the scene's best angles (thanks/ThanksClient), each downloadable.
 */
export default function ThanksPage() {
  return (
    <main className="relative h-screen w-screen">
      <ThanksClient />
    </main>
  );
}
