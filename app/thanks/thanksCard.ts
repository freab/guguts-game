/**
 * The thank-you cards after winning Stark Hackathon (app/thanks): their words,
 * and how they're drawn over the scene. One drawing for both the screen and
 * the downloaded picture, so what you see is what you save.
 */

export interface ThanksText {
  /** Big, at the top (some cards have none). */
  title?: string;
  paragraphs: string[];
  /** In Ge'ez, after the paragraphs (only on some cards). */
  amharic?: string;
  /** In gold, the card's last line (only on the last card). */
  highlight?: string;
  signature: string;
}

const SIGNATURE = "Gugut & the Goat · Gugut Studios · Stark Hackathon";
const BEGINNING = "This is only the beginning for Gugut Studios.";

export const THANKS_CARDS: ThanksText[] = [
  {
    title: "Thank you.",
    paragraphs: [
      "To the judges and organisers of Stark Hackathon, for giving Gugut a chance.",
      "To Surafel Yimam, who gave Gugut his voice. To Eman Issae, for the designs. To Temesgen, whose music fills the maze.",
      "And to the hundreds of you who played and shared it on Telegram: you made this real.",
    ],
    signature: SIGNATURE,
  },
  {
    paragraphs: [
      "Every message and every mention today reminded me why I build things.",
      "Thank you for walking into the maze with Gugut.",
    ],
    amharic: "አመሰግናለሁ.",
    highlight: BEGINNING,
    signature: SIGNATURE,
  },
];

/** The faces the card is set in (CSS font-family strings, from next/font and the page). */
export interface CardFonts {
  title: string;
  body: string;
  amharic: string;
}

const CREAM = "#fdf3d4";
const GOLD = "#c9a45c";

/** Lines of `text` no wider than `max` in the context's current font. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > max && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * The card over a w × h picture: a soft dark wash on the left, the words on
 * it, the signature at the bottom. Sized from the height, so a 4K download
 * and the screen look the same.
 */
export function drawThanks(ctx: CanvasRenderingContext2D, w: number, h: number, fonts: CardFonts, card: ThanksText) {
  const s = h / 1080;
  const left = w * 0.065;
  const width = Math.min(w * 0.44, 820 * s);

  // The wash the words sit on.
  const wash = ctx.createLinearGradient(0, 0, w * 0.68, 0);
  wash.addColorStop(0, "rgba(0, 0, 0, 0.72)");
  wash.addColorStop(0.6, "rgba(0, 0, 0, 0.38)");
  wash.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, w, h);

  // Laid out first, then centred on the picture's height.
  type Run = { text: string; font: string; color: string; size: number; gapBefore: number };
  const runs: Run[] = [];
  const add = (text: string, font: string, color: string, size: number, gapBefore: number) => {
    ctx.font = font;
    wrap(ctx, text, width).forEach((line, i) => runs.push({ text: line, font, color, size, gapBefore: i === 0 ? gapBefore : 0 }));
  };
  if (card.title) add(card.title, `600 ${118 * s}px ${fonts.title}`, CREAM, 118 * s, 0);
  card.paragraphs.forEach((p, i) => add(p, `400 ${29 * s}px ${fonts.body}`, "rgba(253, 243, 212, 0.88)", 29 * s, (i === 0 ? (card.title ? 38 : 0) : 18) * s));
  if (card.amharic) add(card.amharic, `700 ${44 * s}px ${fonts.amharic}`, CREAM, 44 * s, 30 * s);
  if (card.highlight) add(card.highlight, `italic 500 ${40 * s}px ${fonts.title}`, GOLD, 40 * s, 36 * s);

  const lineHeight = (r: Run) => r.size * (r.size > 100 ? 1.02 : 1.45);
  const total = runs.reduce((sum, r) => sum + r.gapBefore + lineHeight(r), 0);
  let y = (h - total) / 2;
  ctx.textBaseline = "top";
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 18 * s;
  for (const r of runs) {
    y += r.gapBefore;
    ctx.font = r.font;
    ctx.fillStyle = r.color;
    ctx.fillText(r.text, left, y);
    y += lineHeight(r);
  }

  // The signature, and a thin gold rule above it.
  ctx.shadowBlur = 0;
  ctx.fillStyle = GOLD;
  ctx.fillRect(left, h - 92 * s, 120 * s, 2 * s);
  ctx.font = `500 ${20 * s}px ${fonts.body}`;
  ctx.fillStyle = "rgba(253, 243, 212, 0.62)";
  ctx.letterSpacing = `${1.5 * s}px`;
  ctx.fillText(card.signature.toUpperCase(), left, h - 74 * s);
  ctx.letterSpacing = "0px";
}
