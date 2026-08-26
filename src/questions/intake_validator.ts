// @generated-by: codd implement
// @generated-from: docs/design/question_media_intake_design.md (design:question-media-intake-design)
// @design-node: docs/design/question_media_intake_design.md
// @output-paths: src, tests
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import type { QuestionIntakeRecord } from "./intake_record.js";
import { isAnswerScore } from "../scoring/answer_score.js";

/**
 * 事前問題ファイルの入稿検証（`module:questions`・QM-1／0〜100 整数の三層防衛の一層目）。
 *
 * question_media_intake_design §2.2 が定める「事前ファイル読込 → 検証 → DB 登録」入稿
 * パイプラインのうち、`QuestionIntakeRecord[]` を意味検証する段を担う。`intake_reader`
 * が JSON をパースして得た生レコード列を受け取り、次の規則に反する各項目を一件ずつ
 * {@link IntakeIssue} として列挙して返す（例外送出ではなく issue 列の返却）:
 *
 *   - `questionNumber` が 1〜10 の整数であり、かつ入稿内で一意であること。
 *   - `text` が非空（空文字・空白のみを拒否）であること。
 *   - `correctValue` が 0〜100 の整数であること。判定は採点モジュールの唯一の
 *     レンジ定義点 {@link isAnswerScore}（`src/scoring/answer_score.ts`）を共有し、
 *     -1 / 101 / 50.5 を拒否する。これは UI・サーバ・DB `CHECK` の三層防衛の
 *     **入稿検証層（一層目）**であり、サーバ検証や DB CHECK とレンジ規約が必ず一致する。
 *   - 宣言された（非 null の）`imagePath` / `videoPath` が、注入された
 *     {@link MediaPresence} を通じて所定フォルダ（QUESTION_MEDIA_ROOT）配下に実体を
 *     持つこと。a モードのフォールバックは「パスの有無」で分岐するため、未配置パスを
 *     そのまま登録すると本番の a モードが空画面になる。これを本番前に排除するため、
 *     入稿時に実体存在を検証し、未配置は問題番号を添えて拒否する。
 *
 * 各 {@link IntakeIssue} は対象の `questionNumber` と snake_case の `field` 名を保持する
 * ため、制御盤（司会者）サーフェスは「問題3の動画が所定フォルダに未配置です」のような
 * 問題番号タグ付きの job-to-be-done 文言をここから合成できる。検証結果の消費側
 * （`loadQuestions`）は issue が 1 件でもあれば `questions` を 1 行も変更しない
 * （全 or 無）。本モジュールは純粋な検証関数であり、DB 登録・ファイル I/O・採点へは
 * 依存しない（メディア実体確認は {@link MediaPresence} 抽象を介して外部化する）。
 */

/**
 * 所定フォルダ（QUESTION_MEDIA_ROOT）配下のメディア実体存在を判定する注入ポート。
 *
 * 実運用ではファイルシステム上の実体確認をラップした実装を注入し、単体検証では
 * 「配置済みパス集合」を返すテストダブルへ差し替える。相対パスはメディアルート配下の
 * 相対パス（`questions.image_path` / `video_path` と同一表現）を受ける。
 */
export interface MediaPresence {
  /** 与えた相対パスの実体が所定フォルダ配下に存在すれば `true`。 */
  exists(relativePath: string): boolean;
}

/**
 * 入稿検証で検出した 1 件の問題点。対象の問題番号と、DB カラム（snake_case）に対応する
 * `field` 名、および司会者向け文言の素になる短い理由を保持する。呼び出し側は `field` と
 * `questionNumber` から問題番号タグ付きの検証結果メッセージを組み立てる。
 */
export interface IntakeIssue {
  /** 問題点が属する問題番号（`questions.question_number`。生値ゆえ範囲外を含みうる）。 */
  questionNumber: number;
  /** 問題点の対象フィールド（DB カラム名に対応する snake_case）。 */
  field: "question_number" | "text" | "correct_value" | "image_path" | "video_path";
  /** 検出理由の短い説明（司会者向け文言の素）。 */
  reason: string;
}

/**
 * 入稿レコード列を意味検証し、規則違反を {@link IntakeIssue} の列として返す。
 *
 * 空配列は「全項目が妥当（all-clear）」を意味する。1 件でも issue があれば、消費側
 * （`loadQuestions`）は全 or 無で 0 問登録とする。宣言メディア（非 null の
 * `imagePath` / `videoPath`）のみ {@link MediaPresence} で実体存在を確認し、未指定
 * （省略または `null`）のメディアは検証対象外＝ issue を出さない（NULL 許容・登録可）。
 *
 * @param records 検証対象の生入稿レコード列（`intake_reader` の出力）。
 * @param media 所定フォルダ配下の実体存在を判定する注入ポート。
 * @returns 検出した問題点の列（空なら all-clear）。
 */
export function validateIntake(
  records: readonly QuestionIntakeRecord[],
  media: MediaPresence,
): IntakeIssue[] {
  const issues: IntakeIssue[] = [];
  const seen = new Set<number>();
  for (const r of records) {
    if (
      !Number.isInteger(r.questionNumber) ||
      r.questionNumber < 1 ||
      r.questionNumber > 10
    ) {
      issues.push({
        questionNumber: r.questionNumber,
        field: "question_number",
        reason: "1〜10 の整数のみ",
      });
    }
    if (seen.has(r.questionNumber)) {
      issues.push({
        questionNumber: r.questionNumber,
        field: "question_number",
        reason: "問題番号が重複",
      });
    }
    seen.add(r.questionNumber);
    if (typeof r.text !== "string" || r.text.trim() === "") {
      issues.push({
        questionNumber: r.questionNumber,
        field: "text",
        reason: "問題文は空にできない",
      });
    }
    // 0〜100 整数の一層目防衛。採点モジュールの isAnswerScore を共有し、
    // -1 / 101 / 50.5 を拒否する（サーバ検証・DB CHECK とレンジ規約が一致）。
    if (!isAnswerScore(r.correctValue)) {
      issues.push({
        questionNumber: r.questionNumber,
        field: "correct_value",
        reason: "正解値は 0〜100 の整数のみ",
      });
    }
    // 宣言された（非 null の）メディアパスのみ所定フォルダ配下の実体存在を確認する。
    // 未配置は問題番号を添えて拒否し、a モードの空画面を本番前に排除する。
    if (r.videoPath != null && !media.exists(r.videoPath)) {
      issues.push({
        questionNumber: r.questionNumber,
        field: "video_path",
        reason: "動画が所定フォルダに未配置",
      });
    }
    if (r.imagePath != null && !media.exists(r.imagePath)) {
      issues.push({
        questionNumber: r.questionNumber,
        field: "image_path",
        reason: "画像が所定フォルダに未配置",
      });
    }
  }
  return issues;
}
