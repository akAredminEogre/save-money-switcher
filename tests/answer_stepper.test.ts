// @generated-by: codd implement
// @generated-from: docs/design/system_design.md (design:system-design)
// @design-node: docs/design/system_design.md
// @output-paths: src, tests
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { describe, it, expect } from "vitest";
import {
  ANSWER_MIN_VALUE,
  ANSWER_MAX_VALUE,
  INITIAL_ANSWER_VALUE,
  STEP_DELTAS,
  clampToAnswerRange,
  createAnswerStepper,
  stepAnswer,
  plusOne,
  minusOne,
  plusTen,
  minusTen,
  type StepButton,
} from "../src/tablet/answer_stepper.js";
import { assertIntegerAnswer } from "../src/scoring/validate_answer.js";

/**
 * 決定的な擬似乱数（Park–Miller MINSTD）でボタン列を生成し、どんな順序・長さでも
 * クランプが破れないことをストレスするためのテスト補助。seed 固定で再現可能。
 */
function deterministicButtons(count: number, seed0: number): StepButton[] {
  const buttons: readonly StepButton[] = [
    "plusOne",
    "minusOne",
    "plusTen",
    "minusTen",
  ];
  let seed = seed0;
  const out: StepButton[] = [];
  for (let i = 0; i < count; i += 1) {
    seed = (seed * 48271) % 0x7fffffff;
    out.push(buttons[seed % buttons.length]!);
  }
  return out;
}

describe("tablet answer stepper (INV-6 の UI 側二重防衛)", () => {
  it("宣言定数と新規ステッパの初期値", () => {
    expect(ANSWER_MIN_VALUE).toBe(0);
    expect(ANSWER_MAX_VALUE).toBe(100);
    expect(INITIAL_ANSWER_VALUE).toBe(0);
    // 受付開始時の新規ステッパは 0 から合成を始める
    expect(createAnswerStepper().value).toBe(0);
    // 与えた初期値（再接続復帰時の送信済み値など）はそのまま採る
    expect(createAnswerStepper(50).value).toBe(50);
  });

  // codd: covers vb=VB-42
  it("+1 / −1 / +10 / −10 の4ボタンで 0〜100 を増減する（テンキー直接入力でない）", () => {
    const base = createAnswerStepper(50);
    expect(plusOne(base).value).toBe(51);
    expect(minusOne(base).value).toBe(49);
    expect(plusTen(base).value).toBe(60);
    expect(minusTen(base).value).toBe(40);

    // 4ボタンと増減量の対応は単一出典（他所で再定義しない）
    expect(STEP_DELTAS).toStrictEqual({
      plusOne: 1,
      minusOne: -1,
      plusTen: 10,
      minusTen: -10,
    });

    // ボタン押下は「合成（積み上げ）」であって値の直接入力ではない
    let s = createAnswerStepper(); // 0
    s = plusTen(s); // 10
    s = plusTen(s); // 20
    s = plusOne(s); // 21
    s = minusOne(s); // 20
    expect(s.value).toBe(20);

    // 各操作は不変（元のステッパを書き換えず新値を返す）
    expect(base.value).toBe(50);
  });

  // codd: covers vb=VB-43
  it("0 未満・100 超へ振り切れない（境界クランプ）", () => {
    // クランプ関数そのもの: 範囲外は境界へ、範囲内はそのまま
    expect(clampToAnswerRange(-1)).toBe(0);
    expect(clampToAnswerRange(-5)).toBe(0);
    expect(clampToAnswerRange(0)).toBe(0);
    expect(clampToAnswerRange(50)).toBe(50);
    expect(clampToAnswerRange(100)).toBe(100);
    expect(clampToAnswerRange(101)).toBe(100);
    expect(clampToAnswerRange(105)).toBe(100);

    // 下限 0 で −1 / −10 を押しても 0 のまま
    const atMin = createAnswerStepper(0);
    expect(minusOne(atMin).value).toBe(0);
    expect(minusTen(atMin).value).toBe(0);

    // 上限 100 で +1 / +10 を押しても 100 のまま
    const atMax = createAnswerStepper(100);
    expect(plusOne(atMax).value).toBe(100);
    expect(plusTen(atMax).value).toBe(100);

    // 境界をまたぐステップも境界で止まる
    expect(plusTen(createAnswerStepper(95)).value).toBe(100); // 95 + 10 = 105 → 100
    expect(minusTen(createAnswerStepper(5)).value).toBe(0); // 5 − 10 = −5 → 0

    // 何度連打しても範囲外へ出ない
    let high = createAnswerStepper(0);
    for (let i = 0; i < 30; i += 1) {
      high = plusTen(high); // 合計 +300 相当でも
    }
    expect(high.value).toBe(100); // 100 で頭打ち

    let low = createAnswerStepper(100);
    for (let i = 0; i < 30; i += 1) {
      low = minusTen(low); // 合計 −300 相当でも
    }
    expect(low.value).toBe(0); // 0 で底打ち
  });

  // codd: covers vb=VB-33
  it("−1 / 101 / 50.5 をステッパが合成できない（UI 側で送信対象になり得ない）", () => {
    // どんなボタン列・長さでも合成値は 0〜100 の整数に留まる
    let s = createAnswerStepper();
    const observed: number[] = [s.value];
    for (const button of deterministicButtons(500, 7)) {
      s = stepAnswer(s, STEP_DELTAS[button]);
      observed.push(s.value);
    }
    for (const value of observed) {
      expect(Number.isInteger(value)).toBe(true); // 50.5 のような非整数に決してならない
      expect(value).toBeGreaterThanOrEqual(0); // −1 に決してならない
      expect(value).toBeLessThanOrEqual(100); // 101 に決してならない
    }
    expect(observed).not.toContain(-1);
    expect(observed).not.toContain(101);
    expect(observed).not.toContain(50.5);

    // UI を迂回した不正な初期値も、ステッパを不正状態にできない
    expect(createAnswerStepper(-1).value).toBe(0); // 負値 → 下限
    expect(createAnswerStepper(101).value).toBe(100); // 100 超 → 上限
    const fromHalf = createAnswerStepper(50.5).value; // 小数 → 整数へ正規化
    expect(Number.isInteger(fromHalf)).toBe(true);
    expect(fromHalf).not.toBe(50.5);
    expect(fromHalf).toBeGreaterThanOrEqual(0);
    expect(fromHalf).toBeLessThanOrEqual(100);
  });

  it("ステッパの合成値はサーバ側バリデータ（INV-6 の対）が常に受理する", () => {
    // UI 側ガードが作る値は、サーバ側 assertIntegerAnswer が拒否しない
    // ＝二重防衛の両半分が同じ 0〜100 整数の契約で整合している証跡
    let s = createAnswerStepper();
    for (const button of deterministicButtons(300, 42)) {
      s = stepAnswer(s, STEP_DELTAS[button]);
      expect(() => assertIntegerAnswer(s.value)).not.toThrow();
    }
    // 端点 0 / 100 もサーバ側で受理される
    expect(assertIntegerAnswer(createAnswerStepper(0).value)).toBe(0);
    expect(assertIntegerAnswer(createAnswerStepper(100).value)).toBe(100);
  });
});
