// ゲーム進行のステートマシン（描画非依存）
//   - 落下/設置/連鎖の解決を update(dt) で進める
//   - 連鎖アニメ用に「消去中/落下中」の進捗を公開（レンダラが読む）
//   - 一過性イベント(連鎖発生・ゲームオーバー等)はコールバックで通知
import {
  applyGravity,
  childPos,
  createGrid,
  type FallMove,
  findGroups,
  pieceFits,
} from "./board.ts";
import { Rng } from "./rng.ts";
import { stepScore } from "./scoring.ts";
import {
  type ColorId,
  COLS,
  HIDDEN_ROWS,
  NUM_COLORS,
  type Orientation,
  type Phase,
  type Piece,
  ROWS,
  SPAWN_COL,
  VISIBLE_ROWS,
} from "./types.ts";

export interface GameConfig {
  baseFallMs: number; // レベル1の1段落下時間
  fallDecay: number; // レベルごとの加速率
  minFallMs: number; // 落下時間の下限
  softFallMs: number; // ソフトドロップ時の1段落下時間
  lockMs: number; // 設置猶予
  clearMs: number; // 消去アニメ長
  dropMs: number; // 連鎖落下アニメ長
  clearPerLevel: number; // 何個消したらレベル+1
}

export const DEFAULT_CONFIG: GameConfig = {
  baseFallMs: 800,
  fallDecay: 0.85,
  minFallMs: 90,
  softFallMs: 40,
  lockMs: 350,
  clearMs: 260,
  dropMs: 130,
  clearPerLevel: 30,
};

export interface GameEvents {
  onSpawn?: () => void;
  onLock?: () => void;
  /** 連鎖の各ステップ。chain=連鎖数(1始まり), gained=このステップの得点 */
  onChainStep?: (chain: number, gained: number) => void;
  onChainEnd?: (totalChain: number) => void;
  /** 連鎖の結果、盤面が空になったとき（得点には反映しない・演出のみ） */
  onAllClear?: () => void;
  onGameOver?: (score: number) => void;
}

type ResolveSub = "idle" | "clear" | "drop";

export class Game {
  grid = createGrid();
  piece: Piece | null = null;
  next: [ColorId, ColorId];
  phase: Phase = "title";
  score = 0;
  cleared = 0;
  level = 1;
  chain = 0;

  events: GameEvents = {};

  private cfg: GameConfig;
  private rng: Rng;
  private fallTimer = 0;
  private lockTimer = 0;
  private softDrop = false;

  // 解決フェーズの状態
  private resolveSub: ResolveSub = "idle";
  private resolveTimer = 0;
  private clearingCells = new Set<string>();
  private fallMoves: FallMove[] = [];

  constructor(cfg: GameConfig = DEFAULT_CONFIG, seed?: number) {
    this.cfg = cfg;
    this.rng = new Rng(seed);
    this.next = this.randomPair();
  }

  private randomColor(): ColorId {
    return this.rng.int(NUM_COLORS) as ColorId;
  }
  private randomPair(): [ColorId, ColorId] {
    return [this.randomColor(), this.randomColor()];
  }

  /** タイトルから新規開始 */
  start(): void {
    this.grid = createGrid();
    this.score = 0;
    this.cleared = 0;
    this.level = 1;
    this.chain = 0;
    this.softDrop = false;
    this.resolveSub = "idle";
    this.next = this.randomPair();
    this.spawn();
  }

  private spawn(): void {
    const [a, c] = this.next;
    this.next = this.randomPair();
    const top = HIDDEN_ROWS; // 見える最上段（軸=ここ, 子=1つ上）
    // 軸の出現行を決める：通常は見える最上段。埋まっていたら1段ハミ出して出現（粘り）。
    // 軸・子の両方が空いている行を上から探し、無ければ窒息。
    let row = -1;
    for (const r of [top, top - 1]) {
      if (this.grid[r][SPAWN_COL] === null && this.grid[r - 1][SPAWN_COL] === null) {
        row = r;
        break;
      }
    }
    if (row === -1) {
      this.piece = null;
      this.gameOver();
      return;
    }
    this.piece = { col: SPAWN_COL, row, orientation: 0, axis: a, child: c };
    this.fallTimer = 0;
    this.lockTimer = 0;
    this.phase = "control";
    this.events.onSpawn?.();
  }

  private gameOver(): void {
    this.phase = "gameover";
    this.events.onGameOver?.(this.score);
  }

  // ---- 入力コマンド ----
  move(dir: number): boolean {
    if (this.phase !== "control" || !this.piece) return false;
    const p = this.piece;
    const step = Math.sign(dir);
    if (step === 0) return false;
    if (pieceFits(this.grid, p.col + step, p.row, p.orientation)) {
      p.col += step;
      return true;
    }
    return false;
  }

  /** 目標列へ向けて1マスずつ移動（壁/ぶよで止まる） */
  moveTo(col: number): void {
    if (!this.piece) return;
    while (this.piece.col !== col) {
      if (!this.move(Math.sign(col - this.piece.col))) break;
    }
  }

