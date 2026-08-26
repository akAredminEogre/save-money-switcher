// @generated-by: codd implement
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @design-node: docs/design/data_model_design.md
// @output-paths: src, tests
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import type { AnswerScore } from "../scoring/answer_score.js";

/**
 * 問題エンティティ（`questions` テーブルの行に対応・data_model_design §2.2 / 規約 DM-1）。
 *
 * 事前問題ファイルの読込で `questions` へ一括登録され、ランタイム出題は
 * ファイル再読込ではなく本エンティティ（DB）から供給される。進行中のライブ編集も
 * `questions` への DB 更新として永続し、再取得で読み戻せる（op_load_questions /
 * op_live_edit_correct）。DB テーブルの列は snake_case、本ドメイン型の
 * フィールドは camelCase で対応する（`question_number` ↔ `questionNumber`、
 * `image_path` ↔ `imagePath`、`video_path` ↔ `videoPath`、`correct_value` ↔
 * `correctValue`）。
 *
 * 出題面（TV a モード）は本エンティティの 3 フィールドのみで決まる 3 段フォールバック
 * で解決する: `videoPath` 有 → 動画 ／ `videoPath` 無・`imagePath` 有 → 画像 ／
 * 双方 `null` → `text`。この解決は外部状態に依存しない。
 */
export interface Question {
  /** 問の安定識別子（`questions.id`・主キー）。 */
  id: string;

  /**
   * 問題番号（`questions.question_number`）。1 ゲーム 10 問に対応する 1〜10 の整数で、
   * DB では unique 制約を持つ。TypeScript の構造的型では 1〜10 の整数部分集合を静的に
   * 表せないため `number` とし、範囲・整数性は入稿検証と DB CHECK が保証する。
   */
  questionNumber: number;

  /** 問題文（`questions.text`）。テキスト出題面のフォールバック元にもなる。 */
  text: string;

  /**
   * 画像の相対パス（`questions.image_path`）。任意であり、未指定は `null` として登録・
   * 出題できる。所定フォルダ配下の相対パスを保持する。動画が無く本フィールドが非 `null`
   * のとき、a モードの出題面は画像へフォールバックする。
   */
  imagePath: string | null;

  /**
   * 動画の相対パス（`questions.video_path`）。任意であり、未指定は `null` として登録・
   * 出題できる。問題ファイルにパスを記載し、動画は所定フォルダへ事前配置する。非 `null`
   * のとき、画像の有無に関わらず a モードの出題面は動画を優先する。
   */
  videoPath: string | null;

  /**
   * 正解値（`questions.correct_value`）。0〜100 の整数のみを取り、{@link AnswerScore}
   * として型・実行時アサート・DB CHECK の三層で範囲を固定する。誤差計算・増減円・残額の
   * 基点となる（`error = |answer - correctValue|`）。
   */
  correctValue: AnswerScore;
}
