/**
 * 参加者の氏名変更（`applyRenameParticipant`・cmd_2159 機能追加「メンバー名の設定・編集」）。
 *
 * メンバー設定面（/me）が叩く改名コマンドのサーバ側受理境界を固定する:
 *   - 氏名だけが変わり、同一性（id / connectionId / joinedAt）は不変であること
 *     （参加は connectionId の一意性のみが 1 人 = 1 台を担保する不変・PC-INV-1。改名で
 *      識別子が動けば同一人物の同一性と解答・残額の突合が壊れる）。
 *   - 受理境界は `participants/name.ts` の単一バリデータ（非空・コードポイント 20 文字以内）
 *     に一致し、拒否は 400/404 の業務ステータスで返る（例外を投げ抜けさせず 5xx にしない）。
 */

import { describe, it, expect } from "vitest";
import { applyRenameParticipant, applyJoin } from "../../src/server/orchestrator.js";
import type { Session } from "../../src/server/session.js";
import { MAX_DISPLAY_NAME_LENGTH } from "../../src/participants/name.js";
import { createSequenceGenerator } from "../../src/realtime_sync/protocol.js";
import type { Stage } from "../../src/game_state/progression.js";
import type { QuestionSettlement } from "../../src/scoring/settlement.js";

/** 各テストで独立した揮発セッションを組む（module-level シングルトンを汚さない）。 */
function freshSession(): Session {
  return {
    game: { currentQuestionNumber: 1, tvMode: "a", phase: "lobby" },
    loaded: false,
    stages: new Map<number, Stage>(),
    participants: [],
    answers: new Map<number, Map<string, number>>(),
    settlements: new Map<number, readonly QuestionSettlement[]>(),
    seq: createSequenceGenerator(),
  };
}

/** 氏名で参加確定し、生成された参加者を返す。 */
function join(s: Session, name: string) {
  const result = applyJoin(name, s);
  expect(result.ok).toBe(true);
  expect(result.participant).toBeDefined();
  return result.participant!;
}

describe("applyRenameParticipant（メンバー名の変更）", () => {
  it("氏名のみが更新され、id / connectionId / joinedAt は不変である", () => {
    const s = freshSession();
    const before = join(s, "たろう");
    const { id, connectionId, joinedAt } = before;

    const result = applyRenameParticipant(id, "タロウ", s);

    expect(result.ok).toBe(true);
    expect(result.status).toBeUndefined();
    expect(s.participants).toHaveLength(1);
    expect(s.participants[0].name).toBe("タロウ");
    // 同一性を成す 3 つの値は改名で一切動かない（PC-INV-1）。
    expect(s.participants[0].id).toBe(id);
    expect(s.participants[0].connectionId).toBe(connectionId);
    expect(s.participants[0].joinedAt).toBe(joinedAt);
  });

  it("改名は participant_renamed イベントを当該参加者宛に載せて返す", () => {
    const s = freshSession();
    const p = join(s, "たろう");

    const result = applyRenameParticipant(p.id, "タロウ", s);

    expect(result.events).toHaveLength(1);
    expect(result.events[0].type).toBe("participant_renamed");
    expect(result.events[0].payload).toEqual({ participantId: p.id });
  });

  it("前後の空白を除いた氏名を保持する", () => {
    const s = freshSession();
    const p = join(s, "たろう");

    expect(applyRenameParticipant(p.id, "  タロウ  ", s).ok).toBe(true);
    expect(s.participants[0].name).toBe("タロウ");
  });

  it("未知の participantId は 404 で拒否し、誰の氏名も変えない", () => {
    const s = freshSession();
    const p = join(s, "たろう");

    const result = applyRenameParticipant("p_unknown", "タロウ", s);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.events).toHaveLength(0);
    expect(s.participants[0].name).toBe("たろう");
    expect(p.name).toBe("たろう");
  });

  it("participantId が文字列でなくとも例外を投げず 404 で拒否する", () => {
    const s = freshSession();
    join(s, "たろう");

    for (const bad of [undefined, null, 42, {}]) {
      const result = applyRenameParticipant(bad, "タロウ", s);
      expect(result.ok).toBe(false);
      expect(result.status).toBe(404);
    }
    expect(s.participants[0].name).toBe("たろう");
  });

  it("空白のみの氏名は 400 で拒否し、変更前の氏名を保つ", () => {
    const s = freshSession();
    const p = join(s, "たろう");

    for (const blank of ["", "   ", "\t\n"]) {
      const result = applyRenameParticipant(p.id, blank, s);
      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
      expect(result.events).toHaveLength(0);
    }
    expect(s.participants[0].name).toBe("たろう");
  });

  it("氏名が文字列でなくとも例外を投げず 400 で拒否する", () => {
    const s = freshSession();
    const p = join(s, "たろう");

    for (const bad of [undefined, null, 42, {}]) {
      const result = applyRenameParticipant(p.id, bad, s);
      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
    }
    expect(s.participants[0].name).toBe("たろう");
  });

  it("上限長ちょうど（20 文字）は受理し、1 文字超過（21 文字）は 400 で拒否する", () => {
    const s = freshSession();
    const p = join(s, "たろう");
    const atLimit = "あ".repeat(MAX_DISPLAY_NAME_LENGTH);
    const overLimit = "あ".repeat(MAX_DISPLAY_NAME_LENGTH + 1);

    expect(applyRenameParticipant(p.id, atLimit, s).ok).toBe(true);
    expect(s.participants[0].name).toBe(atLimit);

    const rejected = applyRenameParticipant(p.id, overLimit, s);
    expect(rejected.ok).toBe(false);
    expect(rejected.status).toBe(400);
    // 拒否された入力で氏名が書き換わらない。
    expect(s.participants[0].name).toBe(atLimit);
  });

  it("サロゲートペア（絵文字）20 個は受理する（長さはコードポイント基準）", () => {
    const s = freshSession();
    const p = join(s, "たろう");
    const emoji = "😀".repeat(MAX_DISPLAY_NAME_LENGTH); // UTF-16 では 40 単位・コードポイントでは 20

    const result = applyRenameParticipant(p.id, emoji, s);

    expect(result.ok).toBe(true);
    expect(s.participants[0].name).toBe(emoji);
  });

  it("改名は他の参加者の氏名に波及しない", () => {
    const s = freshSession();
    const taro = join(s, "たろう");
    const hanako = join(s, "はなこ");

    expect(applyRenameParticipant(taro.id, "タロウ", s).ok).toBe(true);

    const renamed = s.participants.find((x) => x.id === taro.id);
    const untouched = s.participants.find((x) => x.id === hanako.id);
    expect(renamed?.name).toBe("タロウ");
    expect(untouched?.name).toBe("はなこ");
  });
});
