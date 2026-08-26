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
 * TV（観客向け受動表示）サーフェスの公開面（`module:tv_display`）。
 *
 * 5 モード分岐描画（`renderTvSurface`）と各モード描画（a〜e）、および描画可能ビューモデル
 * 型を単一入口で再輸出する。消費側（TV 面）はここから描画関数とビューモデル型を参照する。
 */

export {
  renderTvSurface,
  serializeTvSurface,
  collectVisibleText,
  MissingTvSurfaceDataError,
} from "./render_tv_surface.js";
export type { TvSurfaceRequest } from "./render_tv_surface.js";

export { renderTvModeA, renderQuestionFace } from "./render_question_face.js";
export { renderTvModeB, renderDisclosure } from "./render_disclosure.js";
export type { DisclosureInput, DisclosureAnswer } from "./render_disclosure.js";
export { renderTvModeC, renderCorrectValue } from "./render_correct_value.js";
export type { CorrectValueInput } from "./render_correct_value.js";
export {
  renderTvModeD,
  renderSettlementTable,
  SETTLEMENT_TABLE_HEADERS,
} from "./render_settlement_table.js";
export type { SettlementTableEntry } from "./render_settlement_table.js";
export { renderTvModeE, renderTotals } from "./render_totals.js";
export type { TotalsInput } from "./render_totals.js";

export type {
  TvSurfaceMode,
  TvSurfaceViewModel,
  QuestionFaceViewModel,
  DisclosureEntry,
  DisclosureViewModel,
  CorrectValueViewModel,
  SettlementRowViewModel,
  SettlementTableViewModel,
  TotalsRowViewModel,
  TotalsViewModel,
} from "./tv_surface_view.js";
