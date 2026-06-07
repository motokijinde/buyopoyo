import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";

const FONT = "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif";
const ROW_H = 38;
const TOP_N = 10;

export interface RankEntry {
  rank: number;
  name: string;
  score: number;
  timestamp: string;
}

type BtnHit = { x: number; y: number; w: number; h: number };

function fmtTimestamp(ts: string): string {
  const m = ts.match(/\d{4}-(\d{2})-(\d{2}) (\d{2}:\d{2})/);
  return m ? `${m[1]}/${m[2]} ${m[3]}` : ts.slice(0, 10);
}

export class RankingOverlay extends Container {
  private panelGfx = new Graphics();
  private highlightGfx = new Graphics();
  private titleSprite = new Sprite();
  private rankTexts: Text[] = [];
  private nameTexts: Text[] = [];
  private scoreTexts: Text[] = [];
  private dateTexts: Text[] = [];
  private closeBtnSprite = new Sprite();
  private closeBtnText: Text;
  private closeBtnBase = { x: 0, y: 0, w: 0, h: 0, scale: 1 };
  private closeBtnHit: BtnHit = { x: 0, y: 0, w: 0, h: 0 };
  private closePressT = -1;
  private onCloseCb: (() => void) | null = null;
  private highlightIdx = -1;
  private timeMs = 0;

  constructor() {
    super();

    const dimBg = new Graphics();
    dimBg.label = "dim";
    this.addChild(dimBg);
    this.addChild(this.panelGfx);
    this.addChild(this.highlightGfx);

    this.titleSprite.anchor.set(0.5);
    this.addChild(this.titleSprite);

    for (let i = 0; i < TOP_N; i++) {
      const rank = new Text({ text: "", style: { fill: "#ffe07a", fontSize: 14, fontFamily: FONT, fontWeight: "bold" } });
      const name = new Text({ text: "", style: { fill: "#ffffff", fontSize: 14, fontFamily: FONT } });
      const score = new Text({ text: "", style: { fill: "#ffce3a", fontSize: 14, fontFamily: FONT, fontWeight: "bold" } });
      const date = new Text({ text: "", style: { fill: "#aaaaaa", fontSize: 11, fontFamily: FONT } });
      rank.anchor.set(0, 0.5);
      name.anchor.set(0, 0.5);
      score.anchor.set(1, 0.5);
      date.anchor.set(1, 0.5);
      this.rankTexts.push(rank);
      this.nameTexts.push(name);
      this.scoreTexts.push(score);
      this.dateTexts.push(date);
      this.addChild(rank, name, score, date);
    }

    this.closeBtnSprite.anchor.set(0.5);
    this.addChild(this.closeBtnSprite);

    this.closeBtnText = new Text({
      text: "とじる",
      style: { fill: "#ffffff", fontSize: 20, fontFamily: FONT, fontWeight: "bold",
               stroke: { color: "#881100", width: 5 } },
    });
    this.closeBtnText.anchor.set(0.5);
    this.addChild(this.closeBtnText);

    this.visible = false;
  }

  setTextures(logoTex: Texture, closeBtnTex: Texture): void {
    this.titleSprite.texture = logoTex;
    this.closeBtnSprite.texture = closeBtnTex;
  }

  show(entries: RankEntry[], highlightIdx: number, onClose: () => void): void {
    this.highlightIdx = highlightIdx;
    this.onCloseCb = onClose;
    this.closePressT = -1;
    this.timeMs = 0;

    for (let i = 0; i < TOP_N; i++) {
      const e = entries[i];
      if (e) {
        const medals = ["🥇", "🥈", "🥉"];
        this.rankTexts[i].text = i < 3 ? medals[i] : `${e.rank}.`;
        this.nameTexts[i].text = e.name;
        this.scoreTexts[i].text = e.score.toLocaleString();
        this.dateTexts[i].text = fmtTimestamp(String(e.timestamp));
        this.rankTexts[i].visible = true;
        this.nameTexts[i].visible = true;
        this.scoreTexts[i].visible = true;
        this.dateTexts[i].visible = true;
      } else {
        for (const t of [this.rankTexts[i], this.nameTexts[i], this.scoreTexts[i], this.dateTexts[i]]) {
          t.visible = false;
        }
      }
    }

    this.visible = true;
  }

  hide(): void {
    this.visible = false;
    const cb = this.onCloseCb;
    this.onCloseCb = null;
    cb?.();
  }

  tryPressClose(clientX: number, clientY: number): boolean {
    if (!this.visible || this.closePressT >= 0) return false;
    const b = this.closeBtnHit;
    if (clientX >= b.x - b.w / 2 && clientX <= b.x + b.w / 2 &&
        clientY >= b.y - b.h / 2 && clientY <= b.y + b.h / 2) {
      this.closePressT = 0;
      return true;
    }
    return false;
  }

