import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { LEVELS } from "../maze/levels";
import { formatTime, type ShareProfile } from "../leaderboard/shared";
import { SITE_URL } from "../site";

/**
 * The cards shown when a link to the game is posted on X, Telegram,
 * WhatsApp… (Open Graph / Twitter images, 1200 × 630), styled like the
 * title screen and preloader (ui/LoadingOverlay) and the in-game share cards
 * (share/shareCard): the maze entrance filling the card, darkened on the
 * left where the words sit; the GUGUT wordmark; the poster's cream lettering;
 * glass rows; the address on a gold pill with the cream play button. Either
 * the game's pitch (siteCard) or a player's best times, straight from the
 * leaderboard (playerCard), so a shared time can't be faked.
 */
export const CARD_SIZE = { width: 1200, height: 630 };

const C = {
  cream: "#fdf3d4",
  creamDim: "rgba(253,243,212,0.75)",
  gold: "#c9a45c",
  goldInk: "#2a2312",
  glass: "rgba(255,255,255,0.16)",
  glassEdge: "rgba(255,255,255,0.5)",
};
const SHADOW = "0 2px 14px rgba(20,16,8,0.55)";
const host = new URL(SITE_URL).host;

// Read once: the backdrop (a JPEG of public/preloader/first.webp — the
// renderer can't read WebP) and the wordmark.
const backdrop = readFile(join(process.cwd(), "public", "share", "maze.jpg")).then(
  (data) => `data:image/jpeg;base64,${data.toString("base64")}`
);
const logo = readFile(join(process.cwd(), "public", "logo gugut.svg")).then(
  (data) => `data:image/svg+xml;base64,${data.toString("base64")}`
);

/**
 * The poster lettering (Jolly Lodger) as a TTF, fetched from Google Fonts on
 * first use (the renderer needs the font file; the page's own copy is
 * WOFF2). Null if it can't be had — then the renderer's default face.
 */
let posterFont: Promise<ArrayBuffer | null> | null = null;
function loadPosterFont(): Promise<ArrayBuffer | null> {
  posterFont ??= (async () => {
    try {
      const css = await (await fetch("https://fonts.googleapis.com/css2?family=Jolly+Lodger")).text();
      const url = /src: url\((.+?)\) format\('(?:opentype|truetype)'\)/.exec(css)?.[1];
      if (!url) return null;
      const res = await fetch(url);
      return res.ok ? await res.arrayBuffer() : null;
    } catch {
      return null;
    }
  })();
  return posterFont;
}

/** A gold-edged pill beside the wordmark (the game's card: its win). */
const badge = (text: string) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      border: `2px solid ${C.gold}`,
      background: "rgba(20,16,8,0.55)",
      color: C.gold,
      borderRadius: 999,
      padding: "6px 20px",
      fontSize: 26,
      letterSpacing: 1,
    }}
  >
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.gold} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" />
    </svg>
    {text}
  </div>
);

async function frame(children: React.ReactNode, tag?: string, padBottom = 48) {
  const [bg, mark, font] = await Promise.all([backdrop, logo, loadPosterFont()]);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          color: C.cream,
          fontFamily: font ? "Jolly Lodger" : undefined,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- (an image in a generated card, not a page) */}
        <img src={bg} width={1200} height={630} style={{ position: "absolute", top: 0, left: 0, objectFit: "cover" }} alt="" />
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 1200,
            height: 630,
            backgroundImage: "linear-gradient(90deg, rgba(20,16,8,0.85) 0%, rgba(20,16,8,0.6) 50%, rgba(20,16,8,0.08) 100%)",
          }}
        />
        <div style={{ position: "relative", display: "flex", flexDirection: "column", justifyContent: "space-between", width: 720, height: 630, padding: `48px 56px ${padBottom}px` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mark} width={190} height={126} alt="Gugut & the Goat" />
            {tag && badge(tag)}
          </div>
          {children}
        </div>
      </div>
    ),
    { ...CARD_SIZE, fonts: font ? [{ name: "Jolly Lodger", data: font, weight: 400, style: "normal" }] : undefined }
  );
}

