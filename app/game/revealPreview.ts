/**
 * The goat reveal (maze/GoatReveal) played without a run, as if Gugut had
 * just reached her — for the "how it's made" presentation (app/present).
 */
let startedAt = 0;

export const revealPreview = {
  start() {
    startedAt = performance.now();
  },
  stop() {
    startedAt = 0;
  },
  /** performance.now() it started (0 = off). */
  startedAt: () => startedAt,
};
