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
  InvalidAnswerError,
  assertIntegerAnswer,
  isIntegerAnswer,
} from "../src/scoring/validate_answer.js";

describe("scoring/validate_answer ── サーバ側 0〜100 整数ガード（INV-6）", () => {
  // codd: covers vb=VB-32
  it("受理: 0 と 100 の境界値をサーバ側の判定経路が受理し、正規化した整数を返す", () => {
    expect(assertIntegerAnswer(0)).toBe(0);
    expect(assertIntegerAnswer(100)).toBe(100);
    // 境界内の代表値も受理する。
    expect(assertIntegerAnswer(50)).toBe(50);
  });

  // codd: covers vb=VB-34
  it("拒否: −1 / 101 / 50.5 をサーバ側でも拒否し answers へ入れない", () => {
    expect(() => assertIntegerAnswer(-1)).toThrow(InvalidAnswerError);
    expect(() => assertIntegerAnswer(101)).toThrow(InvalidAnswerError);
    expect(() => assertIntegerAnswer(50.5)).toThrow(InvalidAnswerError);
  });

  it("拒否: 上限直上・下限直下（境界のちょうど外側）", () => {
    expect(() => assertIntegerAnswer(ANSWER_MIN_VALUE - 1)).toThrow(InvalidAnswerError);
    expect(() => assertIntegerAnswer(ANSWER_MAX_VALUE + 1)).toThrow(InvalidAnswerError);
  });

  it("拒否: 数値でない入力（文字列・null・undefined・NaN・Infinity・真偽・オブジェクト）", () => {
    const nonNumeric: unknown[] = [
      "50",
      "",
      "abc",
      null,
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      true,
      false,
      {},
      [],
      [50],
    ];
    for (const value of nonNumeric) {
      expect(() => assertIntegerAnswer(value)).toThrow(InvalidAnswerError);
    }
  });

  it("拒否時のエラーは拒否した生値を保持する（監査用）", () => {
    let caught: unknown;
    try {
      assertIntegerAnswer(101);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InvalidAnswerError);
    expect((caught as InvalidAnswerError).rawValue).toBe(101);
  });

  it("isIntegerAnswer は 0〜100 の整数のみ true を返す", () => {
    expect(isIntegerAnswer(0)).toBe(true);
    expect(isIntegerAnswer(100)).toBe(true);
    expect(isIntegerAnswer(50)).toBe(true);
    expect(isIntegerAnswer(-1)).toBe(false);
    expect(isIntegerAnswer(101)).toBe(false);
    expect(isIntegerAnswer(50.5)).toBe(false);
    expect(isIntegerAnswer("50")).toBe(false);
  });
});
