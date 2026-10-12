import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { posterFont } from "./fonts";
import { SITE_NAME, SITE_URL } from "./site";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Absolute URLs for the link-preview cards (app/opengraph-image, app/s/[id]).
  metadataBase: new URL(SITE_URL),
  title: `${SITE_NAME} · a 3D maze game from Ethiopia`,
  description: "Find Gugut's runaway goat in a 3D maze before sundown. A free browser game from Ethiopia, winner of Stark Hackathon. No download: plays on phones and computers.",
  keywords: ["maze game", "3D browser game", "free online game", "Ethiopia", "Ethiopian game", "WebGPU", "three.js", "goat", "Kaldi", "coffee legend", "Gugut"],
  openGraph: { siteName: SITE_NAME, type: "website", locale: "en_US" },
  // X: its own card (app/twitter-image), and a shorter line.
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME}: find the goat before sundown`,
    description: "A free 3D maze game from Ethiopia, winner of Stark Hackathon. Plays in your browser.",
    // Made by (credited when the link is shared).
    creator: "@freabM",
    site: "@freabM",
  },
  // Home-screen app on iPhone: no browser bars (see app/manifest.ts); an opaque status bar, so nothing sits under the clock or the notch.
  appleWebApp: { capable: true, title: "Gugut", statusBarStyle: "black" },
};

/* Vercel: Web Analytics (visitors, countries, devices, pages) and Speed Insights
   (how fast it loads for real players). The game's own stats: PostHog (game/stats). */
export const viewport: Viewport = {
  themeColor: "#0b0d08",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${posterFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col overflow-hidden m-0">
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
