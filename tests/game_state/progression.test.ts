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
  isDisclosed,
  isSettled,
  STAGES,
  type Round,
} from "../../src/game_state/progression.js";

describe("game_state/progression 進行段階の再採点範囲判定（DM-2 / SC-4）", () => {
  it("isDisclosed は開示済み（c 以降 = answer_revealed | settlement_computed）のみ真", () => {
    expect(isDisclosed("accepting")).toBe(false);
    expect(isDisclosed("answers_locked")).toBe(false);
    expect(isDisclosed("answers_opened")).toBe(false);
    expect(isDisclosed("answer_revealed")).toBe(true);
    expect(isDisclosed("settlement_computed")).toBe(true);
  });

  it("isSettled は精算済み（d = settlement_computed）のみ真", () => {
    expect(isSettled("accepting")).toBe(false);
    expect(isSettled("answers_locked")).toBe(false);
    expect(isSettled("answers_opened")).toBe(false);
    expect(isSettled("answer_revealed")).toBe(false);
    expect(isSettled("settlement_computed")).toBe(true);
  });

  // codd: covers vb=VB-38
  it("c 到達（answer_revealed 以降）を開示済みと判定する", () => {
    // b（answers_opened）までは開示済みでない＝正解ライブ編集の自動再採点対象外（境界外）。
    expect(isDisclosed("answers_opened")).toBe(false);
    // c（answer_revealed）以降は開示済み＝自動再採点の対象。
    expect(isDisclosed("answer_revealed")).toBe(true);
    expect(isDisclosed("settlement_computed")).toBe(true);
  });

  // codd: covers vb=VB-39
  it("d 到達は settlement_computed のみ", () => {
    // c（answer_revealed）は開示済みだが未精算＝残額の差分再計算の対象外。
    expect(isSettled("answer_revealed")).toBe(false);
    // d（settlement_computed）到達問のみ残額の差分再計算の対象。
    expect(isSettled("settlement_computed")).toBe(true);
  });

  it("開示は c（answer_revealed）ちょうどで発生する不連続な境界（c-onset）である", () => {
    // c 直前（answers_opened）は偽、c ちょうど（answer_revealed）で真へ切り替わる。
    // 「c 以降」を rank>=answer_revealed で判定しているため、境界が 1 段階で反転する。
    expect(isDisclosed("answers_opened")).toBe(false);
    expect(isDisclosed("answer_revealed")).toBe(true);
  });

  it("精算判定は d（settlement_computed）ただ 1 段階のみで真（d-only）", () => {
    // 5 段階のうち settlement_computed だけが isSettled=真であること（終端 1 段のみ）を全走査で確認。
    const settledStages = STAGES.filter((stage) => isSettled(stage));
    expect(settledStages).toEqual(["settlement_computed"]);
  });

  it("精算済みは常に開示済みを含意する（settled ⇒ disclosed の単調性）", () => {
    for (const stage of STAGES) {
      if (isSettled(stage)) {
        expect(isDisclosed(stage)).toBe(true);
      }
    }
    // 少なくとも settlement_computed で含意が実際に成立することを直接検証する。
    expect(isSettled("settlement_computed")).toBe(true);
    expect(isDisclosed("settlement_computed")).toBe(true);
  });

  it("Round は問=ラウンド 1 行の到達段階を stage として保持し述語判定に供する", () => {
    const revealed: Round = {
      questionId: "q-3",
      questionNumber: 3,
      stage: "answer_revealed",
    };
    const settled: Round = {
      questionId: "q-7",
      questionNumber: 7,
      stage: "settlement_computed",
    };
    expect(isDisclosed(revealed.stage)).toBe(true);
    expect(isSettled(revealed.stage)).toBe(false);
    expect(isDisclosed(settled.stage)).toBe(true);
    expect(isSettled(settled.stage)).toBe(true);
  });
});
