// @generated-by: codd implement
// @generated-from: docs/design/surface_copy_obligations.md (design:surface-copy-obligations)
// @design-node: docs/design/surface_copy_obligations.md
// @output-paths: tests
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @generated-from: docs/design/operational_behavior_model.md (design:operational-behavior-model)
// @generated-from: docs/design/participation_connection_design.md (design:participation-connection-design)
// @generated-from: docs/design/question_media_intake_design.md (design:question-media-intake-design)
// @generated-from: docs/design/realtime_sync_design.md (design:realtime-sync-design)
// @generated-from: docs/design/scoring_engine_design.md (design:scoring-engine-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { describe, it, expect } from "vitest";
import { formatYen, CURRENCY_UNIT } from "../../src/scoring/currency.js";

// 本ユニットは surface_copy_obligations §2.5・§2.11 / op_enforce_currency_yen_copy の
// dod_currency_yen_all_surfaces / dod_currency_no_point_token / dod_currency_no_pointization_phrase を、
// 「金額整形の単一点」= src/scoring/currency.ts の formatYen / CURRENCY_UNIT の単位で機械可検化する。
// 全サーフェス（TV d/e・タブレットの自残額・金額を含む API 応答）はこの唯一の整形点を経由するため、
// ここで「整数円を円建てで整形し出力に point/pt/点 を持たせない／非整数は文言化せず送出する」を押さえると、
// VB-35（金額が全サーフェス・API・内部表現で円建てであり point/pt/点 が存在しない）を内部表現＝整形点の
// 単位で担保できる。唯一の整形点そのものを実際に import して評価する（設計 §2.11 の受け入れ例に準拠）。
describe("scoring/currency 金額整形の単一点（円建て固定・点化禁止・SCO-4）", () => {
  // codd: covers vb=VB-35
  it("整数円を『<金額>円』へ整形し、可視文言に point/pt/点 を持たせない", () => {
    // 通貨単位は「円」ちょうど（point/pt/点・ポイント等への置換でない）。設計 §2.5 が verbatim に固定。
    // 単位が「円」以外へ差し替わればここが直接 RED になり、点化・ポイント化を捕捉する。
    expect(CURRENCY_UNIT).toBe("円");

    // 精算経路に現れる確定金額（先渡し 10,000 / 減算 -100・-500 / ピタリ賞 +1,000 / 残額 0・11,000 /
    // 小さな負値 -1）を実際に整形し、SUT 出力を独立に固定した期待（円単位で終わる・整数値を欠落改変
    // せず表す・点化語が不在）へ照合する。
    const amounts = [10_000, -100, -500, 1_000, 0, 11_000, -1] as const;
    for (const amount of amounts) {
      const shown = formatYen(amount);

      // 整形出力の単位が円である（内部表現＝整形点が円建てで終わる）。
      expect(shown.endsWith(CURRENCY_UNIT)).toBe(true);

      // 金額整形出力そのもの（対象文字列にスコープ）に point/pt/点 が存在しない。
      expect(shown).not.toMatch(/point|pt|点/i);

      // 千位区切りの有無に依らず、整形出力が元の整数円を忠実に表す（SUT 出力から単位・区切りを除いて
      // 数値へ読み戻し、独立に与えた入力値 amount と照合）。
      const numeric = Number(shown.slice(0, -CURRENCY_UNIT.length).replace(/,/g, ""));
      expect(numeric).toBe(amount);
    }
  });

  it("増減円(-100/-500)・ピタリ賞(+1,000)の境界も円建てで整形される", () => {
    // 誤差1→-100 / 誤差5→-500 の減算は負号を保った円建て（例 -100円 / -500円）。
    const minus100 = formatYen(-100);
    expect(minus100.endsWith(CURRENCY_UNIT)).toBe(true);
    expect(minus100.startsWith("-")).toBe(true);
    expect(Number(minus100.slice(0, -CURRENCY_UNIT.length).replace(/,/g, ""))).toBe(-100);

    const minus500 = formatYen(-500);
    expect(minus500.endsWith(CURRENCY_UNIT)).toBe(true);
    expect(Number(minus500.slice(0, -CURRENCY_UNIT.length).replace(/,/g, ""))).toBe(-500);

    // ピタリ賞 +1,000 の加算側も円建て（1,000円）で point/pt/点 を含まない。
    const bonus = formatYen(1_000);
    expect(bonus.endsWith(CURRENCY_UNIT)).toBe(true);
    expect(bonus).not.toMatch(/point|pt|点/i);
    expect(Number(bonus.slice(0, -CURRENCY_UNIT.length).replace(/,/g, ""))).toBe(1_000);
  });

  it("非整数の金額は文言化せず送出する（整数円のみ受理・小数/NaN/Infinity を拒否）", () => {
    // 小数（設計 §2.5 の 50.5 境界）・NaN・Infinity は整形せず送出し、点化・小数化された文字列を
    // 返さない（整数円の不変条件を表示層で守る番人・currency.ts の契約どおり）。
    expect(() => formatYen(50.5)).toThrow();
    expect(() => formatYen(-0.5)).toThrow();
    expect(() => formatYen(Number.NaN)).toThrow();
    expect(() => formatYen(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => formatYen(Number.NEGATIVE_INFINITY)).toThrow();
  });
});
