import { describe, expect, it } from "vitest";
import { Game } from "../src/core/game.ts";
import { type ColorId, COLS, HIDDEN_ROWS, ROWS } from "../src/core/types.ts";

const R: ColorId = 0;
const G: ColorId = 2;

/** ROWS×COLS の空盤面に指定セルを置いた2次元配列を返す */
function layout(cells: Array<[number, number, ColorId]>): Array<Array<ColorId | null>> {
  const rows: Array<Array<ColorId | null>> = Array.from({ length: ROWS }, () =>
    Array<ColorId | null>(COLS).fill(null),
  );
  for (const [r, c, color] of cells) rows[r][c] = color;
  return rows;
}

/** 連鎖が解決しきる(=次のピースがspawnされてcontrolに戻る)までupdateを回す */
function runUntilControl(game: Game): void {
  let chainEnded = false;
  game.events.onChainEnd = () => {
    chainEnded = true;
  };
  // まずlockを発火
  for (let i = 0; i < 4000 && !chainEnded; i++) {
    game.update(16);
  }
}

describe("Game: 設置→消去→得点→再出現", () => {
  it("縦4赤を完成させると消えて40点(1連鎖)", () => {
    const game = new Game();
    game.start();
    game.setGridForTest(
      layout([
        [ROWS - 1, 0, R],
        [ROWS - 2, 0, R],
        [ROWS - 3, 0, R],
      ]),
    );
    // 赤を col0 に落として縦4を完成（子は上向き＝邪魔しない位置）
    game.piece = { col: 0, row: 1, orientation: 0, axis: R, child: G };
    game.hardDrop();
    runUntilControl(game);

    expect(game.score).toBe(40);
    expect(game.cleared).toBe(4);
    expect(game.phase).toBe("control");
  });

  it("2連鎖が正しく加算される(40基準ではなく連鎖ボーナス込み)", () => {
    const game = new Game();
    game.start();
    // col0に赤3・col1に緑3。赤を1つ足すと赤4(連鎖1)→緑が落ちて緑4(連鎖2)
    game.setGridForTest(
      layout([
        [ROWS - 1, 0, R],
        [ROWS - 2, 0, R],
        [ROWS - 3, 0, R],
        [ROWS - 1, 1, G],
        [ROWS - 2, 1, G],
        [ROWS - 3, 1, G],
      ]),
    );
    const chains: number[] = [];
    game.events.onChainStep = (chain) => chains.push(chain);
    game.piece = { col: 0, row: 1, orientation: 0, axis: R, child: G };
    game.hardDrop();
    runUntilControl(game);

    // 連鎖1: 赤4 → 4×10×1 = 40
    // 連鎖2: 緑4(col0r12 + col1r10..12) → chainB(2)=8 → 4×10×8 = 320
    expect(chains).toEqual([1, 2]);
    expect(game.score).toBe(360);
    expect(game.cleared).toBe(8);
    expect(game.phase).toBe("control");
  });
});

describe("Game: ゲームオーバー", () => {
  it("出現位置が埋まっていると窒息", () => {
    const game = new Game();
    game.start();
    let over = false;
    game.events.onGameOver = () => {
      over = true;
    };
    // 出現列(col2)を交互色で天井まで埋める（同色4連結を作らない＝消えない壁）
    const cells: Array<[number, number, ColorId]> = [];
    for (let r = 0; r < ROWS; r++) cells.push([r, 2, r % 2 === 0 ? R : G]);
    game.setGridForTest(layout(cells));
    // 現在のピースを別の列(col4)で着地させ→解決→次のspawnで窒息
    game.piece = { col: 4, row: 1, orientation: 0, axis: R, child: G };
    game.hardDrop();
    for (let i = 0; i < 4000 && !over; i++) game.update(16);
    expect(over).toBe(true);
    expect(game.phase).toBe("gameover");
  });

  it("出現列が見える12段フルでも、まだ窒息せず1段ハミ出して出現できる（粘り）", () => {
    const game = new Game();
    game.start();
    let over = false;
    game.events.onGameOver = () => {
      over = true;
    };
    // col2 の見える12段(row2..13)をフルに（隠し段 row0,row1 は空）
    const cells: Array<[number, number, ColorId]> = [];
    for (let r = HIDDEN_ROWS; r <= ROWS - 1; r++) cells.push([r, 2, r % 2 === 0 ? R : G]);
    game.setGridForTest(layout(cells));
    // 別列に置いて解決→次spawn。col2は満タンでもハミ出し段に出現できるので窒息しない
    game.piece = { col: 4, row: HIDDEN_ROWS, orientation: 0, axis: R, child: G };
    game.hardDrop();
    runUntilControl(game);
    expect(over).toBe(false);
    expect(game.phase).toBe("control");
    // ハミ出し段（見える最上段の1つ上＝隠し段）に出現している
    expect(game.piece?.col).toBe(2);
    expect(game.piece?.row).toBe(HIDDEN_ROWS - 1);
  });

  it("ハミ出し段まで埋まって初めて窒息する", () => {
    const game = new Game();
    game.start();
    let over = false;
    game.events.onGameOver = () => {
      over = true;
    };
    // col2 を見える12段＋ハミ出し1段（row1..13）まで埋める
    const cells: Array<[number, number, ColorId]> = [];
    for (let r = HIDDEN_ROWS - 1; r <= ROWS - 1; r++) cells.push([r, 2, r % 2 === 0 ? R : G]);
    game.setGridForTest(layout(cells));
    // 別列に置いて解決→次spawn。col2はハミ出し段も埋まっているので窒息
    game.piece = { col: 4, row: HIDDEN_ROWS, orientation: 0, axis: R, child: G };
    game.hardDrop();
    for (let i = 0; i < 4000 && !over; i++) game.update(16);
    expect(over).toBe(true);
    expect(game.phase).toBe("gameover");
  });
});
