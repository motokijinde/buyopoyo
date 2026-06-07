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
  const jingle = new Audio(`${import.meta.env.BASE_URL}nc300657.mp3`);
  jingle.volume = 0.6;

  // ハイスコア読み込み
  setBest(Number(localStorage.getItem(BEST_KEY) || 0));

  // ランキング表示（RANKINGボタン・名前入力スキップ後・登録後で共用）
  const showRanking = (
    entries: { rank: number; name: string; score: number; timestamp: string }[],
    highlightIdx: number,
  ): void => {
    renderer.showRanking(entries, highlightIdx, () => {});
  };

  // ローディング付きランキング取得→表示（タイムアウト時リトライ/スキップ対応）
  const openRanking = (): void => {
    renderer.showLoading();
    fetchRankings()
      .then((res) => {
        renderer.hideLoading();
        showRanking(res.rankings, -1);
      })
      .catch(() => {
        renderer.showLoadingTimeout(openRanking, () => renderer.hideLoading());
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
          const isTop10 = top.length < 10 || score > top[top.length - 1].score;

          if (!isTop10) {
            showRanking(top, -1);
            return;
          }

          // TOP10入り → 名前入力
          showNameInput(
            score,
            (name) => {
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
                    renderer.showLoadingTimeout(doSubmit, () => {
                      renderer.hideLoading();
                      showRanking(top, -1);
                    });
                  });
              };
              doSubmit();
            },
            () => showRanking(top, -1),
          );
        })
        .catch(() => {
          renderer.showLoadingTimeout(fetchAndCheck, () => renderer.hideLoading());
        });
    };

    // ゲームオーバーアニメが始まってからローディングを出す
    setTimeout(fetchAndCheck, 900);
  };

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
    };
    jingle.onended = go;
    jingle.currentTime = 0;
    jingle.play().catch(go);
    setTimeout(go, 8000);
  };
  const goTitle = (): void => game.goTitle();
  new GestureInput(renderer.app.canvas, game, renderer, beginStart, goTitle, openRanking);

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
