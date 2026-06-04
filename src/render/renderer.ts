// PixiJSレンダラ：ゲーム状態を毎フレーム描画する（ロジックには非依存）
//   - ぶよはテクスチャ済みスプライト（プール再利用）、連結ブリッジはGraphics
//   - 落下/消去/連鎖アニメ、画面シェイク、連鎖ポップ、飛沫パーティクル
import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import type { Game } from "../core/game.ts";
import { childPos } from "../core/board.ts";
import { COLS, ROWS, SPAWN_COL, VISIBLE_ROWS, type ColorId } from "../core/types.ts";
import {
  COLOR_DEFS,
  type Expression,
  generateParticleTexture,
  generatePuyoTextures,
} from "./puyoGraphics.ts";

const TEX_SIZE = 128;

interface Layout {
  vw: number;
  vh: number;
  cell: number;
  boardX: number;
  boardTop: number;
  hudH: number;
  safeTop: number;
  safeBottom: number;
}

interface Particle {
  sprite: Sprite;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

export class Renderer {
  app: Application;
  private textures!: Map<string, Texture>;
  private particleTex!: Texture;

  private bgSprite = new Sprite(Texture.WHITE);
  private world = new Container();
  private frameGfx = new Graphics();
  private dangerGfx = new Graphics();
  private bridgeGfx = new Graphics();
  private puyoLayer = new Container();
  private particleLayer = new Container();
  private hud = new Container();

  private scoreText!: Text;
  private bestText!: Text;
  private levelText!: Text;
  private nextLabel!: Text;
  private nextSprites: [Sprite, Sprite];
  private chainText!: Text;
  private overlayText!: Text;
  private subText!: Text;

  private puyoPool: Sprite[] = [];
  private particles: Particle[] = [];

  private layout: Layout = {
    vw: 0, vh: 0, cell: 40, boardX: 0, boardTop: 0, hudH: 0, safeTop: 0, safeBottom: 0,
  };

  // アニメ用内部状態
  private pvx = SPAWN_COL;
  private pvy = 1;
  private shakeAmt = 0;
  private chainShowT = 0;
  private chainShowN = 0;
  private wasClearing = false;
  private timeMs = 0;

  private constructor(app: Application) {
    this.app = app;
    this.nextSprites = [new Sprite(), new Sprite()];
  }

  static async create(parent: HTMLElement): Promise<Renderer> {
    const app = new Application();
    await app.init({
      resizeTo: window,
      background: "#150b2c",
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2.5),
      autoDensity: true,
    });
    parent.appendChild(app.canvas);
    const r = new Renderer(app);
    r.build();
    r.resize();
    return r;
  }

  private build(): void {
    this.textures = generatePuyoTextures();
    this.particleTex = generateParticleTexture();

    this.app.stage.addChild(this.bgSprite);
    this.app.stage.addChild(this.world);
    this.world.addChild(this.frameGfx);
    this.world.addChild(this.dangerGfx);
    this.world.addChild(this.bridgeGfx);
    this.world.addChild(this.puyoLayer);
    this.world.addChild(this.particleLayer);
    this.app.stage.addChild(this.hud);

    const font = "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif";
    this.scoreText = new Text({ text: "0", style: { fill: "#ffffff", fontSize: 26, fontFamily: font, fontWeight: "bold" } });
    const small = { fill: "#ffffffb0", fontSize: 11, fontFamily: font, fontWeight: "bold" as const };
    this.bestText = new Text({ text: "BEST 0", style: small });
    this.levelText = new Text({ text: "LEVEL 1", style: small });
    this.nextLabel = new Text({ text: "NEXT", style: small });
    this.bestText.anchor.set(1, 0);
    this.levelText.anchor.set(1, 0);
    this.nextLabel.anchor.set(1, 0);
    for (const s of this.nextSprites) s.anchor.set(0.5);

    this.chainText = new Text({
      text: "",
      style: { fill: "#ffffff", fontSize: 54, fontFamily: font, fontWeight: "bold", stroke: { color: "#ff5a6a", width: 6 } },
    });
    this.chainText.anchor.set(0.5);
    this.chainText.visible = false;

    this.overlayText = new Text({ text: "", style: { fill: "#ffffff", fontSize: 44, fontFamily: font, fontWeight: "bold", align: "center" } });
    this.overlayText.anchor.set(0.5);
    this.subText = new Text({ text: "", style: { fill: "#ffce3a", fontSize: 18, fontFamily: font, fontWeight: "bold", align: "center" } });
    this.subText.anchor.set(0.5);

    this.hud.addChild(this.scoreText, this.bestText, this.levelText, this.nextLabel);
    this.hud.addChild(this.nextSprites[0], this.nextSprites[1]);
    this.hud.addChild(this.chainText, this.overlayText, this.subText);
  }

