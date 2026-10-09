"use client";

import Dialog from "./Dialog";

/** Who made the game, and whose work is in it (the same list as the README's Credits). */
const CREDITS: { role: string; who: string; detail?: string; href?: string }[] = [
  { role: "Designs", who: "Eman Issae" },
  { role: "Voice of Gugut", who: "Surafel Yimam", detail: "The voiceovers" },
  { role: "Music", who: "Temesgen", detail: "“Nostalgia” — all rights belong to the artist", href: "https://temesgen.com" },
  {
    role: "Sound effects",
    who: "Joseph Sardin, BigSoundBank",
    detail: "Birds, footsteps, goat bleats and drinking (public domain)",
    href: "https://bigsoundbank.com",
  },
  { role: "Textures", who: "Poly Haven and ambientCG", detail: "Public domain" },
  { role: "Grass", who: "Ebenezer", detail: "Based on FluffyGrass (MIT license)", href: "https://github.com/thebenezer/FluffyGrass" },
  { role: "Fonts", who: "Jolly Lodger and Geist", detail: "Google Fonts" },
];

/** The credits (pause menu, end of a run). */
export default function CreditsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Credits" onClose={onClose}>
      <dl className="space-y-3">
        {CREDITS.map((c) => (
          <div key={c.role}>
            <dt className="text-xs uppercase tracking-wider text-white/45">{c.role}</dt>
            <dd className="text-sm text-white/85">
              {c.href ? (
                <a href={c.href} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-4 hover:text-white">
                  {c.who}
                </a>
              ) : (
                <span className="font-semibold">{c.who}</span>
              )}
              {c.detail && <span className="block text-xs text-white/50">{c.detail}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
