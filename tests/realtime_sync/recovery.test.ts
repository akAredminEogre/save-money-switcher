// @generated-by: codd implement
// @generated-from: docs/design/realtime_sync_design.md (design:realtime-sync-design)
// @design-node: docs/design/realtime_sync_design.md
// @output-paths: src, tests
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { describe, it, expect } from "vitest";
import {
  buildSnapshot,
  type GameStateAuthority,
  type RecoveryAuthorityData,
} from "../../src/realtime_sync/recovery.js";

// buildSnapshot は再接続端末の state_snapshot をサーバ権威（game_state/balances/answers）から
// 再構成する単一関数であり、ロール投影を自ら適用する（設計 §2.7）。本スイートは実際に
// buildSnapshot を実行し、その戻り値に対して、解答者が現在問題番号・進行段階・TV モード・
// 自分の残額・送信済みへサーバ権威から復帰し、他者（p2）の残額・送信済みが一切漏れないことを証す。
describe("realtime_sync/recovery 再接続時のサーバ権威からの状態復帰", () => {
  const gameState: GameStateAuthority = {
    currentQuestionNumber: 3,
    stage: "answers_locked",
    tvMode: "a",
  };
  const authority: RecoveryAuthorityData = {
    balances: { p1: 9500, p2: 10000 },
    submitted: { p1: true },
  };

  // codd: covers vb=VB-05
  it("解答者はサーバ権威の進行状態と自分の残額・送信済みへ復帰し他者情報は復帰対象外", () => {
    const snap = buildSnapshot(
      gameState,
      { role: "contestant", participantId: "p1", disclosed: false },
      authority,
    );

    // 進行状態はサーバ権威 game_state から復帰する（期待値は入力とは独立の literal で照合）。
    expect(snap.currentQuestionNumber).toBe(3);
    expect(snap.stage).toBe("answers_locked");
    expect(snap.tvMode).toBe("a");

    // 自分（p1）の残額のみが balances から復帰する（他者 p2 の 10000 ではない）。
    expect(snap.ownBalance).toBe(9500);
    // 受付中に送信済みだった状態が answers 由来で送信済み表示へ復帰する。
    expect(snap.ownSubmitted).toBe(true);

    // 他者情報の構造的除外：全員分の残額マップ・送信済みマップ・参加者一覧を持たない。
    expect(snap.balances).toBeUndefined();
    expect(snap.submitted).toBeUndefined();
    expect((snap as unknown as Record<string, unknown>).participants).toBeUndefined();

    // 他者（p2）の識別子・残額はスナップショットのどこにも残らない（設計 §2.10 が固定する検査）。
    const serialized = JSON.stringify(snap);
    expect(serialized).not.toContain("p2");
    expect(serialized).not.toContain("10000");
  });

  it("未送信の解答者は送信済み false へ・自分の残額のみ復帰する", () => {
    const snap = buildSnapshot(
      gameState,
      { role: "contestant", participantId: "p2", disclosed: false },
      authority,
    );
    // p2 は submitted マップに無い → 送信済みは false。
    expect(snap.ownSubmitted).toBe(false);
    // 自分（p2）の残額は復帰対象（自分のデータは漏洩ではない）。
    expect(snap.ownBalance).toBe(10000);
    // 他者（p1）の残額・識別子は含まれない。
    const serialized = JSON.stringify(snap);
    expect(serialized).not.toContain("p1");
    expect(serialized).not.toContain("9500");
  });

  it("残額未登録の解答者は残額 null・送信済み false へ復帰する", () => {
    const snap = buildSnapshot(
      gameState,
      { role: "contestant", participantId: "unknown", disclosed: false },
      authority,
    );
    expect(snap.ownBalance).toBeNull();
    expect(snap.ownSubmitted).toBe(false);
    const serialized = JSON.stringify(snap);
    expect(serialized).not.toContain("p1");
    expect(serialized).not.toContain("p2");
  });

  it("残額 0 の解答者は 0 を残額として復帰する（不在と 0 を混同しない）", () => {
    const snap = buildSnapshot(
      gameState,
      { role: "contestant", participantId: "p3", disclosed: false },
      { balances: { p3: 0 }, submitted: {} },
    );
    // 0 円は「未登録（null）」ではなく数値 0 として復帰する。
    expect(snap.ownBalance).toBe(0);
    expect(snap.ownSubmitted).toBe(false);
  });

  it("司会者はサーバ権威の全量（全員残額・全員送信済み）へ復帰する", () => {
    const snap = buildSnapshot(
      gameState,
      { role: "host", disclosed: false },
      authority,
    );
    expect(snap.currentQuestionNumber).toBe(3);
    expect(snap.stage).toBe("answers_locked");
    expect(snap.tvMode).toBe("a");
    // 司会者は全員分の残額・送信済みを受け取る（投影による除去は起きない）。
    expect(snap.balances).toEqual({ p1: 9500, p2: 10000 });
    expect(snap.submitted).toEqual({ p1: true });
    // 司会者投影は解答者専用フィールド（自分の残額/送信済み）を持たない。
    expect(snap.ownBalance).toBeUndefined();
    expect(snap.ownSubmitted).toBeUndefined();
  });

  it("観客はサーバ権威の進行状態のみへ復帰し残額・送信済みを持たない", () => {
    const snap = buildSnapshot(
      gameState,
      { role: "audience", disclosed: true },
      authority,
    );
    expect(snap.currentQuestionNumber).toBe(3);
    expect(snap.stage).toBe("answers_locked");
    expect(snap.tvMode).toBe("a");
    // 観客投影は残額・送信済み・全体一覧のいずれも持たない（進行状態のみ）。
    expect(snap.ownBalance).toBeUndefined();
    expect(snap.balances).toBeUndefined();
    expect(snap.submitted).toBeUndefined();
    // 観客投影へ他者の残額値が漏れない。
    const serialized = JSON.stringify(snap);
    expect(serialized).not.toContain("9500");
    expect(serialized).not.toContain("10000");
  });
});
