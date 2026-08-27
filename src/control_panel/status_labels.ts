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
 * 制御盤の進行状況を運用語で表す可視ラベルの供給点（surface_copy_obligations §2.2 boundary_cases /
 * §3.1 状態表示の運用語化 / dod_cp_no_internal_leak）。
 *
 * 内部の進行段階識別子（`accepting`／`answers_locked`／`answers_opened`／`answer_revealed`／
 * `settlement_computed`）を、司会者向けの運用語（受付中／締切／解答オープン／正解発表／精算）へ
 * 写す。制御盤の状態表示は必ず本写像を経由し、内部イベント名を可視文言へ出さない（VB-79）。
 * 進行段階の型は `module:game_state` の単一定義 `progression.ts` を真実源として共有し、段階の
 * 二重管理を避ける。
 */

import type { Stage } from "../game_state/progression.js";

/**
 * 内部進行段階から制御盤の運用語ラベルへの写像。全段階を網羅し、いずれのラベルにも内部
 * イベント名を含めない。凍結して実行時にも書き換え不能とする。
 */
export const CONTROL_PANEL_STATUS_LABELS: Readonly<Record<Stage, string>> = Object.freeze({
  accepting: "受付中",
  answers_locked: "締切",
  answers_opened: "解答オープン",
  answer_revealed: "正解発表",
  settlement_computed: "精算",
});

/**
 * 進行段階を制御盤の運用語ラベルへ写す。内部イベント名（`answers_locked` 等）を返さず、
 * 必ず運用語（締切 等）を返す。
 */
export function controlPanelStatusLabel(stage: Stage): string {
  return CONTROL_PANEL_STATUS_LABELS[stage];
}
