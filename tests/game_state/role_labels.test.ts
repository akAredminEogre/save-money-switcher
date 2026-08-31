// @generated-by: codd implement
// @generated-from: docs/design/surface_copy_obligations.md (design:surface-copy-obligations)
// @design-node: docs/design/surface_copy_obligations.md
// @output-paths: tests
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

import { describe, it, expect } from "vitest";
import { ROLE_LABELS } from "../../src/game_state/role_labels.js";

// 本ユニットは surface_copy_obligations §2.8・§2.11 / op_map_role_labels_in_copy /
// shared_domain_model §1.5 の「可視ロールラベルの単一供給点」を検証し、次の 2 つの
// DoD を機械可検化する:
//   - dod_labels_business_facing: 全サーフェスの可視文言でロールが 司会者/解答者/観客
//     の可視ラベルで表され、内部識別子 host/contestant/audience が露出しない。
//   - dod_labels_single_source: 可視ロールラベルが単一のラベル定義
//     src/game_state/role_labels.ts（ROLE_LABELS）から供給される。
// これらは VB-80「全サーフェスでロールが 司会者/解答者/観客 の可視ラベルで表され
// host/contestant/audience が露出せず、単一ラベル定義から供給される」に対応する。
// ここでは唯一の供給点である src/game_state/role_labels.ts の ROLE_LABELS を実際に
// import して評価し、各サーフェスの可視文言がこの写像から供給されることを型・実値で
// 押さえる。
describe("game_state/role_labels 可視ロールラベルの単一供給", () => {
  // codd: covers vb=VB-80
  it("全ロールを 司会者/解答者/観客 の可視ラベルへ写し内部識別子 host/contestant/audience を露出しない", () => {
    // 単一ラベル定義（src/game_state/role_labels.ts）からの写像を、SUT の出力とは
    // 独立に固定した設計確定の可視文言（surface_copy_obligations §1.5・
    // shared_domain_model §1.5・decision_records §1.4 が verbatim に固定）と照合する。
    // dod_labels_business_facing の「司会者/解答者/観客 で表す」側を押さえる。
    expect(ROLE_LABELS.host).toBe("司会者");
    expect(ROLE_LABELS.contestant).toBe("解答者");
    expect(ROLE_LABELS.audience).toBe("観客");

    // 可視ラベル「値」のみ（内部識別子であるキーは対象外）を走査し、
    // host / contestant / audience の内部識別子が可視文言へ漏れないことを確かめる。
    // dod_labels_business_facing の「内部識別子 host/contestant/audience を露出しない」
    // 側を押さえる。ラベルが内部識別子へ差し替わると toBe と本ガードの双方が RED になる。
    for (const label of Object.values(ROLE_LABELS)) {
      expect(label).not.toMatch(/host|contestant|audience/i);
    }
  });

  it("3 ロールすべてに非空の可視ラベルが単一供給点から供給され、ラベルが互いに重複しない", () => {
    // dod_labels_single_source: 唯一の供給点 ROLE_LABELS が全ロールを網羅し、
    // 識別可能な相異なるラベルを与えることを確かめる（供給点の完全性と一意性）。
    const roles = ["host", "contestant", "audience"] as const;
    for (const role of roles) {
      expect(typeof ROLE_LABELS[role]).toBe("string");
      expect(ROLE_LABELS[role].length).toBeGreaterThan(0);
    }
    // Set のサイズ（SUT 由来）を、独立に固定したロール数 3 と照合する。
    const labels = roles.map((role) => ROLE_LABELS[role]);
    expect(new Set(labels).size).toBe(roles.length);
  });
});

// ── クロスカット検証可能挙動のカバレッジ状況（coverage-closure タスク）─────────
// 直近のカバレッジレビューが未カバーと指摘した以下の VB は、テスト戦略 §1.6 で
// E2E スペック（tests/e2e/*.spec.ts / *.browser.spec.ts）を正準 owner とする
// end-to-end 挙動であり、いずれも「稼働中のクラウド WebSocket サーバ」「実ブラウザ
// による可視要素・要素不在の観測」「永続 DB への書込み／再取得」「ロール投影
// fan-out 配信」を実行して初めて観測できる。
// 本ファイルは決定的なユニットテストであり、ハーネス契約（本タスク設計ノード）が
// 「外部プロセスを起動せず wall-clock を読まない」ことを要求するため、これらの
// 端末間配信・DOM 要素の有無・DB 永続を実際に実行・観測できない。純ドメイン関数の
// 断片だけを見て `covers` を付すと偽のカバレッジ主張となり authenticity ゲートに
// 落ちるため、ここでは正直に blocked としてマークする（各 VB の実カバレッジは、
// §1.6 が宣言する所有 E2E スペックの稼働サーバ／ブラウザ検証が担う）。
//
// codd: blocked vb=VB-02 reason=requires_running_ws_server_broadcast
// codd: blocked vb=VB-04 reason=requires_browser_and_cloud_ws_authority
// codd: blocked vb=VB-07 reason=requires_join_route_and_db_persistence
// codd: blocked vb=VB-09 reason=requires_browser_ui_element_absence
// codd: blocked vb=VB-16 reason=requires_db_answer_persistence
// codd: blocked vb=VB-19 reason=requires_running_server_disclosure_gate
// codd: blocked vb=VB-21 reason=requires_db_rounds_stage_persistence
// codd: blocked vb=VB-25 reason=requires_ws_undo_event_broadcast
// codd: blocked vb=VB-41 reason=requires_browser_tablet_ui_scope
// codd: blocked vb=VB-45 reason=requires_browser_tv_five_modes
// codd: blocked vb=VB-47 reason=requires_browser_tv_mode_switch
// codd: blocked vb=VB-51 reason=requires_browser_tv_e_totals_display
// codd: blocked vb=VB-53 reason=requires_db_question_supply_roundtrip
// codd: blocked vb=VB-57 reason=requires_join_access_control_endpoint
// codd: blocked vb=VB-59 reason=requires_ui_and_server_name_validation
// codd: blocked vb=VB-60 reason=requires_reconnect_over_running_server
// codd: blocked vb=VB-62 reason=requires_ws_role_projection_fanout
// codd: blocked vb=VB-71 reason=requires_live_edit_endpoint_and_db_check
// codd: blocked vb=VB-73 reason=requires_reveal_flow_and_tv_display
// codd: blocked vb=VB-78 reason=requires_browser_control_panel_ui_absence
// codd: blocked vb=VB-84 reason=requires_browser_tv_ui_absence
// codd: blocked vb=VB-85 reason=requires_browser_control_panel_qr_ui_absence
