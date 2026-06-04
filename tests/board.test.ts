import { describe, expect, it } from "vitest";
import { applyGravity, childPos, createGrid, findGroups } from "../src/core/board.ts";
import { COLS, type ColorId, ROWS } from "../src/core/types.ts";

const R: ColorId = 0;
const G: ColorId = 2;

function gridFrom(cells: Array<[number, number, ColorId]>) {
  const g = createGrid();
  for (const [r, c, color] of cells) g[r][c] = color;
  return g;
}

describe("childPos", () => {
  it("向きごとに子の位置が正しい", () => {
    expect(childPos(2, 5, 0)).toEqual([4, 2]); // 上
    expect(childPos(2, 5, 1)).toEqual([5, 3]); // 右
    expect(childPos(2, 5, 2)).toEqual([6, 2]); // 下
    expect(childPos(2, 5, 3)).toEqual([5, 1]); // 左
  });
});

describe("findGroups", () => {
  it("縦4つは消去対象", () => {
    const g = gridFrom([
      [ROWS - 1, 0, R],
      [ROWS - 2, 0, R],
      [ROWS - 3, 0, R],
      [ROWS - 4, 0, R],
    ]);
    const groups = findGroups(g);
    expect(groups).toHaveLength(1);
    expect(groups[0].cells).toHaveLength(4);
    expect(groups[0].color).toBe(R);
  });

  it("3つ以下は消えない", () => {
    const g = gridFrom([
      [ROWS - 1, 0, R],
      [ROWS - 2, 0, R],
      [ROWS - 3, 0, R],
    ]);
    expect(findGroups(g)).toHaveLength(0);
  });

  it("斜めはつながらない", () => {
    const g = gridFrom([
      [ROWS - 1, 0, R],
      [ROWS - 2, 1, R],
      [ROWS - 3, 2, R],
      [ROWS - 4, 3, R],
    ]);
    expect(findGroups(g)).toHaveLength(0);
  });

  it("L字4つは1グループ", () => {
    const g = gridFrom([
      [ROWS - 1, 0, G],
      [ROWS - 1, 1, G],
      [ROWS - 1, 2, G],
      [ROWS - 2, 2, G],
    ]);
    const groups = findGroups(g);
    expect(groups).toHaveLength(1);
    expect(groups[0].cells).toHaveLength(4);
  });
});

describe("applyGravity", () => {
  it("浮いたセルが下詰めされ移動が記録される", () => {
    const g = createGrid();
    g[0][0] = R; // 一番上に浮いている
    const moves = applyGravity(g);
    expect(g[0][0]).toBeNull();
    expect(g[ROWS - 1][0]).toBe(R);
    expect(moves).toEqual([{ col: 0, fromRow: 0, toRow: ROWS - 1, color: R }]);
  });

  it("満杯の列は動かない", () => {
    const g = createGrid();
    for (let r = 0; r < ROWS; r++) g[r][0] = R;
    const moves = applyGravity(g);
    expect(moves).toHaveLength(0);
    expect(g.every((row) => row[0] === R)).toBe(true);
  });

  it("列の数は不変", () => {
    expect(createGrid()[0]).toHaveLength(COLS);
  });
});
