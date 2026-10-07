/**
 * Changes to the first-person view on top of where the player looks and
 * stands:
 * - `pitch`: Gugut's head tipping back as he drinks (maze/WaterBottles).
 *   Radians, + looks up.
 * - `drop`: how far his eyes are lowered (m) — sitting down to listen to
 *   Temesgen (character/Seat).
 * CameraRig adds both.
 */
export const viewTilt = { pitch: 0, drop: 0 };
