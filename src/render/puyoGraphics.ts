// ぶよのグラフィックをコードで生成（オフスクリーンCanvas → Pixiテクスチャ）
//   - 色ごとに本体グラデ・ツヤ・ほっぺ・お目目を描画
//   - 色覚配慮: 頭のアクセント(房/ツノ/耳)＋色ごとの目の形(8'.2)で色を区別
//   - 表情: normal / blink / happy / worried（開き目は色ごとの目の形で性格づけ）
import { Texture } from "pixi.js";

export interface ColorDef {
  name: string;
  body: string;
  hi: string;
  dk: string;
  cheek: string;
  accent: "tuft" | "bump" | "leaf" | "ears"; // 頭の飾り（色覚配慮）
  eye: "round" | "droopy" | "sleepy" | "cat"; // 目の形＝性格づけ（8'.2・色覚配慮）
}

export const COLOR_DEFS: ColorDef[] = [
  // 赤=元気/つり目, 黄=のんびり/たれ目, 緑=クール/ジト目, 紫=いたずら/ねこ目
  { name: "red", body: "#ff5a6a", hi: "#ffb3bd", dk: "#c8323f", cheek: "#ff8a96", accent: "tuft", eye: "round" },
  { name: "yellow", body: "#ffce3a", hi: "#fff0a8", dk: "#d99e10", cheek: "#ffe07a", accent: "bump", eye: "droopy" },
  { name: "green", body: "#4fd16b", hi: "#aef0bd", dk: "#249a43", cheek: "#86e39a", accent: "leaf", eye: "sleepy" },
  { name: "purple", body: "#b06bdb", hi: "#e0bff2", dk: "#7a3ba8", cheek: "#cd9ae8", accent: "ears", eye: "cat" },
];

export type Expression =
  | "normal"
  | "blink"
  | "happy"
  | "worried"
  | "dizzy"
  | "excited" // 連鎖中の「おおっ」目キラキラ
  | "startled" // 消える直前の見開き「ハッ」
  | "smug"; // 操作中の「ちょっと得意げ」

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

const EYE_DARK = "#2a1530";

/** 丸い瞳＋ハイライト（round/droopy/sleepy 共通） */
function drawPupil(ctx: CanvasRenderingContext2D, ex: number, ey: number, pr: number): void {
  ctx.fillStyle = EYE_DARK;
  ctx.beginPath();
  ctx.arc(ex, ey, pr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.arc(ex - pr * 0.3, ey - pr * 0.3, pr * 0.32, 0, Math.PI * 2);
  ctx.fill();
}

/** 閉じ目系（まばたき / 笑顔）は状態演出なので色共通 */
function drawClosedEyes(ctx: CanvasRenderingContext2D, S: number, expr: "blink" | "happy"): void {
  const cx = S / 2;
  const R = S * 0.46;
  const eyeX = R * 0.32;
  const eyeY = cx - R * 0.1;
  const er = R * 0.24;
  ctx.strokeStyle = EYE_DARK;
  ctx.lineWidth = S * 0.035;
  ctx.lineCap = "round";
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    if (expr === "happy") {
      // ^ ^ の笑い目
      ctx.moveTo(cx + sx * eyeX - er * 0.6, eyeY + er * 0.3);
      ctx.lineTo(cx + sx * eyeX, eyeY - er * 0.4);
      ctx.lineTo(cx + sx * eyeX + er * 0.6, eyeY + er * 0.3);
    } else {
      // まばたきの伏し目
      ctx.moveTo(cx + sx * eyeX - er * 0.7, eyeY);
      ctx.quadraticCurveTo(cx + sx * eyeX, eyeY + er * 0.5, cx + sx * eyeX + er * 0.7, eyeY);
    }
    ctx.stroke();
  }
}

