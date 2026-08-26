// @generated-by: codd implement
// @generated-from: docs/design/scoring_engine_design.md (design:scoring-engine-design)
// @design-node: docs/design/scoring_engine_design.md
// @output-paths: src, tests
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { describe, it, expect } from "vitest";
import { rescoreQuestion } from "../../src/scoring/rescore_question.js";
import { settleQuestion } from "../../src/scoring/settle_question.js";
import { aggregateBalance } from "../../src/scoring/aggregate_balance.js";

describe("scoring/rescore_question 差分再採点の監査不変式（SC-4・§2.7）", () => {
  const answers = [
    { participantId: "p1", value: 40 },
    { participantId: "p2", value: 50 },
  ];

  // codd: covers vb=VB-70
  it("差分更新後の balances が answers＋編集後 correct_value からの全再計算と一致する", () => {
    // 旧: 正解 50（p1 誤差10 → -1000 / p2 誤差0 → +1000）
    const oldSettlements = settleQuestion("q1", 50, answers);
    // 正解を 50→40 へ訂正 → SUT が (新拠出 − 旧拠出) の差分を返す
    const { balanceDeltas } = rescoreQuestion("q1", 40, answers, oldSettlements);
    // 全再計算の独立基準（新: 正解 40）を settleQuestion + aggregateBalance で得る
    const fullRecompute = settleQuestion("q1", 40, answers);

    for (const a of answers) {
      const oldBalance = aggregateBalance(
        oldSettlements.filter((s) => s.participantId === a.participantId),
      );
      const delta = balanceDeltas.find(
        (d) => d.participantId === a.participantId,
      )!.deltaYen;
      const newFull = aggregateBalance(
        fullRecompute.filter((s) => s.participantId === a.participantId),
      );
      // 旧残額 + SUT の差分 が、編集後 correct_value からの全再計算残額と一致する。
      expect(oldBalance + delta).toBe(newFull);
    }
  });

  it("各参加者の差分が (新拠出 − 旧拠出) に一致する（正解 50→40 の訂正）", () => {
    const oldSettlements = settleQuestion("q1", 50, answers);
    const { questionId, balanceDeltas } = rescoreQuestion(
      "q1",
      40,
      answers,
      oldSettlements,
    );

    // 対象問の識別子が結果へ保持され、各解答者 1 件ずつの差分を返す。
    expect(questionId).toBe("q1");
    expect(balanceDeltas).toHaveLength(answers.length);

    // p1: 旧(正解50,答40)=誤差10 → -1000 ／ 新(正解40,答40)=誤差0 → +1000。
    //     差分 = +1000 − (−1000) = +2000（SUT とは独立に手計算した期待値）。
    expect(
      balanceDeltas.find((d) => d.participantId === "p1")!.deltaYen,
    ).toBe(2000);
    // p2: 旧(正解50,答50)=誤差0 → +1000 ／ 新(正解40,答50)=誤差10 → -1000。
    //     差分 = −1000 − (+1000) = −2000。
    expect(
      balanceDeltas.find((d) => d.participantId === "p2")!.deltaYen,
    ).toBe(-2000);
  });
});
