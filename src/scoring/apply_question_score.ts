// @generated-by: codd implement
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @design-node: docs/design/data_model_design.md
// @output-paths: src, tests
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import type { QuestionProgress } from "../game_state/progression.js";
import {
  applyQuestionScore,
  INITIAL_GRANT_YEN,
  YEN_PER_ERROR,
  PITARI_BONUS_YEN,
  SCORE_CURRENCY,
} from "./apply_question_score_impl.js";
import type {
  QuestionScore,
  QuestionScoreInput,
} from "./apply_question_score_impl.js";

/**
 * 得点精算コア `applyQuestionScore` の公開面（`module:scoring`・scoring_engine_design §2.3 /
 * system_design §2.2 / data_model_design §2.9・規約 SC-1〜SC-3 / DM-3）。
 *
 * 精算の実体は `apply_question_score_impl.ts` にあり、本ファイルはそれを再エクスポートする
 * 単一の入口である。得点精算（op_compute_settlement）・TV d/e 表示・差分再採点
 * （`rescore_question.ts`）など消費側は、ここから {@link applyQuestionScore} と円建て確定値
 * （{@link INITIAL_GRANT_YEN} / {@link YEN_PER_ERROR} / {@link PITARI_BONUS_YEN} /
 * {@link SCORE_CURRENCY}）・型（{@link QuestionScore} / {@link QuestionScoreInput}）を参照する
 * （ユニットテストも本面から import する）。
 *
 * {@link applyQuestionScore} は 1 プレイヤー・1 問の純関数として、誤差 = |解答 − 正解|・
 * 増減円 = 誤差 × −100・誤差 0 のピタリ賞 +1,000 円（加算側・確定値）・精算後の整数円残額
 * （精算前残額 + 増減円 + ピタリ賞）を算出し、結果へ通貨タグ（円）を添える。誤差 0 は +1,000、
 * 誤差 1 は −100 のみでピタリ賞が付かず、両者の間に不連続がある（§2.1 の境界）。0〜100 整数で
 * ない解答/正解は回答レンジ値型のガードで、非整数円は整数円ガードで計算前に弾かれる（SC-3・
 * 二重防衛のサーバ層）。
 *
 * 併せて、問題ごとの進行状態 {@link QuestionProgress}（`module:game_state`）に紐づけて
 * 1 問 1 人分を採点する {@link scoreQuestionForProgress} を提供する。採点結果へ当該問の
 * `questionId` を保持させ、`answers`・`balances`・TV(d) の当該問フォーカス表示が同じ問題を
 * 指すよう対応付ける。
 */

/** 当該問に紐づいた 1 人分の得点精算結果（{@link QuestionScore} ＋ 対象問の識別子）。 */
export interface RoundQuestionScore extends QuestionScore {
  /** 採点対象の問題識別子（`rounds.question_id` に対応）。 */
  readonly questionId: number;
}

/**
 * 問題進行 {@link QuestionProgress} が指す 1 問について、1 人分の得点を精算する。
 *
 * 算出そのものは {@link applyQuestionScore} に委譲し（0〜100 整数の検証・誤差 × −100・
 * ピタリ賞 +1,000 円・円建てはそこで確定どおり適用される）、結果へ当該問の `questionId`
 * を添えて返す。
 *
 * @throws {InvalidAnswerError} 解答または正解が 0〜100 の整数でない場合（委譲先が送出）。
 */
export function scoreQuestionForProgress(
  progress: QuestionProgress,
  input: QuestionScoreInput,
): RoundQuestionScore {
  return { questionId: progress.questionId, ...applyQuestionScore(input) };
}

export {
  applyQuestionScore,
  INITIAL_GRANT_YEN,
  YEN_PER_ERROR,
  PITARI_BONUS_YEN,
  SCORE_CURRENCY,
};
export type { QuestionScore, QuestionScoreInput };
