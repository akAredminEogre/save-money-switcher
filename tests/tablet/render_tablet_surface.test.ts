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

// @output-paths: src, tests
import { describe, it, expect } from "vitest";
import {
  buildTabletSurfaceViewModel,
  collectTabletVisibleText,
  type TabletSurfaceState,
} from "../../src/tablet/tablet_surface_view_model.js";
import { renderTabletSurface } from "../../src/tablet/render_tablet_surface.js";
import { formatYen } from "../../src/scoring/currency.js";
import { ROLE_LABELS } from "../../src/game_state/role_labels.js";

// 本スイートは surface_copy_obligations §2.3 / op_render_tablet_surface の入力専用最小面を
// 検証する。SUT（buildTabletSurfaceViewModel / renderTabletSurface）を実行し、投影済み表示
// モデルと描画 HTML の観測結果に対して独立に固定した期待値を照合する。

const acceptingState: TabletSurfaceState = {
  questionNumber: 3,
  answerValue: 42,
  submitted: false,
  ownBalanceYen: 9_500,
  status: "accepting",
};

const lockedSubmittedState: TabletSurfaceState = {
  questionNumber: 7,
  answerValue: 100,
  submitted: true,
  ownBalanceYen: -500, // 残額は下限を持たず負値も円建てで描画される（F-01）
  status: "locked",
};

