/** Tuning for the player and the first-person camera. World units = metres. */

/** Collision radius of the character's footprint against the walls. */
export const COLLISION_RADIUS = 0.3;

/** Walking pace (m/s): the head bob reaches full height at this speed. */
export const WALK_CLIP_SPEED = 1.4;

/** Movement response (1/s): higher = snappier start / stop. */
export const ACCELERATION = 10;
export const DECELERATION = 12;
/** How fast the body turns to face its direction of travel (1/s). */
export const TURN_RATE = 12;
/** Largest distance moved per collision sub-step, so fast moves can't tunnel. */
export const MAX_SUBSTEP = 0.1;
/** Frame delta clamp, so a hitch or tab switch can't teleport the player. */
export const MAX_DELTA = 0.05;

/** First-person eye height and head bob. */
export const EYE_HEIGHT = 1.65;
export const BOB_AMPLITUDE = 0.035;
/** Bob cycles per metre travelled (roughly one per step). */
export const BOB_FREQUENCY = 1.6;

/** Pitch limits (radians; negative = looking down). */
export const FIRST_PERSON_PITCH: [number, number] = [-1.45, 1.45];

/** Mouse look: radians per pixel at sensitivity 1. */
export const LOOK_RADIANS_PER_PIXEL = 0.0022;
