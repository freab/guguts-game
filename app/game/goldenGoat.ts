import { treeSeed } from "../maze/mazeData";

/**
 * A secret: about one maze in ODDS has a golden goat — gold fur that
 * glitters (maze/Goat). Finding her earns the "Lucky shepherd" badge and a
 * gold frame on the share card (ui/GameOver, share/shareCard). Seeded, so a
 * maze keeps her. `#golden` in the address forces her (to see it).
 */
const ODDS = 50;

export function goldenGoat(): boolean {
  if (typeof window !== "undefined" && window.location.hash.includes("golden")) return true;
  // A hash of the maze's seed, so it doesn't follow the other seeded choices.
  let h = Math.imul(treeSeed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) % ODDS === 0;
}