/** The invitation, and the address on the gold pill with the cream play button. */
const footer = (line: string) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
    <div style={{ fontSize: 34, color: C.creamDim, textShadow: SHADOW }}>{line}</div>
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        background: C.gold,
        color: C.goldInk,
        borderRadius: 999,
        padding: "8px 8px 8px 26px",
        fontSize: 32,
        boxShadow: "0 6px 30px rgba(20,16,8,0.35)",
      }}
    >
      {host}
      <svg width="40" height="40" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="12" fill={C.cream} />
        <path d="M9.5 7.5v9l7-4.5z" fill={C.gold} />
      </svg>
    </div>
  </div>
);

/** The game itself: what it is, and an invitation. */
export function siteCard() {
  return frame(
    <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
      <div style={{ display: "flex", flexDirection: "column", textShadow: SHADOW }}>
        <div style={{ fontSize: 76, lineHeight: 1 }}>Gugut&apos;s goat ran into the maze.</div>
        <div style={{ fontSize: 36, color: C.creamDim, marginTop: 16, lineHeight: 1.2 }}>
          A 3D maze game from Ethiopia. Find her before sundown — call her, follow her bleat, rest by Temesgen&apos;s krar.
        </div>
      </div>
      {footer("Play free in your browser")}
    </div>,
    "WINNER · STARK HACKATHON"
  );
}

/**
 * The game's card for X (app/twitter-image), which shows only the picture
 * (no title or description) small in the feed, with the address on a dark
 * label over its bottom-left corner: fewer, bigger words, and nothing that
 * matters down in that corner (the play pill sits above it).
 */
export function xCard() {
  return frame(
    <div style={{ display: "flex", flexDirection: "column", gap: 34 }}>
      <div style={{ display: "flex", flexDirection: "column", textShadow: SHADOW }}>
        <div style={{ fontSize: 92, lineHeight: 0.98 }}>Find the goat before sundown.</div>
        <div style={{ fontSize: 42, color: C.creamDim, marginTop: 18, lineHeight: 1.15 }}>A free 3D maze game from Ethiopia.</div>
      </div>
      <div style={{ display: "flex" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            background: C.gold,
            color: C.goldInk,
            borderRadius: 999,
            padding: "10px 10px 10px 30px",
            fontSize: 38,
            boxShadow: "0 6px 30px rgba(20,16,8,0.35)",
          }}
        >
          Play free in your browser
          <svg width="46" height="46" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="12" fill={C.cream} />
            <path d="M9.5 7.5v9l7-4.5z" fill={C.gold} />
          </svg>
        </div>
      </div>
    </div>,
    "WINNER · STARK HACKATHON",
    // (Clear of X's address label, bottom left.)
    92
  );
}

/** A player's best times, rank and all — read from the leaderboard. */
export function playerCard(profile: ShareProfile) {
  const rows = LEVELS.filter((l) => profile.bests[l.id]);
  return frame(
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div style={{ fontSize: 56, lineHeight: 1, textShadow: SHADOW }}>{`${profile.name} found the goat`}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.length === 0 && <div style={{ fontSize: 36, color: C.creamDim }}>Still searching the maze…</div>}
        {rows.map((l) => {
          const best = profile.bests[l.id]!;
          return (
            <div
              key={l.id}
              style={{
                display: "flex",
                alignItems: "center",
                background: C.glass,
                border: `2px solid ${C.glassEdge}`,
                borderRadius: 22,
                padding: "6px 26px",
              }}
            >
              <div style={{ width: 130, fontSize: 36, color: C.creamDim }}>{l.label}</div>
              <div style={{ flex: 1, fontSize: 60, textShadow: SHADOW }}>{formatTime(best.timeMs)}</div>
              {/* (One string: a box with several text pieces needs flex in the card renderer.) */}
              <div style={{ fontSize: 34 }}>{`#${best.rank} of ${best.players}`}</div>
            </div>
          );
        })}
      </div>
      {footer("Can you find her faster?")}
    </div>
  );
}
