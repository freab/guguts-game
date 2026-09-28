/** Culling state of one grass chunk, for the minimap. */
export const ChunkState = {
  /** Beyond the draw distance — not drawn. */
  OutOfRange: 0,
  /** Within the draw distance but outside the camera's view — culled. */
  OutOfView: 1,
  /** Within the draw distance and in view — actually drawn. */
  Drawn: 2,
  /** In view but hidden behind walls (no line of sight) — culled. */
  Occluded: 3,
} as const;
export type ChunkState = (typeof ChunkState)[keyof typeof ChunkState];

export interface GrassChunkInfo {
  /** Chunk centre and half-size on the ground plane. */
  x: number;
  z: number;
  half: number;
  tufts: number;
  state: ChunkState;
}

/**
 * Live grass culling state, written by GrassField every frame and read by the
 * minimap on its own loop (no React re-renders).
 */
export const grassMapStore = {
  chunks: [] as GrassChunkInfo[],
  drawDistance: 0,
  drawnChunks: 0,
  drawnTufts: 0,
  totalTufts: 0,
};
