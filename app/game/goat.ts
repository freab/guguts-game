"use client";

import { COLS, ROWS, cellAt, cellToWorld, exitPosition, inClearing, worldToCell } from "../maze/mazeData";

/**
 * Where the goat is. She starts on the exit tile, by her bush; on Hard she
 * doesn't stay put — each time Gugut calls, a moment after she answers, she
 * trots off down the maze, away from him (flee): to the spot within reach
 * that is furthest from him by the way he'd have to walk, never passing
 * close to him. Cornered in a dead end, she can't. She never runs into the
 * clearing.
 *
 * Everything that needs her (reaching her, her bleat, seeing her, the call
 * map, the reveal, the win shot) reads position(); the bush, the bottles'
 * placement and Temesgen's hint stay with where she started (the exit).
 */

/** Trotting speed (m/s), and how fast she turns to face her way (radians/s). */
const TROT = 1.9;
const TURN = 7;
/** At most this many tiles per flight (a tile is CELL m: half a corridor between junctions). */
const FLEE_MAX = 10;
/** She never comes closer to him than this (tiles, walking). */
const KEEP_AWAY = 3;

interface GoatState {
  x: number;
  z: number;
  /** Which way she faces (radians about Y; her model faces +Z), and is turning to. */
  facing: number;
  heading: number;
  /** Points still to trot through (world x, z), nearest first. */
  path: [number, number][];
}

const state: GoatState = { x: 0, z: 0, facing: 0, heading: 0, path: [] };

const NEIGHBOURS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const open = (r: number, c: number) => r >= 0 && c >= 0 && r < ROWS && c < COLS && cellAt(r, c) !== "wall";

/** Walking distance (tiles) from (r, c) to every open tile. */
function distancesFrom(r: number, c: number): Int32Array {
  const dist = new Int32Array(ROWS * COLS).fill(-1);
  const queue: number[] = [r * COLS + c];
  dist[r * COLS + c] = 0;
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i];
    const ar = Math.floor(at / COLS);
    const ac = at % COLS;
    for (const [dr, dc] of NEIGHBOURS) {
      const nr = ar + dr;
      const nc = ac + dc;
      if (!open(nr, nc) || dist[nr * COLS + nc] >= 0) continue;
      dist[nr * COLS + nc] = dist[at] + 1;
      queue.push(nr * COLS + nc);
    }
  }
  return dist;
}

export const goat = {
  /** Where she is now (world x, z). */
  position: (): [number, number] => [state.x, state.z],
  facing: () => state.facing,
  /** Is she trotting off right now? */
  moving: () => state.path.length > 0,

  /** A new maze: on her tile by the bush, looking back into the maze (towards its centre). */
  reset() {
    const [x, z] = exitPosition();
    state.x = x;
    state.z = z;
    state.facing = state.heading = Math.atan2(-x, -z);
    state.path = [];
  },

  /**
   * She runs from Gugut (at px, pz): to the tile within FLEE_MAX of her that
   * is furthest from him by the way he'd have to walk — never passing within
   * KEEP_AWAY tiles of him, so she may dash a little his way to duck into a
   * side passage, but never past him. Returns whether she went (cornered in a
   * dead end with him in its mouth, she can't).
   */
  flee(px: number, pz: number): boolean {
    if (state.path.length > 0) return false;
    const [pr, pc] = worldToCell(px, pz);
    const fromPlayer = distancesFrom(pr, pc);
    const [gr, gc] = worldToCell(state.x, state.z);
    const start = gr * COLS + gc;
    // Her own walk, out to FLEE_MAX tiles, keeping clear of him.
    const steps = new Map<number, number>([[start, 0]]);
    const parent = new Map<number, number>();
    const queue = [start];
    let best = start;
    for (let i = 0; i < queue.length; i++) {
      const at = queue[i];
      if (fromPlayer[at] > fromPlayer[best] || (fromPlayer[at] === fromPlayer[best] && steps.get(at)! < steps.get(best)!)) best = at;
      if (steps.get(at)! >= FLEE_MAX) continue;
      const ar = Math.floor(at / COLS);
      const ac = at % COLS;
      for (const [dr, dc] of NEIGHBOURS) {
        const nr = ar + dr;
        const nc = ac + dc;
        const next = nr * COLS + nc;
        if (!open(nr, nc) || steps.has(next) || fromPlayer[next] < KEEP_AWAY) continue;
        // (Never out through the exit's gap in the border, nor into the clearing.)
        if (nr === 0 || nc === 0 || nr === ROWS - 1 || nc === COLS - 1) continue;
        const [wx, wz] = cellToWorld(nr, nc);
        if (inClearing(wx, wz, -1)) continue;
        steps.set(next, steps.get(at)! + 1);
        parent.set(next, at);
        queue.push(next);
      }
    }
    if (best === start) return false;
    const path: [number, number][] = [];
    for (let at = best; at !== start; at = parent.get(at)!) path.unshift(cellToWorld(Math.floor(at / COLS), at % COLS));
    state.path = path;
    return true;
  },

  /** Each frame: trot along the path, turning to face where she's going. */
  update(dt: number) {
    let left = TROT * Math.min(dt, 0.1);
    while (left > 0 && state.path.length > 0) {
      const [tx, tz] = state.path[0];
      const dx = tx - state.x;
      const dz = tz - state.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-4) state.heading = Math.atan2(dx, dz);
      if (d <= left) {
        state.x = tx;
        state.z = tz;
        state.path.shift();
        left -= d;
      } else {
        state.x += (dx / d) * left;
        state.z += (dz / d) * left;
        left = 0;
      }
    }
    // Turn towards her way (the short way round).
    const turn = Math.atan2(Math.sin(state.heading - state.facing), Math.cos(state.heading - state.facing));
    state.facing += Math.sign(turn) * Math.min(Math.abs(turn), TURN * Math.min(dt, 0.1));
  },
};

goat.reset();
