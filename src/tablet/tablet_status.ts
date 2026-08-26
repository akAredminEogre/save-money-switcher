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
 * タブレット面の受付状態ラベル（`module:tablet`・surface_copy_obligations §2.3 /
 * op_render_tablet_surface / §3.1 状態表示の運用語化）。
 *
 * 解答者面は「入力を受け付けている（受付中）」「締め切られた（締切）」の 2 状態のみを
 * 可視化する。ここで供給する語は **運用語**（受付中／締切）であり、内部イベント名
 * （accepting / answers_locked 等）を可視文言へ露出させない（dod_tablet_answerer_copy_only /
 * VB-79）。タブレットは入力専用最小面ゆえ、状態は入力可否の 2 値に限り、開示・正解発表・
 * 精算といった他段階を解答者へ出さない（他段階は TV／制御盤の役割）。
 *
 * 本モジュールはタブレット面に閉じた最小の状態写像のみを供給し、他モジュールへ依存しない
 * リーフである。段階全体（accepting〜settlement_computed）の運用語写像は別サーフェスの
 * 責務であり、ここではタブレットが必要とする 2 値のみを持つ。
 */

/**
 * 解答者タブレットが区別する入力受付状態。
 *
 * `accepting`（受付中・送信可）／`locked`（締切・送信不可）の 2 値のみ。値そのものは内部
 * キーであり可視文言には現れない（可視化は必ず {@link TABLET_STATUS_LABELS} を経由する）。
 */
export type TabletInputStatus = "accepting" | "locked";

/**
 * 入力受付状態から解答者向け可視ラベルへの写像（accepting→受付中 / locked→締切）。
 *
 * どのラベル値にも内部イベント名を含めない。凍結して実行時にも書き換え不能とする。
 */
export const TABLET_STATUS_LABELS: Readonly<Record<TabletInputStatus, string>> = Object.freeze({
  accepting: "受付中",
  locked: "締切",
});

/** 入力受付状態を解答者向け可視ラベル（受付中／締切）へ写す。 */
export function tabletStatusLabel(status: TabletInputStatus): string {
  return TABLET_STATUS_LABELS[status];
}

/** 締切（入力ロック）状態であるか。締切時は数値入力・送信を不可とする。 */
export function isInputLocked(status: TabletInputStatus): boolean {
  return status === "locked";
}
