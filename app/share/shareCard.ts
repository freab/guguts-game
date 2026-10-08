"use client";

import { posterFont } from "../fonts";
import { formatTime } from "../leaderboard/shared";

/**
 * Share cards for one run (or a best time), drawn in the browser on a canvas
 * so they can be saved or handed straight to Instagram, X, Telegram… (the
 * Web Share API). Three shapes: an Instagram post (4:5), a story (9:16) and
 * a wide card (X / Telegram / WhatsApp).
 *
 * Styled like the title screen and preloader (ui/LoadingOverlay): the maze
 * entrance (public/preloader/first.webp) filling the card, darkened where
 * the words sit; the GUGUT wordmark; everything in the poster's cream
 * lettering with a soft shadow; level, rank and badges on glass chips; and the
 * game's address on a gold pill with the cream play button, like "Enter the
 * maze".
 */
export type CardFormat = "post" | "story" | "wide";

export const CARD_FORMATS: Record<CardFormat, { width: number; height: number; label: string }> = {
  post: { width: 1080, height: 1350, label: "Post" },
  story: { width: 1080, height: 1920, label: "Story" },
  wide: { width: 1200, height: 630, label: "Wide" },
};

export interface CardData {
  name: string;
  /** "Easy", "Medium", "Hard". */
  level: string;
  timeMs: number;
  /** 0 = no stars shown (a best time, where calls aren't known). */
  stars: number;
  badges: string[];
  rank?: number;
  players?: number;
  newBest?: boolean;
  /** "Called her twice · 1 of 2 bottles of water", or nothing. */
  detail?: string;
  /** The address printed on the card (the game, or the player's page). */
  host: string;
}

/** The preloader's colours. */
const C = {
  cream: "#fdf3d4",
  creamDim: "rgba(253,243,212,0.72)",
  creamFaint: "rgba(253,243,212,0.25)",
  gold: "#c9a45c",
  goldInk: "#2a2312",
  glass: "rgba(255,255,255,0.16)",
  glassEdge: "rgba(255,255,255,0.5)",
  shade: "20,16,8",
};

const BACKDROP_SRC = "/preloader/first.webp";
const LOGO_SRC = encodeURI("/logo gugut.svg");

const images = new Map<string, Promise<HTMLImageElement>>();
function loadImage(src: string): Promise<HTMLImageElement> {
  let p = images.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(src));
      img.src = src;
    });
    images.set(src, p);
  }
  return p;
}

/** The poster lettering (next/font), loaded before drawing. */
async function titleFont(): Promise<string> {
  const family = posterFont.style.fontFamily;
  await document.fonts.load(`100px ${family}`);
  return family;
}

