import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import type { ColorId } from "../core/types.ts";
import type { Expression } from "./puyoGraphics.ts";

const FONT = "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif";
const PUYO_SIZE = 52;
const TEX_SIZE = 128;
const PUYO_SCALE = PUYO_SIZE / TEX_SIZE;
const BOUNCE_AMP = 22;
const BOUNCE_FREQ = 0.004;

type BtnHit = { x: number; y: number; w: number; h: number };

export class LoadingOverlay extends Container {
  private puyos: Sprite[] = [];
  private puyoBaseY = 0;
  private msgText: Text;
  private timeoutText: Text;
  private retryGfx = new Graphics();
  private skipGfx = new Graphics();
  private retryText: Text;
  private skipText: Text;
  private retryHit: BtnHit = { x: 0, y: 0, w: 0, h: 0 };
  private skipHit: BtnHit = { x: 0, y: 0, w: 0, h: 0 };
  private retryPressT = -1;
  private skipPressT = -1;
  private retryCb: (() => void) | null = null;
  private skipCb: (() => void) | null = null;
  private timedOut = false;
  private timeMs = 0;

  constructor(getTexture: (c: ColorId, e: Expression) => Texture) {
    super();

    const bg = new Graphics();
    this.addChild(bg);
    bg.label = "bg";

    for (let i = 0; i < 3; i++) {
      const s = new Sprite(getTexture(i as ColorId, "happy"));
      s.anchor.set(0.5);
      s.scale.set(PUYO_SCALE);
      this.puyos.push(s);
      this.addChild(s);
    }

    this.msgText = new Text({
      text: "よみこみちゅう...",
      style: { fill: "#ffffff", fontSize: 20, fontFamily: FONT, fontWeight: "bold",
               stroke: { color: "#7a3ba8", width: 4 } },
    });
    this.msgText.anchor.set(0.5);
    this.addChild(this.msgText);

    this.timeoutText = new Text({
      text: "つながらなかったよ...",
      style: { fill: "#ffce3a", fontSize: 18, fontFamily: FONT, fontWeight: "bold",
               stroke: { color: "#7a3ba8", width: 4 } },
    });
    this.timeoutText.anchor.set(0.5);
    this.timeoutText.visible = false;
    this.addChild(this.timeoutText);

    this.retryText = new Text({
      text: "もう一度",
      style: { fill: "#ffffff", fontSize: 18, fontFamily: FONT, fontWeight: "bold",
               stroke: { color: "#1a5500", width: 4 } },
    });
    this.retryText.anchor.set(0.5);
    this.skipText = new Text({
      text: "スキップ",
      style: { fill: "#cccccc", fontSize: 18, fontFamily: FONT, fontWeight: "bold",
               stroke: { color: "#444444", width: 4 } },
    });
    this.skipText.anchor.set(0.5);

    this.addChild(this.retryGfx, this.retryText, this.skipGfx, this.skipText);
    this.retryGfx.visible = false;
    this.retryText.visible = false;
    this.skipGfx.visible = false;
    this.skipText.visible = false;

    this.visible = false;
  }

  show(): void {
    this.timedOut = false;
    this.timeMs = 0;
    this.msgText.visible = true;
    this.timeoutText.visible = false;
    this.retryGfx.visible = false;
    this.retryText.visible = false;
    this.skipGfx.visible = false;
    this.skipText.visible = false;
    this.visible = true;
  }

  showTimeout(onRetry: () => void, onSkip: () => void): void {
    this.timedOut = true;
    this.retryCb = onRetry;
    this.skipCb = onSkip;
    this.msgText.visible = false;
    this.timeoutText.visible = true;
    this.retryGfx.visible = true;
    this.retryText.visible = true;
    this.skipGfx.visible = true;
    this.skipText.visible = true;
  }

  hide(): void {
    this.visible = false;
    this.retryCb = null;
    this.skipCb = null;
  }

  tryPress(clientX: number, clientY: number): boolean {
    if (!this.visible || !this.timedOut) return false;
    if (this.retryPressT < 0 && this.skipPressT < 0) {
      if (this.hitTest(clientX, clientY, this.retryHit)) {
        this.retryPressT = 0;
        return true;
      }
      if (this.hitTest(clientX, clientY, this.skipHit)) {
        this.skipPressT = 0;
        return true;
      }
    }
    return false;
  }

