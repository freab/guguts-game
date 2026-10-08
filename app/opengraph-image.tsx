import { CARD_SIZE, siteCard } from "./share/ogCard";

/** The card shown when a link to the game is posted (X, Telegram, WhatsApp…). */
export const alt = "Gugut & the Goat — find the runaway goat in the maze before sundown";
export const size = CARD_SIZE;
export const contentType = "image/png";

export default function Image() {
  return siteCard();
}
