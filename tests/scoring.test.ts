import { describe, expect, it } from "vitest";
import { chainBonus, colorBonus, connectBonus, stepScore } from "../src/core/scoring.ts";
import type { ClearGroup } from "../src/core/types.ts";

describe("ボーナステーブル", () => {
  it("連鎖ボーナス", () => {
    expect(chainBonus(1)).toBe(0);
    expect(chainBonus(2)).toBe(8);
    expect(chainBonus(3)).toBe(16);
    expect(chainBonus(4)).toBe(32);
    expect(chainBonus(5)).toBe(64);
    expect(chainBonus(6)).toBe(96);
    expect(chainBonus(10)).toBe(224);
    expect(chainBonus(11)).toBe(256);
    expect(chainBonus(12)).toBe(288);
  });

  it("連結ボーナス", () => {
    expect(connectBonus(4)).toBe(0);
    expect(connectBonus(5)).toBe(2);
    expect(connectBonus(6)).toBe(3);
    expect(connectBonus(10)).toBe(7);
    expect(connectBonus(11)).toBe(10);
    expect(connectBonus(20)).toBe(10);
  });

  it("色数ボーナス", () => {
    expect(colorBonus(1)).toBe(0);
    expect(colorBonus(2)).toBe(3);
    expect(colorBonus(3)).toBe(6);
    expect(colorBonus(4)).toBe(12);
  });
});

describe("ステップ得点", () => {
  it("1連鎖4個1色はボーナス0→1扱いで40点", () => {
    const groups: ClearGroup[] = [
      { color: 0, cells: [[0, 0], [0, 1], [0, 2], [0, 3]] },
    ];
    // 4個 × 10 × max(0,1)=1 = 40
    expect(stepScore(groups, 1)).toBe(40);
  });

  it("仕様書の例: 4連鎖で赤5個1塊 = 1700点", () => {
    const groups: ClearGroup[] = [
      { color: 0, cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]] },
    ];
    // 連鎖B(4)=32, 連結B(5)=2, 色数B(1)=0 → 34
    // 5個 × 10 × 34 = 1700
    expect(stepScore(groups, 4)).toBe(1700);
  });

  it("複数塊は連結ボーナスを各塊合計、色数は種類数", () => {
    const groups: ClearGroup[] = [
      { color: 0, cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]] }, // 赤5: 連結2
      { color: 1, cells: [[1, 0], [1, 1], [1, 2], [1, 3]] }, // 黄4: 連結0
    ];
    // 連鎖B(2)=8, 連結=2+0=2, 色数(2)=3 → 13
    // 合計9個 × 10 × 13 = 1170
    expect(stepScore(groups, 2)).toBe(1170);
  });
});
