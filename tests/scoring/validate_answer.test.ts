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
import {
  validateSubmittedAnswer,
  InvalidAnswerError,
} from "../../src/scoring/validate_answer.js";

describe("scoring/validate_answer サーバ側最終防衛（0〜100 整数の二重防衛・SC-3 / INV-6）", () => {
  // codd: covers vb=VB-32
  it("境界の 0 と 100 をサーバ側で受理し 0〜100 の整数として返す", () => {
    // 0=受理 / 100=受理（§2.5 の release-blocking 境界のサーバ層）。
    // 期待値は SUT の算出とは独立に固定した境界値そのもの。
    expect(validateSubmittedAnswer(0)).toBe(0);
    expect(validateSubmittedAnswer(100)).toBe(100);
  });

  // codd: covers vb=VB-34
  it("UI を迂回した −1 / 101 / 50.5 をサーバ側で拒否する（answers へ入れない）", () => {
    // −1=不可 / 101=不可 / 50.5=不可。UI 片側でなくサーバ側でも拒む（二重防衛のサーバ半分）。
    expect(() => validateSubmittedAnswer(-1)).toThrow(InvalidAnswerError);
    expect(() => validateSubmittedAnswer(101)).toThrow(InvalidAnswerError);
    expect(() => validateSubmittedAnswer(50.5)).toThrow(InvalidAnswerError);
  });

  it("非数値（文字列・null・undefined・NaN・Infinity）をサーバ側で拒否する", () => {
    // ネットワーク越しの任意ペイロードを信頼せず、数値でない解答は拒否する。
    expect(() => validateSubmittedAnswer("50")).toThrow(InvalidAnswerError);
    expect(() => validateSubmittedAnswer(null)).toThrow(InvalidAnswerError);
    expect(() => validateSubmittedAnswer(undefined)).toThrow(InvalidAnswerError);
    expect(() => validateSubmittedAnswer(Number.NaN)).toThrow(InvalidAnswerError);
    expect(() =>
      validateSubmittedAnswer(Number.POSITIVE_INFINITY),
    ).toThrow(InvalidAnswerError);
  });

  it("拒否したエラーは監査のため拒否した生値を保持する", () => {
    let caught: unknown;
    try {
      validateSubmittedAnswer(101);
    } catch (error) {
      caught = error;
    }
    // 何も投げなければ caught は undefined のまま → instanceof 判定が失敗する。
    expect(caught).toBeInstanceOf(InvalidAnswerError);
    expect((caught as InvalidAnswerError).rawValue).toBe(101);
  });

  it("受理域内の複数整数を通しで受理して同値を返す", () => {
    for (const value of [1, 25, 50, 75, 99]) {
      expect(validateSubmittedAnswer(value)).toBe(value);
    }
  });
});
