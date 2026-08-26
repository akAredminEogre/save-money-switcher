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
import {
  buildControlPanelView,
  renderControlPanelHtml,
  controlPanelStatusLabel,
  formatTabletConnectionCount,
  type ControlPanelView,
} from "../../src/control_panel/index.js";
import { ROLE_LABELS } from "../../src/game_state/role_labels.js";
import type { Participant } from "../../src/participants/participant.js";

// 本スイートは surface_copy_obligations §2.2 / op_render_control_panel_surface の
// 制御盤サーフェス描画契約を、実際のビュー構築器・HTML 描画器の出力に対して検証する。
// 制御盤は host 面ゆえ、可視要素は §2.7 の全司会者トリガー・参加者一覧（自己入力氏名）・
// 接続把握・参加 QR に限り、解答者数値入力送信面を持たず、内部識別子/イベント名/設定
// キー名/point/pt/点/デモ表記を可視文言へ出さない。

const participants: readonly Participant[] = [
  { id: "p1", name: "たろう", joinedAt: "2026-08-16T00:00:00.000Z", connectionId: "c1" },
  { id: "p2", name: "はなこ", joinedAt: "2026-08-16T00:01:00.000Z", connectionId: "c2" },
];

function makeView(): ControlPanelView {
  return buildControlPanelView({
    stage: "accepting",
    participants,
    connectedTablets: 2,
    maxTabletConnections: 8,
    joinUrl: "https://save-money.example.com/join?t=secret",
    joinQrSvg: '<svg data-qr-code="1"><rect/></svg>',
  });
}

/** 描画 HTML から `data-region` 単一領域の内側だけを取り出す（走査対象をスコープする）。 */
function extractRegion(html: string, region: string): string {
  const re = new RegExp(`<section[^>]*data-region="${region}"[^>]*>([\\s\\S]*?)</section>`);
  const m = html.match(re);
  if (m === null) throw new Error(`領域が見つかりません: ${region}`);
  return m[1];
}

