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
  ROLES,
  GAME_STAGES,
  TV_MODES,
  DOMAIN_EVENT_TYPES,
  CONTROL_EVENT_TYPES,
  SERVER_EVENT_TYPES,
  CURRENCY,
  MONEY_BEARING_EVENT_TYPES,
  isMoneyBearingEvent,
  createSequenceGenerator,
  stampServerEvent,
  CLOSE_OVER_LIMIT,
  COMMAND_KINDS,
  HOST_ONLY_COMMANDS,
  COMMAND_ALLOWED_ROLES,
  isHostOnlyCommand,
  allowedRolesForCommand,
  isCommandAllowedForRole,
  isRole,
  isGameStage,
  isTvMode,
  isDomainEventType,
  isServerEventType,
  isCommandKind,
  type ServerEvent,
  type CommandKind,
} from "../../src/realtime_sync/protocol.js";

describe("realtime_sync/protocol の語彙を確定値に固定する", () => {
  it("ロール/進行段階/TV モードの語彙を確定値どおり公開する", () => {
    expect([...ROLES]).toEqual(["host", "answerer", "audience"]);
    expect([...GAME_STAGES]).toEqual([
      "accepting",
      "answers_locked",
      "answers_opened",
      "answer_revealed",
      "settlement_computed",
    ]);
    expect([...TV_MODES]).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("ドメインイベント種別と配信封筒種別を確定値どおり公開する", () => {
    expect([...DOMAIN_EVENT_TYPES]).toEqual([
      "answers_locked",
      "answers_opened",
      "answer_revealed",
      "settlement_computed",
      "trigger_undone",
      "tv_mode_changed",
      "participant_joined",
      "participant_renamed",
      "balance_updated",
    ]);
    expect([...CONTROL_EVENT_TYPES]).toEqual([
      "state_snapshot",
      "connection_rejected",
      "command_denied",
      "submit_ack",
    ]);
    // 配信封筒種別はドメイン＋制御イベントの合併を網羅する。
    for (const t of DOMAIN_EVENT_TYPES) {
      expect(isServerEventType(t)).toBe(true);
    }
    for (const t of CONTROL_EVENT_TYPES) {
      expect(isServerEventType(t)).toBe(true);
    }
    expect(SERVER_EVENT_TYPES.length).toBe(
      DOMAIN_EVENT_TYPES.length + CONTROL_EVENT_TYPES.length,
    );
  });

  it("型ガードが語彙内/外を判別する", () => {
    expect(isRole("host")).toBe(true);
    expect(isRole("player")).toBe(false);
    expect(isRole(42)).toBe(false);
    expect(isGameStage("accepting")).toBe(true);
    expect(isGameStage("finished")).toBe(false);
    expect(isTvMode("a")).toBe(true);
    expect(isTvMode("f")).toBe(false);
    expect(isDomainEventType("balance_updated")).toBe(true);
    // state_snapshot は制御イベントでありドメインイベントではない。
    expect(isDomainEventType("state_snapshot")).toBe(false);
    expect(isServerEventType("state_snapshot")).toBe(true);
    expect(isServerEventType("unknown_event")).toBe(false);
    expect(isCommandKind("lock")).toBe(true);
    expect(isCommandKind("halt")).toBe(false);
  });
});

describe("ServerEvent 封筒の seq（セッション単位で単調増加）", () => {
  it("stamp ごとに seq が存在し単調増加する", () => {
    const seq = createSequenceGenerator();
    const first: ServerEvent<{ name: string }> = stampServerEvent(seq, {
      type: "participant_joined",
      payload: { name: "太郎" },
    });
    const second = stampServerEvent(seq, { type: "answers_locked", payload: {} });
    const third = stampServerEvent(seq, { type: "answers_opened", payload: {} });

    for (const ev of [first, second, third]) {
      expect(typeof ev.seq).toBe("number");
      expect(Number.isInteger(ev.seq)).toBe(true);
    }
    // 単調増加（開始値・刻み幅は実装自由・順序性のみが設計の固定点）。
    expect(second.seq).toBeGreaterThan(first.seq);
    expect(third.seq).toBeGreaterThan(second.seq);
  });

  it("独立した生成器の seq は互いに干渉しない", () => {
    const a = createSequenceGenerator();
    const b = createSequenceGenerator();
    const a1 = a.next();
    const a2 = a.next();
    const b1 = b.next();
    expect(a2).toBeGreaterThan(a1);
    // b は a の採番に進められない（各生成器が自身の系列を持つ）。
    expect(b1).toBe(a1);
  });

  it("封筒生成が任意フィールドと注入クロックの ts を保持する", () => {
    const seq = createSequenceGenerator();
    const ev = stampServerEvent(
      seq,
      {
        type: "tv_mode_changed",
        stage: "answers_opened",
        questionNumber: 3,
        tvMode: "b",
        payload: {},
      },
      () => 1234,
    );
    expect(ev.type).toBe("tv_mode_changed");
    expect(ev.stage).toBe("answers_opened");
    expect(ev.questionNumber).toBe(3);
    expect(ev.tvMode).toBe("b");
    expect(ev.ts).toBe(1234);
  });

  it("seq 開始値が不正なら生成器を作れない", () => {
    expect(() => createSequenceGenerator(-1)).toThrow(RangeError);
    expect(() => createSequenceGenerator(1.5)).toThrow(RangeError);
  });
});

describe("通貨マーカー（円建て固定・現金感を薄めない）", () => {
  const forbiddenCurrencyTokens = ["point", "pt", "点"];

  // codd: covers vb=VB-35
  it("金額を伴うイベント封筒の内部表現が円建て(currency '円')であり point/pt/点 を含まない", () => {
    const seq = createSequenceGenerator();
    const settlement = stampServerEvent(seq, {
      type: "settlement_computed",
      payload: { rows: [{ name: "太郎", balance: 9500 }] },
    });
    const balance = stampServerEvent(seq, {
      type: "balance_updated",
      payload: { balance: 9500 },
    });
    const modeChange = stampServerEvent(seq, {
      type: "tv_mode_changed",
      tvMode: "d",
      payload: {},
    });

    // 封筒生成が金額イベントへ通貨マーカーを導出付与する（期待値 "円" は独立記述）。
    expect(settlement.currency).toBe("円");
    expect(balance.currency).toBe("円");
    // 通貨マーカーは point/pt/点 のいずれでもない（置換禁止・当該フィールドに限定）。
    expect(forbiddenCurrencyTokens).not.toContain(settlement.currency);
    expect(forbiddenCurrencyTokens).not.toContain(balance.currency);
    // 金額を伴わないイベントには通貨マーカーを付さない。
    expect(modeChange.currency).toBeUndefined();
  });

  it("通貨定数と金額イベント判定が円建てに固定される", () => {
    expect(CURRENCY).toBe("円");
    expect(forbiddenCurrencyTokens).not.toContain(CURRENCY);
    expect([...MONEY_BEARING_EVENT_TYPES]).toEqual([
      "settlement_computed",
      "balance_updated",
    ]);
    expect(isMoneyBearingEvent("settlement_computed")).toBe(true);
    expect(isMoneyBearingEvent("balance_updated")).toBe(true);
    expect(isMoneyBearingEvent("tv_mode_changed")).toBe(false);
    expect(isMoneyBearingEvent("participant_joined")).toBe(false);
  });
});

describe("クローズコード（上限超過の接続拒否）", () => {
  it("CLOSE_OVER_LIMIT が 4001 であり拒否は connection_rejected 種別で表される", () => {
    expect(CLOSE_OVER_LIMIT).toBe(4001);
    // WebSocket のアプリ定義クローズコード範囲（4000–4999）に収まる。
    expect(CLOSE_OVER_LIMIT).toBeGreaterThanOrEqual(4000);
    expect(CLOSE_OVER_LIMIT).toBeLessThanOrEqual(4999);
    // 拒否イベント種別が封筒語彙に定義されている。
    expect(isServerEventType("connection_rejected")).toBe(true);
  });
});

describe("クライアントコマンド語彙と許可ロール（司会者限定の識別）", () => {
  it("コマンド語彙を確定値どおり公開する", () => {
    expect([...COMMAND_KINDS]).toEqual([
      "join",
      "resume",
      "submit_answer",
      "lock",
      "open",
      "reveal",
      "settle",
      "undo",
      "switch_mode",
      "live_edit",
    ]);
  });

  it("司会者限定コマンドは role host のみ許可し解答者・観客を許可しない", () => {
    const hostOnly: CommandKind[] = [
      "lock",
      "open",
      "reveal",
      "settle",
      "undo",
      "switch_mode",
      "live_edit",
    ];
    expect([...HOST_ONLY_COMMANDS]).toEqual(hostOnly);
    for (const cmd of hostOnly) {
      expect(isHostOnlyCommand(cmd)).toBe(true);
      expect([...allowedRolesForCommand(cmd)]).toEqual(["host"]);
      expect(isCommandAllowedForRole(cmd, "host")).toBe(true);
      expect(isCommandAllowedForRole(cmd, "answerer")).toBe(false);
      expect(isCommandAllowedForRole(cmd, "audience")).toBe(false);
    }
  });

  it("解答者・任意ロールのコマンドは司会者限定に含めない", () => {
    expect(isHostOnlyCommand("submit_answer")).toBe(false);
    expect([...COMMAND_ALLOWED_ROLES.submit_answer]).toEqual(["answerer"]);
    expect(isCommandAllowedForRole("submit_answer", "answerer")).toBe(true);
    expect(isCommandAllowedForRole("submit_answer", "host")).toBe(false);
    expect(isCommandAllowedForRole("submit_answer", "audience")).toBe(false);

    expect(isHostOnlyCommand("join")).toBe(false);
    expect([...allowedRolesForCommand("join")]).toEqual(["answerer"]);

    // resume はトークン提示による任意ロールの再接続を許す。
    expect(isHostOnlyCommand("resume")).toBe(false);
    expect(isCommandAllowedForRole("resume", "host")).toBe(true);
    expect(isCommandAllowedForRole("resume", "answerer")).toBe(true);
    expect(isCommandAllowedForRole("resume", "audience")).toBe(true);
  });

  it("host 限定判定と許可ロール表が整合する（司会者のみ＝['host']）", () => {
    for (const kind of COMMAND_KINDS) {
      const roles = [...allowedRolesForCommand(kind)];
      if (isHostOnlyCommand(kind)) {
        expect(roles).toEqual(["host"]);
      } else {
        expect(roles).not.toEqual(["host"]);
        expect(roles.length).toBeGreaterThan(0);
        for (const r of roles) {
          expect(isRole(r)).toBe(true);
        }
      }
    }
  });
});
