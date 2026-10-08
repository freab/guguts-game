import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SITE_NAME, SITE_URL } from "./site";

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
  // Home-screen app on iPhone: fullscreen, no browser bars (see app/manifest.ts).
  appleWebApp: { capable: true, title: "Gugut", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0b0d08",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col overflow-hidden m-0">{children}</body>
    </html>
  );
}
