// @generated-by: codd implement
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @design-node: docs/design/data_model_design.md
// @output-paths: src, tests
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { assertYen, type Yen } from "./yen.js";

/**
 * プレイヤー残額の集計読みモデル（`module:scoring`・scoring_engine_design §2.4 /
 * data_model_design §2.6・DM-3）。
 *
 * `balances` テーブル 1 行（`participant_id` を主キーに 1 人 1 行）に対応し、当該プレイヤーの
 * 現在残額を **整数円** で保持する派生読みモデルである。値は問ごとの拠出台帳 `settlements`
 * から集計され、その不変式は
 *
 *     amount = 10000 + Σ delta_yen + Σ pitari_bonus_yen
 *
 * （先渡し 10,000 円 ＋ 各問の増減円 ＋ ピタリ賞加算。§2.4・§2.9）。集計そのものは
 * `aggregate_balance`（`settlements` からの全再計算）と `balances_repository`（差分更新）が担い、
 * 本モジュールはその器となる型と、整数円の不変条件を構築時に強制する生成器のみを供給する。
 *
 * DM-3（release-blocking）: `amount` は整数円のみを持ち、小数・`point`/`pt`/`点` を格納・派生・
 * 表示のどこにも持たない。通貨は `src/scoring/yen.ts` に単一定義された整数円のドメイン値型
 * {@link Yen} で表し、本読みモデルに `point`/`pt`/`点` フィールドは存在しない（§2.6・INV-7 継承）。
 *
 * この読みモデルは TV d（当該問精算表の残額列）・TV e（全問通算一覧）・勝者判定（残額最多勝ち・
 * `determine_winner` の `determineWinners` が本型の `amount` を比較して e モードへ供給）の
 * 供給源となる（§2.9・§2.10）。タブレット向けには当該解答者自身の残額のみを供給し、他者の
 * 残額は含めない（§2.11）。
 */
export interface Balance {
  /** 残額の主体となる参加者の識別子（`participants.id` を参照・1 人 1 行）。 */
  participantId: string;
  /** 現在残額（**整数円**。`= 10000 + Σ settlements`）。 */
  amount: Yen;
}

/**
 * 整数円の不変条件（DM-3）を構築時に強制して {@link Balance} を生成する。
 *
 * `amount` を {@link assertYen} に通し、小数・`NaN`・`Infinity`（＝ `point`/`pt`/`点` 等の
 * 非整数表現に相当する値）を残額へ持ち込むことを拒む。残額は 0 下限・脱落を確定要件に
 * 持たないため、負の整数円も受理する（F-01）。初期化（10,000 円）・精算・差分更新のいずれの
 * 構築点からも本生成器を経由でき、UI・サーバの検証に続く型/実行時の防衛点となる。
 *
 * @throws {TypeError} `amount` が整数円でない場合（{@link assertYen} が送出）。
 */
export function createBalance(participantId: string, amount: number): Balance {
  return { participantId, amount: assertYen(amount) };
}
