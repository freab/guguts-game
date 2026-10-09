"use client";

import { useEffect, useState, type ReactNode } from "react";
import { formatTime } from "../leaderboard/shared";
import { CARD_FORMATS, drawCard, type CardData, type CardFormat } from "../share/shareCard";
import { shareLink } from "../share/shareLink";
import Dialog from "./Dialog";

export type ShareCard = Omit<CardData, "host">;

/**
 * Share a time: a card image (Instagram post, story, or wide for X /
 * Telegram — share/shareCard) with a preview, and the ways out:
 * - "Share…": the phone's own share sheet (Web Share API) with the image
 *   and the text — the way onto Instagram, Telegram, WhatsApp… from a phone;
 * - Save image (to post anywhere);
 * - X, Telegram, WhatsApp, Facebook: their share pages, with the text and the
 *   link — the player's own page (/s/…), whose preview is a card of their
 *   best times, straight from the leaderboard; or the game, off the board;
 * - Copy link.
 */
export default function ShareDialog({
  card,
  onBoard,
  onClose,
}: {
  card: ShareCard;
  /** Their time is on the leaderboard: share their own page, not just the game. */
  onBoard: boolean;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<CardFormat>("post");
  const [image, setImage] = useState<{ format: CardFormat; blob: Blob; url: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void shareLink(onBoard).then((l) => live && setLink(l));
    return () => {
      live = false;
    };
  }, [onBoard]);

  // Draw the card for the chosen shape (again when the link — its address — arrives).
  useEffect(() => {
    if (!link) return;
    let live = true;
    let url: string | null = null;
    void drawCard(format, { ...card, host: new URL(link).host }).then(
      (blob) => {
        url = URL.createObjectURL(blob);
        if (live) setImage({ format, blob, url });
        else URL.revokeObjectURL(url);
      },
      () => live && setStatus("Couldn't draw the card.")
    );
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [format, card, link]);

  const text = `I found Gugut's goat in ${formatSummary(card)}. Can you find her faster?`;
  const ready = image && image.format === format && link;
  const file = () => new File([image!.blob], `gugut-${card.level.toLowerCase()}-${CARD_FORMATS[format].label.toLowerCase()}.png`, { type: "image/png" });

  const nativeShare = async () => {
    if (!ready) return;
    try {
      const f = file();
      if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], text: `${text} ${link}` });
      else await navigator.share({ text, url: link });
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") setStatus("Sharing didn't work here — save the image instead.");
    }
  };
  const save = () => {
    if (!ready) return;
    const a = document.createElement("a");
    a.href = image.url;
    a.download = file().name;
    a.click();
    setStatus("Image saved.");
  };
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(`${text} ${link}`);
      setStatus("Copied — paste it anywhere.");
    } catch {
      setStatus(link);
    }
  };
  const open = (url: string) => window.open(url, "_blank", "noopener,noreferrer");
  const enc = encodeURIComponent;
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <Dialog title="Share your time" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-1 rounded-xl bg-[#303030] p-1">
          {(Object.keys(CARD_FORMATS) as CardFormat[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFormat(f)}
              className={`flex-1 px-3 py-1.5 text-sm font-medium ${format === f ? "ui-cta" : "ui-tile"}`}
            >
              {CARD_FORMATS[f].label}
            </button>
          ))}
        </div>

        <div className="flex h-72 items-center justify-center rounded-xl bg-black/30 p-2">
          {ready ? (
            // eslint-disable-next-line @next/next/no-img-element -- (a generated image in memory)
            <img src={image.url} alt="Your share card" className="max-h-full max-w-full rounded-lg object-contain" />
          ) : (
            <span className="text-sm text-cream/50">Drawing your card…</span>
          )}
        </div>

        {canNativeShare && (
          <button type="button" disabled={!ready} onClick={() => void nativeShare()} className="ui-cta w-full px-5 py-2.5 ui-label disabled:opacity-40">
            Share… (Instagram, Telegram, WhatsApp…)
          </button>
        )}
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          <ShareButton disabled={!ready} onClick={save}>
            Save image
          </ShareButton>
          <ShareButton disabled={!link} onClick={() => open(`https://x.com/intent/post?text=${enc(text)}&url=${enc(link!)}`)}>
            X
          </ShareButton>
          <ShareButton disabled={!link} onClick={() => open(`https://t.me/share/url?url=${enc(link!)}&text=${enc(text)}`)}>
            Telegram
          </ShareButton>
          <ShareButton disabled={!link} onClick={() => open(`https://wa.me/?text=${enc(`${text} ${link}`)}`)}>
            WhatsApp
          </ShareButton>
          <ShareButton disabled={!link} onClick={() => open(`https://www.facebook.com/sharer/sharer.php?u=${enc(link!)}`)}>
            Facebook
          </ShareButton>
          <ShareButton disabled={!link} onClick={() => void copy()}>
            Copy link
          </ShareButton>
        </div>
        <p className="text-xs leading-relaxed text-cream/45">
          {status ??
            (canNativeShare
              ? "For Instagram, use Share… and pick Instagram — or save the image and post it."
              : "For Instagram, save the image and post it from your phone. Links on X and Telegram show your best times.")}
        </p>
      </div>
    </Dialog>
  );
}

function ShareButton({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="ui-tile px-3 py-2 ui-label disabled:opacity-40">
      {children}
    </button>
  );
}

/** "1:23.45 on Hard ★★★ (#3 of 57)". */
function formatSummary(card: ShareCard): string {
  const stars = card.stars > 0 ? ` ${"★".repeat(card.stars)}${"☆".repeat(3 - card.stars)}` : "";
  const rank = card.rank && card.players ? ` (#${card.rank} of ${card.players})` : "";
  return `${formatTime(card.timeMs)} on ${card.level}${stars}${rank}`;
}
