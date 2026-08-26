// @generated-by: codd implement
// @generated-from: docs/design/surface_copy_obligations.md (design:surface-copy-obligations)
// @design-node: docs/design/surface_copy_obligations.md
// @output-paths: src, tests
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

/**
 * 金額の可視文言を整形する単一の整形点（`module:scoring`・surface_copy_obligations §2.5 /
 * op_enforce_currency_yen_copy / decision_records ADR-B）。
 *
 * TV(d) の 6 列精算表・TV(e) の全問通算一覧・タブレットの自残額表示・金額を含む API 応答は、
 * いずれも金額を本モジュールの {@link formatYen} だけを唯一の整形点として経由する。通貨単位は
 * {@link CURRENCY_UNIT}（「円」）に単一化し、得点を点数化・ポイント化する語を型・出力・可視
 * コピーのいずれにも生じさせない（★設計原則「現金感を薄めない」＝円建て固定）。これにより
 * VB-35（金額が全サーフェス・API・内部表現で円建てであり `point`/`pt`/`点` が存在しない）と
 * dod_currency_yen_all_surfaces / dod_currency_no_point_token /
 * dod_currency_no_pointization_phrase を表示層で担保する。
 *
 * 金額の内部表現は整数円（`src/scoring/yen.ts` の `Yen`）である。増減円 = 誤差 × −100・
 * 残額 = 先渡し 10,000 円 ＋ Σ 拠出 はいずれも整数演算で常に整数円になるため、非整数
 * （小数・`NaN`・`Infinity`）の到達は上流のバグを意味する。よって非整数は文言化せず
 * {@link TypeError} を送出し、誤りを表示前に露呈させる。負の増減（例 −100 円 / −500 円）・
 * ピタリ賞の加算（+1,000 円）も整数であれば円建てで整形する（残額は下限を持たず負値を
 * 取りうる）。本モジュールは純粋な整形のみを供給し、他モジュールへ依存しないリーフとする。
 */

/**
 * 金額の通貨単位。全サーフェスの金額表示はこの単一定義を用い、`point`/`pt`/`点` への置換を
 * 型・出力・可視コピーのいずれにも持たせない（円建て固定）。
 */
export const CURRENCY_UNIT = "円" as const;

/**
 * 整数円を円建ての可視文言へ整形する唯一の整形点。
 *
 * 日本語ロケールの千位区切り表記（`toLocaleString("ja-JP")`）へ変換し、末尾に
 * {@link CURRENCY_UNIT}（「円」）を付す。例: `10000` → 「10,000円」／`-100` → 「-100円」／
 * `-500` → 「-500円」／`1000` → 「1,000円」。得点を点数化・ポイント化する語は出力に一切
 * 含まれない。
 *
 * 金額は整数円のみを受理する。小数・`NaN`・`Infinity` 等の非整数は文言化せず
 * {@link TypeError} を送出する（整数円で保持される残額・増減円の不変条件を表示層で守る番人）。
 * 負値も整数であれば円建てで整形する。
 *
 * @param amount 整形する整数円。
 * @returns `<千位区切りの金額>円` 形式の可視文言。
 * @throws {TypeError} `amount` が整数でない場合。
 */
export function formatYen(amount: number): string {
  if (!Number.isInteger(amount)) {
    throw new TypeError(
      `金額は整数円のみ整形できます（小数・非整数は不可）。受領値: ${String(amount)}`,
    );
  }
  return `${amount.toLocaleString("ja-JP")}${CURRENCY_UNIT}`;
}
