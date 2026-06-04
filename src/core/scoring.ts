// 得点計算（初代準拠）
//   1ステップの得点 = (消したぶよ数 × 10) × (連鎖B + 連結B合計 + 色数B)
//   ボーナス合計が0なら1とみなす。全消しボーナスは無し（初代準拠）。
import type { ClearGroup } from "./types.ts";

/** 連鎖ボーナス: 1→0, 2→8, 3→16, 4→32, 5→64, 6→96, 7→128 ... 10→224, 以降+32 */
export function chainBonus(chain: number): number {
  const table = [0, 0, 8, 16, 32, 64, 96, 128, 160, 192, 224];
  if (chain <= 0) return 0;
  if (chain <= 10) return table[chain];
  return 224 + (chain - 10) * 32;
}

/** 連結ボーナス: 4→0,5→2,6→3,7→4,8→5,9→6,10→7,11+→10 */
export function connectBonus(size: number): number {
  const table: Record<number, number> = { 4: 0, 5: 2, 6: 3, 7: 4, 8: 5, 9: 6, 10: 7 };
  if (size >= 11) return 10;
  return table[size] ?? 0;
}

/** 色数ボーナス: 1→0,2→3,3→6,4→12 */
export function colorBonus(numColors: number): number {
  const table = [0, 0, 3, 6, 12];
  return table[Math.min(numColors, 4)] ?? 0;
}

/** 1ステップ（同時消去）の得点。chainはそのステップの連鎖数(1始まり)。 */
export function stepScore(groups: ClearGroup[], chain: number): number {
  let totalCleared = 0;
  let connect = 0;
  const colors = new Set<number>();
  for (const g of groups) {
    totalCleared += g.cells.length;
    connect += connectBonus(g.cells.length);
    colors.add(g.color);
  }
  let bonus = chainBonus(chain) + connect + colorBonus(colors.size);
  if (bonus === 0) bonus = 1;
  return 10 * totalCleared * bonus;
}
