// タッチ・ジェスチャー入力 → ゲームコマンドへ変換
//   左右ドラッグ=移動 / タップ=回転(左半=反時計,右半=時計)
//   下フリック=ハードドロップ / 下にドラッグ=ソフト落下
import type { Game } from "../core/game.ts";
import type { Renderer } from "../render/renderer.ts";

export interface GestureTune {
  tapMaxDist: number;
  tapMaxMs: number;
  gestureThresh: number;
  flickDropMs: number;
}

export const DEFAULT_GESTURE_TUNE: GestureTune = {
  tapMaxDist: 14,
  tapMaxMs: 250,
  gestureThresh: 10,
  flickDropMs: 220,
};

interface TouchState {
  sx: number;
  sy: number;
  t: number;
  mode: "horiz" | "vert" | null;
  baseCol: number;
}

export class GestureInput {
  private touch: TouchState | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    private game: Game,
    private renderer: Renderer,
    private onStartOrRetry: () => void,
    private tune: GestureTune = DEFAULT_GESTURE_TUNE,
  ) {
    canvas.addEventListener("pointerdown", this.onDown, { passive: false });
    canvas.addEventListener("pointermove", this.onMove, { passive: false });
    canvas.addEventListener("pointerup", this.onUp, { passive: false });
    canvas.addEventListener("pointercancel", this.onCancel);
    document.addEventListener("gesturestart", (e) => e.preventDefault());
    document.addEventListener("dblclick", (e) => e.preventDefault());
  }

  private onDown = (e: PointerEvent): void => {
    e.preventDefault();
    if (this.game.phase === "title" || this.game.phase === "gameover") {
      this.onStartOrRetry();
      return;
    }
    this.touch = {
      sx: e.clientX,
      sy: e.clientY,
      t: performance.now(),
      mode: null,
      baseCol: this.game.piece ? this.game.piece.col : 0,
    };
  };

  private onMove = (e: PointerEvent): void => {
    e.preventDefault();
    const t = this.touch;
    if (!t || this.game.phase !== "control") return;
    const dx = e.clientX - t.sx;
    const dy = e.clientY - t.sy;
    if (!t.mode && Math.hypot(dx, dy) > this.tune.gestureThresh) {
      t.mode = Math.abs(dx) > Math.abs(dy) ? "horiz" : "vert";
    }
    if (t.mode === "horiz") {
      const target = t.baseCol + Math.round(dx / this.renderer.cellSize());
      this.game.moveTo(target);
    } else if (t.mode === "vert") {
      this.game.setSoftDrop(dy > 0);
    }
  };

  private onUp = (e: PointerEvent): void => {
    e.preventDefault();
    const t = this.touch;
    this.game.setSoftDrop(false);
    if (t && this.game.phase === "control") {
      const dt = performance.now() - t.t;
      const dx = e.clientX - t.sx;
      const dy = e.clientY - t.sy;
      const dist = Math.hypot(dx, dy);
      if (!t.mode && dt < this.tune.tapMaxMs && dist < this.tune.tapMaxDist) {
        // タップ=回転（左半分=反時計, 右半分=時計）
        this.game.rotate(e.clientX < this.renderer.vw / 2 ? -1 : 1);
      } else if (t.mode === "vert" && dy > this.renderer.cellSize() * 1.2 && dt < this.tune.flickDropMs) {
        this.game.hardDrop();
      }
    }
    this.touch = null;
  };

  private onCancel = (): void => {
    this.game.setSoftDrop(false);
    this.touch = null;
  };
}
