// @generated-by: codd implement
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @design-node: docs/design/data_model_design.md
// @output-paths: src, tests
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

/**
 * 問×人の精算拠出台帳行（`QuestionSettlement`・scoring_engine_design §2.4 /
 * data_model_design §2.6・規約 SC-3 / DM-3）。
 *
 * 1 問 × 1 参加者の精算結果を 1 行として保持する durable な拠出台帳（`settlements`
 * テーブル）のドメイン型で、データモデル側の settlements 台帳（§2.6）と verbatim に
 * 共有される唯一の型契約である。settle（精算生成 `settleQuestion`）・aggregate
 * （集計 `aggregateBalance`）・rescore（差分再採点 `rescoreQuestion`）の各単位が
 * この同一レコード型を消費する。集計読みモデル `balances` は
 * `amount = 10000 + Σ deltaYen + Σ pitariBonusYen` の不変式でこの台帳から導出され、
 * 正解ライブ編集時の差分再採点（§2.9・op_auto_rescore）はこの行を再計算して
 * `balances` を旧拠出との差分で更新する。
 *
 * SC-3 / DM-3（release-blocking）の型固定: 金額はすべて整数円（{@link Yen}）で保持し、
 * 回答スナップショット・誤差は 0〜100 整数（{@link AnswerScore}）で保持する。通貨を
 * 表すフィールドは {@link Yen} 型の `deltaYen` / `pitariBonusYen` のみであり、小数・
 * `point`/`pt`/`点` に相当する得点表現のフィールドはこの構造に存在しない（円建て固定・
 * INV-7 継承）。値が実際に 0〜100 整数・整数円であることの実行時保証は生成側の精算
 * 純関数（`applyQuestionScore` / `settleQuestion` 等）が担い、本モジュールは
 * 型定義のみを供給して `src/scoring/` をリーフに保つ。
 */

import type { AnswerScore } from "./answer_score.js";
import type { Yen } from "./yen.js";

/**
 * 1 問 × 1 参加者の精算拠出行。DB `settlements` テーブル（§2.6）の 1 行に対応し、
 * `unique(questionId, participantId)` により問ごと・人ごとに 1 行へ保たれる。
 */
export interface QuestionSettlement {
  /** 対象の問（`questions.id` への参照）。 */
  questionId: string;
  /** 対象の参加者（`participants.id` への参照）。 */
  participantId: string;
  /** 精算時点の解答スナップショット（0〜100 の整数）。 */
  answerValue: AnswerScore;
  /** 誤差 = |answerValue − correctValue|（0〜100 の整数）。 */
  error: AnswerScore;
  /** 増減円 = error × −100（整数円・常に 0 以下）。 */
  deltaYen: Yen;
  /** 誤差 0（ピタリ賞成立）のとき真。 */
  pitariAwarded: boolean;
  /** ピタリ賞の加算額（0 または +1000・整数円）。 */
  pitariBonusYen: Yen;
}
