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

import { describe, it, expect } from "vitest";
import { renderJoinSurface } from "../../src/participants/join_surface.js";
import { ROLE_LABELS } from "../../src/game_state/role_labels.js";
import { MAX_DISPLAY_NAME_LENGTH } from "../../src/participants/name.js";

// 本ユニットは surface_copy_obligations §2.6 / op_render_join_surface の描画義務を、単一の純粋
// レンダラ renderJoinSurface を実際に実行し、その返すビューモデルの各フィールドへスコープして
// 検証する。設計が固定した可視文言（「参加する」「ただいま満席のため参加できません」）は SUT の
// 出力とは独立に固定したリテラルと照合し、方式・設定キー・接続数会計・内部識別子の非露出は
// 当該面の可視文言フィールドに限定して走査する。
describe("participants/join_surface /join サーフェス描画（SCO §2.6・op_render_join_surface）", () => {
  // codd: covers vb=VB-81
  it("許可済・非満席の /join に氏名入力欄と「参加する」を表示し、事前氏名台帳・端末番号割当の入力を持たない", () => {
    const vm = renderJoinSurface({
      accessGranted: true,
      loginRedirectRequired: false,
      atCapacity: false,
    });
    expect(vm.kind).toBe("form");
    if (vm.kind !== "form") throw new Error("form を期待");

    // 入力欄は氏名の自己入力（自由記述テキスト）ただ 1 つ。端末番号割当・事前氏名台帳の
    // 選択欄が存在しないことを、入力欄の用途一覧そのもので押さえる。
    expect(vm.fields.map((f) => f.purpose)).toEqual(["display_name"]);
    expect(vm.fields[0]?.control).toBe("text");
    // UI の氏名長上限がサーバ検証と同じ単一定義から反映されている（迂回不能な二重防衛の一致）。
    expect(vm.fields[0]?.maxLength).toBe(MAX_DISPLAY_NAME_LENGTH);

    // 必須の可視コピー（設計が固定した表面形を独立なリテラルで照合）。
    expect(vm.prompt).toBe("お名前を入力してください");
    expect(vm.submitLabel).toBe("参加する");
  });

  // codd: covers vb=VB-82
  it("満席時の /join に平易文を表示し、設定キー名・接続数会計・内部ロール識別子・点化文言を露出しない", () => {
    const vm = renderJoinSurface({
      accessGranted: true,
      loginRedirectRequired: false,
      atCapacity: true,
    });
    expect(vm.kind).toBe("full");
    if (vm.kind !== "full") throw new Error("full を期待");

    // job-to-be-done 平易文（設計が固定した表面形）。
    expect(vm.message).toBe("ただいま満席のため参加できません");
    // 満席の告知面には氏名入力フォームを出さない。
    expect("fields" in vm).toBe(false);

    // 満席メッセージに限定して禁止露出を走査する。
    expect(vm.message).not.toMatch(/MAX_TABLET_CONNECTIONS|JOIN_ACCESS_TOKEN|PUBLIC_BASE_URL/);
    expect(vm.message).not.toMatch(/\d+\s*\/\s*\d+/); // 接続数会計（◯/◯台）
    expect(vm.message).not.toMatch(/host|answerer|audience/i); // 内部ロール識別子
    expect(vm.message).not.toMatch(/point|pt|点/i);
  });

  // codd: covers vb=VB-58
  it("未認証・未参加の /join に保護ナビ（制御盤操作）を露出せず、分岐B 未認証はログインへ誘導し、アクセス拒否は方式を露出しない平易文を出す", () => {
    const controlOps = /\/control-panel|そこまで|解答オープン|正解発表|精算|取消|問題を読み込む/;

    // 分岐B 未認証 → ログインへ誘導（保護ナビへは誘導しない）。
    const login = renderJoinSurface({
      accessGranted: false,
      loginRedirectRequired: true,
      atCapacity: false,
    });
    expect(login.kind).toBe("login_required");
    if (login.kind !== "login_required") throw new Error("login_required を期待");
    expect(login.login?.path).toBe("/login");
    expect(login.login?.path).not.toBe("/control-panel");
    const loginCopy = [login.message, login.login?.label ?? "", login.login?.path ?? ""].join(" ");
    expect(loginCopy).not.toMatch(controlOps);

    // 分岐A 不一致 / 未構成 → アクセス制御方式（トークン/認証）を露出しない平易文。
    const denied = renderJoinSurface({
      accessGranted: false,
      loginRedirectRequired: false,
      atCapacity: false,
    });
    expect(denied.kind).toBe("access_denied");
    if (denied.kind !== "access_denied") throw new Error("access_denied を期待");
    expect(denied.message.length).toBeGreaterThan(0);
    expect(denied.message).not.toMatch(/トークン|token|認証|JOIN_ACCESS_TOKEN|MAX_TABLET_CONNECTIONS/i);
    expect(denied.message).not.toMatch(controlOps);
    expect("login" in denied).toBe(false); // 拒否面はログイン方式も露出しない

    // 未参加（許可済・氏名入力前）の到達点にも制御盤の保護ナビが無い。
    const form = renderJoinSurface({
      accessGranted: true,
      loginRedirectRequired: false,
      atCapacity: false,
    });
    if (form.kind !== "form") throw new Error("form を期待");
    const formCopy = [form.heading, form.prompt, form.submitLabel].join(" ");
    expect(formCopy).not.toMatch(controlOps);
  });

  it("参加フォームの見出しが単一ラベル定義（ROLE_LABELS）の可視ラベルを用い、内部ロール識別子を露出しない", () => {
    const vm = renderJoinSurface({
      accessGranted: true,
      loginRedirectRequired: false,
      atCapacity: false,
    });
    if (vm.kind !== "form") throw new Error("form を期待");
    // 可視ロールラベルは単一供給点から供給される（解答者ラベルを含む）。
    expect(vm.heading).toContain(ROLE_LABELS.answerer);
    // 内部識別子 host/answerer/audience は可視文言へ出さない。
    expect(vm.heading).not.toMatch(/host|answerer|audience/i);
  });
});
