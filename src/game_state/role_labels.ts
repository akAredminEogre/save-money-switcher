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
 * ロールの可視ラベルの単一供給点（`module:game_state`・surface_copy_obligations §2.8 /
 * op_map_role_labels_in_copy / shared_domain_model §1.5）。
 *
 * 内部ロール識別子（host / contestant / audience）を、全サーフェス（制御盤・タブレット・
 * TV・参加受付）が共有する可視ラベル（司会者 / 解答者 / 観客）へ写す唯一の定義点である。
 * 可視コピーは必ず本写像から供給し、内部識別子（host/contestant/audience）をユーザー可視
 * 文言へ露出させない（VB-79 / VB-80）。各サーフェスでラベルを個別に綴らず本モジュールを
 * 単一の出典とすることで、表記揺れと内部識別子の漏洩を排除する（dod_labels_single_source /
 * dod_labels_business_facing）。
 *
 * 公開面として {@link Role} 型と {@link ROLE_LABELS} 写像の双方を輸出し、消費側サーフェス
 * （control_panel / tv_display / contestant_tablets / join_page）はこの単一定義から型・可視
 * ラベルをともに参照する。ラベル値には内部識別子（host/contestant/audience）を一切含めない。
 * 本モジュールは純粋な定数写像のみを供給し、他モジュールへ依存しない（import を持たない
 * リーフ）。
 */

/**
 * ロールの内部識別子（アクセス制御・配信のロール投影に用いる snake_case 値集合）を表す
 * 公開ユニオン型。
 *
 * 可視ラベルへの写像 {@link ROLE_LABELS} のキー集合を型で固定し、この 3 値以外のロールを
 * 可視ラベルへ写せないことをコンパイル時に保証する。値そのものは内部識別子であり、可視
 * コピーには一切現れない（可視化は必ず {@link ROLE_LABELS} を経由する）。
 */
export type Role = "host" | "contestant" | "audience";

/**
 * 内部ロール識別子から可視ラベルへの写像（host→司会者 / contestant→解答者 / audience→観客）。
 *
 * 全サーフェスの可視コピーはここから供給し、`host` / `contestant` / `audience` の内部識別子を
 * ユーザー可視文言へ出さない。どのラベル値にも内部識別子を含めない。凍結して実行時にも
 * 書き換え不能とする。
 */
export const ROLE_LABELS: Readonly<Record<Role, string>> = Object.freeze({
  host: "司会者",
  contestant: "解答者",
  audience: "観客",
});
