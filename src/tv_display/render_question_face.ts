// @generated-by: codd implement
// @generated-from: docs/design/surface_copy_obligations.md (design:surface-copy-obligations)
// @design-node: docs/design/surface_copy_obligations.md
// @output-paths: src, tests
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @generated-from: docs/design/operational_behavior_model.md (design:operational-behavior-model)
// @generated-from: docs/design/participation_connection_design.md (design:participation-connection-design)
// @generated-from: docs/design/question_media_intake_design.md (design:question-media-intake-design)
// @generated-from: docs/design/realtime_sync_design.md (design:realtime-sync-design)
// @generated-from: docs/design/scoring_engine_design.md (design:scoring-engine-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

/**
 * TV a モード ── 出題面の描画（`module:tv_display`・surface_copy_obligations §2.4a /
 * op_render_tv_surface / dod_tv_no_path_or_internal_leak / VB-48 / VB-49 / VB-83）。
 *
 * 出題面の優先順位解決（動画 →（無ければ）画像 →（無ければ）テキスト）は純関数
 * {@link resolveQuestionFace} へ委譲し、その解決済み値のみを描画する。動画・画像は配信 URL
 * を、テキストは問題文を可視値として持ち、生ファイルパス文字列や `fallback` 等の内部語を
 * 一切露出しない（dod_tv_no_path_or_internal_leak）。見出しは観客向けの問題番号表示に限る。
 */

import { resolveQuestionFace } from "../questions/resolve_question_face.js";
import type { Question } from "../questions/question.js";
import type { QuestionFaceViewModel } from "./tv_surface_view.js";

/** a モードの出題面を、解決済み（動画/画像/テキスト）値のみで描画する。 */
export function renderTvModeA(question: Question): QuestionFaceViewModel {
  const face = resolveQuestionFace(question);
  const heading = `第${question.questionNumber}問`;
  if (face.kind === "video") {
    return { mode: "a", heading, media: { kind: "video", mediaUrl: face.mediaUrl } };
  }
  if (face.kind === "image") {
    return { mode: "a", heading, media: { kind: "image", mediaUrl: face.mediaUrl } };
  }
  return { mode: "a", heading, media: { kind: "text", text: face.text } };
}

/** 記述的別名（`renderTvModeA` と同一）。 */
export const renderQuestionFace = renderTvModeA;
