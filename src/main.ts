// エントリポイント：Game・Renderer・入力を配線してループを回す
import { Game } from "./core/game.ts";
import { GestureInput } from "./input/gestures.ts";
import { Renderer, getBest, setBest } from "./render/renderer.ts";

const BEST_KEY = "buyopoyo_best";

async function main(): Promise<void> {
  const parent = document.getElementById("app")!;
  const renderer = await Renderer.create(parent);
  const game = new Game();

  // スタート音（タップ＝ユーザー操作で再生。iOSの自動再生制限に対応）
  const jingle = new Audio(`${import.meta.env.BASE_URL}nc300657.mp3`);
  jingle.volume = 0.6;

  // ハイスコア読み込み
  setBest(Number(localStorage.getItem(BEST_KEY) || 0));

  // ゲームイベント → 演出・保存
  game.events.onChainStep = (chain) => {
    renderer.showChain(chain);
  };
  game.events.onLock = () => {
    renderer.shake(3);
  };
  game.events.onAllClear = () => {
    renderer.showAllClear();
  };
  game.events.onGameOver = (score) => {
    if (score > getBest()) {
      setBest(score);
      localStorage.setItem(BEST_KEY, String(score));
    }
    renderer.shake(16);
  };

  // 入力（タイトル/ゲームオーバーでタップ→開始/リトライ）
  // タップ→スタート音＋演出を流し、鳴り終わったらゲーム画面へ遷移
  let starting = false;
  const beginStart = (): void => {
    if (starting) return;
    starting = true;
    renderer.startIntro();
    const go = (): void => {
      if (!starting) return;
      starting = false;
      game.start();
    };
    jingle.onended = go;
    jingle.currentTime = 0;
    jingle.play().catch(go); // 再生できなければ即開始
    // 安全策：万一endedが来なくても最長で開始
    setTimeout(go, 8000);
  };
  const goTitle = (): void => game.goTitle();
  new GestureInput(renderer.app.canvas, game, renderer, beginStart, goTitle);

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
