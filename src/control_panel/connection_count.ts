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
 * 制御盤の接続把握「◯/◯台」表示の整形点（surface_copy_obligations §2.2 op_render_control_panel_surface
 * expected_outcomes・count_readback_render）。
 *
 * 司会者は当該境界の管理者ゆえ、現在のタブレット接続数と解決済み上限を「◯/◯台」で把握して
 * よい（他面 `/tablet`・`/tv`・`/join` には出さない）。本整形点は接続数と上限の 2 つの整数値
 * のみから「◯/◯台」文字列を作り、設定キー名（`MAX_TABLET_CONNECTIONS` 等）・接続数会計の
 * 内部語を一切露出しない（VB-79 / VB-82 は本値を非 host 面へ出さないことで担保）。上限の解決
 * （環境変数／`config` テーブル）は `src/config/` が所有し、本関数は解決済み値を受け取るのみで
 * 判定経路に数値リテラルを持たない。
 */

/**
 * タブレット接続把握の可視文字列「◯/◯台」を作る。
 *
 * @param connected 現在の解答者（タブレット）接続数（0 以上の整数）。
 * @param max 解決済みのタブレット接続上限（1 以上の整数）。
 * @returns 例: 満席時は `8/8台`、3 台接続・上限 16 なら `3/16台`。
 * @throws {RangeError} 接続数が 0 未満または非整数、上限が 1 未満または非整数の場合。
 */
export function formatTabletConnectionCount(connected: number, max: number): string {
  if (!Number.isInteger(connected) || connected < 0) {
    throw new RangeError("接続台数は 0 以上の整数で指定してください");
  }
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError("上限台数は 1 以上の整数で指定してください");
  }
  return `${connected}/${max}台`;
}