/** 描画 HTML から指定属性の値集合を抽出する（可視文言走査ではなく構造抽出）。 */
function attrValues(html: string, attr: string): string[] {
  const re = new RegExp(`${attr}="([^"]*)"`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

describe("tablet/表示モデル 入力専用最小面の投影", () => {
  it("自分の残額を formatYen 経由の円建て文言で表示する", () => {
    const vm = buildTabletSurfaceViewModel(acceptingState);
    // 独立に固定した期待文言（円建て・千位区切り・点化なし）と照合。
    expect(vm.ownBalanceText).toBe("あなたの残額 9,500円");
    // 単一整形点 formatYen を経由していること（producer への束縛）。
    expect(vm.ownBalanceText).toContain(formatYen(9_500));
  });

  it("負の残額も円建てで整形し下限で切り上げない", () => {
    const vm = buildTabletSurfaceViewModel(lockedSubmittedState);
    expect(vm.ownBalanceText).toBe("あなたの残額 -500円");
  });

  it("受付中/締切を運用語で表し数値入力は 4 ボタン方式で供給される", () => {
    expect(buildTabletSurfaceViewModel(acceptingState).statusLabel).toBe("受付中");
    const locked = buildTabletSurfaceViewModel(lockedSubmittedState);
    expect(locked.statusLabel).toBe("締切");
    // −10/−1/+1/+10 の 4 ボタン（テンキー直接入力ではない）。
    const vm = buildTabletSurfaceViewModel(acceptingState);
    expect(vm.stepperButtons.map((b) => b.delta)).toEqual([-10, -1, 1, 10]);
    expect(vm.stepperButtons.map((b) => b.label)).toEqual(["−10", "−1", "+1", "+10"]);
  });

  it("表示数値は 0〜100 にクランプされ 100 超・0 未満へ振り切れない", () => {
    const high = buildTabletSurfaceViewModel({ ...acceptingState, answerValue: 150 }).answerValue;
    expect(high).toBeLessThanOrEqual(100);
    expect(high).toBeGreaterThanOrEqual(0);
    const low = buildTabletSurfaceViewModel({ ...acceptingState, answerValue: -5 }).answerValue;
    expect(low).toBeGreaterThanOrEqual(0);
    expect(low).toBeLessThanOrEqual(100);
  });

  it("締切時は数値入力ボタンが無効化される", () => {
    const vm = buildTabletSurfaceViewModel(lockedSubmittedState);
    expect(vm.inputLocked).toBe(true);
    expect(vm.stepperButtons.every((b) => b.disabled)).toBe(true);
    const accepting = buildTabletSurfaceViewModel(acceptingState);
    expect(accepting.stepperButtons.every((b) => b.disabled)).toBe(false);
  });
});

describe("tablet/描画 入力専用最小面と禁止要素の不在", () => {
  it("送信前は送信ボタンが可能で、送信後に送信済みが表示される", () => {
    const before = renderTabletSurface(acceptingState);
    expect(before).toContain(">送信</button>");
    expect(before).not.toContain("送信済み");
    const after = renderTabletSurface({ ...acceptingState, submitted: true });
    expect(after).toContain("送信済み");
  });

  it("締切時は送信ボタンが無効化される", () => {
    const html = renderTabletSurface({ ...acceptingState, status: "locked" });
    expect(html).toMatch(/data-op="submit"[^>]*disabled/);
  });

  it("面のアクセシブルラベルが単一定義 ROLE_LABELS の解答者ラベルで供給される", () => {
    const html = renderTabletSurface(acceptingState);
    const labels = attrValues(html, "aria-label");
    expect(labels).toContain(ROLE_LABELS.answerer); // 「解答者」
    expect(labels).not.toContain("answerer");
  });

  // codd: covers vb=VB-24
  it("タブレット面に締切・開示・正解発表・精算・モード切替・取消の操作要素が存在しない", () => {
    const ops = attrValues(renderTabletSurface(acceptingState), "data-op");
    // 解答者面の操作要素は数値ステッパ(step)と送信(submit)のみ。
    expect(new Set(ops)).toEqual(new Set(["step", "submit"]));
    // 司会者操作(lock/open/reveal/settle/switch/mode/undo)の操作要素が無い。
    for (const hostOp of ["lock", "open", "reveal", "settle", "switch", "mode", "undo"]) {
      expect(ops).not.toContain(hostOp);
    }
  });

  // codd: covers vb=VB-44
  it("タブレット面に他者の氏名/解答/残額/得点・出題本文・全体一覧が表示されない", () => {
    const fields = attrValues(renderTabletSurface(acceptingState), "data-field");
    // 可視データは自分の情報（受付状態/問題番号/自分の数値入力/送信済み/自分の残額）に限る。
    const allowedOwnFields = new Set([
      "status",
      "question-number",
      "answer-value",
      "submitted",
      "own-balance",
    ]);
    for (const field of fields) {
      expect(allowedOwnFields.has(field)).toBe(true);
    }
    // 他者情報・出題本文・全体一覧を表すデータ面が無い。
    for (const forbidden of ["others", "roster", "question-body", "leaderboard", "all-players"]) {
      expect(fields).not.toContain(forbidden);
    }
  });
});

describe("tablet/文言 解答者向けコピーと内部語の不在", () => {
  // codd: covers vb=VB-79
  it("可視文言に内部ロール識別子・内部イベント名・設定キー名・デモ/テスト表記が存在しない", () => {
    const vm = buildTabletSurfaceViewModel(lockedSubmittedState);
    const visible = collectTabletVisibleText(vm);
    const joined = visible.join("\n");
    // 内部ロール識別子。
    expect(joined).not.toMatch(/host|answerer|audience/i);
    // 内部イベント名。
    expect(joined).not.toMatch(
      /accepting|answers_locked|answers_opened|answer_revealed|settlement_computed|tv_mode/i,
    );
    // 設定キー名。
    expect(joined).not.toMatch(/MAX_TABLET_CONNECTIONS|JOIN_ACCESS_TOKEN|PUBLIC_BASE_URL/);
    // デモ/テスト/サンプル表記。
    expect(joined).not.toMatch(/デモ|テスト|サンプル|demo|sample/i);
    // 点化文言（金額は円建て固定）。
    expect(joined).not.toMatch(/point|pt|点/i);
    // 走査対象が空でなく解答者向けの運用語が実際に供給されていること。
    expect(visible).toContain("解答者");
    expect(visible).toContain("締切");
    expect(visible).toContain("送信済み");
    expect(visible).toContain("あなたの残額 -500円");
  });
});
