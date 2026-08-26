// @generated-by: codd implement
// @generated-from: docs/design/scoring_engine_design.md (design:scoring-engine-design)
// @design-node: docs/design/scoring_engine_design.md
// @output-paths: src, tests
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { applyQuestionScore } from "./apply_question_score.js";
import type { AnswerScore } from "./answer_score.js";
import type { QuestionSettlement } from "./settlement.js";

/**
 * 当該問の精算対象となる 1 人分の解答スナップショット（`answers.value` 由来）。
 *
 * scoring_engine_design §2.3（op_compute_settlement の derived 段）が定める得点精算と、
 * それを再利用する自動再採点（op_auto_rescore・§2.7）が共有する入力型である。`value` は
 * 精算時点に確定した各人の解答で、0〜100 の整数（{@link AnswerScore}）。参加者識別子と
 * 解答値のみを持つ最小の行で、他者情報を含めず `settlements` 台帳の 1 行へ写像される。
 */
export interface AnswerRow {
  /** 解答者識別子（`answers.participant_id` / `settlements.participant_id` に対応）。 */
  participantId: string;
  /** 当該問へのその人の解答（0〜100 の整数）。 */
  value: AnswerScore;
}

/**
 * 当該問の全解答を精算し、問×人の拠出台帳 {@link QuestionSettlement} の配列を生成する
 * 派生生成器（scoring_engine_design §2.3・op_compute_settlement の derived 段）。
 *
 * 各解答へ {@link applyQuestionScore} を 1 回ずつ適用する。誤差 = |解答 − 正解|・
 * 増減円 = 誤差 × −100・誤差 0 のピタリ賞 +1,000 円・整数円・円建て・0〜100 整数の検証は
 * すべて {@link applyQuestionScore} が確定どおり行い、本関数はその結果を台帳行へ写像する
 * 純関数である。得点精算（op_compute_settlement）と自動再採点（op_auto_rescore）が共有する
 * 唯一の計算経路であり、集計残額 `balances.amount` は `aggregateBalance`
 * （= 10,000 + Σ deltaYen + Σ pitariBonusYen）がこの台帳から導く。
 *
 * 精算後残額の集計は集計読みモデル側（`aggregateBalance` / `balances`）が担うため、各解答の
 * 精算は先渡し額に依存しない基点 `balance: 0` で評価し、台帳へは増減（`deltaYen` /
 * `pitariBonusYen`）と誤差・解答スナップショットのみを残す。`pitariAwarded` は誤差 0
 * （ピタリ賞成立）の真偽で、算出済みの誤差から導く。金額は整数円で保持し、`point`/`pt`/`点`
 * を持たない（円建て固定・SC-2）。
 *
 * @param questionId 精算対象の問の識別子（`settlements.question_id` に対応）。
 * @param correct 当該問の正解値（0〜100 の整数）。
 * @param answers 精算対象の全参加者の解答スナップショット。
 * @returns 参加者ごとの精算拠出行（入力 `answers` と同順）。
 * @throws 解答または `correct` が 0〜100 の整数でない場合。検証は
 *   {@link applyQuestionScore} が誤差計算の前に行い、範囲外・小数・非数値を弾く。
 */
export function settleQuestion(
  questionId: string,
  correct: AnswerScore,
  answers: readonly AnswerRow[],
): readonly QuestionSettlement[] {
  return answers.map((answer): QuestionSettlement => {
    const scored = applyQuestionScore({
      balance: 0,
      answer: answer.value,
      correct,
    });
    return {
      questionId,
      participantId: answer.participantId,
      answerValue: answer.value,
      error: scored.error,
      deltaYen: scored.delta,
      pitariAwarded: scored.error === 0,
      pitariBonusYen: scored.pitariBonus,
    };
  });
}
