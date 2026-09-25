// A tiny mutable store for the player's world (x, z), written by whichever
// controller is active each frame and read by the minimap on its own animation
// loop — so the HUD can track the player without triggering a React re-render
// every frame.
export const playerState = { x: 0, z: 0 };

export function setPlayerPos(x: number, z: number): void {
  playerState.x = x;
  playerState.z = z;
}
