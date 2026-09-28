/** Difficulty levels, picked on the title screen. */
export type LevelId = "easy" | "medium" | "hard";

export interface Level {
  id: LevelId;
  label: string;
  /** One line under the label on the title screen. */
  blurb: string;
  /** Maze size in cells (see mazeData.setMazeConfig). */
  cellsW: number;
  cellsH: number;
  /** Corridor width in metres. */
  cell: number;
}

export const LEVELS: Level[] = [
  { id: "easy", label: "Easy", blurb: "8 × 8 · a morning walk", cellsW: 8, cellsH: 8, cell: 2 },
  { id: "medium", label: "Medium", blurb: "14 × 14 · more dead ends", cellsW: 14, cellsH: 14, cell: 2 },
  { id: "hard", label: "Hard", blurb: "20 × 20 · a true labyrinth", cellsW: 20, cellsH: 20, cell: 2 },
];
