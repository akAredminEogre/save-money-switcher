// @generated-by: codd implement
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @design-node: docs/design/data_model_design.md
// @output-paths: src, tests
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import type { Question } from "./question.js";

/**
 * 問題内容のライブ編集で差し替え可能なフィールドの部分パッチ。
 *
 * question_media_intake_design §2.3 / §2.5 と data_model_design §2.2 / §2.9（規約
 * DM-1・QM-3）で確定した「進行中のライブ編集」の適用面を型で固定する。編集できるのは
 * 問題文・画像パス・動画パス・正解値の 4 フィールドのみで、`id` と `questionNumber`
 * （`unique` キー・出題順の安定識別子）は編集対象に含めない ── これらを patch から
 * 除くことで、ライブ編集が問の同一性や採番を書き換えないことを型レベルで保証する。
 *
 * すべてのキーは任意（`Partial`）で、与えたフィールドのみを更新する。`correctValue`
 * を含む patch は、当該問が開示済み（c 以降・`isDisclosed` 真）のとき自動再採点を誘発
 * する編集として扱われる（§2.5・§2.6・op_auto_rescore）。再採点ゲートの 2 条件判定
 * （`correctValue` 有無 × `isDisclosed`）は本型ではなくライブ編集オーケストレータの
 * 責務であり、本型は編集面（どのフィールドを触れるか）だけを表す。
 */
export type QuestionContentPatch = Partial<
  Pick<Question, "text" | "imagePath" | "videoPath" | "correctValue">
>;

/**
 * 問題データ（`questions` テーブル）への永続化ポート（`module:questions`・DM-1/QM-1）。
 *
 * data_model_design §2.2 と question_media_intake_design §2.3 が定める入稿・
 * ランタイム供給・ライブ編集の境界を、具体 DB 技術から切り離した抽象として宣言する。
 * 本ファイルは**ポート（インタフェース）の定義のみ**であり、具体的な DB バックエンド
 * 実装（永続化技術の選定）は data_model_design §3.1 の選定へ委ねられ、ここでは書かない。
 * 差し替えられるアダプタは、`question_number` の `unique`・`correct_value` の
 * `CHECK(0<=correct_value<=100)`・FK を defense-in-depth として強制できる DB 上に
 * 与えられる（0〜100 整数の三層防衛のうち DB 層・§2.4/§2.9）。
 *
 * DM-1 準拠の要点:
 *   - 入稿の唯一の機構は事前ファイル読込 → {@link bulkInsert}。当日その場で問題集を
 *     ゼロから手入力する API を持たない（ゼロ入稿の入口を本ポートに設けない）。
 *   - ランタイム出題は {@link getByNumber} / {@link listAll} を通じ `questions`
 *     テーブルからのみ供給し、問題ファイルの再読込に依存しない（dod_load_runtime_from_db）。
 *   - 進行中のライブ編集は {@link updateContent} による行更新として `questions` へ
 *     永続し、再取得で登録時と同一の `text`・`correctValue` を読み戻せる（dod_edit_persist）。
 */
export interface QuestionsRepository {
  /**
   * 検証済みの全問を `questions` テーブルへ一括登録する（入稿）。
   *
   * `question_number`（`unique`）をキーとした upsert として振る舞い、進行中の再読込でも
   * 重複行を作らない（§2.1 の再読込の冪等性）。呼び出し側（`loadQuestions`）は全 or 無で
   * 検証を通した問のみを渡す契約であり、本メソッドは部分登録の判断を持たない。
   */
  bulkInsert(questions: readonly Question[]): Promise<void>;

  /**
   * 問題番号（1〜10）で 1 問を取得する。ランタイム出題の供給元。
   *
   * 出題面（TV a モード）の解決・精算・再採点はすべて本メソッド（または {@link listAll}）
   * が返す DB 上の値を用い、登録時と同一の `text`・`correctValue` を読み戻す
   * （dod_load_runtime_from_db）。該当番号の問が存在しなければ `null` を返す。
   */
  getByNumber(questionNumber: number): Promise<Question | null>;

  /**
   * 登録済みの全問を取得する。ランタイム出題・全体供給の読み取り面。
   *
   * ファイル再読込ではなく `questions` テーブルを唯一の供給源とする（DM-1）。
   */
  listAll(): Promise<readonly Question[]>;

  /**
   * 進行中のライブ編集を単一の問へ適用し、更新後の問を返す（§2.9・op_live_edit_correct）。
   *
   * `id` で対象問を特定し、{@link QuestionContentPatch} が与えたフィールド
   * （問題文・画像/動画パス・正解値）のみを `questions` の行更新として永続する。返り値は
   * DB 再取得相当の編集後 {@link Question} であり、呼び出し側の readback に供する。正解値
   * 編集に伴う自動再採点の起動判定は本メソッドの責務外（ライブ編集オーケストレータが担う）。
   */
  updateContent(id: string, patch: QuestionContentPatch): Promise<Question>;
}
