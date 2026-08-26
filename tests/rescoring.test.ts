// @generated-by: codd implement
// @generated-from: docs/design/system_design.md (design:system-design)
// @design-node: docs/design/system_design.md
// @output-paths: src, tests
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { describe, it, expect } from "vitest";
import {
  rescoreOnCorrection,
  UnknownParticipantBalanceError,
  type RescoreOnCorrectionInput,
} from "../src/scoring/rescore_on_correction.js";
import {
  applyQuestionScore,
  INITIAL_GRANT_YEN,
} from "../src/scoring/apply_question_score.js";
import { InvalidAnswerError } from "../src/scoring/validate_answer.js";

/**
 * 差分再採点（E-3残）の受け入れ。得点式は apply_question_score 側で確定済みゆえ、本テストは
 * 「開示段階の境界（c 未到達 → 再採点しない / c 以降 → 再採点する）」「編集後正解からの再計算と
 * 残額差分の適用」「d 到達時の差分再計算と d/e 供給データ」「差分適用が全再計算に一致する監査
 * 不変式」を、期待値を独立に立てて固定する。段階名は progression の Stage 値集合に一致する。
 */

// 共通シナリオ: 直前正解 50 → 編集後 45。p1 は解答 50、p2 は解答 40。
// 独立計算（apply_question_score とハンドで導出した期待値・literal）:
//   p1 旧: |50-50|=0 → 増減 0・ピタリ +1000 → 寄与 +1000 → 現在残額 10000+1000 = 11000
//   p1 新: |50-45|=5 → 増減 -500・ピタリ 0     → 寄与  -500 → 差分 -500-(+1000) = -1500 → 9500
//   p2 旧: |40-50|=10→ 増減 -1000・ピタリ 0    → 寄与 -1000 → 現在残額 10000-1000 = 9000
//   p2 新: |40-45|=5 → 増減 -500・ピタリ 0     → 寄与  -500 → 差分 -500-(-1000) = +500  → 9500
const P1_CURRENT = 11_000;
const P2_CURRENT = 9_000;
const baseAnswersAndBalances: Pick<
  RescoreOnCorrectionInput,
  "previousCorrect" | "editedCorrect" | "answers" | "balances"
> = {
  previousCorrect: 50,
  editedCorrect: 45,
  answers: [
    { participantId: 1, answer: 50 },
    { participantId: 2, answer: 40 },
  ],
  balances: [
    { participantId: 1, amount: P1_CURRENT },
    { participantId: 2, amount: P2_CURRENT },
  ],
};

function participant(result: ReturnType<typeof rescoreOnCorrection>, id: number) {
  const row = result.participants.find((p) => p.participantId === id);
  if (row === undefined) {
    throw new Error(`participant ${id} not found in rescore result`);
  }
  return row;
}

