// PixiJSレンダラ：ゲーム状態を毎フレーム描画する（ロジックには非依存）
//   - ぶよはテクスチャ済みスプライト（プール再利用）、連結ブリッジはGraphics
//   - 落下/消去/連鎖アニメ、画面シェイク、連鎖ポップ、飛沫パーティクル
import { Application, Assets, Container, FillGradient, Graphics, Sprite, Text, Texture } from "pixi.js";
import type { Game } from "../core/game.ts";
import { childPos } from "../core/board.ts";
import { COLS, HIDDEN_ROWS, ROWS, SPAWN_COL, VISIBLE_ROWS, type ColorId, type Piece } from "../core/types.ts";
import {
  COLOR_DEFS,
  type Expression,
  generateParticleTexture,
  generatePuyoTextures,
} from "./puyoGraphics.ts";
import { LoadingOverlay } from "./loadingOverlay.ts";
import { RankingOverlay, type RankEntry } from "./rankingOverlay.ts";

const TEX_SIZE = 128;
const LAND_MS = 240; // 着地スクワッシュの長さ
// 背景画像 game_bg.png のフレーム内側（プレイ領域）の位置：画像に対する割合
const GAME_BG = { left: 0.1995, right: 0.7946, top: 0.1598, bottom: 0.8613 };

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
  private gameBgSprite = new Sprite();
  private gameBgLoaded = false;
  private titleLayer = new Container();
  private titleBgSprite = new Sprite();
  private titleLogoSprite = new Sprite();
  private titleChars: Sprite[] = [];
  private titleLoaded = false;
  private gameoverSprite = new Sprite();
  private gameoverLoaded = false;
  private titleLogoBase = { x: 0, y: 0, scale: 1 };
  private titleCharBase: Array<{ x: number; y: number; size: number }> = [];
  private titleBtnSprite = new Sprite();
  private titleBtnText!: Text;
  private titleBtnBase = { x: 0, y: 0, w: 0, h: 0, scale: 1 };
  private btnPressT = -1;
  private btnPressCallback: (() => void) | null = null;
  private titleRankingBtnSprite = new Sprite();
  private titleRankingBtnText!: Text;
  private titleRankingBtnBase = { x: 0, y: 0, w: 0, h: 0, scale: 1 };
  private rankingBtnPressT = -1;
  private rankingBtnPressCallback: (() => void) | null = null;
  private dangerOverlayGfx = new Graphics();
  private dangerPulse = 0;
  private gameoverBtnSprites = [new Sprite(), new Sprite(), new Sprite()];
  private gameoverBtnTexts: Text[] = [];
  private gameoverBtnBases = [0, 1, 2].map(() => ({ x: 0, y: 0, w: 0, h: 0, scale: 1 }));
  private gameoverBtnPressTs = [-1, -1, -1];
  private gameoverBtnCallbacks: Array<(() => void) | null> = [null, null, null];
  private gameoverBtnsLoaded = false;
  private introActive = false; // スタート演出（ジングル再生）中
  private introStart = 0;
  private world = new Container();
  private frameGfx = new Graphics();
  private bridgeGfx = new Graphics();
  private puyoLayer = new Container();
  private particleLayer = new Container();
  private hud = new Container();

  private scoreText!: Text;
  private scoreLabelText!: Text;
  private bestText!: Text;
  private levelText!: Text;
  private levelLabelText!: Text;
  private levelMeterGfx = new Graphics();
  private levelMeterProg = 0;
  private levelGemGradient!: FillGradient;
  private scoreLabelSprite = new Sprite();
  private bestLabelSprite = new Sprite();
  private levelLabelSprite = new Sprite();
  private nextLabelSprite = new Sprite();
  private labelImgLoaded = false;
  private nextLabel!: Text;
  private nextSprites: [Sprite, Sprite];
  private chainText!: Text;
  private allClearText!: Text;
  private overlayText!: Text;
  private subText!: Text;

  private puyoPool: Sprite[] = [];
  private particles: Particle[] = [];

  private layout: Layout = {
    vw: 0, vh: 0, cell: 40, boardX: 0, boardTop: 0, hudH: 0, safeTop: 0, safeBottom: 0,
  };

  // アニメ用内部状態
  private pvx = SPAWN_COL;
  private pvy = HIDDEN_ROWS;
  private shakeAmt = 0;
  private chainShowT = 0;
  private chainShowN = 0;
  private allClearT = 0;
  private wasClearing = false;
  private timeMs = 0;

  // 着地スクワッシュ用：セルごとの残り時間と、前フレームの落下/組ぶよ状態
  private landAnim = new Map<string, number>();
  private prevFallKeys = new Set<string>();
  private prevPieceCells: string[] | null = null;

  // ゲームオーバー演出（ぐるぐる目＋徐々に灰色化）の経過
  private prevPhase = "title";
  private gameOverT = 0;

  private loadingOverlay!: LoadingOverlay;
  private rankingOverlay!: RankingOverlay;

  private constructor(app: Application) {
    this.app = app;
    this.nextSprites = [new Sprite(), new Sprite()];
  }

  static async create(parent: HTMLElement): Promise<Renderer> {
    const app = new Application();
    await app.init({
      resizeTo: window,
      background: "#000000",
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2.5),
      autoDensity: true,
    });
    parent.appendChild(app.canvas);
    const r = new Renderer(app);
    r.build();
    await r.loadImages();
    r.resize();
    return r;
  }

  /** 画像素材を読み込む（失敗してもフォールバックで動く） */
  private async loadImages(): Promise<void> {
    const base = import.meta.env.BASE_URL;
    try {
      const [bg, logo, btn] = await Promise.all([
        Assets.load(`${base}back.png`),
        Assets.load(`${base}moji.png`),
        Assets.load(`${base}button-yellow.png`),
      ]);
      this.titleBgSprite.texture = bg;
      this.titleLogoSprite.texture = logo;
      this.titleBtnSprite.texture = btn;
      this.titleLoaded = true;
    } catch {
      this.titleLoaded = false;
    }
    try {
      this.gameBgSprite.texture = await Assets.load(`${base}game_bg.png`);
      this.gameBgLoaded = true;
    } catch {
      this.gameBgLoaded = false;
    }
    try {
      this.gameoverSprite.texture = await Assets.load(`${base}gameover.png`);
      this.gameoverLoaded = true;
    } catch {
      this.gameoverLoaded = false;
    }
    try {
      const [green, purple, red, rankingLogo] = await Promise.all([
        Assets.load(`${base}button-green.png`),
        Assets.load(`${base}button-purple.png`),
        Assets.load(`${base}button-red.png`),
        Assets.load(`${base}ranking.png`),
      ]);
      this.gameoverBtnSprites[0].texture = green;
      this.gameoverBtnSprites[1].texture = purple;
      this.gameoverBtnSprites[2].texture = red;
      this.titleRankingBtnSprite.texture = purple;
      this.rankingOverlay.setTextures(rankingLogo, red);
      this.gameoverBtnsLoaded = true;
    } catch {
      this.gameoverBtnsLoaded = false;
    }
    try {
      const [st, bt, lt, nt] = await Promise.all([
        Assets.load(`${base}score.png`),
        Assets.load(`${base}best.png`),
        Assets.load(`${base}level.png`),
        Assets.load(`${base}next.png`),
      ]);
      this.scoreLabelSprite.texture = st;
      this.bestLabelSprite.texture = bt;
      this.levelLabelSprite.texture = lt;
      this.nextLabelSprite.texture = nt;
      this.labelImgLoaded = true;
    } catch {
      this.labelImgLoaded = false;
    }
  }

  private build(): void {
    this.textures = generatePuyoTextures();
    this.particleTex = generateParticleTexture();
    this.levelGemGradient = new FillGradient({
      type: "linear",
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: "#fff5c0" },
        { offset: 0.3, color: "#ffd740" },
        { offset: 0.72, color: "#ff9900" },
        { offset: 1, color: "#cc5500" },
      ],
      textureSpace: "local",
    });

    this.app.stage.addChild(this.bgSprite);
    this.app.stage.addChild(this.world);
    this.app.stage.addChild(this.dangerOverlayGfx);
    this.world.addChild(this.gameBgSprite); // 盤面の最背面（フレーム画像）
    this.world.addChild(this.frameGfx);
    this.world.addChild(this.bridgeGfx);
    this.world.addChild(this.puyoLayer);
    this.world.addChild(this.particleLayer);

    const font = "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif";
    this.scoreLabelText = new Text({ text: "SCORE", style: { fill: "#ffce3a", fontSize: 11, fontFamily: font, fontWeight: "bold" } });
    this.scoreText = new Text({ text: "0", style: { fill: "#ffffff", fontSize: 22, fontFamily: font, fontWeight: "bold", stroke: { color: "#cc44aa", width: 4 } } });
    this.bestText = new Text({ text: "BEST 0", style: { fill: "#ffffff", fontSize: 22, fontFamily: font, fontWeight: "bold", stroke: { color: "#cc44aa", width: 4 } } });
    this.levelLabelText = new Text({ text: "LEVEL", style: { fill: "#ffe07a", fontSize: 10, fontFamily: font, fontWeight: "bold" } });
    this.levelText = new Text({ text: "1", style: { fill: "#ffe07a", fontSize: 20, fontFamily: font, fontWeight: "bold", stroke: { color: "#7a3ba8", width: 4 } } });
    this.nextLabel = new Text({ text: "NEXT", style: { fill: "#ffe07a", fontSize: 12, fontFamily: font, fontWeight: "bold" } });
    this.levelLabelText.anchor.set(0.5, 0);
    this.levelText.anchor.set(0.5, 0);
    this.nextLabel.anchor.set(0.5, 0);
    for (const s of this.nextSprites) s.anchor.set(0.5);

    this.chainText = new Text({
      text: "",
      style: { fill: "#ffffff", fontSize: 54, fontFamily: font, fontWeight: "bold", stroke: { color: "#ff5a6a", width: 6 } },
    });
    this.chainText.anchor.set(0.5);
    this.chainText.visible = false;

    this.allClearText = new Text({
      text: "",
      style: { fill: "#ffe07a", fontSize: 46, fontFamily: font, fontWeight: "bold", stroke: { color: "#b06bdb", width: 6 } },
    });
    this.allClearText.anchor.set(0.5);
    this.allClearText.visible = false;

    this.overlayText = new Text({ text: "", style: { fill: "#ffffff", fontSize: 44, fontFamily: font, fontWeight: "bold", align: "center" } });
    this.overlayText.anchor.set(0.5);
    this.subText = new Text({ text: "", style: { fill: "#ffce3a", fontSize: 18, fontFamily: font, fontWeight: "bold", align: "center", stroke: { color: "#7a3ba8", width: 4 } } });
    this.subText.anchor.set(0.5);
    this.titleBtnSprite.anchor.set(0.5);
    this.titleBtnText = new Text({ text: "START", style: { fill: "#ffffff", fontSize: 24, fontFamily: font, fontWeight: "bold", stroke: { color: "#996600", width: 5 } } });
    this.titleBtnText.anchor.set(0.5);
    this.titleRankingBtnSprite.anchor.set(0.5);
    this.titleRankingBtnText = new Text({ text: "RANKING", style: { fill: "#ffffff", fontSize: 20, fontFamily: font, fontWeight: "bold", stroke: { color: "#441188", width: 5 } } });
    this.titleRankingBtnText.anchor.set(0.5);
    const goLabels = ["REPLAY", "RANKING", "EXIT"];
    const goStrokes = ["#1a5500", "#441188", "#881100"];
    for (let i = 0; i < 3; i++) {
      const t = new Text({ text: goLabels[i], style: { fill: "#ffffff", fontSize: 24, fontFamily: font, fontWeight: "bold", stroke: { color: goStrokes[i], width: 5 } } });
      t.anchor.set(0.5);
      this.gameoverBtnTexts.push(t);
      this.gameoverBtnSprites[i].anchor.set(0.5);
    }

    this.hud.addChild(this.scoreLabelText, this.scoreText, this.bestText);
    this.hud.addChild(this.levelLabelText, this.levelText);
    this.hud.addChild(this.nextLabel);
    for (const s of [this.scoreLabelSprite, this.bestLabelSprite, this.levelLabelSprite, this.nextLabelSprite]) {
      s.anchor.set(0.5, 0.43);
      this.hud.addChild(s);
    }
    this.hud.addChild(this.levelMeterGfx);
    this.hud.addChild(this.nextSprites[0], this.nextSprites[1]);
    this.hud.addChild(this.chainText, this.allClearText, this.overlayText, this.subText);

    // タイトル（最前面・タイトル中のみ表示）：背景→4色キャラ→ロゴ
    this.titleBgSprite.anchor.set(0.5);
    this.titleLogoSprite.anchor.set(0.5);
    this.titleLayer.addChild(this.titleBgSprite);
    for (let i = 0; i < 4; i++) {
      const s = new Sprite(this.tex(i as ColorId, "normal"));
      s.anchor.set(0.5);
      this.titleChars.push(s);
      this.titleLayer.addChild(s);
    }
    this.titleLayer.addChild(this.titleLogoSprite);
    this.titleLayer.addChild(this.titleBtnSprite, this.titleBtnText);
    this.titleLayer.addChild(this.titleRankingBtnSprite, this.titleRankingBtnText);
    this.titleLayer.visible = false;
    this.app.stage.addChild(this.titleLayer);
    // ゲームオーバー画像（タイトルより前面、HUDより背面）
    this.gameoverSprite.anchor.set(0.5);
    this.gameoverSprite.alpha = 0;
    this.app.stage.addChild(this.gameoverSprite);
    // ゲームオーバーボタン（gameoverSpriteより前面、HUDより背面）
    for (let i = 0; i < 3; i++) {
      this.gameoverBtnSprites[i].visible = false;
      this.app.stage.addChild(this.gameoverBtnSprites[i]);
      this.gameoverBtnTexts[i].visible = false;
      this.app.stage.addChild(this.gameoverBtnTexts[i]);
    }
    // HUD/オーバーレイ文字（タップでスタート等）はタイトル画像より前面に
    this.app.stage.addChild(this.hud);

    // ローディング・ランキングオーバーレイ（最前面）
    this.loadingOverlay = new LoadingOverlay((c, e) => this.tex(c, e));
    this.app.stage.addChild(this.loadingOverlay);
    this.rankingOverlay = new RankingOverlay();
    this.app.stage.addChild(this.rankingOverlay);
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
    const hudH = 180 + safeTop;
    const footH = 24 + safeBottom;
    const availH = vh - hudH - footH;
    const availW = vw - 16;
    // 見える12段＋猶予ゾーン(隠し段)ぶんの高さを確保
    const cell = Math.floor(Math.min(availW / COLS, availH / (VISIBLE_ROWS + HIDDEN_ROWS)));
    const boardX = Math.floor((vw - cell * COLS) / 2);
    // 盤面（猶予ゾーン込み）を上下中央に：余り高さを上下へ均等配分
    const totalH = (VISIBLE_ROWS + HIDDEN_ROWS) * cell;
    const pad = Math.floor((availH - totalH) / 2);
    const boardTop = hudH + pad + HIDDEN_ROWS * cell;
    this.layout = { vw, vh, cell, boardX, boardTop, hudH, safeTop, safeBottom };

    this.drawBackground();
    this.layoutGameBg();
    this.drawFrame();
    this.layoutHud();
    this.layoutTitle();
    this.layoutGameoverBtns();
    this.loadingOverlay.layout(vw, vh);
    this.rankingOverlay.layout(vw, vh);
  }

  /** 背景フレーム画像を、内側（プレイ領域）が盤面グリッドにぴったり重なるよう配置（横は非正方マスに合わせ微伸長） */
  private layoutGameBg(): void {
    if (!this.gameBgLoaded) return;
    const { cell, boardX, boardTop } = this.layout;
    const iwF = GAME_BG.right - GAME_BG.left;
    const ihF = GAME_BG.bottom - GAME_BG.top;
    const gridW = COLS * cell;
    const gridH = (VISIBLE_ROWS + HIDDEN_ROWS) * cell;
    const drawnW = gridW / iwF;
    const drawnH = gridH / ihF;
    const tex = this.gameBgSprite.texture;
    this.gameBgSprite.scale.set(drawnW / tex.width, drawnH / tex.height);
    // 内側の左上(GAME_BG.left, top)がグリッド左上（猶予ゾーンの上端）に来るよう原点をずらす
    this.gameBgSprite.position.set(
      boardX - GAME_BG.left * drawnW,
      boardTop - HIDDEN_ROWS * cell - GAME_BG.top * drawnH,
    );
  }

  /** タイトル背景をcontainで収め、ロゴ・4色キャラを背景に対する割合で配置 */
  private layoutTitle(): void {
    if (!this.titleLoaded) return;
    const { vw, vh } = this.layout;
    const tex = this.titleBgSprite.texture;
    // contain + 元サイズ上限：画面に収まる最大スケール（1倍超えない）でPCは左右レターボックス
    const s = Math.min(vw / tex.width, vh / tex.height, 1);
    const bw = tex.width * s;
    const bh = tex.height * s;
    const bx = (vw - bw) / 2;
    const by = (vh - bh) / 2;
    // 背景
    this.titleBgSprite.scale.set(s);
    this.titleBgSprite.position.set(vw / 2, vh / 2);
    // ロゴ（横幅を背景の82%に・上寄り）
    const logoTex = this.titleLogoSprite.texture;
    this.titleLogoBase = { x: bx + bw * 0.5, y: by + bh * 0.3, scale: (bw * 0.82) / logoTex.width };
    // 4色キャラを横一列に（プロト準拠：中心間≒60px相当の詰めた間隔＋内側を上げたアーチ）
    const size = bw * 0.12;
    const arch = [0, -0.35, -0.35, 0];
    this.titleCharBase = [];
    for (let i = 0; i < 4; i++) {
      this.titleCharBase.push({
        x: bx + bw * (0.5 + (i - 1.5) * 0.155),
        y: by + bh * 0.155 + arch[i] * size,
        size,
      });
    }
    // STARTボタン・RANKINGボタン（同サイズ・縦並び）
    const btnTex = this.titleBtnSprite.texture;
    const btnW = bw * 0.62;
    const btnScale = btnW / btnTex.width;
    const btnH = btnTex.height * btnScale;
    const btnX = bx + bw * 0.5;
    const btnGap = btnH * 0.18;
    // 2ボタン分の高さを中心に寄せて、0.70付近に配置
    const btnBlockH = btnH * 2 + btnGap;
    const btnY = by + bh * 0.72 - btnBlockH / 2 + btnH / 2;
    this.titleBtnBase = { x: btnX, y: btnY, w: btnW, h: btnH, scale: btnScale };
    this.titleBtnSprite.scale.set(btnScale);
    this.titleBtnSprite.position.set(btnX, btnY);
    this.titleBtnText.style.fontSize = Math.round(Math.min(btnH * 0.42, btnW * 0.18));
    this.titleBtnText.position.set(btnX, btnY - btnH * 0.10);

    // RANKINGボタン（STARTと同サイズ・直下）
    const rBtnTex = this.titleRankingBtnSprite.texture;
    const rBtnScale = rBtnTex.width > 1 ? btnW / rBtnTex.width : btnScale;
    const rBtnH = rBtnTex.height * rBtnScale;
    const rBtnX = btnX;
    const rBtnY = btnY + btnH / 2 + btnGap + rBtnH / 2;
    this.titleRankingBtnBase = { x: rBtnX, y: rBtnY, w: btnW, h: rBtnH, scale: rBtnScale };
    this.titleRankingBtnSprite.scale.set(rBtnScale);
    this.titleRankingBtnSprite.position.set(rBtnX, rBtnY);
    this.titleRankingBtnText.style.fontSize = Math.round(Math.min(rBtnH * 0.42, btnW * 0.18));
    this.titleRankingBtnText.position.set(rBtnX, rBtnY - rBtnH * 0.10);
  }

  /** タイトルのアニメ：通常=ぷるぷる揺れ＋まばたき／スタート演出中=にっこりピョコ＆ロゴ拡大 */
  private updateTitle(dtMs: number): void {
    if (!this.titleLoaded) return;
    const t = this.timeMs;
    const intro = this.introActive ? Math.min(1, (t - this.introStart) / 320) : 0; // 立ち上がり0→1
    for (let i = 0; i < 4; i++) {
      const b = this.titleCharBase[i];
      const ch = this.titleChars[i];
      if (!b || !ch) continue;
      if (this.introActive) {
        // にっこり笑顔でピョコピョコ跳ねる
        ch.texture = this.tex(i as ColorId, "happy");
        const base = (b.size / TEX_SIZE) * (1 + 0.12 * intro);
        ch.scale.set(base, base);
        ch.position.set(b.x, b.y - Math.abs(Math.sin(t / 180 + i * 0.5)) * b.size * 0.22 * intro);
      } else {
        const e = Math.sin(t / 520 + i * 1.3); // 色ごとに位相ずらし
        const blink = (t + i * 900) % 2800 < 130;
        ch.texture = this.tex(i as ColorId, blink ? "blink" : "normal");
        const base = b.size / TEX_SIZE;
        ch.scale.set(base * (1 - 0.06 * e), base * (1 + 0.06 * e));
        ch.position.set(b.x, b.y + e * b.size * 0.07);
      }
    }
    const lb = this.titleLogoBase;
    if (this.introActive) {
      const pop = 1 + 0.1 * intro + 0.04 * Math.sin(t / 140); // ドンと拡大＋小刻みに弾む
      this.titleLogoSprite.scale.set(lb.scale * pop, lb.scale * pop);
      this.titleLogoSprite.position.set(lb.x, lb.y);
    } else {
      const e = Math.sin(t / 430);
      this.titleLogoSprite.scale.set(lb.scale * (1 - 0.03 * e), lb.scale * (1 + 0.03 * e));
      this.titleLogoSprite.position.set(lb.x, lb.y + Math.sin(t / 600) * this.layout.vh * 0.004);
    }

    // ボタンアニメーション
    const b = this.titleBtnBase;
    let btnScale = b.scale;
    if (this.btnPressT >= 0) {
      this.btnPressT += dtMs;
      const PRESS = 80, BOUNCE = 100, SETTLE = 60, TOTAL = PRESS + BOUNCE + SETTLE;
      let sc: number;
      if (this.btnPressT < PRESS) {
        sc = 1 - 0.12 * (this.btnPressT / PRESS);
      } else if (this.btnPressT < PRESS + BOUNCE) {
        sc = 0.88 + 0.2 * ((this.btnPressT - PRESS) / BOUNCE);
      } else if (this.btnPressT < TOTAL) {
        sc = 1.08 - 0.08 * ((this.btnPressT - PRESS - BOUNCE) / SETTLE);
      } else {
        sc = 1;
        const cb = this.btnPressCallback;
        this.btnPressT = -1;
        this.btnPressCallback = null;
        cb?.();
      }
      btnScale = b.scale * sc;
    }
    this.titleBtnSprite.scale.set(btnScale);
    this.titleBtnText.scale.set(this.btnPressT >= 0 ? btnScale / b.scale : 1);

    // RANKINGボタンアニメーション
    const rb = this.titleRankingBtnBase;
    let rBtnScale = rb.scale;
    if (this.rankingBtnPressT >= 0) {
      this.rankingBtnPressT += dtMs;
      const PRESS = 80, BOUNCE = 100, SETTLE = 60, TOTAL = PRESS + BOUNCE + SETTLE;
      let sc: number;
      if (this.rankingBtnPressT < PRESS) sc = 1 - 0.12 * (this.rankingBtnPressT / PRESS);
      else if (this.rankingBtnPressT < PRESS + BOUNCE) sc = 0.88 + 0.2 * ((this.rankingBtnPressT - PRESS) / BOUNCE);
      else if (this.rankingBtnPressT < TOTAL) sc = 1.08 - 0.08 * ((this.rankingBtnPressT - PRESS - BOUNCE) / SETTLE);
      else {
        sc = 1;
        const cb = this.rankingBtnPressCallback;
        this.rankingBtnPressT = -1;
        this.rankingBtnPressCallback = null;
        cb?.();
      }
      rBtnScale = rb.scale * sc;
    }
    this.titleRankingBtnSprite.scale.set(rBtnScale);
    this.titleRankingBtnText.scale.set(this.rankingBtnPressT >= 0 ? rBtnScale / rb.scale : 1);
  }

  private layoutGameoverBtns(): void {
    if (!this.gameoverBtnsLoaded) return;
    const { vw, vh } = this.layout;
    const btnW = this.titleBtnBase.w > 0 ? this.titleBtnBase.w : vw * 0.62;
    const cx = vw / 2;
    // 3ボタン分の高さを計算してブロックごと中央配置（タイトルと同じgap比率）
    const tex0 = this.gameoverBtnSprites[0].texture;
    const btnH = tex0.width > 1 ? (tex0.height * (btnW / tex0.width)) : 60;
    const btnGap = btnH * 0.18;
    const blockH = btnH * 3 + btnGap * 2;
    let y = vh * 0.72 - blockH / 2 + btnH / 2;
    for (let i = 0; i < 3; i++) {
      const tex = this.gameoverBtnSprites[i].texture;
      const sc = btnW / tex.width;
      const h = tex.height * sc;
      this.gameoverBtnBases[i] = { x: cx, y, w: btnW, h, scale: sc };
      this.gameoverBtnSprites[i].scale.set(sc);
      this.gameoverBtnSprites[i].position.set(cx, y);
      this.gameoverBtnTexts[i].style.fontSize = Math.round(Math.min(h * 0.42, btnW * 0.18));
      this.gameoverBtnTexts[i].position.set(cx, y - h * 0.10);
      y += btnH / 2 + btnGap + btnH / 2;
    }
  }

  private updateGameoverBtns(dtMs: number): void {
    for (let i = 0; i < 3; i++) {
      const b = this.gameoverBtnBases[i];
      let sc = b.scale;
      if (this.gameoverBtnPressTs[i] >= 0) {
        this.gameoverBtnPressTs[i] += dtMs;
        const PRESS = 80, BOUNCE = 100, SETTLE = 60, TOTAL = PRESS + BOUNCE + SETTLE;
        const t = this.gameoverBtnPressTs[i];
        let factor: number;
        if (t < PRESS) factor = 1 - 0.12 * (t / PRESS);
        else if (t < PRESS + BOUNCE) factor = 0.88 + 0.2 * ((t - PRESS) / BOUNCE);
        else if (t < TOTAL) factor = 1.08 - 0.08 * ((t - PRESS - BOUNCE) / SETTLE);
        else {
          factor = 1;
          const cb = this.gameoverBtnCallbacks[i];
          this.gameoverBtnPressTs[i] = -1;
          this.gameoverBtnCallbacks[i] = null;
          cb?.();
        }
        sc = b.scale * factor;
        this.gameoverBtnTexts[i].scale.set(factor);
      } else {
        this.gameoverBtnTexts[i].scale.set(1);
      }
      this.gameoverBtnSprites[i].scale.set(sc);
    }
  }

  tryPressGameoverBtn(clientX: number, clientY: number, onReplay: () => void, onRanking: () => void, onMenu: () => void): boolean {
    if (!this.gameoverBtnsLoaded) return false;
    const callbacks = [onReplay, onRanking, onMenu];
    for (let i = 0; i < 3; i++) {
      if (this.gameoverBtnPressTs[i] >= 0) continue;
      const b = this.gameoverBtnBases[i];
      const hw = b.w / 2, hh = b.h / 2;
      if (clientX >= b.x - hw && clientX <= b.x + hw && clientY >= b.y - hh && clientY <= b.y + hh) {
        this.gameoverBtnPressTs[i] = 0;
        this.gameoverBtnCallbacks[i] = callbacks[i];
        return true;
      }
    }
    return false;
  }

  private drawLevelMeter(game: Game, dtMs: number): void {
    const MAX_LEVEL = 10;
    const BLOCKS = 8;
    const target = Math.min(1, game.level / MAX_LEVEL);
    this.levelMeterProg += (target - this.levelMeterProg) * Math.min(1, dtMs / 250);

    const g = this.levelMeterGfx;
    g.clear();
    const { vw, safeTop } = this.layout;
    const top = safeTop + 8;
    const cx = vw / 2;
    const bw = 14, bh = 14, gap = 3;
    const lh = 26;
    const totalW = BLOCKS * bw + (BLOCKS - 1) * gap;
    const startX = cx - totalW / 2 + 10;
    const y = top + lh + 10;

    for (let i = 0; i < BLOCKS; i++) {
      const x = startX + i * (bw + gap);
      const partial = Math.min(1, Math.max(0, this.levelMeterProg * BLOCKS - i));
      const r = 4;

      // 凹み（空ブロックのベース）
      g.roundRect(x, y, bw, bh, r).fill({ color: 0x060212, alpha: 0.88 });

      if (partial > 0) {
        // 外側発光
        g.roundRect(x - 2, y - 2, bw + 4, bh + 4, r + 2).fill({ color: 0xffaa00, alpha: 0.22 * partial });
        // 宝石グラデーション本体
        g.roundRect(x, y, bw, bh, r).fill(this.levelGemGradient);
        // 部分塗り：右側を暗くオーバーレイして埋まってない部分を表現
        if (partial < 1) {
          const px = Math.ceil(bw * partial);
          g.rect(x + px, y, bw - px, bh).fill({ color: 0x060212, alpha: 1 });
        }
        // 上部ハイライト（白い光沢）
        const hlW = Math.floor(bw * partial) - 4;
        if (hlW > 1) {
          g.roundRect(x + 2, y + 2, hlW, Math.floor(bh * 0.32), 1).fill({ color: 0xffffff, alpha: 0.55 });
        }
      }

      // 枠線
      g.roundRect(x, y, bw, bh, r).stroke({ width: 1, color: 0xffffff, alpha: 0.22 });
    }
  }

  private drawBackground(): void {
    const { vw, vh } = this.layout;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(2, Math.floor(vw));
    canvas.height = Math.max(2, Math.floor(vh));
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, vw, vh);
    this.bgSprite.texture = Texture.from(canvas);
    this.bgSprite.width = vw;
    this.bgSprite.height = vh;
  }

  private drawFrame(): void {
    const g = this.frameGfx;
    g.clear();
    // 背景フレーム画像があるときは自前の枠・グリッド・猶予ゾーンは描かない（画像が担う）
    if (this.gameBgLoaded) return;
    const { cell, boardX, boardTop } = this.layout;
    const w = cell * COLS;
    const h = cell * VISIBLE_ROWS;
    const zoneH = HIDDEN_ROWS * cell; // 上の猶予（危険）ゾーン
    const topY = boardTop - zoneH;
    // 盤面＋猶予ゾーン全体の下地（暗め）
    g.roundRect(boardX - 4, topY - 4, w + 8, h + zoneH + 8, 12).fill({ color: "#0a0418", alpha: 0.55 });
    // 猶予ゾーンをうっすら警告色に（ここまで積むと窒息＝はみ出し置き場）
    g.rect(boardX, topY, w, zoneH).fill({ color: "#ff5050", alpha: 0.1 });
    // 見える盤面の極薄グリッド
    for (let c = 0; c <= COLS; c++) {
      g.moveTo(boardX + c * cell, boardTop).lineTo(boardX + c * cell, boardTop + h);
    }
    for (let r = 0; r <= VISIBLE_ROWS; r++) {
      g.moveTo(boardX, boardTop + r * cell).lineTo(boardX + w, boardTop + r * cell);
    }
    g.stroke({ width: 1, color: "#ffffff", alpha: 0.05 });
    // 猶予ゾーンのゴースト縦グリッド＋盤面との境界線（警告色）
    for (let c = 0; c <= COLS; c++) {
      g.moveTo(boardX + c * cell, topY).lineTo(boardX + c * cell, boardTop);
    }
    g.moveTo(boardX, boardTop).lineTo(boardX + w, boardTop);
    g.stroke({ width: 1, color: "#ff7a7a", alpha: 0.18 });
    // 外枠
    g.roundRect(boardX - 4, topY - 4, w + 8, h + zoneH + 8, 12).stroke({ width: 3, color: "#ffffff", alpha: 0.18 });
  }

  private layoutHud(): void {
    const { vw, safeTop } = this.layout;
    const top = safeTop + 8;
    // ラベル画像の表示高さ（各画像のサイズから個別にスケールを計算）
    const lh = 26;
    const calcScale = (sprite: Sprite) => {
      const th = sprite.texture.height || 1024;
      const tw = sprite.texture.width || 1536;
      const s = Math.min(lh / th, 1); // 元サイズより拡大しない
      return { ls: s, lw: Math.round(tw * s) };
    };
    const { ls: scoreLs, lw: scoreLw } = calcScale(this.scoreLabelSprite);
    const { ls: bestLs, lw: bestLw } = calcScale(this.bestLabelSprite);
    const { ls: levelLs, lw: levelLw } = calcScale(this.levelLabelSprite);
    const { ls: nextLs, lw: nextLw } = calcScale(this.nextLabelSprite);
    const row1y = top + lh / 2;
    // 左：SCORE / 値 / BEST / 値 の縦積みレイアウト
    const scoreValY = top + lh + 2 + 11;        // SCOREラベル下＋数値半分
    const bestLblY  = scoreValY + 11 + 4 + 13;  // SCORE値下＋BESTラベル中心
    const bestValY  = bestLblY  + 13 + 2 + 11;  // BESTラベル下＋数値半分

    this.scoreLabelText.position.set(14, top);
    this.scoreText.anchor.set(0, 0.5);
    this.scoreText.position.set(14, scoreValY);
    this.bestText.anchor.set(0, 0.5);
    this.bestText.position.set(14, bestValY);

    // 中央：[LEVEL] 3 横並び / メーター（少し右寄り）
    const cx = vw / 2;
    this.levelLabelText.position.set(cx, top);
    this.levelText.anchor.set(0, 0.5);
    this.levelText.position.set(cx + levelLw / 2 + 6, row1y);

    // 右：[NEXT] / ぶよ × 2
    const nextSize = 36;
    const nx = vw - nextLw / 2 - 14;
    this.nextLabel.position.set(nx, top);
    this.nextSprites[0].position.set(nx, top + lh + 8 + nextSize / 2);
    this.nextSprites[1].position.set(nx, top + lh + 8 + nextSize + 2 + nextSize / 2);
    for (const s of this.nextSprites) s.scale.set(nextSize / TEX_SIZE);

    // ラベル画像配置（anchor=0.5 で中心基準）
    this.scoreLabelSprite.scale.set(scoreLs);
    this.scoreLabelSprite.position.set(14 + scoreLw / 2, row1y);
    this.bestLabelSprite.scale.set(bestLs);
    this.bestLabelSprite.position.set(14 + bestLw / 2, bestLblY);
    this.levelLabelSprite.scale.set(levelLs);
    this.levelLabelSprite.position.set(cx, row1y);
    this.nextLabelSprite.scale.set(nextLs);
    this.nextLabelSprite.position.set(nx, row1y);

    this.chainText.position.set(vw / 2, this.layout.boardTop + this.layout.cell * VISIBLE_ROWS * 0.38);
    this.allClearText.position.set(vw / 2, this.layout.boardTop + this.layout.cell * VISIBLE_ROWS * 0.22);
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
  /** タイトルのスタート演出を開始（ジングルが鳴っている間アニメ） */
  startIntro(): void {
    this.introActive = true;
    this.introStart = this.timeMs;
  }
  showAllClear(): void {
    this.allClearT = 1100;
    this.shake(6);
    // 盤面のあちこちにきらめきを散らす（ごほうび演出。得点には影響しない）
    for (let i = 0; i < 12; i++) {
      const c = Math.floor(Math.random() * COLS);
      const r = 1 + Math.floor(Math.random() * VISIBLE_ROWS);
      this.spawnParticles(this.cx(c), this.cy(r));
    }
  }

  // ---- 毎フレーム描画 ----
  render(game: Game, dtMs: number): void {
    this.timeMs += dtMs;
    const L = this.layout;

    // 着地スクワッシュの時間を進める
    for (const [k, v] of this.landAnim) {
      const nv = v - dtMs;
      if (nv <= 0) this.landAnim.delete(k);
      else this.landAnim.set(k, nv);
    }

    // ゲームオーバー経過（灰色化の進み具合に使う）
    if (game.phase === "gameover") {
      if (this.prevPhase !== "gameover") {
        this.gameOverT = 0;
        for (let i = 0; i < 3; i++) {
          this.gameoverBtnPressTs[i] = -1;
          this.gameoverBtnCallbacks[i] = null;
        }
      }
      this.gameOverT += dtMs;
    }
    this.prevPhase = game.phase;

    // シェイク減衰
    this.shakeAmt *= Math.pow(0.001, dtMs / 1000);
    if (this.shakeAmt < 0.3) this.shakeAmt = 0;
    this.world.position.set(
      this.shakeAmt ? (Math.random() - 0.5) * this.shakeAmt : 0,
      this.shakeAmt ? (Math.random() - 0.5) * this.shakeAmt : 0,
    );

    // HUD更新
    this.scoreText.text = String(game.score);
    this.bestText.text = this.labelImgLoaded ? String(getBest()) : `BEST ${getBest()}`;
    this.levelText.text = String(game.level);
    this.nextSprites[0].texture = this.tex(game.next[1], "normal");
    this.nextSprites[1].texture = this.tex(game.next[0], "normal");
    const showHud = game.phase !== "title";
    const useImg = this.labelImgLoaded;
    // タイトル中は盤面を隠してタイトル画像だけ見せる
    this.world.visible = showHud;
    this.hud.visible = true;
    this.scoreLabelText.visible = showHud && !useImg;
    this.scoreText.visible = showHud;
    this.bestText.visible = showHud;
    this.levelLabelText.visible = showHud && !useImg;
    this.levelText.visible = showHud;
    this.levelMeterGfx.visible = showHud;
    this.nextLabel.visible = showHud && !useImg;
    this.nextSprites[0].visible = showHud;
    this.nextSprites[1].visible = showHud;
    this.scoreLabelSprite.visible = showHud && useImg;
    this.bestLabelSprite.visible = showHud && useImg;
    this.levelLabelSprite.visible = showHud && useImg;
    this.nextLabelSprite.visible = showHud && useImg;
    if (showHud) this.drawLevelMeter(game, dtMs);

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

      // 着地検出：落下→静止 / 組ぶよの設置 でスクワッシュを起動
      const fallKeys = new Set(fallOff.keys());
      for (const k of this.prevFallKeys) {
        if (!fallKeys.has(k)) {
          const [r, c] = k.split(",").map(Number);
          if (game.grid[r]?.[c] != null) this.landAnim.set(k, LAND_MS);
        }
      }
      if (this.prevPieceCells && !game.piece) {
        for (const k of this.prevPieceCells) {
          if (!fallKeys.has(k)) this.landAnim.set(k, LAND_MS); // 接地して固定された分
        }
      }
      this.prevFallKeys = fallKeys;
      this.prevPieceCells = game.piece ? this.pieceCells(game.piece) : null;

      // ぶよ本体の色味（ゲームオーバーは徐々に灰色化）
      const over = game.phase === "gameover";
      const tint = over ? this.grayTint(Math.min(0.65, this.gameOverT / 700)) : 0xffffff;

      // 連結ブリッジ（ぶよと同じtint・揺れに合わせる）
      this.drawBridges(game, fallOff, clearing, tint, over);

      // ぶよ本体
      // 連鎖（2連鎖以上）の余韻中は、消えずに残ったぶよが「おおっ」と興奮
      const exciting = !over && this.chainShowT > 0 && this.chainShowN >= 2;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const color = game.grid[r][c];
          if (color === null) continue;
          const k = `${r},${c}`;
          const off = fallOff.get(k) ?? 0;
          const x = this.cx(c);
          let y = this.cy(r) + off;
          let expr: Expression = over ? "dizzy" : exciting ? "excited" : blink ? "blink" : "normal";
          let sx = 1, sy = 1, alpha = 1;
          if (over) {
            // ゲームオーバー：ぐるぐる目で脱力（揺れ・スクワッシュは止める）
          } else if (clearing && clearing.cells.has(k)) {
            // 消える直前に見開いて「ハッ」と一瞬ためてから、笑顔で弾ける
            const p = clearing.progress;
            if (p < 0.3) {
              expr = "startled";
              sx = sy = 1 + 0.12 * Math.sin((p / 0.3) * Math.PI * 0.5);
            } else {
              expr = "happy";
              const q = (p - 0.3) / 0.7;
              sx = sy = 1 - q;
              alpha = 1 - q;
            }
          } else if (off === 0) {
            const la = this.landAnim.get(k);
            if (la !== undefined) {
              // 着地：むぎゅっと潰れて戻る（減衰する横潰れ）。接地面は保つ
              const p = 1 - la / LAND_MS;
              const e = Math.exp(-3.2 * p) * Math.cos(6.5 * p);
              sy = 1 - 0.26 * e;
              sx = 1 + 0.26 * e;
              y += (1 - sy) * L.cell * 0.5;
            } else {
              // 待機：色ごとに位相をずらしたぷるん揺れ
              y += this.bobOffset(color);
            }
          }
          this.placePuyoAt(idx++, x, y, color, expr, sx, sy, alpha, tint);
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

      // 操作中の組ぶよ（control中のみ。ゲームオーバー時の"置けなかった組ぶよ"は描かない）
      if (game.piece && game.phase === "control") {
        const p = game.piece;
        const k = 1 - Math.exp(-dtMs / 55);
        this.pvx += (p.col - this.pvx) * k;
        this.pvy += (p.row - this.pvy) * k;
        const danger = this.isDanger(game);
        // 操作中は基本ちょっと得意げ。危険時はあせり、たまにまばたき
        const e: Expression = danger ? "worried" : blink ? "blink" : "smug";
        const ax = this.cxf(this.pvx);
        const ay = this.cyf(this.pvy);
        // 左右移動の追従の遅れ分だけ、進行方向へ慣性で傾ける
        const tilt = Math.max(-0.2, Math.min(0.2, (p.col - this.pvx) * 0.4));
        const [cr, cc] = childPos(p.col, p.row, p.orientation);
        const dx = (cc - p.col) * L.cell;
        const dy = (cr - p.row) * L.cell;
        this.placePuyoAt(idx++, ax + dx, ay + dy, p.child, e, 1, 1, 1, 0xffffff, tilt);
        this.placePuyoAt(idx++, ax, ay, p.axis, e, 1, 1, 1, 0xffffff, tilt);
      } else {
        // 出現位置のリセット用
        this.pvx = SPAWN_COL;
        this.pvy = HIDDEN_ROWS;
      }
    }
    // 余ったプールを隠す
    for (let i = idx; i < this.puyoPool.length; i++) this.puyoPool[i].visible = false;

    // パーティクル
    this.updateParticles(dtMs);

    // 連鎖ポップ
    this.updateChainPopup(dtMs);

    // 全消し演出
    this.updateAllClear(dtMs);

    // 危険時の画面フラッシュ
    this.updateDangerOverlay(game, dtMs);

    // オーバーレイ（タイトル/ゲームオーバー）
    this.updateOverlay(game, dtMs);

    // ローディング・ランキングオーバーレイ更新
    this.loadingOverlay.update(dtMs);
    this.rankingOverlay.update(dtMs);
  }

  private drawBridges(
    game: Game,
    fallOff: Map<string, number>,
    clearing: { cells: Set<string>; progress: number } | null,
    tint: number,
    over: boolean,
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
        const body = this.applyTint(COLOR_DEFS[color].body, tint);
        const x = this.cx(c);
        // 同色は同位相で揺れるので、ブリッジも同じだけ動かせば繋がりが保てる
        // （ゲームオーバー中はぶよ側が揺れを止めるので、ブリッジも止める）
        const y = this.cy(r) + off + (off === 0 && !over ? this.bobOffset(color) : 0);
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

  private placePuyoAt(i: number, x: number, y: number, color: ColorId, expr: Expression, scaleX: number, scaleY: number, alpha: number, tint = 0xffffff, rotation = 0): void {
    let s = this.puyoPool[i];
    if (!s) {
      s = new Sprite();
      s.anchor.set(0.5);
      this.puyoLayer.addChild(s);
      this.puyoPool[i] = s;
    }
    s.visible = true;
    s.texture = this.tex(color, expr);
    const k = this.layout.cell * 0.99 / TEX_SIZE;
    s.scale.set(k * scaleX, k * scaleY);
    s.position.set(x, y);
    s.alpha = alpha;
    s.tint = tint;
    s.rotation = rotation;
  }

  /** 待機中の微振動（色ごとに位相をずらす）。縦オフセットpx */
  private bobOffset(color: ColorId): number {
    return Math.sin(this.timeMs / 600 + color * 1.7) * this.layout.cell * 0.022;
  }

  /** 白→暗いグレーへ amt(0..1) で寄せた tint（ゲームオーバーの灰色化） */
  private grayTint(amt: number): number {
    const r = Math.round(0xff * (1 - amt) + 0x70 * amt);
    const g = Math.round(0xff * (1 - amt) + 0x70 * amt);
    const b = Math.round(0xff * (1 - amt) + 0x78 * amt);
    return (r << 16) | (g << 8) | b;
  }

  /** body色(#rrggbb)に tint を乗算して数値色で返す（スプライトのtintと見た目を揃える） */
  private applyTint(bodyHex: string, tint: number): number {
    const br = parseInt(bodyHex.slice(1, 3), 16);
    const bg = parseInt(bodyHex.slice(3, 5), 16);
    const bb = parseInt(bodyHex.slice(5, 7), 16);
    const r = Math.round((br * ((tint >> 16) & 0xff)) / 255);
    const g = Math.round((bg * ((tint >> 8) & 0xff)) / 255);
    const b = Math.round((bb * (tint & 0xff)) / 255);
    return (r << 16) | (g << 8) | b;
  }

  /** 組ぶよが占める2セルのキー */
  private pieceCells(p: Piece): string[] {
    const [cr, cc] = childPos(p.col, p.row, p.orientation);
    return [`${p.row},${p.col}`, `${cr},${cc}`];
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

  private updateAllClear(dtMs: number): void {
    if (this.allClearT <= 0) {
      this.allClearText.visible = false;
      return;
    }
    this.allClearT -= dtMs;
    const t = this.allClearT;
    this.allClearText.visible = true;
    this.allClearText.text = "ぜんけし！";
    const fadeIn = Math.min(1, (1100 - t) / 150); // 出はポップ
    const fadeOut = Math.min(1, t / 300); // 終わりはフェード
    this.allClearText.alpha = Math.min(fadeIn, fadeOut);
    this.allClearText.scale.set(1 + 0.25 * (1 - fadeOut));
  }

  private updateDangerOverlay(game: Game, dtMs: number): void {
    const g = this.dangerOverlayGfx;
    g.clear();
    if (game.phase !== "control" && game.phase !== "resolving") { this.dangerPulse = 0; return; }
    if (!this.isDanger(game)) { this.dangerPulse = 0; return; }
    this.dangerPulse += dtMs * 0.006;
    const { vw, vh } = this.layout;
    const a = 0.08 + 0.07 * Math.sin(this.dangerPulse);
    g.rect(0, 0, vw, vh).fill({ color: 0xffffff, alpha: a });
  }

  private isDanger(game: Game): boolean {
    for (let c = 0; c < COLS; c++) {
      for (let r = HIDDEN_ROWS; r <= HIDDEN_ROWS + 2; r++) {
        if (game.grid[r]?.[c] != null) return true;
      }
    }
    return false;
  }

  private updateGameoverAnim(vw: number, vh: number): void {
    const sprite = this.gameoverSprite;
    const tex = sprite.texture;
    const FALL_MS = 480;
    const t = this.gameOverT;
    const targetY = vh * 0.28;
    const s = Math.min(vw * 0.85 / tex.width, vh * 0.32 / tex.height);
    sprite.scale.set(s);
    sprite.x = vw / 2;

    if (t < FALL_MS) {
      const p = t / FALL_MS;
      const startY = -(tex.height * s) / 2;
      sprite.y = startY + (targetY - startY) * (p * p); // ease-in 落下
      sprite.alpha = Math.min(1, p * 4); // 素早くフェードイン
    } else {
      // 減衰バウンド（指数減衰 × コサイン）
      const bt = (t - FALL_MS) / 400;
      const bounce = Math.exp(-bt * 3.5) * Math.cos(bt * Math.PI * 3.5) * (tex.height * s) * 0.12;
      // バウンド収束後はゆらゆら浮遊
      const float = bt > 1.8 ? Math.sin(this.timeMs / 900) * 3 : 0;
      sprite.y = targetY + bounce + float;
      sprite.alpha = 1;
    }
  }

  tryPressTitleRankingBtn(clientX: number, clientY: number, callback: () => void): boolean {
    if (!this.titleLoaded || !this.gameoverBtnsLoaded || this.rankingBtnPressT >= 0 || this.introActive) return false;
    const b = this.titleRankingBtnBase;
    const hw = b.w / 2, hh = b.h / 2;
    if (clientX >= b.x - hw && clientX <= b.x + hw && clientY >= b.y - hh && clientY <= b.y + hh) {
      this.rankingBtnPressT = 0;
      this.rankingBtnPressCallback = callback;
      return true;
    }
    return false;
  }

  tryPressTitleBtn(clientX: number, clientY: number, callback: () => void): boolean {
    if (!this.titleLoaded || this.btnPressT >= 0 || this.introActive) return false;
    const b = this.titleBtnBase;
    const hw = b.w / 2, hh = b.h / 2;
    if (clientX >= b.x - hw && clientX <= b.x + hw && clientY >= b.y - hh && clientY <= b.y + hh) {
      this.btnPressT = 0;
      this.btnPressCallback = callback;
      return true;
    }
    return false;
  }

  private updateOverlay(game: Game, dtMs: number): void {
    if (game.phase !== "title") this.introActive = false; // 遷移したら演出終了
    this.titleLayer.visible = game.phase === "title" && this.titleLoaded;
    // ゲームオーバー以外のフェーズではスプライトを隠す
    if (game.phase !== "gameover") {
      this.gameoverSprite.alpha = 0;
      for (let i = 0; i < 3; i++) {
        this.gameoverBtnSprites[i].visible = false;
        this.gameoverBtnTexts[i].visible = false;
      }
    }
    const { vw, vh } = this.layout;
    if (game.phase === "title") {
      if (this.titleLoaded) this.updateTitle(dtMs);
      // 大ロゴ文字は画像がある時は不要（moji.pngが担う）。フォールバック時のみ表示
      this.overlayText.visible = !this.titleLoaded;
      if (!this.titleLoaded) {
        this.overlayText.text = "ぶよぽよ";
        this.overlayText.style.fontSize = 56;
      }
      // ボタン画像があるときはsubTextを非表示
      this.subText.visible = !this.titleLoaded && !this.introActive;
      if (!this.titleLoaded) {
        this.subText.text = "タップでスタート";
        this.subText.alpha = 0.5 + 0.5 * Math.sin(this.timeMs / 400);
        this.subText.style.fontSize = 22;
        this.subText.position.set(vw / 2, vh * 0.55);
      }
      this.titleBtnSprite.visible = this.titleLoaded && !this.introActive;
      this.titleBtnText.visible = this.titleLoaded && !this.introActive;
      const showRankingBtn = this.titleLoaded && !this.introActive && this.gameoverBtnsLoaded;
      this.titleRankingBtnSprite.visible = showRankingBtn;
      this.titleRankingBtnText.visible = showRankingBtn;
    } else if (game.phase === "gameover") {
      if (this.gameoverLoaded) this.updateGameoverAnim(vw, vh);
      const showBtns = this.gameoverBtnsLoaded &&
        !this.loadingOverlay.visible && !this.rankingOverlay.visible;
      for (let i = 0; i < 3; i++) {
        this.gameoverBtnSprites[i].visible = showBtns;
        this.gameoverBtnTexts[i].visible = showBtns;
      }
      if (showBtns) {
        this.updateGameoverBtns(dtMs);
        this.overlayText.visible = false;
        this.subText.visible = false;
      } else {
        this.overlayText.visible = true;
        this.overlayText.text = "ゲームオーバー";
        this.overlayText.style.fontSize = 38;
        this.overlayText.position.set(vw / 2, vh * 0.42);
        this.subText.visible = true;
        this.subText.style.fontSize = 18;
        this.subText.text = "タップでもう一回";
        this.subText.alpha = 0.5 + 0.5 * Math.sin(this.timeMs / 400);
        this.subText.position.set(vw / 2, vh * 0.58);
      }
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
    return this.layout.boardTop + (r - HIDDEN_ROWS) * this.layout.cell + this.layout.cell / 2;
  }
  private cxf(c: number): number {
    return this.layout.boardX + c * this.layout.cell + this.layout.cell / 2;
  }
  private cyf(r: number): number {
    return this.layout.boardTop + (r - HIDDEN_ROWS) * this.layout.cell + this.layout.cell / 2;
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

  // ---- ローディングオーバーレイ ----
  showLoading(): void {
    this.loadingOverlay.show();
  }
  showLoadingTimeout(onRetry: () => void, onSkip: () => void): void {
    this.loadingOverlay.showTimeout(onRetry, onSkip);
  }
  hideLoading(): void {
    this.loadingOverlay.hide();
  }
  tryPressLoadingBtn(clientX: number, clientY: number): boolean {
    return this.loadingOverlay.tryPress(clientX, clientY);
  }

  // ---- ランキングオーバーレイ ----
  showRanking(entries: RankEntry[], highlightIdx: number, onClose: () => void): void {
    this.rankingOverlay.show(entries, highlightIdx, onClose);
    this.rankingOverlay.layout(this.layout.vw, this.layout.vh);
  }
  tryPressRankingClose(clientX: number, clientY: number): boolean {
    return this.rankingOverlay.tryPressClose(clientX, clientY);
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
