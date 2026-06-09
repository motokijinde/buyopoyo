// エントリポイント：Game・Renderer・入力を配線してループを回す
import { Game } from "./core/game.ts";
import { GestureInput } from "./input/gestures.ts";
import { Renderer, getBest, setBest } from "./render/renderer.ts";
import { fetchRankings, submitScore } from "./services/ranking.ts";
import { showNameInput } from "./ui/nameInput.ts";

const BEST_KEY = "buyopoyo_best";

async function main(): Promise<void> {
  const parent = document.getElementById("app")!;
  const renderer = await Renderer.create(parent);
  const game = new Game();

  // スタート音（タップ＝ユーザー操作で再生。iOSの自動再生制限に対応）
  const jingle = new Audio(`${import.meta.env.BASE_URL}start_jingle.wav`);
  jingle.volume = 0.6;

  // ゲーム中 BGM
  const bgm = new Audio(`${import.meta.env.BASE_URL}candy_loop.mp3`);
  bgm.loop = true;
  bgm.volume = 0.45;

  // 着地SE
  const landSE = new Audio(`${import.meta.env.BASE_URL}puyo_land.wav`);
  landSE.volume = 0.5;

  // 消去SE
  const eraseSE = new Audio(`${import.meta.env.BASE_URL}puyo_erase.wav`);
  eraseSE.volume = 0.5;

  // 回転SE
  const rotateSE = new Audio(`${import.meta.env.BASE_URL}puyo_rotate.wav`);
  rotateSE.volume = 0.5;

  // ゲームオーバーSE
  const gameoverSE = new Audio(`${import.meta.env.BASE_URL}gameover.wav`);
  gameoverSE.volume = 0.6;

  // ボタンSE（START/REPLAY以外の全ボタン共通）
  const btnSE = new Audio(`${import.meta.env.BASE_URL}button_select.wav`);
  btnSE.volume = 0.6;
  const playBtnSE = (): void => { btnSE.currentTime = 0; btnSE.play().catch(() => {}); };

  // ハイスコア読み込み
  setBest(Number(localStorage.getItem(BEST_KEY) || 0));

  // ランキング表示（RANKINGボタン・名前入力スキップ後・登録後で共用）
  const showRanking = (
    entries: { rank: number; name: string; score: number; timestamp: string }[],
    highlightIdx: number,
  ): void => {
    renderer.showRanking(entries, highlightIdx, () => { playBtnSE(); renderer.enableGameoverBtns(); });
  };

  // ローディング付きランキング取得→表示（タイムアウト時リトライ/スキップ対応）
  const openRanking = (): void => {
    playBtnSE();
    renderer.showLoading();
    fetchRankings()
      .then((res) => {
        renderer.hideLoading();
        showRanking(res.rankings, -1);
      })
      .catch(() => {
        renderer.showLoadingTimeout(openRanking, () => { playBtnSE(); renderer.hideLoading(); });
      });
  };

  // ゲームオーバー時のランキングフロー
  const startRankingFlow = (score: number): void => {
    const sessionId = crypto.randomUUID();

    const fetchAndCheck = (): void => {
      renderer.showLoading();
      fetchRankings()
        .then((res) => {
          renderer.hideLoading();
          const top = res.rankings;
          const isTop10 = score > 0 && (top.length < 10 || score > top[top.length - 1].score);

          if (!isTop10) {
            showRanking(top, -1);
            return;
          }

          // TOP10入り → 名前入力
          showNameInput(
            score,
            (name) => {
              playBtnSE();
              // 登録フロー
              const doSubmit = (): void => {
                renderer.showLoading();
                submitScore(name, score, sessionId)
                  .then((res2) => {
                    renderer.hideLoading();
                    const idx = res2.rankings.findIndex(
                      (e) => e.score === score && e.name === name,
                    );
                    showRanking(res2.rankings, idx);
                  })
                  .catch(() => {
                    renderer.showLoadingTimeout(
                      () => { playBtnSE(); doSubmit(); },
                      () => { playBtnSE(); renderer.hideLoading(); showRanking(top, -1); },
                    );
                  });
              };
              doSubmit();
            },
            () => { playBtnSE(); showRanking(top, -1); },
          );
        })
        .catch(() => {
          renderer.showLoadingTimeout(
            () => { playBtnSE(); fetchAndCheck(); },
            () => { playBtnSE(); renderer.hideLoading(); renderer.enableGameoverBtns(); },
          );
        });
    };

    // ゲームオーバーアニメが始まってからローディングを出す
    setTimeout(fetchAndCheck, 900);
  };

  // ゲームイベント → 演出・保存
  game.events.onChainStep = (chain) => {
    renderer.showChain(chain);
    eraseSE.currentTime = 0;
    eraseSE.play().catch(() => {});
  };
  game.events.onRotate = () => {
    rotateSE.currentTime = 0;
    rotateSE.play().catch(() => {});
  };
  game.events.onLock = () => {
    renderer.shake(3);
    landSE.currentTime = 0;
    landSE.play().catch(() => {});
  };
  game.events.onAllClear = () => {
    renderer.showAllClear();
  };
  game.events.onGameOver = (score) => {
    if (score > getBest()) {
      setBest(score);
      localStorage.setItem(BEST_KEY, String(score));
    }
    bgm.pause();
    bgm.currentTime = 0;
    gameoverSE.currentTime = 0;
    gameoverSE.play().catch(() => {});
    renderer.shake(16);
    startRankingFlow(score);
  };

  // 入力（タイトル/ゲームオーバーでタップ→開始/リトライ）
  let starting = false;
  const beginStart = (): void => {
    if (starting) return;
    starting = true;
    renderer.startIntro();
    const go = (): void => {
      if (!starting) return;
      starting = false;
      game.start();
      bgm.currentTime = 0;
      bgm.play().catch(() => {});
    };
    jingle.onended = go;
    jingle.currentTime = 0;
    jingle.play().catch(go);
    setTimeout(go, 8000);
  };
  const goTitle = (): void => { playBtnSE(); bgm.pause(); bgm.currentTime = 0; game.goTitle(); };
  const pause = (): void => { playBtnSE(); game.pause(); bgm.pause(); };
  const resume = (): void => {
    game.resume();
    if (game.phase === "control" || game.phase === "resolving") bgm.play().catch(() => {});
  };
  new GestureInput(renderer.app.canvas, game, renderer, beginStart, goTitle, openRanking, pause, resume, goTitle);

  // リサイズ
  window.addEventListener("resize", () => renderer.resize());
  window.addEventListener("orientationchange", () => setTimeout(() => renderer.resize(), 200));

  // メインループ
  renderer.app.ticker.add((ticker) => {
    let dt = ticker.deltaMS;
    if (dt > 100) dt = 100;
    game.update(dt);
    renderer.render(game, dt);
  });
}

main();
