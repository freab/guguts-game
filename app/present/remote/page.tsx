import type { Metadata, Viewport } from "next";
import RemoteClient from "./RemoteClient";

export const metadata: Metadata = {
  title: "Gugut · Remote",
  robots: { index: false },
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

/** The presentation's phone remote: pair with the code on the laptop, then drive the slides from here. */
export default function RemotePage() {
  return (
    <main className="min-h-dvh w-full bg-black">
      <RemoteClient />
    </main>
  );
}
