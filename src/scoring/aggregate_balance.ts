// @generated-by: codd implement
// @generated-from: docs/design/scoring_engine_design.md (design:scoring-engine-design)
// @design-node: docs/design/scoring_engine_design.md
// @output-paths: src, tests
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

/**
 * 残額の集計読みモデル `aggregateBalance` ── settlements 台帳からプレイヤー残額を
 * 全再計算で導く単一の集計関数（`module:scoring`・scoring_engine_design §2.4 / §2.9 /
 * §2.11・規約 SC-1〜SC-3 / DM-3）。
 *
 * `balances.amount` の整合不変式
 *
 *     amount = INITIAL_GRANT + Σ(deltaYen) + Σ(pitariBonusYen)
 *
 * （先渡し 10,000 円 ＋ 各問の増減円 ＋ ピタリ賞加算）を、当該プレイヤーの
 * {@link QuestionSettlement} 台帳から**全再計算**で求める。settlements が空のとき Σ=0 と
 * なり `aggregateBalance([]) === 10000`（＝ {@link INITIAL_GRANT}）を返す。これは参加確定
 * （op_join_game）または `phase = in_progress` 開始時の賞金先渡し初期化
 * （`balances.amount = 10000`・SC-1・§2.4）と一致する。
 *
 * この全再計算は、正解ライブ編集に伴う差分更新（`rescoreQuestion`・§2.7）の**正しさの
 * 基準（監査グラウンドトゥルース）**である。差分更新後の `balances.amount` は、`answers`
 * ＋ 編集後 `correct_value` からの本全再計算と常に一致しなければならない
 * （dod_rescore_matches_full_recompute・§2.7）。差分更新はあくまで最適化であり、正しさの
 * 唯一の基準は本関数である（`rescore_question.test.ts` がこの一致を検算する）。
 *
 * ピタリ賞は**加算側 +1,000 のみ**を Σ に反映する。「他プレイヤーから 1,000 円獲得」の
 * **拠出（減算）側**は F-02 未確定のため現段階では 0 とし、確定後に `settlements` へ負の
 * 拠出行を追加する形で本関数の Σ へ加わる拡張余地を残す（§2.11）。加算側 +1,000・円建て・
 * 現金感を薄めない各確定値は変更しない。
 *
 * SC-2 / SC-3（release-blocking）: 金額はすべて整数円（{@link Yen}）で扱い、`point`/`pt`/
 * `点` を格納・派生・返却のどこにも持たない。集計結果は {@link assertYen} を通し、途中に
 * 小数が混入していないことを実行時にも保証する。残額は 0 下限・脱落を確定要件に持たない
 * ため、負の整数円も表現しうる（F-01）。他モジュールへ依存せず `src/scoring/` をリーフに
 * 保つ。
 */

import { INITIAL_GRANT, assertYen, type Yen } from "./yen.js";
import type { QuestionSettlement } from "./settlement.js";

/**
 * 精算拠出台帳から現在残額（整数円）を全再計算する。
 *
 * {@link INITIAL_GRANT}（先渡し 10,000 円）へ、渡された全 {@link QuestionSettlement} の
 * `deltaYen`（増減円 = 誤差 × −100・0 以下）と `pitariBonusYen`（ピタリ賞の加算側・
 * 0 または +1,000）を積み上げて残額を求める。入力は通常、当該 1 プレイヤー分の台帳行
 * （問ごとに 1 行）を想定するが、本関数は総和のみを取るため順序・重複は結果に影響しない。
 * 空配列なら Σ=0 で先渡し額そのもの（10,000 円）を返す。
 *
 * 集計結果は {@link assertYen} を経て整数円であることを保証する（SC-3）。呼び出し側は
 * 差分更新の検算（監査不変式・§2.7）や `balances.amount` の初期化・再構築に本関数を
 * 単一の基準として用いる。
 *
 * @param settlements 集計対象の精算拠出行（通常は 1 プレイヤー分）。
 * @returns 現在残額（整数円 = `INITIAL_GRANT + Σ(deltaYen + pitariBonusYen)`）。
 * @throws {TypeError} 集計結果が整数円でない場合（{@link assertYen} が送出）。
 */
export function aggregateBalance(
  settlements: readonly QuestionSettlement[],
): Yen {
  const contributions = settlements.reduce(
    (sum, settlement) => sum + settlement.deltaYen + settlement.pitariBonusYen,
    0,
  );
  return assertYen(INITIAL_GRANT + contributions);
}