describe("control_panel サーフェス描画（op_render_control_panel_surface）", () => {
  // codd: covers vb=VB-77
  it("§2.7 の全司会者トリガーが司会者向け操作語で存在し、各モード個別ジャンプ a〜e を備える", () => {
    const view = makeView();
    // 設計 §2.7 / dod_cp_visible_host_triggers が verbatim に固定した可視操作語（SUT の
    // 出力とは独立に列挙）と、ビューが供給するトリガーラベル集合を照合する。
    const labels = new Set(view.triggers.map((t) => t.label));
    const expectedLabels = [
      "問題を読み込む",
      "そこまで",
      "解答オープン！",
      "正解発表",
      "精算",
      "次へ",
      "戻る",
      "取消",
      "問題・正解を編集",
    ];
    for (const expected of expectedLabels) {
      expect(labels.has(expected)).toBe(true);
    }
    // 各モードへの個別ジャンプが a〜e の順で 5 系統存在する。
    expect(view.modeJumpTriggers.map((t) => t.mode)).toEqual(["a", "b", "c", "d", "e"]);
    // 描画 HTML にも各トリガーの可視操作語が現れる。
    const rendered = renderControlPanelHtml(view);
    for (const expected of expectedLabels) {
      expect(rendered).toContain(expected);
    }
  });

  // codd: covers vb=VB-78
  it("制御盤に解答者用の数値入力送信面(+1/-1/+10/-10 と送信)が存在しない", () => {
    const view = makeView();
    const html = renderControlPanelHtml(view);
    // 描画されるコマンド要素はすべて司会者トリガーのいずれかであり、解答送信面のコマンド
    // （submit_answer）や数値ステッパは含まれない。
    const hostCommands = new Set([
      "load_questions",
      "lock_answers",
      "open_answers",
      "reveal_answer",
      "compute_settlement",
      "mode_next",
      "mode_back",
      "edit_question",
      "undo",
      "mode_jump",
    ]);
    const emittedCommands = [...html.matchAll(/data-command="([^"]+)"/g)].map((m) => m[1]);
    expect(emittedCommands.length).toBeGreaterThan(0);
    for (const command of emittedCommands) {
      expect(hostCommands.has(command)).toBe(true);
    }
    expect(emittedCommands).not.toContain("submit_answer");
    // 可視ボタンラベルに数値ステッパ・送信の操作語が現れない。
    const buttonLabels = [
      ...view.triggers.map((t) => t.label),
      ...view.modeJumpTriggers.map((t) => t.label),
    ];
    for (const stepperLabel of ["+1", "-1", "−1", "+10", "-10", "−10", "送信"]) {
      expect(buttonLabels).not.toContain(stepperLabel);
    }
  });

  // codd: covers vb=VB-06
  it("制御盤に参加用クラウドURLを符号化した QR が可視要素として表示される", () => {
    const view = makeView();
    // ビューは QR の符号化元 URL と解決済み SVG を保持する。
    expect(view.joinQr.joinUrl).toBe("https://save-money.example.com/join?t=secret");
    expect(view.joinQr.svg).toContain("<svg");
    // 描画 HTML の QR 提示領域に、SVG（可視要素）と符号化元の /join URL が現れる。
    const html = renderControlPanelHtml(view);
    const qrRegion = extractRegion(html, "join-qr");
    expect(qrRegion).toContain("<svg");
    expect(qrRegion).toContain("https://save-money.example.com/join?t=secret");
  });

  // codd: covers vb=VB-08
  it("参加確定が制御盤の参加者一覧に自己入力氏名で反映される", () => {
    const view = makeView();
    // 自己入力氏名が参加者一覧へそのまま反映される（端末番号・座席の付与をしない）。
    expect(view.roster.map((r) => r.displayName)).toEqual(["たろう", "はなこ"]);
    const html = renderControlPanelHtml(view);
    const rosterRegion = extractRegion(html, "roster");
    expect(rosterRegion).toContain("たろう");
    expect(rosterRegion).toContain("はなこ");
    // 参加者一覧領域には氏名台帳・端末番号割当の入力要素を置かない（自己入力氏名の反映のみ）。
    expect(rosterRegion).not.toContain("<input");
    expect(rosterRegion).not.toContain("<select");
  });

  // codd: covers vb=VB-79
  it("制御盤の可視文言に内部ロール識別子/内部イベント名/設定キー名/point/pt/点/デモ・テスト表記が存在しない", () => {
    const view = makeView();
    // 監査対象は「アプリが著した可視コピー」に限る（参加者の自己入力氏名・URL 値は対象外）。
    const appCopy = [
      view.roleLabel,
      view.title,
      view.statusHeading,
      view.statusLabel,
      view.modeJumpHeading,
      view.rosterHeading,
      view.connectionCountHeading,
      view.connectionCount,
      view.joinQr.heading,
      view.joinQr.caption,
      ...view.triggers.map((t) => t.label),
      ...view.modeJumpTriggers.map((t) => t.label),
    ];
    const forbidden: readonly RegExp[] = [
      /\bhost\b/i,
      /\banswerer\b/i,
      /\baudience\b/i,
      /accepting|answers_locked|answers_opened|answer_revealed|settlement_computed|tv_mode_changed/,
      /MAX_TABLET_CONNECTIONS|JOIN_ACCESS_TOKEN|PUBLIC_BASE_URL/,
      /point|pt|点/i,
      /demo|sample|サンプル|デモ|テスト/i,
    ];
    for (const text of appCopy) {
      for (const pattern of forbidden) {
        expect(text).not.toMatch(pattern);
      }
    }
  });

  it("ロール表記を可視ラベル 司会者 で表し内部識別子 host を露出しない", () => {
    const view = makeView();
    // ロール表記は単一定義（ROLE_LABELS）から供給され、内部識別子 host を出さない。
    expect(view.roleLabel).toBe("司会者");
    expect(view.roleLabel).toBe(ROLE_LABELS.host);
    expect(view.roleLabel).not.toBe("host");
  });

  it("接続把握を「◯/◯台」で表示し満席時に n/n台となる（設定キー名を露出しない）", () => {
    // 現接続数と解決済み上限の 2 値のみから整形し、設定キー名を出さない。
    expect(formatTabletConnectionCount(2, 8)).toBe("2/8台");
    expect(formatTabletConnectionCount(8, 8)).toBe("8/8台");
    expect(formatTabletConnectionCount(3, 16)).not.toMatch(/MAX_TABLET_CONNECTIONS/);
    const view = buildControlPanelView({
      stage: "accepting",
      participants,
      connectedTablets: 8,
      maxTabletConnections: 8,
      joinUrl: "https://save-money.example.com/join",
      joinQrSvg: "<svg></svg>",
    });
    expect(view.connectionCount).toBe("8/8台");
  });

  it("進行状況を運用語で表示し内部イベント名を出さない", () => {
    // 内部段階識別子を運用語へ写し、生の内部イベント名を返さない。
    expect(controlPanelStatusLabel("accepting")).toBe("受付中");
    expect(controlPanelStatusLabel("answers_locked")).toBe("締切");
    expect(controlPanelStatusLabel("answers_opened")).toBe("解答オープン");
    expect(controlPanelStatusLabel("answer_revealed")).toBe("正解発表");
    expect(controlPanelStatusLabel("settlement_computed")).toBe("精算");
    expect(controlPanelStatusLabel("answers_locked")).not.toBe("answers_locked");
  });
});