  private env(side: "top" | "bottom"): number {
    const probe = document.createElement("div");
    probe.style.cssText = `position:fixed;${side}:env(safe-area-inset-${side});`;
    document.body.appendChild(probe);
    const v = parseFloat(getComputedStyle(probe)[side as "top"]) || 0;
    probe.remove();
    return v;
  }

  resize(): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const safeTop = this.env("top");
    const safeBottom = this.env("bottom");
    const hudH = 86 + safeTop;
    const footH = 24 + safeBottom;
    const availH = vh - hudH - footH;
    const availW = vw - 16;
    const cell = Math.floor(Math.min(availW / COLS, availH / (VISIBLE_ROWS + 1)));
    const boardX = Math.floor((vw - cell * COLS) / 2);
    const boardTop = hudH + cell;
    this.layout = { vw, vh, cell, boardX, boardTop, hudH, safeTop, safeBottom };

    this.drawBackground();
    this.drawFrame();
    this.layoutHud();
  }

  private drawBackground(): void {
    const { vw, vh } = this.layout;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(2, Math.floor(vw));
    canvas.height = Math.max(2, Math.floor(vh));
    const ctx = canvas.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 0, vh);
    g.addColorStop(0, "#2a1858");
    g.addColorStop(1, "#120726");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);
    this.bgSprite.texture = Texture.from(canvas);
    this.bgSprite.width = vw;
    this.bgSprite.height = vh;
  }

  private drawFrame(): void {
    const { cell, boardX, boardTop } = this.layout;
    const w = cell * COLS;
    const h = cell * VISIBLE_ROWS;
    const g = this.frameGfx;
    g.clear();
    // 盤面の中（暗め）
    g.roundRect(boardX - 4, boardTop - 4, w + 8, h + 8, 12).fill({ color: "#0a0418", alpha: 0.55 });
    // 極薄グリッド
    for (let c = 0; c <= COLS; c++) {
      g.moveTo(boardX + c * cell, boardTop).lineTo(boardX + c * cell, boardTop + h);
    }
    for (let r = 0; r <= VISIBLE_ROWS; r++) {
      g.moveTo(boardX, boardTop + r * cell).lineTo(boardX + w, boardTop + r * cell);
    }
    g.stroke({ width: 1, color: "#ffffff", alpha: 0.05 });
    // 枠
    g.roundRect(boardX - 4, boardTop - 4, w + 8, h + 8, 12).stroke({ width: 3, color: "#ffffff", alpha: 0.18 });
  }

  private layoutHud(): void {
    const { vw, safeTop } = this.layout;
    const top = safeTop + 8;
    this.scoreText.position.set(16, top + 14);
    this.bestText.position.set(vw - 16, top);
    this.levelText.position.set(vw - 16, top + 16);
    this.nextLabel.position.set(vw - 16, top + 36);
    const nx = vw - 30;
    const ny = top + 56;
    this.nextSprites[0].position.set(nx, ny);
    this.nextSprites[1].position.set(nx, ny + 26);
    for (const s of this.nextSprites) {
      const k = 22 / TEX_SIZE;
      s.scale.set(k);
    }
    this.chainText.position.set(vw / 2, this.layout.boardTop + this.layout.cell * VISIBLE_ROWS * 0.38);
    this.overlayText.position.set(vw / 2, this.layout.vh * 0.42);
    this.subText.position.set(vw / 2, this.layout.vh * 0.55);
  }

  // ---- 外部から呼ぶ演出トリガ ----
  showChain(n: number): void {
    if (n < 2) return;
    this.chainShowN = n;
    this.chainShowT = 900;
    this.shake(Math.min(14, 4 + n * 2));
  }
  shake(amt: number): void {
    this.shakeAmt = Math.max(this.shakeAmt, amt);
  }

  // ---- 毎フレーム描画 ----
  render(game: Game, dtMs: number): void {
    this.timeMs += dtMs;
    const L = this.layout;

    // シェイク減衰
    this.shakeAmt *= Math.pow(0.001, dtMs / 1000);
    if (this.shakeAmt < 0.3) this.shakeAmt = 0;
    this.world.position.set(
      this.shakeAmt ? (Math.random() - 0.5) * this.shakeAmt : 0,
      this.shakeAmt ? (Math.random() - 0.5) * this.shakeAmt : 0,
    );

    // HUD更新
    this.scoreText.text = String(game.score);
    this.bestText.text = `BEST ${getBest()}`;
    this.levelText.text = `LEVEL ${game.level}`;
    this.nextSprites[0].texture = this.tex(game.next[1], "normal");
    this.nextSprites[1].texture = this.tex(game.next[0], "normal");
    const showHud = game.phase !== "title";
    this.hud.visible = true;
    this.scoreText.visible = showHud;
    this.bestText.visible = showHud;
    this.levelText.visible = showHud;
    this.nextLabel.visible = showHud;
    this.nextSprites[0].visible = showHud;
    this.nextSprites[1].visible = showHud;

    // 盤面ぶよの描画
    let idx = 0;
    const blink = this.timeMs % 3600 < 140;
    if (game.phase !== "title") {
      const clearing = game.getClearing();
      const falling = game.getFalling();
      const fallOff = new Map<string, number>();
      if (falling) {
        for (const m of falling.moves) {
          fallOff.set(`${m.toRow},${m.col}`, (m.fromRow - m.toRow) * L.cell * (1 - falling.progress));
        }
      }

      // 連結ブリッジ
      this.drawBridges(game, fallOff, clearing);

      // ぶよ本体
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const color = game.grid[r][c];
          if (color === null) continue;
          const off = fallOff.get(`${r},${c}`) ?? 0;
          const x = this.cx(c);
          const y = this.cy(r) + off;
          let expr: Expression = blink ? "blink" : "normal";
          let scale = 1;
          let alpha = 1;
          if (clearing && clearing.cells.has(`${r},${c}`)) {
            expr = "happy";
            scale = 1 - clearing.progress;
            alpha = 1 - clearing.progress;
          }
          this.placePuyo(idx++, x, y, color, expr, scale, alpha);
        }
      }

      // 消去開始の瞬間に飛沫
      const nowClearing = !!clearing;
      if (nowClearing && !this.wasClearing && clearing) {
        for (const k of clearing.cells) {
          const [r, c] = k.split(",").map(Number);
          this.spawnParticles(this.cx(c), this.cy(r));
        }
      }
      this.wasClearing = nowClearing;

      // 操作中の組ぶよ
      if (game.piece) {
        const p = game.piece;
        const k = 1 - Math.exp(-dtMs / 55);
        this.pvx += (p.col - this.pvx) * k;
        this.pvy += (p.row - this.pvy) * k;
        const danger = this.isDanger(game);
        const e: Expression = danger ? "worried" : blink ? "blink" : "normal";
        const ax = this.cxf(this.pvx);
        const ay = this.cyf(this.pvy);
        const [cr, cc] = childPos(p.col, p.row, p.orientation);
        const dx = (cc - p.col) * L.cell;
        const dy = (cr - p.row) * L.cell;
        this.placePuyoAt(idx++, ax + dx, ay + dy, p.child, e, 1, 1);
        this.placePuyoAt(idx++, ax, ay, p.axis, e, 1, 1);
      } else {
        // 出現位置のリセット用
        this.pvx = SPAWN_COL;
        this.pvy = 1;
      }
    }
    // 余ったプールを隠す
    for (let i = idx; i < this.puyoPool.length; i++) this.puyoPool[i].visible = false;

    // パーティクル
    this.updateParticles(dtMs);

    // 連鎖ポップ
    this.updateChainPopup(dtMs);

    // 危険時の枠フラッシュ
    this.updateDangerFrame(game);

    // オーバーレイ（タイトル/ゲームオーバー）
    this.updateOverlay(game);
  }

  private drawBridges(
    game: Game,
    fallOff: Map<string, number>,
    clearing: { cells: Set<string>; progress: number } | null,
  ): void {
    const g = this.bridgeGfx;
    g.clear();
    const L = this.layout;
    const isClear = (r: number, c: number) => clearing?.cells.has(`${r},${c}`) ?? false;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const color = game.grid[r][c];
        if (color === null || isClear(r, c)) continue;
        const off = fallOff.get(`${r},${c}`) ?? 0;
        const body = COLOR_DEFS[color].body;
        const x = this.cx(c);
        const y = this.cy(r) + off;
        // 右
        if (c + 1 < COLS && game.grid[r][c + 1] === color && !isClear(r, c + 1)) {
          const off2 = fallOff.get(`${r},${c + 1}`) ?? 0;
          if (off2 === off) {
            g.roundRect(x, y - L.cell * 0.28, L.cell, L.cell * 0.56, L.cell * 0.18).fill(body);
          }
        }
        // 下
        if (r + 1 < ROWS && game.grid[r + 1][c] === color && !isClear(r + 1, c)) {
          const off2 = fallOff.get(`${r + 1},${c}`) ?? 0;
          if (off2 === off) {
            g.roundRect(x - L.cell * 0.28, y, L.cell * 0.56, L.cell).fill(body);
          }
        }
      }
    }
  }

  private placePuyo(i: number, x: number, y: number, color: ColorId, expr: Expression, scale: number, alpha: number): void {
    this.placePuyoAt(i, x, y, color, expr, scale, alpha);
  }

  private placePuyoAt(i: number, x: number, y: number, color: ColorId, expr: Expression, scale: number, alpha: number): void {
    let s = this.puyoPool[i];
    if (!s) {
      s = new Sprite();
      s.anchor.set(0.5);
      this.puyoLayer.addChild(s);
      this.puyoPool[i] = s;
    }
    s.visible = true;
    s.texture = this.tex(color, expr);
    const k = (this.layout.cell * 0.99 / TEX_SIZE) * scale;
    s.scale.set(k);
    s.position.set(x, y);
    s.alpha = alpha;
  }

  private spawnParticles(x: number, y: number): void {
    const n = 6;
    for (let i = 0; i < n; i++) {
      const sp = new Sprite(this.particleTex);
      sp.anchor.set(0.5);
      sp.position.set(x, y);
      const a = Math.random() * Math.PI * 2;
      const spd = 0.05 + Math.random() * 0.12;
      const k = this.layout.cell / 40;
      this.particleLayer.addChild(sp);
      this.particles.push({
        sprite: sp,
        vx: Math.cos(a) * spd * k * 16,
        vy: Math.sin(a) * spd * k * 16,
        life: 350,
        maxLife: 350,
      });
    }
  }

  private updateParticles(dtMs: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dtMs;
      if (p.life <= 0) {
        p.sprite.destroy();
        this.particles.splice(i, 1);
        continue;
      }
      const t = dtMs / 16;
      p.sprite.x += p.vx * t;
      p.sprite.y += p.vy * t;
      p.vy += 0.6 * t;
      const f = p.life / p.maxLife;
      p.sprite.alpha = f;
      p.sprite.scale.set((this.layout.cell / 40) * (0.4 + 0.6 * f));
    }
  }

  private updateChainPopup(dtMs: number): void {
    if (this.chainShowT > 0) {
      this.chainShowT -= dtMs;
      const a = Math.min(1, this.chainShowT / 300);
      this.chainText.visible = true;
      this.chainText.text = `${this.chainShowN} れんさ`;
      this.chainText.alpha = a;
      const sc = 1 + 0.3 * (1 - a);
      this.chainText.scale.set(sc);
    } else {
      this.chainText.visible = false;
    }
  }

  private dangerPulse = 0;
  private updateDangerFrame(game: Game): void {
    this.dangerGfx.clear(); // 毎フレームclearして溜め込まない
    const danger = game.phase !== "title" && this.isDanger(game);
    if (!danger) return;
    this.dangerPulse += 0.1;
    const { cell, boardX, boardTop } = this.layout;
    const w = cell * COLS, h = cell * VISIBLE_ROWS;
    const a = 0.3 + 0.2 * Math.sin(this.dangerPulse);
    this.dangerGfx.roundRect(boardX - 4, boardTop - 4, w + 8, h + 8, 12).stroke({ width: 3, color: "#ff5050", alpha: a });
  }

  private isDanger(game: Game): boolean {
    for (let r = 1; r <= 4; r++) {
      if (game.grid[r]?.[SPAWN_COL] !== null && game.grid[r]?.[SPAWN_COL] !== undefined) return true;
    }
    return false;
  }

  private updateOverlay(game: Game): void {
    if (game.phase === "title") {
      this.overlayText.visible = true;
      this.subText.visible = true;
      this.overlayText.text = "ぶよぽよ";
      this.overlayText.style.fontSize = 56;
      const blink = 0.5 + 0.5 * Math.sin(this.timeMs / 400);
      this.subText.text = "タップでスタート";
      this.subText.alpha = blink;
    } else if (game.phase === "gameover") {
      this.overlayText.visible = true;
      this.subText.visible = true;
      this.overlayText.text = `ゲームオーバー\nSCORE ${game.score}`;
      this.overlayText.style.fontSize = 38;
      const blink = 0.5 + 0.5 * Math.sin(this.timeMs / 400);
      this.subText.text = "タップでもう一回";
      this.subText.alpha = blink;
    } else {
      this.overlayText.visible = false;
      this.subText.visible = false;
    }
  }

  // ---- 座標ヘルパ ----
  private tex(color: ColorId, expr: Expression): Texture {
    return this.textures.get(`${color}_${expr}`)!;
  }
  private cx(c: number): number {
    return this.layout.boardX + c * this.layout.cell + this.layout.cell / 2;
  }
  private cy(r: number): number {
    return this.layout.boardTop + (r - 1) * this.layout.cell + this.layout.cell / 2;
  }
  private cxf(c: number): number {
    return this.layout.boardX + c * this.layout.cell + this.layout.cell / 2;
  }
  private cyf(r: number): number {
    return this.layout.boardTop + (r - 1) * this.layout.cell + this.layout.cell / 2;
  }

  /** 画面座標→盤面列（入力で使う） */
  cellSize(): number {
    return this.layout.cell;
  }
  get vw(): number {
    return this.layout.vw;
  }
  get vh(): number {
    return this.layout.vh;
  }
}

// ハイスコア（描画側の表示用。保存はmainが行う）
let _best = 0;
export function setBest(v: number): void {
  _best = v;
}
export function getBest(): number {
  return _best;
}
