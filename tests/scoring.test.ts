// @generated-by: codd implement
// @generated-from: docs/design/system_design.md (design:system-design)
// @design-node: docs/design/system_design.md
// @output-paths: src, tests
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { describe, it, expect } from "vitest";
import {
  applyQuestionScore,
  scoreQuestionForProgress,
  INITIAL_GRANT_YEN,
  YEN_PER_ERROR,
  PITARI_BONUS_YEN,
  SCORE_CURRENCY,
} from "../src/scoring/apply_question_score.js";
import type { QuestionScore } from "../src/scoring/apply_question_score.js";
import { InvalidAnswerError } from "../src/scoring/validate_answer.js";
import { startQuestion } from "../src/game_state/progression.js";

describe("apply_question_score", () => {
  // codd: covers vb=VB-27
  it("誤差 = |解答 − 正解| を 0〜100 の整数として算出する", () => {
    expect(applyQuestionScore({ balance: 10_000, answer: 45, correct: 50 }).error).toBe(5);
    expect(applyQuestionScore({ balance: 10_000, answer: 62, correct: 50 }).error).toBe(12);
    expect(applyQuestionScore({ balance: 10_000, answer: 0, correct: 100 }).error).toBe(100);
    expect(applyQuestionScore({ balance: 10_000, answer: 50, correct: 50 }).error).toBe(0);
  });

  // codd: covers vb=VB-28
  it("増減円 = 誤差 × −100 で残額へ減算される（誤差5 → −500円）", () => {
    const r = applyQuestionScore({ balance: 10_000, answer: 45, correct: 50 });
    expect(r.error).toBe(5);
    expect(r.delta).toBe(-500);
    expect(r.balance).toBe(9_500);
  });

  // codd: covers vb=VB-29
  it("誤差 0 のピタリ賞で当該プレイヤーへ +1,000 円が加算される", () => {
    const r = applyQuestionScore({ balance: 10_000, answer: 50, correct: 50 });
    expect(r.error).toBe(0);
    expect(r.pitariBonus).toBe(1_000);
    expect(r.balance).toBe(11_000);
  });

  // codd: covers vb=VB-30
  it("誤差 1 では −100 円のみでピタリ賞が付かない（誤差0直上の境界・不連続）", () => {
    const r = applyQuestionScore({ balance: 10_000, answer: 51, correct: 50 });
    expect(r.error).toBe(1);
    expect(r.delta).toBe(-100);
    expect(r.pitariBonus).toBe(0);
    expect(r.balance).toBe(9_900);
  });

  // codd: covers vb=VB-32
  it("入力値 0 と 100 がスコアリング経路で受理される", () => {
    const zero = applyQuestionScore({ balance: 10_000, answer: 0, correct: 20 });
    expect(zero.error).toBe(20);
    expect(zero.delta).toBe(-2_000);
    const hundred = applyQuestionScore({ balance: 10_000, answer: 100, correct: 20 });
    expect(hundred.error).toBe(80);
    expect(hundred.delta).toBe(-8_000);
    // 0=正解・100=正解のピタリ境界もスコアリング経路で受理される
    expect(applyQuestionScore({ balance: 10_000, answer: 0, correct: 0 }).pitariBonus).toBe(1_000);
    expect(applyQuestionScore({ balance: 10_000, answer: 100, correct: 100 }).pitariBonus).toBe(1_000);
  });

  // codd: covers vb=VB-35
  it("金額は円建て（currency=「円」）で表され point/pt/点 を含まない", () => {
    const r: QuestionScore = applyQuestionScore({ balance: 10_000, answer: 40, correct: 50 });
    expect(r.currency).toBe("円");
    expect(SCORE_CURRENCY).toBe("円");
    // 円建ての各金額は整数（円）であり、単位語を内包した文字列表現ではない
    for (const yen of [r.delta, r.pitariBonus, r.balance, r.initialGrant]) {
      expect(typeof yen).toBe("number");
      expect(Number.isInteger(yen)).toBe(true);
    }
  });

  it("確定値定数が円建てルールに一致する（先渡し10,000・誤差係数−100・ピタリ1,000）", () => {
    expect(INITIAL_GRANT_YEN).toBe(10_000);
    expect(YEN_PER_ERROR).toBe(-100);
    expect(PITARI_BONUS_YEN).toBe(1_000);
    expect(applyQuestionScore({ balance: 0, answer: 0, correct: 0 }).initialGrant).toBe(10_000);
  });

  it("UI を迂回した範囲外・小数・非整数の解答/正解を assertIntegerAnswer 経由で拒否する", () => {
    expect(() => applyQuestionScore({ balance: 10_000, answer: 101, correct: 50 })).toThrow(InvalidAnswerError);
    expect(() => applyQuestionScore({ balance: 10_000, answer: -1, correct: 50 })).toThrow(InvalidAnswerError);
    expect(() => applyQuestionScore({ balance: 10_000, answer: 50.5, correct: 50 })).toThrow(InvalidAnswerError);
    expect(() => applyQuestionScore({ balance: 10_000, answer: 50, correct: 101 })).toThrow(InvalidAnswerError);
  });

  it("問題進行（QuestionProgress）に紐づけて採点し当該問の questionId を保持する", () => {
    const progress = startQuestion(7);
    const scored = scoreQuestionForProgress(progress, { balance: 10_000, answer: 48, correct: 50 });
    expect(scored.questionId).toBe(7);
    expect(scored.error).toBe(2);
    expect(scored.delta).toBe(-200);
    expect(scored.balance).toBe(9_800);
    expect(scored.currency).toBe("円");
  });
});
