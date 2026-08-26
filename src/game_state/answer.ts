// @generated-by: codd implement
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @design-node: docs/design/data_model_design.md
// @output-paths: src, tests
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

/**
 * 回答エンティティ（`Answer`）。受付中に解答者が送信した 0〜100 整数の解答を
 * `answer_submitted` の永続レコードとして表す（data_model_design §2.4・規約 DM-3）。
 *
 * `answers` テーブル（snake_case カラム）の 1 行へ対応するドメイン型であり、DB カラムと
 * 本型のフィールド（camelCase）の対応は次のとおり:
 *   - `id`            ↔ `answers.id`（解答識別子・PK）
 *   - `questionId`    ↔ `answers.question_id`（FK → questions.id）
 *   - `participantId` ↔ `answers.participant_id`（FK → participants.id）
 *   - `value`         ↔ `answers.value`（0〜100 整数・{@link AnswerScore}）
 *   - `submittedAt`   ↔ `answers.submitted_at`（ISO-8601・送信時刻）
 *
 * `value` は {@link AnswerScore} を参照して 0〜100 の整数へ束ねる。回答レンジの防衛は
 * UI（`src/tablet/`）・サーバ側最終検証（`src/scoring/validate_answer.ts`）・DB CHECK の
 * 三層で担保し（§2.4）、本型はそのうちドメイン型レベルで値域を `AnswerScore` に固定する
 * 層を担う（実行時アサートは `assertAnswerScore`、永続時の三層目は `answers.value` の
 * CHECK 制約が受け持つ）。
 *
 * 一意制約 `unique(question_id, participant_id)` により 1 参加者は 1 問へ高々 1 解答を持ち、
 * 受付中の再送信は同一行の upsert（最新値で更新）となる（§2.4）。開示（b）到達前は他者の
 * 解答をどの端末向け読みモデルにも含めない（§2.11）。
 */

import type { AnswerScore } from "../scoring/answer_score.js";

/**
 * 受付中に永続化された 1 件の解答（`answers` テーブル 1 行＝`answer_submitted`）。
 */
export interface Answer {
  /** 解答識別子（`answers.id`・PK）。 */
  id: string;
  /** 対象問題の識別子（`answers.question_id`・FK → questions.id）。 */
  questionId: string;
  /** 解答者の識別子（`answers.participant_id`・FK → participants.id）。 */
  participantId: string;
  /** 送信された解答値。0〜100 の整数（{@link AnswerScore}）に固定する。 */
  value: AnswerScore;
  /** 送信時刻（`answers.submitted_at`・ISO-8601 文字列）。 */
  submittedAt: string;
}