/** 開き目：色ごとの「目の形」で性格を出す（8'.2）。worried で瞳が上＋汗 */
function drawOpenEyes(ctx: CanvasRenderingContext2D, S: number, def: ColorDef, worried: boolean): void {
  const cx = S / 2;
  const R = S * 0.46;
  const eyeX = R * 0.34;
  const eyeY = cx - R * 0.08;
  const er = R * 0.24;

  for (const sx of [-1, 1]) {
    const ex = cx + sx * eyeX;

    switch (def.eye) {
      case "round": { // 赤：ぱっちり丸目・つり目気味
        ctx.save();
        ctx.translate(ex, eyeY);
        ctx.rotate(sx * -0.2); // 外側を上げてつり目に
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.ellipse(0, 0, er * 1.18, er * 1.12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        drawPupil(ctx, ex + sx * er * 0.05, eyeY + (worried ? -er * 0.4 : er * 0.05), er * 0.62);
        break;
      }
      case "droopy": { // 黄：たれ目・半円
        ctx.save();
        ctx.translate(ex, eyeY);
        ctx.rotate(sx * 0.16); // 外側を下げてたれ目に
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(0, 0, er * 1.05, 0, Math.PI); // 下半円（上は平ら）
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        drawPupil(ctx, ex, eyeY + (worried ? er * 0.1 : er * 0.42), er * 0.5);
        break;
      }
      case "sleepy": { // 緑：半目・ジト目
        const lidY = eyeY - er * 0.15;
        ctx.save();
        ctx.beginPath();
        ctx.rect(ex - er * 1.4, lidY, er * 2.8, er * 1.8);
        ctx.clip();
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(ex, eyeY, er, 0, Math.PI * 2);
        ctx.fill();
        drawPupil(ctx, ex, eyeY + (worried ? er * 0.15 : er * 0.4), er * 0.5);
        ctx.restore();
        // 重い上まぶた（ジト目の線）
        ctx.strokeStyle = EYE_DARK;
        ctx.lineWidth = S * 0.045;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(ex - er * 1.05, lidY);
        ctx.lineTo(ex + er * 1.05, lidY);
        ctx.stroke();
        break;
      }
      case "cat": { // 紫：ねこ目・きゅるん
        const pdy = worried ? -er * 0.3 : er * 0.05;
        const pr = er * 0.6;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.ellipse(ex, eyeY, er * 0.96, er * 1.08, 0, 0, Math.PI * 2);
        ctx.fill();
        // 縦長スリットの瞳
        ctx.fillStyle = EYE_DARK;
        ctx.beginPath();
        ctx.ellipse(ex, eyeY + pdy, pr * 0.62, pr * 1.25, 0, 0, Math.PI * 2);
        ctx.fill();
        // きゅるんの大きめハイライト2つ
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.beginPath();
        ctx.arc(ex - pr * 0.3, eyeY + pdy - pr * 0.5, pr * 0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(ex + pr * 0.35, eyeY + pdy + pr * 0.55, pr * 0.2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }
  }

  if (worried) {
    // 汗
    ctx.fillStyle = "rgba(120,200,255,0.9)";
    ctx.beginPath();
    ctx.ellipse(cx + eyeX * 1.7, eyeY - er, er * 0.3, er * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** ゲームオーバー：目がぐるぐる回る渦巻き（しょんぼり感は灰色化＋まゆ無しの脱力で） */
function drawDizzyEyes(ctx: CanvasRenderingContext2D, S: number): void {
  const cx = S / 2;
  const R = S * 0.46;
  const eyeX = R * 0.34;
  const eyeY = cx - R * 0.05;
  const er = R * 0.26;
  ctx.strokeStyle = EYE_DARK;
  ctx.lineWidth = S * 0.03;
  ctx.lineCap = "round";
  for (const sx of [-1, 1]) {
    const ex = cx + sx * eyeX;
    ctx.beginPath();
    const steps = 44;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const ang = sx * t * 2.3 * Math.PI * 2; // 左右で渦の向きを反転
      const rad = er * t;
      const px = ex + Math.cos(ang) * rad;
      const py = eyeY + Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
}

/** きらめき（4点星のツインクル） */
function drawSparkle(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.quadraticCurveTo(x, y, x + s, y);
  ctx.quadraticCurveTo(x, y, x, y + s);
  ctx.quadraticCurveTo(x, y, x - s, y);
  ctx.quadraticCurveTo(x, y, x, y - s);
  ctx.fill();
}

/** 連鎖中の興奮顔：大きなお目目＋瞳キラキラ＋まわりにツインクル */
function drawExcitedEyes(ctx: CanvasRenderingContext2D, S: number): void {
  const cx = S / 2;
  const R = S * 0.46;
  const eyeX = R * 0.34;
  const eyeY = cx - R * 0.06;
  const er = R * 0.27;
  for (const sx of [-1, 1]) {
    const ex = cx + sx * eyeX;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(ex, eyeY, er * 1.05, 0, Math.PI * 2);
    ctx.fill();
    const pr = er * 0.62;
    ctx.fillStyle = EYE_DARK;
    ctx.beginPath();
    ctx.arc(ex, eyeY, pr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath();
    ctx.arc(ex - pr * 0.3, eyeY - pr * 0.4, pr * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex + pr * 0.35, eyeY + pr * 0.5, pr * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  drawSparkle(ctx, cx - eyeX * 1.5, eyeY - er * 0.9, S * 0.06);
  drawSparkle(ctx, cx + eyeX * 1.5, eyeY - er * 0.8, S * 0.05);
}

/** 見開き「ハッ」：目を大きく開いて瞳は小さく（驚き） */
function drawStartledEyes(ctx: CanvasRenderingContext2D, S: number): void {
  const cx = S / 2;
  const R = S * 0.46;
  const eyeX = R * 0.33;
  const eyeY = cx - R * 0.08;
  const er = R * 0.3;
  for (const sx of [-1, 1]) {
    const ex = cx + sx * eyeX;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(ex, eyeY, er, 0, Math.PI * 2);
    ctx.fill();
    const pr = er * 0.3;
    ctx.fillStyle = EYE_DARK;
    ctx.beginPath();
    ctx.arc(ex, eyeY, pr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(ex - pr * 0.3, eyeY - pr * 0.3, pr * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 得意げ顔：外上がりの半目まぶた＋瞳を上＆外へ寄せた「ふふん」視線 */
function drawSmugEyes(ctx: CanvasRenderingContext2D, S: number): void {
  const cx = S / 2;
  const R = S * 0.46;
  const eyeX = R * 0.33;
  const eyeY = cx - R * 0.05;
  const er = R * 0.24;
  for (const sx of [-1, 1]) {
    const ex = cx + sx * eyeX;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(ex, eyeY, er, 0, Math.PI * 2);
    ctx.fill();
    // 瞳：上＆外側に寄せてキョロッと得意げ
    const pr = er * 0.5;
    drawPupil(ctx, ex + sx * er * 0.25, eyeY - er * 0.18, pr);
    // 外上がりの上まぶた（半目のドヤ感）
    ctx.strokeStyle = EYE_DARK;
    ctx.lineWidth = S * 0.042;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(ex - sx * er * 1.05, eyeY - er * 0.35);
    ctx.lineTo(ex + sx * er * 1.05, eyeY - er * 0.7);
    ctx.stroke();
  }
}

function drawEyes(ctx: CanvasRenderingContext2D, S: number, def: ColorDef, expr: Expression): void {
  if (expr === "dizzy") {
    drawDizzyEyes(ctx, S);
    return;
  }
  if (expr === "excited") {
    drawExcitedEyes(ctx, S);
    return;
  }
  if (expr === "startled") {
    drawStartledEyes(ctx, S);
    return;
  }
  if (expr === "smug") {
    drawSmugEyes(ctx, S);
    return;
  }
  if (expr === "happy" || expr === "blink") {
    drawClosedEyes(ctx, S, expr);
    return;
  }
  drawOpenEyes(ctx, S, def, expr === "worried");
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

  drawEyes(ctx, S, def, expr);
}

/** 全色×表情のテクスチャを生成して Map で返す（キー: `${colorIdx}_${expr}`） */
export function generatePuyoTextures(): Map<string, Texture> {
  const map = new Map<string, Texture>();
  const exprs: Expression[] = ["normal", "blink", "happy", "worried", "dizzy", "excited", "startled", "smug"];
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
