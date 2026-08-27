// @generated-by: codd implement
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @design-node: docs/design/data_model_design.md
// @output-paths: src, tests
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { describe, it, expect } from "vitest";
import {
  applyQuestionScore,
  scoreQuestionForProgress,
  INITIAL_GRANT_YEN,
} from "../../src/scoring/apply_question_score.js";
import { startQuestion } from "../../src/game_state/progression.js";

describe("scoring/apply_question_score 得点精算コア（整数円・SC-1/SC-2/SC-3）", () => {
  // codd: covers vb=VB-26
  it("賞金先渡し 10,000 円が採点の基点になり残額へ反映される", () => {
    expect(INITIAL_GRANT_YEN).toBe(10_000);
    // 先渡し 10,000 円から誤差 0（ピタリ）で +1,000 → 11,000 円。
    // 先渡しが 10,000 でなければ 11,000 にはならない。
    const r = applyQuestionScore({ balance: INITIAL_GRANT_YEN, answer: 50, correct: 50 });
    expect(r.balance).toBe(11_000);
  });

  // codd: covers vb=VB-27
  it("誤差 = |解答 − 正解| が 0〜100 の整数として算出される", () => {
    expect(applyQuestionScore({ balance: 10_000, answer: 45, correct: 50 }).error).toBe(5);
    expect(applyQuestionScore({ balance: 10_000, answer: 0, correct: 100 }).error).toBe(100);
    expect(applyQuestionScore({ balance: 10_000, answer: 100, correct: 100 }).error).toBe(0);
  });

  // codd: covers vb=VB-28
  it("増減円 = 誤差 × −100 で減算される（10,000→9,500・誤差5 → −500円・円建て）", () => {
    const r = applyQuestionScore({ balance: 10_000, answer: 45, correct: 50 });
    expect(r.error).toBe(5);
    expect(r.delta).toBe(-500);
    expect(r.balance).toBe(9_500);
    expect(r.currency).toBe("円");
  });

  // codd: covers vb=VB-29
  it("誤差 0 のピタリ賞で当該プレイヤーへ +1,000 円が加算される", () => {
    const r = applyQuestionScore({ balance: 10_000, answer: 50, correct: 50 });
    expect(r.error).toBe(0);
    // 誤差 0 ゆえ増減円は 0。加算はピタリ賞 +1,000 円のみで残額が丁度 1,000 円増える。
    expect(r.delta).toBe(0);
    expect(r.pitariBonus).toBe(1_000);
    expect(r.balance).toBe(11_000);
  });

  // codd: covers vb=VB-30
  it("誤差1では −100 円のみでピタリ賞が付かない（誤差0直上の境界・不連続）", () => {
    const off = applyQuestionScore({ balance: 10_000, answer: 51, correct: 50 });
    expect(off.error).toBe(1);
    expect(off.delta).toBe(-100);
    expect(off.pitariBonus).toBe(0);
    expect(off.balance).toBe(9_900);

    // 対照: 誤差0 は +1,000 の不連続（誤差1 の −100 と誤差0 の +1,000 の跳び）。
    const pitari = applyQuestionScore({ balance: 10_000, answer: 50, correct: 50 });
    expect(pitari.pitariBonus).toBe(1_000);
    expect(pitari.balance).toBe(11_000);
    // 残額差分が −100 から +1,000 へ 1,100 円ぶん飛ぶ（誤差0/1 の境界で不連続）。
    expect(pitari.balance - off.balance).toBe(1_100);
  });

  // codd: covers vb=VB-35
  it("精算結果は円建て（内部表現）で currency が「円」であり point/pt/点 へ置換しない", () => {
    const r = applyQuestionScore({ balance: 10_000, answer: 45, correct: 50 });
    // 金額を表す通貨タグは「円」ちょうど（point/pt/点 のいずれでもない）。
    expect(r.currency).toBe("円");
  });

  it("100 超・小数・負値は 0〜100 整数のみのガードで受理しない（§2.3 の拒否ケース・SC-3）", () => {
    // 解答側の範囲外・小数を誤差計算前のガードで拒否する。
    expect(() => applyQuestionScore({ balance: 10_000, answer: 101, correct: 50 })).toThrow();
    expect(() => applyQuestionScore({ balance: 10_000, answer: 50.5, correct: 50 })).toThrow();
    expect(() => applyQuestionScore({ balance: 10_000, answer: -1, correct: 50 })).toThrow();
    // 正解値側の範囲外も同様に拒否する。
    expect(() => applyQuestionScore({ balance: 10_000, answer: 50, correct: 101 })).toThrow();
  });

  it("error / delta / pitariBonus / balance がすべて整数で小数値を持たない", () => {
    const r = applyQuestionScore({ balance: 10_000, answer: 45, correct: 50 });
    expect(Number.isInteger(r.error)).toBe(true);
    expect(Number.isInteger(r.delta)).toBe(true);
    expect(Number.isInteger(r.pitariBonus)).toBe(true);
    expect(Number.isInteger(r.balance)).toBe(true);
  });

  it("scoreQuestionForProgress は当該問の questionId を添えて applyQuestionScore へ委譲する", () => {
    const progress = startQuestion(3);
    const scored = scoreQuestionForProgress(progress, {
      balance: 10_000,
      answer: 45,
      correct: 50,
    });
    // 当該問の識別子が採点結果へ保持される（answers/balances/TV(d) の当該問フォーカスと対応）。
    expect(scored.questionId).toBe(3);
    // 委譲先の算出（誤差5 → −500円・残額9,500円・円建て）がそのまま保たれる。
    expect(scored.error).toBe(5);
    expect(scored.delta).toBe(-500);
    expect(scored.balance).toBe(9_500);
    expect(scored.currency).toBe("円");
  });
});
