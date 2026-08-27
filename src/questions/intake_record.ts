// @generated-by: codd implement
// @generated-from: docs/design/question_media_intake_design.md (design:question-media-intake-design)
// @design-node: docs/design/question_media_intake_design.md
// @output-paths: src, tests
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

/**
 * 事前問題ファイル（JSON 配列）1 エントリのドメイン型（`module:questions`・QM-1）。
 *
 * question_media_intake_design §2.2 が定める「事前ファイル読込 → DB 登録」入稿の
 * 入力側スキーマを型で固定する。出題内容の初期入稿は事前問題ファイルの読込のみで
 * 成立し（当日その場でゼロから手入力する UI/API は持たない）、本型はその JSON 配列
 * `QuestionIntakeRecord[]` の 1 要素＝ 1 問を表す。
 *
 * フィールドは TypeScript ドメインと同じ camelCase で宣言し、§2.3 の対応表に従って
 * snake_case の `questions` カラムへ写す:
 *   - questionNumber → question_number
 *   - text           → text
 *   - correctValue   → correct_value
 *   - imagePath      → image_path
 *   - videoPath      → video_path
 *
 * 本型は「検証前の生の入稿値」を表す。ゆえに correctValue は 0〜100 に絞り込まれた
 * `AnswerScore` ではなく素の `number` とし、範囲外（-1 / 101 / 50.5）・重複問題番号・
 * 空文字 text・未配置メディアの拒否は入稿検証（`validateIntake`）が担う。検証を通過した
 * レコードは登録時に `Question`（correctValue が `AnswerScore`、imagePath/videoPath が
 * `string | null`）へ写像され `questions` テーブルへ登録される。
 *
 * 純粋な型モジュールであり、ランタイム import を持たない。
 */
export interface QuestionIntakeRecord {
  /**
   * 問題番号（DB: `question_number`）。入稿検証で 1〜10 の整数かつ一意であることを
   * 要求する（本型は検証前の生値ゆえ number として受ける）。
   */
  questionNumber: number;

  /**
   * 問題文（DB: `text`）。入稿検証で非空（空文字・空白のみを拒否）であることを要求する。
   */
  text: string;

  /**
   * 正解値（DB: `correct_value`）。入稿検証・サーバ検証・DB CHECK の三層で 0〜100 の
   * 整数のみを受理する。範囲外・小数は検証段階で拒否されるため、本型では絞り込み前の
   * 生値として number で受ける。
   */
  correctValue: number;

  /**
   * 画像の相対パス（DB: `image_path`・任意・NULL 許容）。所定フォルダ
   * （QUESTION_MEDIA_ROOT）配下の相対パスを記載する。未指定（省略または null）の問題は
   * NULL として登録でき、a モードの出題面はテキストへフォールバックする。宣言した場合は
   * 入稿検証が所定フォルダ配下の実体存在を確認する。
   */
  imagePath?: string | null;

  /**
   * 動画の相対パス（DB: `video_path`・任意・NULL 許容）。所定フォルダ
   * （QUESTION_MEDIA_ROOT）配下へ事前配置した動画の相対パスを記載する。未指定（省略または
   * null）は NULL として登録でき、a モードの出題面解決では動画→画像→テキストの規定順に
   * 従う。宣言した場合は入稿検証が所定フォルダ配下の実体存在を確認する。
   */
  videoPath?: string | null;
}
