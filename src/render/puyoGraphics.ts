// ぶよのグラフィックをコードで生成（オフスクリーンCanvas → Pixiテクスチャ）
//   - 色ごとに本体グラデ・ツヤ・ほっぺ・お目目を描画
//   - 色覚配慮: 頭のシルエットのアクセント(房/ツノ/耳)で色を区別
//   - 表情: normal / blink / happy / worried
import { Texture } from "pixi.js";

export interface ColorDef {
  name: string;
  body: string;
  hi: string;
  dk: string;
  cheek: string;
  accent: "tuft" | "bump" | "leaf" | "ears"; // 頭の飾り（色覚配慮）
}

export const COLOR_DEFS: ColorDef[] = [
  { name: "red", body: "#ff5a6a", hi: "#ffb3bd", dk: "#c8323f", cheek: "#ff8a96", accent: "tuft" },
  { name: "yellow", body: "#ffce3a", hi: "#fff0a8", dk: "#d99e10", cheek: "#ffe07a", accent: "bump" },
  { name: "green", body: "#4fd16b", hi: "#aef0bd", dk: "#249a43", cheek: "#86e39a", accent: "leaf" },
  { name: "purple", body: "#b06bdb", hi: "#e0bff2", dk: "#7a3ba8", cheek: "#cd9ae8", accent: "ears" },
];

export type Expression = "normal" | "blink" | "happy" | "worried";

const TEX_SIZE = 128; // 生成解像度（表示時に縮小）

/** 頭のアクセント（色覚配慮のシルエット） */
function drawAccent(ctx: CanvasRenderingContext2D, S: number, def: ColorDef): void {
  const cx = S / 2;
  const R = S * 0.46;
  const topY = cx - R;
  ctx.fillStyle = def.dk;
  ctx.beginPath();
  switch (def.accent) {
    case "tuft": // とがった一房
      ctx.moveTo(cx - R * 0.18, topY + R * 0.15);
      ctx.lineTo(cx + R * 0.05, topY - R * 0.5);
      ctx.lineTo(cx + R * 0.22, topY + R * 0.2);
      ctx.closePath();
      break;
    case "bump": // 丸い一房
      ctx.arc(cx, topY + R * 0.05, R * 0.22, Math.PI, 0);
      break;
    case "leaf": // 葉っぱ/角ばったツノ
      ctx.moveTo(cx - R * 0.05, topY + R * 0.2);
      ctx.quadraticCurveTo(cx + R * 0.05, topY - R * 0.55, cx + R * 0.3, topY - R * 0.1);
      ctx.quadraticCurveTo(cx + R * 0.1, topY + R * 0.1, cx - R * 0.05, topY + R * 0.2);
      break;
    case "ears": // コウモリ耳風の二房
      ctx.moveTo(cx - R * 0.35, topY + R * 0.25);
      ctx.lineTo(cx - R * 0.2, topY - R * 0.35);
      ctx.lineTo(cx - R * 0.02, topY + R * 0.15);
      ctx.moveTo(cx + R * 0.35, topY + R * 0.25);
      ctx.lineTo(cx + R * 0.2, topY - R * 0.35);
      ctx.lineTo(cx + R * 0.02, topY + R * 0.15);
      break;
  }
  ctx.fill();
}

function drawEyes(ctx: CanvasRenderingContext2D, S: number, expr: Expression): void {
  const cx = S / 2;
  const R = S * 0.46;
  const eyeX = R * 0.32;
  const eyeY = cx - R * 0.1;
  const er = R * 0.24;

  if (expr === "happy") {
    // ^ ^ の閉じ目
    ctx.strokeStyle = "#2a1530";
    ctx.lineWidth = S * 0.035;
    ctx.lineCap = "round";
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + sx * eyeX - er * 0.6, eyeY + er * 0.3);
      ctx.lineTo(cx + sx * eyeX, eyeY - er * 0.4);
      ctx.lineTo(cx + sx * eyeX + er * 0.6, eyeY + er * 0.3);
      ctx.stroke();
    }
    return;
  }
  if (expr === "blink") {
    ctx.strokeStyle = "#2a1530";
    ctx.lineWidth = S * 0.035;
    ctx.lineCap = "round";
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + sx * eyeX - er * 0.7, eyeY);
      ctx.quadraticCurveTo(cx + sx * eyeX, eyeY + er * 0.5, cx + sx * eyeX + er * 0.7, eyeY);
      ctx.stroke();
    }
    return;
  }

  // normal / worried: 白目＋瞳
  const pupilDY = expr === "worried" ? -er * 0.35 : 0;
  for (const sx of [-1, 1]) {
    const ex = cx + sx * eyeX;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(ex, eyeY, er, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2a1530";
    const pr = er * 0.55;
    ctx.beginPath();
    ctx.arc(ex + pr * 0.3, eyeY + pupilDY, pr, 0, Math.PI * 2);
    ctx.fill();
    // ハイライト
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(ex + pr * 0.3 - pr * 0.3, eyeY + pupilDY - pr * 0.3, pr * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  if (expr === "worried") {
    // 汗
    ctx.fillStyle = "rgba(120,200,255,0.9)";
    ctx.beginPath();
    ctx.ellipse(cx + eyeX * 1.6, eyeY - er, er * 0.3, er * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPuyo(ctx: CanvasRenderingContext2D, S: number, def: ColorDef, expr: Expression): void {
  const cx = S / 2;
  const R = S * 0.46;

  drawAccent(ctx, S, def);

  // 本体（放射グラデ）
  const g = ctx.createRadialGradient(cx - R * 0.3, cx - R * 0.4, R * 0.2, cx, cx, R * 1.1);
  g.addColorStop(0, def.hi);
  g.addColorStop(0.45, def.body);
  g.addColorStop(1, def.dk);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cx, R, 0, Math.PI * 2);
  ctx.fill();

  // ほっぺ
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = def.cheek;
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + sx * R * 0.45, cx + R * 0.28, R * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // ツヤ
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.ellipse(cx - R * 0.32, cx - R * 0.42, R * 0.26, R * 0.16, -0.5, 0, Math.PI * 2);
  ctx.fill();

  drawEyes(ctx, S, expr);
}

/** 全色×表情のテクスチャを生成して Map で返す（キー: `${colorIdx}_${expr}`） */
export function generatePuyoTextures(): Map<string, Texture> {
  const map = new Map<string, Texture>();
  const exprs: Expression[] = ["normal", "blink", "happy", "worried"];
  COLOR_DEFS.forEach((def, idx) => {
    for (const expr of exprs) {
      const canvas = document.createElement("canvas");
      canvas.width = TEX_SIZE;
      canvas.height = TEX_SIZE;
      const ctx = canvas.getContext("2d")!;
      drawPuyo(ctx, TEX_SIZE, def, expr);
      map.set(`${idx}_${expr}`, Texture.from(canvas));
    }
  });
  return map;
}

/** 消去の飛沫用の柔らかい円テクスチャ */
export function generateParticleTexture(): Texture {
  const S = 48;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  ctx.fill();
  return Texture.from(canvas);
}
