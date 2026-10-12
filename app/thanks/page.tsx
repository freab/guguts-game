import { notFound } from "next/navigation";

// The thank-you pictures, switched off for now: /thanks is a 404. To bring
// them back, restore the page below (and drop the notFound one).
//
// import type { Metadata } from "next";
// import ThanksClient from "./ThanksClient";
//
// export const metadata: Metadata = {
//   title: "Gugut & the Goat · Thank you",
//   description: "Gugut & the Goat won Stark Hackathon. Thank you.",
// };
//
// /**
//  * After winning Stark Hackathon: the thank-you pictures (thanks/thanksCard),
//  * one card after another (→ / ←), each with its shot and light picked from
//  * the scene's best angles (thanks/ThanksClient), each downloadable.
//  */
// export default function ThanksPage() {
//   return (
//     <main className="relative h-screen w-screen">
//       <ThanksClient />
//     </main>
//   );
// }

export default function ThanksPage() {
  notFound();
}