describe("scoring/rescore_on_correction ── 正解訂正の差分再採点（E-3残）", () => {
  // codd: covers vb=VB-38
  it("c 未到達（answers_opened / answers_locked / accepting）の正解編集では再採点が起きず残額差分を返さない", () => {
    for (const stage of ["accepting", "answers_locked", "answers_opened"] as const) {
      const result = rescoreOnCorrection({ stage, ...baseAnswersAndBalances });
      expect(result.rescored).toBe(false);
      expect(result.settledDifferential).toBe(false);
      // 残額差分が一切生成されない ＝ 呼び出し側が適用する差分が無く balances は不変。
      expect(result.participants).toHaveLength(0);
    }
  });

  // codd: covers vb=VB-37
  it("c（answer_revealed）到達後は編集後正解から再計算し、各人の残額へ差分が反映される", () => {
    const result = rescoreOnCorrection({
      stage: "answer_revealed",
      ...baseAnswersAndBalances,
    });

    expect(result.rescored).toBe(true);
    expect(result.correctValue).toBe(45);

    const p1 = participant(result, 1);
    expect(p1.error).toBe(5);
    expect(p1.delta).toBe(-500);
    expect(p1.pitariBonus).toBe(0);
    expect(p1.balanceDifference).toBe(-1_500);
    expect(p1.amount).toBe(9_500);
    expect(p1.currency).toBe("円");

    const p2 = participant(result, 2);
    expect(p2.error).toBe(5);
    expect(p2.delta).toBe(-500);
    expect(p2.balanceDifference).toBe(500);
    expect(p2.amount).toBe(9_500);
  });

  // codd: covers vb=VB-39
  it("d（settlement_computed）到達済みの問の正解訂正で残額の差分再計算が行われる", () => {
    const result = rescoreOnCorrection({
      stage: "settlement_computed",
      ...baseAnswersAndBalances,
    });

    expect(result.rescored).toBe(true);
    // d 到達問であることを段階から判別し、差分再計算経路に入る。
    expect(result.settledDifferential).toBe(true);

    // 差分適用後の残額が編集前と異なる（差分再計算が実際に走っている）ことを固定。
    const p1 = participant(result, 1);
    expect(p1.amount).not.toBe(P1_CURRENT);
    expect(p1.amount).toBe(9_500);
    const p2 = participant(result, 2);
    expect(p2.amount).not.toBe(P2_CURRENT);
    expect(p2.amount).toBe(9_500);
  });

  // codd: covers vb=VB-40
  it("d 到達問の 1 回の差分再計算が TV(d) 精算表示と TV(e) 通算残額の双方を同時に供給する", () => {
    const result = rescoreOnCorrection({
      stage: "settlement_computed",
      ...baseAnswersAndBalances,
    });
    expect(result.settledDifferential).toBe(true);

    for (const id of [1, 2] as const) {
      const row = participant(result, id);
      // TV(d) 6 列表を供給する当該問フォーカスの各値。
      expect(row.error).toBe(5);
      expect(row.delta).toBe(-500);
      expect(row.pitariBonus).toBe(0);
      // TV(e) 全員一覧を供給する通算残額。両ビューが同一結果から整合的に導かれる。
      expect(row.amount).toBe(9_500);
      // 残額 = 現在残額 + 差分、かつ 差分 = 編集後寄与 − 編集前寄与 の内部整合。
      const current = id === 1 ? P1_CURRENT : P2_CURRENT;
      expect(row.balanceDifference).toBe(row.newContribution - row.previousContribution);
      expect(row.amount).toBe(current + row.balanceDifference);
    }
  });

  // codd: covers vb=VB-70
  it("差分更新後の残額が answers＋編集後 correct_value からの全再計算に一致する（監査不変式）", () => {
    const result = rescoreOnCorrection({
      stage: "settlement_computed",
      ...baseAnswersAndBalances,
    });

    for (const entry of baseAnswersAndBalances.answers) {
      // 独立の全再計算: 先渡し 10,000 円起点で編集後正解のみを適用した残額（差分経路を経ない）。
      const fromScratch = applyQuestionScore({
        balance: INITIAL_GRANT_YEN,
        answer: entry.answer,
        correct: baseAnswersAndBalances.editedCorrect,
      }).balance;
      expect(participant(result, entry.participantId).amount).toBe(fromScratch);
    }
  });

  it("編集後正解が 0〜100 の整数でなければサーバ側の解答ガードで拒否する", () => {
    expect(() =>
      rescoreOnCorrection({ stage: "answer_revealed", ...baseAnswersAndBalances, editedCorrect: 101 }),
    ).toThrow(InvalidAnswerError);
    expect(() =>
      rescoreOnCorrection({ stage: "answer_revealed", ...baseAnswersAndBalances, editedCorrect: 50.5 }),
    ).toThrow(InvalidAnswerError);
  });

  it("解答者の現在残額が balances に無いと差分適用先を特定できず拒否する", () => {
    expect(() =>
      rescoreOnCorrection({
        stage: "answer_revealed",
        previousCorrect: 50,
        editedCorrect: 45,
        answers: [{ participantId: 99, answer: 40 }],
        balances: [{ participantId: 1, amount: P1_CURRENT }],
      }),
    ).toThrow(UnknownParticipantBalanceError);
  });
});
