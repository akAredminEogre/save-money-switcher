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
 * 制御盤サーフェス（`module:control_panel`）の公開面（surface_copy_obligations §2.2 /
 * op_render_control_panel_surface）。ビューモデル構築・HTML 描画・トリガー定義・状態運用語・
 * 接続把握整形を単一の入口から輸出する。
 */

export {
  buildControlPanelView,
  type ControlPanelView,
  type ControlPanelInput,
  type RosterEntryView,
  type JoinQrView,
} from "./control_panel_view.js";
export { renderControlPanelHtml } from "./render_control_panel.js";
export {
  HOST_TRIGGERS,
  MODE_JUMP_TRIGGERS,
  type HostTriggerView,
  type ModeJumpTriggerView,
  type HostCommand,
  type TvModeLetter,
} from "./host_triggers.js";
export { controlPanelStatusLabel, CONTROL_PANEL_STATUS_LABELS } from "./status_labels.js";
export { formatTabletConnectionCount } from "./connection_count.js";
