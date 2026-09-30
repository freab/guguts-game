/**
 * On-screen touch controls → the player (ui/TouchControls writes, the
 * PlayerController reads each frame). Module-level so the DOM overlay and the
 * canvas loop share it without React re-renders.
 */
export const touchInput = {
  /** The move stick, -1..1: x = right, y = forward. Zero when released. */
  moveX: 0,
  moveY: 0,
  /** Look drag not yet applied, in screen pixels (the controller consumes and zeroes it). */
  lookDX: 0,
  lookDY: 0,
};
