/** Tuning for the player character, camera rig and model. World units = metres. */

/** Rigged character model (Mixamo-rigged Xbot with idle / walk / run clips). */
export const MODEL_URL = "/models/Xbot.glb";
/** The model is uniformly scaled so it stands exactly this tall. */
export const CHARACTER_HEIGHT = 1.8;
/** Collision radius of the character's footprint against the walls. */
export const COLLISION_RADIUS = 0.3;

/** Speeds the walk / run clips were authored at (in-place clips, at full height). */
export const WALK_CLIP_SPEED = 1.4;
export const RUN_CLIP_SPEED = 4.2;

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

/** Third-person camera: look-at pivot height, arm limits, wall clearance. */
export const PIVOT_HEIGHT = 1.45;
export const MIN_ARM = 0.6;
export const CAMERA_WALL_PADDING = 0.25;
/** The camera never dips below this height (keeps it out of the floor). */
export const MIN_CAMERA_HEIGHT = 0.3;

/** Pitch limits (radians; negative = looking down). */
export const FIRST_PERSON_PITCH: [number, number] = [-1.45, 1.45];
export const THIRD_PERSON_PITCH: [number, number] = [-1.2, 0.45];

/** Mouse look: radians per pixel at sensitivity 1, and scroll-zoom limits. */
export const LOOK_RADIANS_PER_PIXEL = 0.0022;
export const ZOOM_RANGE: [number, number] = [0.45, 2.2];
