import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { LEVELS } from "../maze/levels";
import { formatTime, type ShareProfile } from "../leaderboard/shared";
import { SITE_URL } from "../site";

/**
 * The cards shown when a link to the game is posted on X, Telegram,
 * WhatsApp… (Open Graph / Twitter images, 1200 × 630): the poster on the
 * left, and on the right — in the game's grey UI kit — either the game's
 * pitch (siteCard) or a player's best times, straight from the leaderboard
 * (playerCard), so a shared time can't be faked.
 */
export const CARD_SIZE = { width: 1200, height: 630 };

// The poster (a light JPEG of public/GGP (2).png), read once.
const poster = readFile(join(process.cwd(), "public", "share", "poster.jpg")).then(
  (data) => `data:image/jpeg;base64,${data.toString("base64")}`
);

const C = { bg: "#1c1c1c", frame: "#4a4a4a", well: "#383838", tile: "#3e3e3e", ink: "#ececec", dim: "#a3a3a3", amber: "#fcd34d" };
const host = new URL(SITE_URL).host;

async function frame(children: React.ReactNode) {
  const src = await poster;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: C.bg, color: C.ink }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- (an image in a generated card, not a page) */}
        <img src={src} width={429} height={630} style={{ objectFit: "cover" }} alt="" />
        <div style={{ flex: 1, display: "flex", padding: 40 }}>
          <div style={{ flex: 1, display: "flex", background: C.frame, borderRadius: 28, padding: 10 }}>
            <div
              style={{
                flex: 1,
                display: "flex",
                background: C.well,
                borderRadius: 20,
                padding: "36px 40px",
              }}
            >
              {children}
            </div>
          </div>
        </div>
      </div>
    ),
    CARD_SIZE
  );
}

const footer = (line: string) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
    <div style={{ fontSize: 26, color: C.dim }}>{line}</div>
    <div style={{ display: "flex", background: C.ink, color: "#151515", borderRadius: 14, padding: "10px 20px", fontSize: 24, fontWeight: 700 }}>
      {host}
    </div>
  </div>
);

/** The game itself: what it is, and an invitation. */
export function siteCard() {
  return frame(
    <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 22, letterSpacing: 6, color: C.dim }}>A MAZE BEFORE SUNDOWN</div>
        <div style={{ fontSize: 64, fontWeight: 700, marginTop: 12 }}>Gugut&apos;s goat ran into the maze.</div>
        <div style={{ fontSize: 30, color: C.dim, marginTop: 18 }}>
          Find her before the sun goes down — call her, follow her bleat, find water, and listen to the kirar by the old tree.
        </div>
      </div>
      {footer("Play free in your browser")}
    </div>
  );
}

/** A player's best times, rank and all — read from the leaderboard. */
export function playerCard(profile: ShareProfile) {
  const rows = LEVELS.filter((l) => profile.bests[l.id]);
  return frame(
    <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 22, letterSpacing: 6, color: C.dim }}>FOUND THE GOAT</div>
        <div style={{ fontSize: 60, fontWeight: 700, marginTop: 8 }}>{profile.name}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {rows.length === 0 && <div style={{ fontSize: 30, color: C.dim }}>Still searching the maze…</div>}
        {rows.map((l) => {
          const best = profile.bests[l.id]!;
          return (
            <div
              key={l.id}
              style={{
                display: "flex",
                alignItems: "center",
                background: C.tile,
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 16,
                padding: "14px 22px",
              }}
            >
              <div style={{ width: 150, fontSize: 30, color: C.dim }}>{l.label}</div>
              <div style={{ flex: 1, fontSize: 48, fontWeight: 700, color: C.amber }}>{formatTime(best.timeMs)}</div>
              {/* (One string: a box with several text pieces needs flex in the card renderer.) */}
              <div style={{ fontSize: 28, color: C.ink }}>{`#${best.rank} of ${best.players}`}</div>
            </div>
          );
        })}
      </div>
      {footer("Can you find her faster?")}
    </div>
  );
}
