import { CARD_SIZE, xCard } from "./share/ogCard";

/** The card shown when a link to the game is posted on X (its own: share/ogCard xCard). */
export const alt = "Gugut & the Goat, a free 3D maze game from Ethiopia and winner of Stark Hackathon: find the goat before sundown";
export const size = CARD_SIZE;
export const contentType = "image/png";

export default function Image() {
  return xCard();
}
