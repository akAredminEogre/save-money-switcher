// @generated-by: codd implement
// @generated-from: docs/design/question_media_intake_design.md (design:question-media-intake-design)
// @design-node: docs/design/question_media_intake_design.md
// @output-paths: src, tests
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import type { Question } from "../questions/question.js";

/**
 * TV a モード（出題面）の解決種別（`module:media`・QM-2 / N-2）。
 *
 * 出題面は「動画 →（無ければ）画像 →（無ければ）テキスト」の 3 段で解決され、
 * どの段で解決したかをこの判別子が表す。取り得る値はこの 3 種に閉じる。
 */
export type QuestionFaceKind = "video" | "image" | "text";

/**
 * 解決済みの出題面（TV a モードが描画する対象）。
 *
 * `kind` が解決段（video/image/text）、`source` はその段の描画元である:
 * video/image は所定フォルダ（QUESTION_MEDIA_ROOT）配下の相対パス、text は問題文
 * 本文そのもの。配信 URL 構築・描画は消費側（TV a モード）が `kind` に応じて行い、
 * 生パス文字列やどの段で解決したか等の内部語を可視コピーへ露出しない（§1.4・§2.4）。
 */
export interface QuestionFace {
  kind: QuestionFaceKind;
  source: string;
}

/**
 * 問題の 3 フィールドのみから TV a モードの出題面を解決する純関数（QM-2・N-2）。
 *
 * 解決順は **動画 →（無ければ）画像 →（無ければ）テキスト** を厳守し、順序入替・
 * 段飛ばしを行わない。`videoPath` が非 null なら動画（画像の有無に関わらず動画優先）、
 * そうでなく `imagePath` が非 null なら画像、双方 null ならテキストへフォールバックする。
 *
 * 判定は `questions` の 3 フィールド（`videoPath` / `imagePath` / `text`）だけで決まり、
 * 外部状態・ファイル I/O・ネットワークに一切依存しない O(1) の純関数である（§2.10）。
 * メディアパスのライブ編集（§2.5）で `videoPath` / `imagePath` を付与・除去すると、
 * 次の a モード描画は本関数を通じて規定順へ追随する（dod_edit_media_face_follows）。
 */
export function resolveQuestionFace(question: Question): QuestionFace {
  // 第1段: 動画優先。画像の有無に関わらず、動画パスがあれば動画で解決する。
  if (question.videoPath !== null) {
    return { kind: "video", source: question.videoPath };
  }
  // 第2段: 動画が無ければ画像へフォールバックする。
  if (question.imagePath !== null) {
    return { kind: "image", source: question.imagePath };
  }
  // 第3段: 動画・画像とも無ければテキストへフォールバックする。
  return { kind: "text", source: question.text };
}
