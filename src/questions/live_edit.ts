// @generated-by: codd implement
// @generated-from: docs/design/question_media_intake_design.md (design:question-media-intake-design)
// @design-node: docs/design/question_media_intake_design.md
// @output-paths: src, tests
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import type {
  QuestionsRepository,
  QuestionContentPatch,
} from "./questions_repository.js";
import type { Question } from "./question.js";

/**
 * 当該問が「開示済み（c 正解発表以降）」か否かを進行段階から読むポート
 * （`module:game_flow`・`rounds.stage` 由来）。
 *
 * question_media_intake_design §2.5 / §2.6（規約 QM-3）と data_model_design §2.5 が
 * 定める再採点範囲判定の唯一の前提 ── `rounds.stage ∈ {answer_revealed,
 * settlement_computed}` を真偽へ畳んだもの ── を、具体的な進行状態ストアから切り離した
 * 抽象として宣言する。本ファイルは**ポート（インタフェース）の定義のみ**であり、
 * `rounds.stage` を実際に読み `game_state/progression.ts` の `isDisclosed` を適用する
 * 具体アダプタは、それを所有する継承モジュール（`module:game_flow`）側で与えられ、
 * {@link applyLiveEdit} へ注入される（本オーケストレータでは著さない）。
 */
export interface StageReader {
  /**
   * 指定の問が開示済み（c 以降）なら `true`。b（解答オープン）までしか進んでいない問
   * ―― 正解値がまだ観客へ出ていない ―― や未到達の問は `false`。この真偽が再採点ゲートの
   * 第 2 条件になる（§2.5・§2.6 の境界）。
   */
  isDisclosed(questionId: string): Promise<boolean>;
}

/**
 * 開示済み問題の正解訂正で自動再採点を起動するポート（`module:scoring`）。
 *
 * question_media_intake_design §2.6（op_auto_rescore・規約 QM-3）が定める連携面。
 * 編集後 `questions.correct_value` と既存 `answers.value` から当該問の全 `settlements`
 * を再計算し `balances` を差分更新する durable な再書換えは、それを所有する
 * `module:scoring` の具体アダプタ（`rescore_trigger`）が担う。本ポートは「どの問を
 * 再採点するか」を問 ID で受け取る起動面のみを表し、{@link applyLiveEdit} はゲートの
 * 2 条件が揃ったときにこれを 1 度だけ呼ぶ。具体アダプタはここでは注入される。
 */
export interface RescoreTrigger {
  /** 指定の問について全 `settlements` と `balances` を再計算・差分更新する。 */
  rescoreQuestion(questionId: string): Promise<void>;
}

/**
 * 進行中のライブ編集を単一の問へ適用し、開示済みの正解訂正のみ自動再採点へ橋渡す
 * （§2.5・§2.6・規約 QM-3）。
 *
 * 手順は 2 段で、順序に意味がある:
 *   1. `repo.updateContent` で patch（問題文・画像/動画パス・正解値のうち与えた
 *      フィールド）を `questions` へ永続し、DB 再取得相当の編集後 {@link Question} を
 *      得る。返り値はこの読み戻しであり、呼び出し側ハンドラの readback に供する。
 *      text/メディア/正解値いずれの編集でも永続は常に走る。
 *   2. **再採点ゲート（2 条件の論理積）** を評価する。`patch.correctValue` が含まれ
 *      （＝正解値を触った編集）、かつ当該問が開示済み（{@link StageReader} が真）の
 *      ときに限り {@link RescoreTrigger} を 1 度起動する。再採点は永続後の
 *      `correct_value` を測定源にするため、必ず `updateContent` の後に呼ぶ。
 *
 * ゲートの存在判定は `!== undefined` で行い、`correctValue === 0`（0〜100 の妥当な正解値
 * だが falsy）も「編集された」と正しく扱う。`text`／`image_path`／`video_path` のみの
 * 編集、あるいは開示前（c 未到達）の正解編集では再採点は起動せず、`balances` は不変で
 * ある（§2.6 の境界）。短絡評価により、正解値を触らない編集では `isDisclosed` を問い
 * 合わせない。
 *
 * 権限境界（host 限定）と正解値のサーバ側レンジ検証（0〜100 整数）は、本オーケスト
 * レータの上流に立つ制御盤ハンドラ（`op_live_edit_correct` の handler）の責務であり、
 * `applyLiveEdit` は認可・検証済みの編集を受け取る前提で「永続 ＋ 再採点ゲート」のみを
 * 担う。
 */
export async function applyLiveEdit(
  questionId: string,
  patch: QuestionContentPatch,
  repo: QuestionsRepository,
  stage: StageReader,
  rescore: RescoreTrigger,
): Promise<Question> {
  // 1) 永続（＝読み戻し相当を取得）。編集の種類によらず常に走る。
  const updated = await repo.updateContent(questionId, patch);

  // 2) 再採点ゲート: correct_value を含む編集 かつ 開示済み のときだけ起動する。
  if (patch.correctValue !== undefined && (await stage.isDisclosed(questionId))) {
    await rescore.rescoreQuestion(questionId);
  }

  return updated;
}
