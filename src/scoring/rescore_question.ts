// @generated-by: codd implement
// @generated-from: docs/design/question_media_intake_design.md (design:question-media-intake-design)
// @design-node: docs/design/question_media_intake_design.md
// @output-paths: src, tests
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { applyQuestionScore } from "./apply_question_score.js";
import type { AnswerScore } from "./answer_score.js";
import { assertYen, type Yen } from "./yen.js";

/**
 * 差分再採点の入力となる 1 人分の解答スナップショット（`answers.value` 由来）。
 *
 * question_media_intake_design §2.6（規約 QM-3・E-3 残）が定める自動再採点
 * （op_auto_rescore）の測定源のうち「既存 answers.value」側を表す。`value` は 0〜100 の
 * 整数（{@link AnswerScore}）で、精算時点に確定した各人の解答をそのまま持つ。得点精算
 * （`settleQuestion`）と同一の最小解答行を共有し、他者情報は持たない。
 */
export interface AnswerRow {
  /** 解答者識別子（`answers.participant_id` / `settlements.participant_id` に対応）。 */
  participantId: string;
  /** 当該問へのその人の解答（0〜100 の整数）。 */
  value: AnswerScore;
}

/**
 * 正解訂正前（旧 correct_value）に確定していた 1 人分の精算拠出。
 *
 * question_media_intake_design §2.6 の差分再計算で `balances` への「旧寄与」を表し、差分
 * 計算の基準になる。`deltaYen`（増減円 = 誤差 × −100）と `pitariBonusYen`（ピタリ賞の
 * 加算側・0 または +1,000）はいずれも整数円（{@link Yen}）で、`point`/`pt`/`点` へ置換
 * しない（円建て固定・QM-3）。旧 settlements 行（`QuestionSettlement`）が余分なフィールド
 * （error / answerValue 等）を併せ持っていても、本型が要求する 3 フィールドを備えて
 * いれば差分計算に供する（`settleQuestion` の戻り値をそのまま渡せる）。
 */
export interface OldSettlement {
  /** 解答者識別子（旧 settlements 行の participant）。 */
  participantId: string;
  /** 旧正解での増減円（整数円・誤差 × −100）。 */
  deltaYen: Yen;
  /** 旧正解でのピタリ賞加算（整数円・0 または +1,000）。 */
  pitariBonusYen: Yen;
}

/**
 * `balances.amount` へ加算する 1 人分の差分（整数円）。
 *
 * 「旧残額 + {@link deltaYen}」が、編集後 correct_value と `answers` からの全再計算残額に
 * 一致する（question_media_intake_design §2.6 の監査不変式
 * dod_rescore_matches_full_recompute）。差分更新は最適化であり、正しさの基準は
 * `aggregateBalance` による全再計算である。残額は 0 下限・脱落を確定要件に持たないため
 * （F-01）、負の整数円も表現しうる。
 */
export interface BalanceDelta {
  /** 差分の適用先となる解答者識別子。 */
  participantId: string;
  /** `balances` へ加算する整数円の差分（この問での 新拠出 − 旧拠出・負値も受理）。 */
  deltaYen: Yen;
}

/**
 * 正解訂正に伴う `balances` 差分再採点の結果（当該問単位）。
 *
 * `questionId` は差分の対象問（TV d/e の同時更新が指す問）を表し、`balanceDeltas` は
 * 各解答者へ加算する整数円の差分列（この問での 新拠出 − 旧拠出）。
 */
export interface RescoreResult {
  /** 差分再採点の対象問（`rounds.question_id` 相当）。 */
  questionId: string;
  /** 参加者ごとの `balances` 加算差分。 */
  balanceDeltas: BalanceDelta[];
}

/**
 * correct_value 訂正時の差分再計算（開示済み問のみ呼ばれる純関数・QM-3 / §2.6）。
 *
 * 各参加者について、編集後 `newCorrect` と既存解答 `value` から得点精算
 * {@link applyQuestionScore}（誤差 × −100・ピタリ賞 +1,000・円建て）で新しい増減円＋
 * ピタリ賞を求め、旧 settlements の寄与（`deltaYen + pitariBonusYen`）との差
 * （新拠出 − 旧拠出）を `balances` へ加算する差分として返す。外部 I/O・可変状態に依存
 * しない純関数で、呼ぶ順序・回数によらず同じ入力から同じ差分を返す。
 *
 * 監査不変式（dod_rescore_matches_full_recompute・§2.6）: 旧残額へ本差分を適用した結果は、
 * `answers` と編集後 correct_value からの全再計算残額（`aggregateBalance`）に一致する。全
 * 再計算でも同一結果を得るため、差分更新はあくまで最適化である。すべての金額は整数円で
 * 扱い（{@link assertYen} で整数を保証）、`point`/`pt`/`点` を格納・派生・返却のどこにも
 * 出さない。
 *
 * @param answers 精算対象の全参加者の解答スナップショット。
 * @param oldSettlements 旧正解で確定していた各参加者の拠出（差分の基準）。
 * @param newCorrect 編集後の正解値（0〜100 の整数）。
 * @throws {RangeError} 解答または `newCorrect` が 0〜100 の整数でない場合（{@link applyQuestionScore} が送出）。
 */
export function rescoreDiff(
  answers: readonly AnswerRow[],
  oldSettlements: readonly OldSettlement[],
  newCorrect: AnswerScore,
): BalanceDelta[] {
  const previous = new Map<string, OldSettlement>(
    oldSettlements.map((s): [string, OldSettlement] => [s.participantId, s]),
  );
  return answers.map((answer): BalanceDelta => {
    const now = applyQuestionScore({
      balance: 0,
      answer: answer.value,
      correct: newCorrect,
    });
    const prior = previous.get(answer.participantId);
    const priorContribution = (prior?.deltaYen ?? 0) + (prior?.pitariBonusYen ?? 0);
    const nowContribution = now.delta + now.pitariBonus;
    return {
      participantId: answer.participantId,
      deltaYen: assertYen(nowContribution - priorContribution),
    };
  });
}

/**
 * 当該問の正解訂正に対する `balances` 差分再採点（§2.6・op_auto_rescore の純粋コア）。
 *
 * {@link rescoreDiff} に委譲して各参加者の整数円差分（新拠出 − 旧拠出）を求め、対象問
 * `questionId` を添えて返す。開示済み（rounds.stage が answer_revealed 以降・`isDisclosed`
 * 真・§2.6）の問に対してのみ起動され、`isSettled`（settlement_computed・d 到達）の問では
 * 返した差分で TV d/e を同時更新する。本関数は差分の算出のみを担い、settlements/balances
 * の永続化・配信は上位のトリガ／ブロードキャストが担う。
 *
 * @param questionId 差分再採点の対象問の識別子。
 * @param newCorrect 編集後の正解値（0〜100 の整数）。
 * @param answers 精算対象の全参加者の解答スナップショット。
 * @param oldSettlements 旧正解で確定していた各参加者の拠出（差分の基準）。
 * @throws {RangeError} 解答または `newCorrect` が 0〜100 の整数でない場合。
 */
export function rescoreQuestion(
  questionId: string,
  newCorrect: AnswerScore,
  answers: readonly AnswerRow[],
  oldSettlements: readonly OldSettlement[],
): RescoreResult {
  return {
    questionId,
    balanceDeltas: rescoreDiff(answers, oldSettlements, newCorrect),
  };
}