  rotate(dir: number): boolean {
    if (this.phase !== "control" || !this.piece) return false;
    const p = this.piece;
    const nor = (((p.orientation + dir) % 4) + 4) % 4 as Orientation;
    // 壁蹴り: そのまま→左1→右1→上1
    const kicks: Array<[number, number]> = [
      [0, 0],
      [0, -1],
      [0, 1],
      [-1, 0],
    ];
    for (const [dr, dc] of kicks) {
      if (pieceFits(this.grid, p.col + dc, p.row + dr, nor)) {
        p.col += dc;
        p.row += dr;
        p.orientation = nor;
        return true;
      }
    }
    return false;
  }

  setSoftDrop(on: boolean): void {
    this.softDrop = on;
  }

  hardDrop(): void {
    if (this.phase !== "control" || !this.piece) return;
    const p = this.piece;
    while (pieceFits(this.grid, p.col, p.row + 1, p.orientation)) p.row++;
    this.lockTimer = this.cfg.lockMs; // 即固定へ
  }

  private canMoveDown(): boolean {
    const p = this.piece!;
    return pieceFits(this.grid, p.col, p.row + 1, p.orientation);
  }

  private lockPiece(): void {
    const p = this.piece!;
    const [cr, cc] = childPos(p.col, p.row, p.orientation);
    this.grid[p.row][p.col] = p.axis;
    this.grid[cr][cc] = p.child;
    this.piece = null;
    this.softDrop = false;
    this.events.onLock?.();
    // ちぎり対応: まず重力 → 連鎖解決へ
    this.fallMoves = applyGravity(this.grid);
    this.chain = 0;
    this.phase = "resolving";
    this.resolveSub = "drop";
    this.resolveTimer = this.cfg.dropMs;
  }

  private isBoardEmpty(): boolean {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.grid[r][c] !== null) return false;
      }
    }
    return true;
  }

  private fallMs(): number {
    const base = Math.max(
      this.cfg.minFallMs,
      this.cfg.baseFallMs * Math.pow(this.cfg.fallDecay, this.level - 1),
    );
    return this.softDrop ? Math.min(this.cfg.softFallMs, base) : base;
  }

  /** 解決フェーズの1ステップ（消去対象を探して消す or 連鎖終了） */
  private resolveStep(): void {
    const groups = findGroups(this.grid);
    if (groups.length === 0) {
      const total = this.chain;
      if (total > 0 && this.isBoardEmpty()) this.events.onAllClear?.();
      this.events.onChainEnd?.(total);
      this.spawn();
      return;
    }
    this.chain++;
    const gained = stepScore(groups, this.chain);
    this.score += gained;
    for (const g of groups) this.cleared += g.cells.length;
    this.level = 1 + Math.floor(this.cleared / this.cfg.clearPerLevel);
    this.events.onChainStep?.(this.chain, gained);

    this.clearingCells = new Set();
    for (const g of groups) {
      for (const [r, c] of g.cells) this.clearingCells.add(key(r, c));
    }
    this.resolveSub = "clear";
    this.resolveTimer = this.cfg.clearMs;
  }

  update(dt: number): void {
    if (this.phase === "control") {
      this.fallTimer += dt;
      if (this.fallTimer >= this.fallMs()) {
        this.fallTimer = 0;
        if (this.canMoveDown()) this.piece!.row++;
      }
      if (!this.canMoveDown()) {
        this.lockTimer += dt;
        if (this.lockTimer >= this.cfg.lockMs) this.lockPiece();
      } else {
        this.lockTimer = 0;
      }
    } else if (this.phase === "resolving") {
      this.resolveTimer -= dt;
      if (this.resolveSub === "clear") {
        if (this.resolveTimer <= 0) {
          // 実際に消す → 重力
          for (const k of this.clearingCells) {
            const [r, c] = unkey(k);
            this.grid[r][c] = null;
          }
          this.clearingCells.clear();
          this.fallMoves = applyGravity(this.grid);
          this.resolveSub = "drop";
          this.resolveTimer = this.cfg.dropMs;
        }
      } else if (this.resolveSub === "drop") {
        if (this.resolveTimer <= 0) {
          this.fallMoves = [];
          this.resolveStep();
        }
      }
    }
  }

  // ---- レンダラ向けの読み取り ----
  /** 消去中セルとその進捗(0..1)。なければnull */
  getClearing(): { cells: Set<string>; progress: number } | null {
    if (this.phase !== "resolving" || this.resolveSub !== "clear") return null;
    return {
      cells: this.clearingCells,
      progress: 1 - this.resolveTimer / this.cfg.clearMs,
    };
  }

  /** 落下中の移動とその進捗(0..1)。なければnull */
  getFalling(): { moves: FallMove[]; progress: number } | null {
    if (this.phase !== "resolving" || this.resolveSub !== "drop") return null;
    if (this.fallMoves.length === 0) return null;
    return {
      moves: this.fallMoves,
      progress: 1 - this.resolveTimer / this.cfg.dropMs,
    };
  }

  /** デバッグ/テスト用: 盤面を直接セット */
  setGridForTest(rows: Array<Array<ColorId | null>>): void {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        this.grid[r][c] = rows[r]?.[c] ?? null;
      }
    }
  }
}

function key(r: number, c: number): string {
  return `${r},${c}`;
}
function unkey(k: string): [number, number] {
  const i = k.indexOf(",");
  return [Number(k.slice(0, i)), Number(k.slice(i + 1))];
}

export { COLS, ROWS, VISIBLE_ROWS };
