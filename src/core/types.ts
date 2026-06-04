// ぶよぽよ コア型定義（描画に依存しない純ロジック）

/** 盤面の色インデックス。-1 は空。 */
export type ColorId = 0 | 1 | 2 | 3;

export const NUM_COLORS = 4;
export const COLS = 6;
export const VISIBLE_ROWS = 12;
export const HIDDEN_ROWS = 2; // 上に隠し段2段（出現＋ハミ出し猶予のバッファ）
export const ROWS = VISIBLE_ROWS + HIDDEN_ROWS; // row0,1=隠し段, row2..13=見える
export const SPAWN_COL = 2; // 左から3列目

/** 盤面セル：null=空、数値=色 */
export type Cell = ColorId | null;
export type Grid = Cell[][]; // [row][col], row0が最上段(隠し段)

/** 子ぶよの相対方向 */
export type Orientation = 0 | 1 | 2 | 3; // 0=上,1=右,2=下,3=左

/** 操作中の組ぶよ（ロジック上の論理座標） */
export interface Piece {
  col: number;
  row: number;
  orientation: Orientation;
  axis: ColorId;
  child: ColorId;
}

export type Phase = "title" | "control" | "resolving" | "gameover";

/** 1回の消去ステップで消えたグループ */
export interface ClearGroup {
  color: ColorId;
  cells: Array<[number, number]>; // [row, col]
}