  layout(vw: number, vh: number): void {
    const dim = this.getChildAt(0) as Graphics;
    dim.clear();
    dim.rect(0, 0, vw, vh).fill({ color: 0x000000, alpha: 0.92 });

    const pad = 16;
    const innerPad = 14;
    const panelW = Math.min(vw * 0.94, 400);
    const cx = (vw - panelW) / 2 + panelW / 2;

    // ロゴ画像の高さを動的に計算
    const logoTex = this.titleSprite.texture;
    const logoW = panelW - innerPad * 2;
    const logoScale = logoTex.width > 1 ? logoW / logoTex.width : 1;
    const logoH = logoTex.width > 1 ? logoTex.height * logoScale : 40;

    // 閉じるボタン画像の高さを動的に計算
    const closeTex = this.closeBtnSprite.texture;
    const closeBtnW = panelW * 0.62;
    const closeBtnScale = closeTex.width > 1 ? closeBtnW / closeTex.width : 1;
    const closeBtnH = closeTex.width > 1 ? closeTex.height * closeBtnScale : 52;

    const rowsH = TOP_N * ROW_H;
    const panelH = innerPad + logoH + innerPad + rowsH + innerPad * 2 + closeBtnH + innerPad;
    const panelX = (vw - panelW) / 2;
    const panelY = Math.max(pad, (vh - panelH) / 2);

    this.panelGfx.clear();
    this.panelGfx
      .roundRect(panelX, panelY, panelW, panelH, 16)
      .fill({ color: 0x0e0528, alpha: 0.97 });
    this.panelGfx
      .roundRect(panelX, panelY, panelW, panelH, 16)
      .stroke({ width: 2, color: 0xb06bdb, alpha: 0.8 });

    // ロゴ配置
    const logoY = panelY + innerPad + logoH / 2;
    this.titleSprite.scale.set(logoScale);
    this.titleSprite.position.set(cx, logoY);

    const firstRowY = panelY + innerPad + logoH + innerPad;

    const colPad = 12;
    const rankColW = 30;
    const dateColW = 72;
    const rankX = panelX + colPad;
    const nameX = rankX + rankColW + 4;
    const scoreX = panelX + panelW - colPad - dateColW - 4;
    const dateX = panelX + panelW - colPad;

    this.highlightGfx.clear();

    for (let i = 0; i < TOP_N; i++) {
      const rowY = firstRowY + i * ROW_H + ROW_H / 2;

      if (i === this.highlightIdx) {
        this.highlightGfx
          .roundRect(panelX + 4, firstRowY + i * ROW_H + 2, panelW - 8, ROW_H - 4, 8)
          .fill({ color: 0x3d1a6a, alpha: 0.9 });
        this.highlightGfx
          .roundRect(panelX + 4, firstRowY + i * ROW_H + 2, panelW - 8, ROW_H - 4, 8)
          .stroke({ width: 1, color: 0xffe07a, alpha: 0.6 });

        this.rankTexts[i].style.fill = "#ffe07a";
        this.nameTexts[i].style.fill = "#ffe07a";
        this.scoreTexts[i].style.fill = "#ffe07a";
        this.dateTexts[i].style.fill = "#ffce3a";
      } else {
        this.rankTexts[i].style.fill = i < 3 ? "#ffe07a" : "#aaaaaa";
        this.nameTexts[i].style.fill = "#ffffff";
        this.scoreTexts[i].style.fill = "#ffce3a";
        this.dateTexts[i].style.fill = "#888888";
      }

      this.rankTexts[i].position.set(rankX, rowY);
      this.nameTexts[i].position.set(nameX, rowY);
      this.scoreTexts[i].position.set(scoreX, rowY);
      this.dateTexts[i].position.set(dateX, rowY);
    }

    // 閉じるボタン配置
    const closeBtnY = panelY + innerPad + logoH + innerPad + rowsH + innerPad + closeBtnH / 2 + innerPad / 2;
    this.closeBtnBase = { x: cx, y: closeBtnY, w: closeBtnW, h: closeBtnH, scale: closeBtnScale };
    this.closeBtnHit = { x: cx, y: closeBtnY, w: closeBtnW, h: closeBtnH };
    this.closeBtnSprite.scale.set(closeBtnScale);
    this.closeBtnSprite.position.set(cx, closeBtnY);
    this.closeBtnText.style.fontSize = Math.round(Math.min(closeBtnH * 0.42, closeBtnW * 0.18));
    this.closeBtnText.position.set(cx, closeBtnY - closeBtnH * 0.10);
  }

  update(dtMs: number): void {
    if (!this.visible) return;
    this.timeMs += dtMs;

    if (this.closePressT >= 0) {
      this.closePressT += dtMs;
      const PRESS = 80, BOUNCE = 100, SETTLE = 60, TOTAL = PRESS + BOUNCE + SETTLE;
      let factor: number;
      const t = this.closePressT;
      if (t < PRESS) factor = 1 - 0.12 * (t / PRESS);
      else if (t < PRESS + BOUNCE) factor = 0.88 + 0.2 * ((t - PRESS) / BOUNCE);
      else if (t < TOTAL) factor = 1.08 - 0.08 * ((t - PRESS - BOUNCE) / SETTLE);
      else {
        this.closePressT = -1;
        this.hide();
        return;
      }
      this.closeBtnSprite.scale.set(this.closeBtnBase.scale * factor);
      this.closeBtnText.scale.set(factor);
    } else {
      this.closeBtnSprite.scale.set(this.closeBtnBase.scale);
      this.closeBtnText.scale.set(1);
    }

    if (this.highlightIdx >= 0) {
      const pulse = 0.7 + 0.3 * Math.sin(this.timeMs / 350);
      this.highlightGfx.alpha = pulse;
    }
  }
}
