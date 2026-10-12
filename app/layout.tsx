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
  title: SITE_NAME,
  description: "Find Gugut's runaway goat in the maze before the sun goes down.",
  openGraph: { siteName: SITE_NAME, type: "website" },
  twitter: { card: "summary_large_image" },
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
