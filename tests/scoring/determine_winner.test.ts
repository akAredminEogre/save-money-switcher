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
import { determineWinners } from "../../src/scoring/determine_winner.js";

describe("scoring/determine_winner 勝者判定（残額最多勝ち）", () => {
  it("残額最多の単独プレイヤーを勝者として返す", () => {
    const winners = determineWinners([
      { participantId: 1, amount: 8_400 },
      { participantId: 2, amount: 11_000 },
      { participantId: 3, amount: 9_500 },
    ]);
    // 最多残額 11,000 の participant 2 が単独勝者。期待値は入力から独立に固定。
    expect(winners.map((w) => w.participantId)).toEqual([2]);
  });

  // codd: covers vb=VB-76
  it("残額同点時は複数の共同首位を勝者として提示する（同点優先順位を発明しない）", () => {
    const winners = determineWinners([
      { participantId: 1, amount: 11_000 },
      { participantId: 2, amount: 9_500 },
      { participantId: 3, amount: 11_000 },
    ]);
    // 最多残額 11,000 の 2 名が共に勝者。単独 1 名へ絞り込まない。
    expect(winners).toHaveLength(2);
    expect(winners.map((w) => w.participantId).sort((a, b) => a - b)).toEqual([1, 3]);
  });

  it("残額が 1 件も無いなら勝者は存在せず空配列を返す（優先順位を発明しない境界）", () => {
    // 最多が存在しないため誰も勝者にしない。空を独立に固定した期待値と照合する。
    expect(determineWinners([])).toEqual([]);
  });
});
