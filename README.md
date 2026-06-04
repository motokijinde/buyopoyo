# ぶよぽよ

落ち物パズルゲーム「ぶよぽよ」。コンパイル（旧セガ）「ぷよぷよ」初代をオマージュした、iPhone（モバイルWeb）向けの1人用パズル。非公式オマージュであり、公式の商標・素材は使用していません。

詳細仕様は [docs/SPEC.md](docs/SPEC.md) を参照。

## 技術構成
- **Vite + TypeScript + PixiJS（WebGL）**
- ロジック（`src/core`）と描画（`src/render`）・入力（`src/input`）を分離
- グラフィックはコード（Canvas→テクスチャ）で生成（差し替え前提の構造）

## 動かす

```bash
npm install      # 初回のみ
npm run dev      # 開発サーバー（LAN公開）
```

実行すると Vite が `Local` と `Network` のURLを表示します。
**iPhoneをMacと同じWi‑Fiにつなぎ、表示された `Network` のURL**（例 `http://192.168.x.x:5173/`）をSafariで開いてください。
（共有 →「ホーム画面に追加」でフルスクリーン化できます）

その他コマンド:
```bash
npm test         # コアロジックの単体/統合テスト
npm run build    # 型チェック＋本番ビルド（dist/）
npm run preview  # ビルド成果物をプレビュー配信
```

## 操作（ジェスチャー）
- **左右ドラッグ** … 移動
- **タップ** … 回転（左半分=反時計／右半分=時計）
- **下フリック（速い）** … ハードドロップ
- **下にドラッグ** … ソフト落下

## 手触りの調整（チューニング）
落下速度・設置猶予などのゲーム感は `src/core/game.ts` の `DEFAULT_CONFIG`、
ジェスチャー感度は `src/input/gestures.ts` の `DEFAULT_GESTURE_TUNE` に集約。
実機で触りながら数値を調整してください。

## ディレクトリ
```
src/
  core/      ゲームロジック（描画非依存・テスト対象）
    types.ts    型・定数
    rng.ts      乱数
    scoring.ts  得点計算（初代準拠の表）
    board.ts    盤面・重力・連結探索
    game.ts     ステートマシン・進行
  render/
    puyoGraphics.ts  ぶよの絵をコード生成
    renderer.ts      PixiJS描画・エフェクト
  input/
    gestures.ts      タッチ入力
  main.ts      配線・メインループ
tests/         vitest
docs/SPEC.md   仕様書
prototype/     初期の単一HTMLプロトタイプ（手触り検証用・参考）
```

## 既知の未確認事項
- 描画ランタイムはブラウザ実機での最終目視確認が必要（ロジックはテスト済、型・ビルドは通過）。
- 効果音・BGMは未実装（仕様書 第9章）。
- CPU対戦・おじゃまぷよは初回スコープ外（将来拡張）。
