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
 * TV c モード ── 正解値の描画（`module:tv_display`・surface_copy_obligations §2.4c /
 * op_render_tv_surface / VB-55 / VB-73）。
 *
 * 当該問の正解値（0〜100 整数）を観客向けに提示する。MVP の正解発表は開示一覧＋正解値＋
 * 得点増減の表示で成立し、効果音・カウントダウン・アニメ・ランキング演出を要求しない。
 * 見出しは司会者操作語（「正解発表」等のトリガー語）を避けた観客向け文言に限る。
 */

import type { CorrectValueViewModel } from "./tv_surface_view.js";

/** c モード描画の入力（当該問の正解値）。 */
export interface CorrectValueInput {
  readonly correctValue: number;
}

/** 当該問の正解値を提示する。正解値は number のまま保持し、String 化は表示層で行う。 */
export function renderTvModeC(input: CorrectValueInput): CorrectValueViewModel {
  return { mode: "c", heading: "正解", correctValue: input.correctValue };
}

/** 記述的別名（`renderTvModeC` と同一）。 */
export const renderCorrectValue = renderTvModeC;