  layout(vw: number, vh: number): void {
    const bg = this.getChildAt(0) as Graphics;
    bg.clear();
    bg.rect(0, 0, vw, vh).fill({ color: 0x000000, alpha: 0.88 });

    const cx = vw / 2;
    const cy = vh / 2;
    this.puyoBaseY = cy - 30;

    const spacing = PUYO_SIZE + 14;
    for (let i = 0; i < 3; i++) {
      this.puyos[i].x = cx + (i - 1) * spacing;
      this.puyos[i].y = this.puyoBaseY;
    }

    this.msgText.position.set(cx, cy + PUYO_SIZE / 2 + 22);
    this.timeoutText.position.set(cx, cy + PUYO_SIZE / 2 + 18);

    const btnW = vw * 0.36;
    const btnH = 48;
    const btnY = cy + PUYO_SIZE / 2 + 70;
    const retryX = cx - btnW / 2 - 8;
    const skipX = cx + btnW / 2 + 8;

    this.retryHit = { x: retryX, y: btnY, w: btnW, h: btnH };
    this.skipHit = { x: skipX, y: btnY, w: btnW, h: btnH };

    this.drawBtn(this.retryGfx, retryX, btnY, btnW, btnH, 0x2a6a12);
    this.retryText.position.set(retryX, btnY - 2);

    this.drawBtn(this.skipGfx, skipX, btnY, btnW, btnH, 0x333333);
    this.skipText.position.set(skipX, btnY - 2);
  }

  update(dtMs: number): void {
    if (!this.visible) return;
    this.timeMs += dtMs;

    for (let i = 0; i < 3; i++) {
      const v = Math.abs(Math.sin(BOUNCE_FREQ * this.timeMs + (i * Math.PI * 2) / 3));
      this.puyos[i].y = this.puyoBaseY - v * BOUNCE_AMP;
      const sq = 1 - v;
      this.puyos[i].scale.set(PUYO_SCALE * (1 + 0.1 * sq), PUYO_SCALE * (1 - 0.1 * sq));
    }

    if (!this.timedOut) {
      this.msgText.alpha = 0.6 + 0.4 * Math.sin(this.timeMs / 400);
    }

    this.updateBtnPress(this.retryPressT, dtMs, this.retryGfx, this.retryText, (done) => {
      if (done) { this.retryPressT = -1; this.retryCb?.(); }
      else this.retryPressT += dtMs;
    });
    this.updateBtnPress(this.skipPressT, dtMs, this.skipGfx, this.skipText, (done) => {
      if (done) { this.skipPressT = -1; this.skipCb?.(); }
      else this.skipPressT += dtMs;
    });
  }

  private updateBtnPress(
    t: number, _dtMs: number,
    gfx: Graphics, label: Text,
    tick: (done: boolean) => void,
  ): void {
    if (t < 0) { label.scale.set(1); return; }
    const PRESS = 80, BOUNCE = 100, SETTLE = 60, TOTAL = PRESS + BOUNCE + SETTLE;
    let factor: number;
    if (t < PRESS) factor = 1 - 0.12 * (t / PRESS);
    else if (t < PRESS + BOUNCE) factor = 0.88 + 0.2 * ((t - PRESS) / BOUNCE);
    else if (t < TOTAL) factor = 1.08 - 0.08 * ((t - PRESS - BOUNCE) / SETTLE);
    else { tick(true); return; }
    label.scale.set(factor);
    gfx.scale.set(factor);
    tick(false);
  }

  private hitTest(x: number, y: number, b: BtnHit): boolean {
    return x >= b.x - b.w / 2 && x <= b.x + b.w / 2 &&
           y >= b.y - b.h / 2 && y <= b.y + b.h / 2;
  }

  private drawBtn(g: Graphics, cx: number, cy: number, w: number, h: number, color: number): void {
    g.clear();
    g.roundRect(cx - w / 2, cy - h / 2, w, h, 12).fill({ color, alpha: 0.92 });
    g.roundRect(cx - w / 2, cy - h / 2, w, h, 12).stroke({ width: 2, color: 0xffffff, alpha: 0.2 });
    g.pivot.set(cx, cy);
    g.position.set(cx, cy);
  }
}
