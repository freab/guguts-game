import type { Metadata } from "next";
import { redirect } from "next/navigation";
import TrailerClient from "./TrailerClient";

export const metadata: Metadata = {
  title: "Gugut & the Goat · Trailer",
  robots: { index: false },
};

/** The launch trailer, played (and recorded) live from the game's scene (trailer/TrailerClient), on High graphics. */
export default async function TrailerPage({ searchParams }: PageProps<"/trailer">) {
  // (The presentation's client reads ?graphics= as it mounts.)
  if (!(await searchParams).graphics) redirect("/trailer?graphics=high");
  return (
    <main className="h-dvh w-screen">
      <TrailerClient />
    </main>
  );
}
