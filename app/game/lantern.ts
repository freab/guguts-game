"use client";

import { audio } from "../audio/audioEngine";
import { runStore } from "./runStore";

/**
 * A secret: the lantern hanging in the maple. Click it and it swings harder;
 * click it CLICKS_TO_DROP times and it falls into the grass (still glowing),
 * and Temesgen gives you a look. Read by the lantern in scene/MapleTree.
 */
export const CLICKS_TO_DROP = 10;

let clicks = 0;
/** performance.now() of the last click (the swing it gives dies away), and of the fall (0 = hanging). */
let clickedAt = 0;
let droppedAt = 0;

export const lantern = {
  clicks: () => clicks,
  clickedAt: () => clickedAt,
  droppedAt: () => droppedAt,
  /** Gugut clicks the lantern. */
  click(now = performance.now()) {
    if (droppedAt) return;
    clicks++;
    clickedAt = now;
    if (clicks < CLICKS_TO_DROP) return;
    droppedAt = now;
  },
  /** It has hit the ground (scene/MapleTree): the thunk, and Temesgen\x27s look. */
  landed() {
    audio.thunk();
    runStore.notify("Temesgen looks up at the empty branch, then at you. “…”");
  },
  /** A new maze: back on its branch. */
  reset() {
    clicks = 0;
    clickedAt = 0;
    droppedAt = 0;
  },
};
