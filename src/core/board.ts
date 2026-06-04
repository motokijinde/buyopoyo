// 盤面操作：生成・座標判定・重力・連結グループ探索（純ロジック）
import {
  COLS,
  ROWS,
  type Cell,
  type ClearGroup,
  type ColorId,
  type Grid,
  type Orientation,
} from "./types.ts";

export function createGrid(): Grid {
  return Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(null));
}

export function inBounds(row: number, col: number): boolean {
  return col >= 0 && col < COLS && row >= 0 && row < ROWS;
}

export function isFree(grid: Grid, row: number, col: number): boolean {
  return inBounds(row, col) && grid[row][col] === null;
}

/** 子ぶよの座標（軸座標と向きから） */
export function childPos(col: number, row: number, orientation: Orientation): [number, number] {
  switch (orientation) {
    case 0:
      return [row - 1, col]; // 上
    case 1:
      return [row, col + 1]; // 右
    case 2:
      return [row + 1, col]; // 下
    case 3:
      return [row, col - 1]; // 左
  }
}

/** 軸＋子の両方が空きマスに収まるか */
export function pieceFits(
  grid: Grid,
  col: number,
  row: number,
  orientation: Orientation,
): boolean {
  const [cr, cc] = childPos(col, row, orientation);
  return isFree(grid, row, col) && isFree(grid, cr, cc);
}

/**
 * 重力を適用（各列で下詰め）。
 * @returns 落下したセルの移動一覧（演出用）。fromRow→toRow（同col）。
 */
export interface FallMove {
  col: number;
  fromRow: number;
  toRow: number;
  color: ColorId;
}

export function applyGravity(grid: Grid): FallMove[] {
  const moves: FallMove[] = [];
  for (let c = 0; c < COLS; c++) {
    let write = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      const cell = grid[r][c];
      if (cell !== null) {
        if (r !== write) {
          grid[write][c] = cell;
          grid[r][c] = null;
          moves.push({ col: c, fromRow: r, toRow: write, color: cell });
        }
        write--;
      }
    }
  }
  return moves;
}

/** 同色4つ以上の連結グループをすべて返す */
export function findGroups(grid: Grid, minSize = 4): ClearGroup[] {
  const seen = Array.from({ length: ROWS }, () => Array<boolean>(COLS).fill(false));
  const groups: ClearGroup[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (seen[r][c] || grid[r][c] === null) continue;
      const color = grid[r][c] as ColorId;
      const stack: Array<[number, number]> = [[r, c]];
      const cells: Array<[number, number]> = [];
      seen[r][c] = true;
      while (stack.length) {
        const [y, x] = stack.pop()!;
        cells.push([y, x]);
        const neighbors: Array<[number, number]> = [
          [y + 1, x],
          [y - 1, x],
          [y, x + 1],
          [y, x - 1],
        ];
        for (const [ny, nx] of neighbors) {
          if (inBounds(ny, nx) && !seen[ny][nx] && grid[ny][nx] === color) {
            seen[ny][nx] = true;
            stack.push([ny, nx]);
          }
        }
      }
      if (cells.length >= minSize) groups.push({ color, cells });
    }
  }
  return groups;
}
