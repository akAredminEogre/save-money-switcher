// @generated-by: codd implement
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @design-node: docs/design/data_model_design.md
// @output-paths: src, tests
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

/**
 * 整数円のドメイン値型・確定金額定数・ゲーム長（`module:scoring`・SC-1〜SC-3 / DM-3 / INV-7）。
 *
 * scoring_engine_design §2.2 / §2.6 と data_model_design §2.7 / §2.6、decision_records
 * ADR-B（リリースブロッキング不変条件2）で確定した制約を型レベル・実行時アサートの
 * 双方に固定する:
 *   - 金額はすべて **整数円** で保持し、小数・`point`/`pt`/`点` 表現を持たない
 *     （★設計原則「現金感を薄めない」＝円建て固定・SC-2）。
 *   - 得点ルールの確定値（改変禁止・🟦）を **単一定義** とする:
 *       先渡し 10,000 円 ／ 誤差 1 あたり −100 円 ／ ピタリ賞（誤差 0）+1,000 円 ／
 *       1 ゲーム 10 問（SC-1）。
 *   - 通貨は「円」を単一の {@link CURRENCY} 定義とし、精算結果・API 応答・TV d/e 供給用
 *     読みモデルはすべて円で表す（`point`/`pt`/`点` への置換をスキーマ・派生・表示の
 *     どこにも持たせない）。
 *
 * 誤差計算・増減円・残額更新は本モジュールの {@link assertYen} を通した整数値のみを
 * 扱い、途中の小数化を型と実行時アサートの双方で排除する（SC-3）。他モジュールへ依存
 * せず `src/scoring/` をリーフに保つ。
 */

/** 整数円。小数・`point`/`pt`/`点` への置換は禁止（型レベルの円建て固定）。 */
export type Yen = number;

/** 金額の通貨単位。単一定義とし、`point`/`pt`/`点` への置換を禁止する。 */
export const CURRENCY = "円" as const;

/** ゲーム開始時に各プレイヤーへ先渡しする賞金（確定値・改変禁止）。 */
export const INITIAL_GRANT: Yen = 10_000;

/** 正解値との誤差 1 あたりの増減円（確定値・改変禁止・負方向＝減算）。 */
export const YEN_PER_ERROR: Yen = -100;

/** ピタリ賞（誤差 0）の加算側の金額（確定値・改変禁止）。 */
export const PITARI_BONUS: Yen = 1_000;

/**
 * 1 ゲームの問数（確定値・改変禁止・SC-1）。
 *
 * この問数すべての得点精算が完了した時点で、通算残額最多のプレイヤーを勝者として
 * 判定する（scoring_engine_design §2.1・§2.10）。金額ではなく問の計数であるため
 * {@link Yen} 型は付さず、通貨（円）とは独立した整数の定数として単一定義する。
 */
export const QUESTION_COUNT = 10;

/**
 * 金額が整数円であることを保証する実行時ガード。
 *
 * 誤差計算・残額更新の途中で非整数（小数・`NaN`・`Infinity`、および `point`/`pt`/`点`
 * 等に相当する非整数表現）が混入することを拒み、整数円のみを {@link Yen} として返す。
 * 残額は 0 下限や脱落を確定要件に持たないため、負の整数円も受理する（F-01）。
 *
 * @throws {TypeError} 値が整数でない場合。
 */
export function assertYen(v: number): Yen {
  if (!Number.isInteger(v)) {
    throw new TypeError(
      `金額は整数円のみを許容します（小数・point/pt/点 は不可）。受領値: ${String(v)}`,
    );
  }
  return v;
}