/** Text in the preloader's way: cream (or `color`), with a soft dark shadow so it holds over the scene. */
function say(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, font: string, color = C.cream) {
  ctx.save();
  ctx.font = `${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.shadowColor = `rgba(${C.shade},0.5)`;
  ctx.shadowBlur = size * 0.25;
  ctx.shadowOffsetY = size * 0.04;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** `text` shortened with … to fit `max` at the current font. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, edge?: string) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (edge) {
    ctx.strokeStyle = edge;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string) {
  ctx.save();
  ctx.shadowColor = `rgba(${C.shade},0.45)`;
  ctx.shadowBlur = r * 0.5;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

/** The cream play circle from the preloader's buttons, centred at (cx, cy). */
function playButton(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = C.cream;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.2, cy - r * 0.375);
  ctx.lineTo(cx - r * 0.2, cy + r * 0.375);
  ctx.lineTo(cx + r * 0.38, cy);
  ctx.closePath();
  ctx.fillStyle = C.gold;
  ctx.fill();
}

interface Chip {
  text: string;
  gold?: boolean;
}

/** Lay chips out in rows no wider than `max`: their positions, and the total height. */
function layoutChips(ctx: CanvasRenderingContext2D, chips: Chip[], max: number, size: number) {
  const h = size * 1.75;
  const gap = size * 0.4;
  const placed: { chip: Chip; x: number; row: number; w: number }[] = [];
  let x = 0;
  let row = 0;
  for (const chip of chips) {
    const w = ctx.measureText(chip.text).width + size * 1.3;
    if (x > 0 && x + w > max) {
      x = 0;
      row++;
    }
    placed.push({ chip, x, row, w });
    x += w + gap;
  }
  return { placed, h, gap, height: chips.length ? (row + 1) * h + row * gap : 0 };
}

/** The scene, scaled to cover the card, centred on (fx, fy) of the image (the tree and path). */
function drawBackdrop(ctx: CanvasRenderingContext2D, img: HTMLImageElement, W: number, H: number, fx: number, fy: number) {
  const scale = Math.max(W / img.width, H / img.height);
  const sw = W / scale;
  const sh = H / scale;
  const sx = Math.min(Math.max(img.width * fx - sw / 2, 0), img.width - sw);
  const sy = Math.min(Math.max(img.height * fy - sh / 2, 0), img.height - sh);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
}

/** Draw the card; resolves to a PNG. */
export async function drawCard(format: CardFormat, data: CardData): Promise<Blob> {
  const { width: W, height: H } = CARD_FORMATS[format];
  const [backdrop, logo, font] = await Promise.all([loadImage(BACKDROP_SRC), loadImage(LOGO_SRC), titleFont()]);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const wide = format === "wide";
  // Type scale: the story is tallest, the wide card smallest.
  const k = format === "story" ? 1.15 : wide ? 0.62 : 1;
  const pad = (wide ? 56 : 72) * (wide ? 1 : k);

  // The maze entrance, darkened where the words go: the bottom on tall
  // cards, the left on the wide one; and a little at the top for the logo.
  drawBackdrop(ctx, backdrop, W, H, wide ? 0.5 : 0.42, 0.55);
  const shade = wide ? ctx.createLinearGradient(0, 0, W, 0) : ctx.createLinearGradient(0, H * 0.3, 0, H);
  shade.addColorStop(0, `rgba(${C.shade},${wide ? 0.82 : 0})`);
  shade.addColorStop(wide ? 0.55 : 0.45, `rgba(${C.shade},${wide ? 0.55 : 0.45})`);
  shade.addColorStop(1, `rgba(${C.shade},${wide ? 0.05 : 0.86})`);
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);
  if (!wide) {
    const top = ctx.createLinearGradient(0, 0, 0, H * 0.3);
    top.addColorStop(0, `rgba(${C.shade},0.45)`);
    top.addColorStop(1, `rgba(${C.shade},0)`);
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, W, H * 0.3);
  }

  // The wordmark: centred at the top, or top left on the wide card.
  const logoW = wide ? 190 : W * (format === "story" ? 0.62 : 0.52);
  const logoH = (logoW * logo.height) / logo.width;
  ctx.save();
  ctx.shadowColor = `rgba(${C.shade},0.5)`;
  ctx.shadowBlur = 28;
  ctx.drawImage(logo, wide ? pad : (W - logoW) / 2, wide ? pad * 0.8 : H * 0.06, logoW, logoH);
  ctx.restore();

  // Sizes.
  const nameSize = 56 * k;
  const timeSize = (wide ? 200 : 270) * k;
  const starR = 34 * k;
  const chipSize = 42 * k;
  const detailSize = 40 * k;
  const footSize = 44 * k;
  const contentW = wide ? W * 0.56 : W - pad * 2;

  ctx.font = `${chipSize}px ${font}`;
  const facts: Chip[] = [{ text: data.level }];
  if (data.rank && data.players) facts.push({ text: `#${data.rank} of ${data.players}` });
  if (data.newBest) facts.push({ text: "New personal best", gold: true });
  const chips = layoutChips(ctx, [...facts, ...data.badges.map((b) => ({ text: b }))], contentW, chipSize);

  // From the bottom up: the invitation, the detail, the chips, the stars, the time, who.
  const footH = footSize * 1.7;
  let y = H - pad - footH;
  const footY = y;
  if (data.detail) y -= detailSize * 1.7;
  const detailY = y;
  y -= chips.height + (chips.height ? chipSize * 0.7 : 0);
  const chipsY = y;
  const starsY = data.stars > 0 ? (y -= starR * 2 + 22 * k) : y;
  y -= timeSize * 0.88;
  const timeY = y;
  y -= nameSize * 1.1;
  const nameY = y;

  ctx.textBaseline = "top";
  say(ctx, fit(ctx, `${data.name} found her in`, contentW), pad, nameY, nameSize, font, C.creamDim);
  say(ctx, formatTime(data.timeMs), pad - 4 * k, timeY - timeSize * 0.12, timeSize, font);
  if (data.stars > 0) {
    for (let i = 0; i < 3; i++) star(ctx, pad + starR + i * starR * 2.5, starsY + starR, starR, i < data.stars ? C.gold : C.creamFaint);
  }

  // Glass chips (gold for a new best).
  ctx.textBaseline = "middle";
  for (const { chip, x, row, w } of chips.placed) {
    const cy = chipsY + row * (chips.h + chips.gap);
    pill(ctx, pad + x, cy, w, chips.h, chip.gold ? C.gold : C.glass, chip.gold ? undefined : C.glassEdge);
    ctx.font = `${chipSize}px ${font}`;
    ctx.fillStyle = chip.gold ? C.goldInk : C.cream;
    ctx.fillText(chip.text, pad + x + chipSize * 0.65, cy + chips.h / 2 + 2 * k);
  }

  if (data.detail) {
    ctx.textBaseline = "top";
    ctx.font = `${detailSize}px ${font}`;
    say(ctx, fit(ctx, data.detail, contentW), pad, detailY + detailSize * 0.35, detailSize, font, C.creamDim);
  }

  // The invitation, and the address on the gold pill with the play button.
  ctx.font = `${footSize}px ${font}`;
  const hostW = ctx.measureText(data.host).width;
  const pillW = hostW + footSize * 0.9 + footH * 0.95;
  const pillX = wide ? pad + contentW - pillW : W - pad - pillW;
  ctx.save();
  ctx.shadowColor = `rgba(${C.shade},0.35)`;
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 6;
  pill(ctx, pillX, footY, pillW, footH, C.gold);
  ctx.restore();
  ctx.textBaseline = "middle";
  ctx.fillStyle = C.goldInk;
  ctx.fillText(data.host, pillX + footSize * 0.6, footY + footH / 2 + 2 * k);
  playButton(ctx, pillX + pillW - footH / 2, footY + footH / 2, footH * 0.38);
  ctx.font = `${footSize}px ${font}`;
  const invite = fit(ctx, "Can you find her faster?", pillX - pad - 24 * k);
  say(ctx, invite, pad, footY + footH / 2 + 2 * k, footSize, font, C.creamDim);

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("card"))), "image/png")
  );
}
