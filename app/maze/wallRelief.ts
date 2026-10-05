import * as THREE from "three/webgpu";
import { float, texture, vec2 } from "three/tsl";

/** Metres of wall one repeat of the stone texture covers (its real size). */
export const STONE_TILE = 2;
/**
 * How far the wall faces bulge out (m) at most: a centimetre — cast concrete
 * slabs, just not ruler-flat.
 */
export const BULGE = 0.012;
/** Pushed out at least this much everywhere (m), so no face sits flat. */
const BULGE_BASE = 0.006;
/** Height-map mip the bulge reads: ~25 cm per texel, smooth bulges. */
const BULGE_MIP = 6;
/**
 * Extra clearance for things that sit on the wall (ivy): the wall mesh only
 * follows the bulge at its vertices (0.5 m apart), so between them it can
 * stand a little proud of the smooth read below.
 */
export const BULGE_CLEARANCE = 0.015;

/**
 * How far the wall surface is pushed out (m) at a world position — the same
 * read the wall mesh displaces its vertices by, so anything placed on the
 * walls (the ivy) can move out with it. Face-independent (x + z along, y up),
 * so coincident wall vertices agree and slabs stay sealed.
 */
export function wallBulge(height: THREE.Texture, p: THREE.Node<"vec3">) {
  const h = texture(height, vec2(p.x.add(p.z), p.y.negate()).div(STONE_TILE)).level(float(BULGE_MIP)).r;
  return h.mul(BULGE).add(BULGE_BASE);
}
