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
  assertYen,
  CURRENCY,
  INITIAL_GRANT,
  YEN_PER_ERROR,
  PITARI_BONUS,
} from "../../src/scoring/yen.js";

// 円建て固定（INV-7）で内部表現に持ってはならない非・円建て通貨トークン。
const FORBIDDEN_CURRENCY_TOKENS: readonly string[] = ["point", "pt", "点"];

describe("scoring/yen 整数円の値型と確定金額定数（DM-3 / INV-7）", () => {
  // codd: covers vb=VB-35
  it("金額の内部表現が円建て（円）であり point/pt/点 を用いない", () => {
    const currencyLabel: string = CURRENCY;
    // 通貨ラベルは「円」の単一定義である。
    expect(currencyLabel).toBe("円");
    // 内部表現に point/pt/点 のいずれの通貨表現も持たない。
    expect(FORBIDDEN_CURRENCY_TOKENS).not.toContain(currencyLabel);
    // 金額ガードは整数「円」をそのまま扱い、point/pt/点 等の別単位へ変換しない。
    expect(assertYen(INITIAL_GRANT)).toBe(10_000);
  });

  it("確定金額定数が改変禁止の円値を保持する（先渡し10,000 / 誤差1あたり−100 / ピタリ賞+1,000）", () => {
    expect(INITIAL_GRANT).toBe(10_000);
    expect(YEN_PER_ERROR).toBe(-100);
    expect(PITARI_BONUS).toBe(1_000);
  });

  it("確定金額定数はすべて整数円で小数を持たない", () => {
    expect(Number.isInteger(INITIAL_GRANT)).toBe(true);
    expect(Number.isInteger(YEN_PER_ERROR)).toBe(true);
    expect(Number.isInteger(PITARI_BONUS)).toBe(true);
  });

  it("assertYen は整数円をそのまま通す（0・先渡し額・負残高）", () => {
    expect(assertYen(0)).toBe(0);
    expect(assertYen(INITIAL_GRANT)).toBe(10_000);
    // 残額は下限を課さず負の整数円も表現可能（F-01）。
    expect(assertYen(-500)).toBe(-500);
  });

  it("assertYen は非整数の金額を TypeError で拒否する（小数・NaN・Infinity）", () => {
    expect(() => assertYen(50.5)).toThrow(TypeError);
    expect(() => assertYen(-0.5)).toThrow(TypeError);
    expect(() => assertYen(9_999.99)).toThrow(TypeError);
    expect(() => assertYen(Number.NaN)).toThrow(TypeError);
    expect(() => assertYen(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});
