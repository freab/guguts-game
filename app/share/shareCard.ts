"use client";

import { posterFont } from "../fonts";
import { formatTime } from "../leaderboard/shared";

/**
 * Share cards for one run (or a best time), drawn in the browser on a canvas
 * so they can be saved or handed straight to Instagram, X, Telegram… (the
 * Web Share API). Three shapes: an Instagram post (4:5), a story (9:16) and
 * a wide card (X / Telegram / WhatsApp). The poster above (or beside) a panel
 * in the game's grey UI kit: who, the time in the poster's lettering, stars,
 * level and rank, badges, and an invitation with the game's address.
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

const C = {
  bg: "#1c1c1c",
  frame: "#4a4a4a",
  well: "#383838",
  tile: "#3e3e3e",
  line: "rgba(255,255,255,0.08)",
  ink: "#ececec",
  dim: "#a3a3a3",
  amber: "#fcd34d",
  faint: "rgba(255,255,255,0.15)",
  green: "#6ee7b7",
};

let poster: Promise<HTMLImageElement> | null = null;
function loadPoster(): Promise<HTMLImageElement> {
  poster ??= new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("poster"));
    img.src = "/share/poster.jpg";
  });
  return poster;
}

/** The page's fonts (next/font), loaded before drawing. */
async function fonts() {
  const title = posterFont.style.fontFamily;
  const sans = getComputedStyle(document.documentElement).getPropertyValue("--font-geist-sans").trim() || "sans-serif";
  await Promise.all([document.fonts.load(`100px ${title}`), document.fonts.load(`600 40px ${sans}`), document.fonts.load(`40px ${sans}`)]);
  return { title, sans };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

/** Draw `text` no wider than `max`, shortened with … if needed. */
function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** A row of rounded chips (text, colour); wraps to `max` width. Returns the bottom. */
function chips(
  ctx: CanvasRenderingContext2D,
  items: { text: string; color?: string }[],
  x: number,
  y: number,
  max: number,
  size: number
): number {
  const padX = size * 0.7;
  const h = size * 1.9;
  let cx = x;
  let cy = y;
  ctx.textBaseline = "middle";
  for (const item of items) {
    const w = ctx.measureText(item.text).width + padX * 2;
    if (cx > x && cx + w > x + max) {
      cx = x;
      cy += h + size * 0.5;
    }
    roundRect(ctx, cx, cy, w, h, size * 0.55, C.tile, C.line);
    ctx.fillStyle = item.color ?? C.ink;
    ctx.fillText(item.text, cx + padX, cy + h / 2 + 1);
    cx += w + size * 0.5;
  }
  return items.length ? cy + h : y;
}

/** The poster, scaled to cover (x, y, w, h), anchored on its top (the figure and title). */
function drawPoster(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, anchorY: number) {
  const scale = Math.max(w / img.width, h / img.height);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) * anchorY, sw, sh, x, y, w, h);
}

/** Draw the card; resolves to a PNG. */
export async function drawCard(format: CardFormat, data: CardData): Promise<Blob> {
  const { width: W, height: H } = CARD_FORMATS[format];
  const [img, f] = await Promise.all([loadPoster(), fonts()]);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // The poster: beside the panel on the wide card, above it otherwise (fading into the dark).
  const wide = format === "wide";
  let px: number, py: number, pw: number, ph: number, k: number;
  if (wide) {
    const posterW = Math.round((H * img.width) / img.height);
    drawPoster(ctx, img, 0, 0, posterW, H, 0);
    px = posterW + 36;
    py = 36;
    pw = W - px - 36;
    ph = H - 72;
    k = 0.62;
  } else {
    const posterH = format === "story" ? 980 : 640;
    drawPoster(ctx, img, 0, 0, W, posterH, 0.25);
    const fade = ctx.createLinearGradient(0, posterH * 0.55, 0, posterH);
    fade.addColorStop(0, "rgba(28,28,28,0)");
    fade.addColorStop(1, C.bg);
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, W, posterH);
    pw = W - 96;
    ph = format === "story" ? 860 : 740;
    px = 48;
    py = H - ph - 48;
    k = 1;
  }

  // The panel: a frame with a recess (the UI kit).
  roundRect(ctx, px, py, pw, ph, 40 * k, C.frame);
  const pad = 14 * k;
  const ix = px + pad;
  const iy = py + pad;
  const iw = pw - pad * 2;
  const ih = ph - pad * 2;
  roundRect(ctx, ix, iy, iw, ih, 28 * k, C.well);
  const inX = ix + 48 * k;
  const inW = iw - 96 * k;
  let y = iy + 60 * k;

  // Who.
  ctx.textBaseline = "alphabetic";
  ctx.font = `600 ${30 * k}px ${f.sans}`;
  ctx.fillStyle = C.dim;
  ctx.letterSpacing = `${6 * k}px`;
  ctx.fillText(fitText(ctx, `${data.name.toUpperCase()} FOUND HER IN`, inW), inX, y);
  ctx.letterSpacing = "0px";

  // The time, in the poster's lettering.
  const timeSize = (wide ? 190 : 230) * k;
  y += timeSize * 0.92;
  ctx.font = `${timeSize}px ${f.title}`;
  ctx.fillStyle = C.amber;
  ctx.fillText(formatTime(data.timeMs), inX - 4 * k, y);

  // Stars (for a finished run).
  if (data.stars > 0) {
    y += 30 * k;
    const r = 30 * k;
    for (let i = 0; i < 3; i++) star(ctx, inX + r + i * r * 2.5, y + r, r, i < data.stars ? C.amber : C.faint);
    y += r * 2 + 10 * k;
  }

  // Level, rank, new best; then the badges.
  y += 28 * k;
  ctx.font = `600 ${30 * k}px ${f.sans}`;
  const facts: { text: string; color?: string }[] = [{ text: data.level }];
  if (data.rank && data.players) facts.push({ text: `#${data.rank} of ${data.players}` });
  if (data.newBest) facts.push({ text: "New personal best", color: C.green });
  y = chips(ctx, [...facts, ...data.badges.map((b) => ({ text: b, color: C.amber }))], inX, y, inW, 30 * k);

  if (data.detail) {
    y += 52 * k;
    ctx.textBaseline = "alphabetic";
    ctx.font = `${30 * k}px ${f.sans}`;
    ctx.fillStyle = C.dim;
    ctx.fillText(fitText(ctx, data.detail, inW), inX, y);
  }

  // Footer: the invitation, and the address as the light key.
  const footY = iy + ih - 48 * k;
  ctx.font = `600 ${30 * k}px ${f.sans}`;
  const hostW = ctx.measureText(data.host).width + 44 * k;
  const keyH = 64 * k;
  roundRect(ctx, ix + iw - 48 * k - hostW, footY - keyH, hostW, keyH, 18 * k, C.ink);
  ctx.fillStyle = "#151515";
  ctx.textBaseline = "middle";
  ctx.fillText(data.host, ix + iw - 48 * k - hostW + 22 * k, footY - keyH / 2 + 1);
  ctx.font = `${30 * k}px ${f.sans}`;
  ctx.fillStyle = C.dim;
  ctx.fillText(fitText(ctx, "Can you find her faster?", inW - hostW - 24 * k), inX, footY - keyH / 2 + 1);

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("card"))), "image/png")
  );
}
