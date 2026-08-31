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
  projectForRole,
  type ProjectionContext,
  type OwnBalancePayload,
} from "../../src/realtime_sync/fanout.js";
import type { ServerEvent } from "../../src/realtime_sync/protocol.js";

// projectForRole はロール投影の単一判定点であり、可視境界をトランスポート層で強制する
// （設計 §2.5）。本スイートは実際に projectForRole を実行し、その戻り値（投影済みイベント
// または null）に対して、司会者=全量／解答者=自分の残額のみ・他者情報は不配信／観客=開示前は
// 他者の解答を不配信、を証す。

describe("realtime_sync/fanout ロール投影による可視境界", () => {
  describe("観客（audience）", () => {
    // codd: covers vb=VB-19
    it("開示（b）未実行の間は他者の解答がどのクライアント端末へも配信されない", () => {
      const answersOpened: ServerEvent<{
        answers: Array<{ name: string; value: number }>;
      }> = {
        type: "answers_opened",
        seq: 1,
        ts: 0,
        payload: {
          answers: [
            { name: "太郎", value: 40 },
            { name: "花子", value: 55 },
          ],
        },
      };
      // 観客（TV）: 開示前は他者の解答イベントを配信しない。
      expect(
        projectForRole(answersOpened, { role: "audience", disclosed: false }),
      ).toBeNull();
      // 解答者（タブレット）: 他者の解答は開示状態に依らず常に配信外。
      expect(
        projectForRole(answersOpened, {
          role: "contestant",
          participantId: "p1",
          disclosed: false,
        }),
      ).toBeNull();
      expect(
        projectForRole(answersOpened, {
          role: "contestant",
          participantId: "p1",
          disclosed: true,
        }),
      ).toBeNull();
    });

    it("開示後は観客へ全員の氏名＋解答が配信される（開示境界の直上）", () => {
      const answersOpened: ServerEvent<{
        answers: Array<{ name: string; value: number }>;
      }> = {
        type: "answers_opened",
        seq: 2,
        ts: 0,
        payload: {
          answers: [
            { name: "太郎", value: 40 },
            { name: "花子", value: 55 },
          ],
        },
      };
      const projected = projectForRole(answersOpened, {
        role: "audience",
        disclosed: true,
      });
      expect(projected).not.toBeNull();
      expect(projected?.type).toBe("answers_opened");
      expect(projected?.payload).toEqual({
        answers: [
          { name: "太郎", value: 40 },
          { name: "花子", value: 55 },
        ],
      });
    });

    it("他者の解答を含まない進行イベントは開示前でも観客へ配信される", () => {
      const modeChanged: ServerEvent<Record<string, never>> = {
        type: "tv_mode_changed",
        seq: 3,
        ts: 0,
        tvMode: "a",
        payload: {},
      };
      const projected = projectForRole(modeChanged, {
        role: "audience",
        disclosed: false,
      });
      expect(projected).not.toBeNull();
      expect(projected?.type).toBe("tv_mode_changed");
      expect(projected?.tvMode).toBe("a");
    });
  });

  describe("解答者（contestant）", () => {
    const contestantCtx: ProjectionContext = {
      role: "contestant",
      participantId: "p1",
      disclosed: true,
    };

    // codd: covers vb=VB-62
    it("解答者端末へは自分の残額のみが投影され他者の解答・残額・得点は配信されない", () => {
      // (1) 残額更新は全員分から自分（p1）の 1 件のみを円建てで投影する。
      const balanceEvent: ServerEvent<{ balances: Record<string, number> }> = {
        type: "balance_updated",
        seq: 4,
        ts: 0,
        currency: "円",
        payload: { balances: { p1: 9500, p2: 10000, p3: 8700 } },
      };
      const projected = projectForRole(balanceEvent, contestantCtx);
      expect(projected).not.toBeNull();
      const ownEvent = projected as ServerEvent<OwnBalancePayload>;
      // 期待値（自分 p1 の 9500 円）は入力から独立に記述する。
      expect(ownEvent.payload).toEqual({ balance: 9500, currency: "円" });
      // ペイロードのキーは残額と通貨に限られ、参加者別のキーを持たない。
      expect(Object.keys(ownEvent.payload).sort()).toEqual(["balance", "currency"]);
      // 他者（p2/p3）の識別子・残額は投影結果のどこにも残らない。
      const serialized = JSON.stringify(ownEvent);
      expect(serialized).not.toContain("p2");
      expect(serialized).not.toContain("p3");

      // (2) 他者の解答（開示）・全員精算表（得点）・参加者一覧は解答者へ一切配信しない。
      const othersAnswers: ServerEvent<{
        answers: Array<{ name: string; value: number }>;
      }> = {
        type: "answers_opened",
        seq: 5,
        ts: 0,
        payload: { answers: [{ name: "花子", value: 55 }] },
      };
      const settlementTable: ServerEvent<{
        rows: Array<{ name: string; balance: number }>;
      }> = {
        type: "settlement_computed",
        seq: 6,
        ts: 0,
        currency: "円",
        payload: {
          rows: [
            { name: "花子", balance: 9000 },
            { name: "太郎", balance: 9500 },
          ],
        },
      };
      const roster: ServerEvent<{ name: string }> = {
        type: "participant_joined",
        seq: 7,
        ts: 0,
        payload: { name: "花子" },
      };
      expect(projectForRole(othersAnswers, contestantCtx)).toBeNull();
      expect(projectForRole(settlementTable, contestantCtx)).toBeNull();
      expect(projectForRole(roster, contestantCtx)).toBeNull();
    });

    it("正解開示イベントは解答者へ配信されない（自分の可視面に含まれない）", () => {
      const revealed: ServerEvent<{ correctValue: number }> = {
        type: "answer_revealed",
        seq: 8,
        ts: 0,
        payload: { correctValue: 50 },
      };
      expect(projectForRole(revealed, contestantCtx)).toBeNull();
    });

    it("入力ロック等の自分に関わる進行イベントは解答者へ配信される", () => {
      const locked: ServerEvent<Record<string, never>> = {
        type: "answers_locked",
        seq: 9,
        ts: 0,
        stage: "answers_locked",
        payload: {},
      };
      const projected = projectForRole(locked, {
        role: "contestant",
        participantId: "p1",
        disclosed: false,
      });
      expect(projected).not.toBeNull();
      expect(projected?.type).toBe("answers_locked");
      expect(projected?.stage).toBe("answers_locked");
    });

    it("自分の識別子が無い／自分が含まれない残額更新は配信しない", () => {
      const ev: ServerEvent<{ balances: Record<string, number> }> = {
        type: "balance_updated",
        seq: 10,
        ts: 0,
        currency: "円",
        payload: { balances: { p2: 10000 } },
      };
      // participantId 無し → 自分の残額を特定できないため配信しない。
      expect(projectForRole(ev, { role: "contestant", disclosed: true })).toBeNull();
      // 自分（p1）が当該更新に含まれない → 配信しない。
      expect(
        projectForRole(ev, { role: "contestant", participantId: "p1", disclosed: true }),
      ).toBeNull();
    });
  });

  describe("司会者（host）", () => {
    it("司会者へは全員分の残額を含む全量が投影されず素通しする", () => {
      const ev: ServerEvent<{ balances: Record<string, number> }> = {
        type: "balance_updated",
        seq: 11,
        ts: 0,
        currency: "円",
        payload: { balances: { p1: 9500, p2: 10000 } },
      };
      const projected = projectForRole(ev, { role: "host", disclosed: false });
      expect(projected).not.toBeNull();
      // host は全員分の残額をそのまま受け取る（投影による除去が起きない）。
      expect(projected?.payload).toEqual({ balances: { p1: 9500, p2: 10000 } });
    });

    it("開示前でも司会者へは他者の解答が配信される", () => {
      const answersOpened: ServerEvent<{
        answers: Array<{ name: string; value: number }>;
      }> = {
        type: "answers_opened",
        seq: 12,
        ts: 0,
        payload: { answers: [{ name: "太郎", value: 40 }] },
      };
      const projected = projectForRole(answersOpened, {
        role: "host",
        disclosed: false,
      });
      expect(projected).not.toBeNull();
      expect(projected?.payload).toEqual({
        answers: [{ name: "太郎", value: 40 }],
      });
    });
  });
});
