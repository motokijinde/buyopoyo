// エントリポイント：Game・Renderer・入力を配線してループを回す
import { Game } from "./core/game.ts";
import { GestureInput } from "./input/gestures.ts";
import { Renderer, getBest, setBest } from "./render/renderer.ts";

const BEST_KEY = "buyopoyo_best";

async function main(): Promise<void> {
  const parent = document.getElementById("app")!;
  const renderer = await Renderer.create(parent);
  const game = new Game();

  // ハイスコア読み込み
  setBest(Number(localStorage.getItem(BEST_KEY) || 0));

  // ゲームイベント → 演出・保存
  game.events.onChainStep = (chain) => {
    renderer.showChain(chain);
  };
  game.events.onLock = () => {
    renderer.shake(3);
  };
  game.events.onGameOver = (score) => {
    if (score > getBest()) {
      setBest(score);
      localStorage.setItem(BEST_KEY, String(score));
    }
    renderer.shake(16);
  };

  // 入力（タイトル/ゲームオーバーでタップ→開始/リトライ）
  new GestureInput(renderer.app.canvas, game, renderer, () => game.start());

  // リサイズ
  window.addEventListener("resize", () => renderer.resize());
  window.addEventListener("orientationchange", () => setTimeout(() => renderer.resize(), 200));

  // メインループ
  renderer.app.ticker.add((ticker) => {
    let dt = ticker.deltaMS;
    if (dt > 100) dt = 100; // タブ復帰時のジャンプ抑制
    game.update(dt);
    renderer.render(game, dt);
  });
}

main();
