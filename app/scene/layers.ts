/**
 * Render layers. The view camera sees layer 0 only; the sun's shadow camera
 * also sees SHADOW_ONLY_LAYER — full copies of things that are culled in the
 * view but must all be in the (baked-once) shadow map.
 */
export const SHADOW_ONLY_LAYER = 1;
