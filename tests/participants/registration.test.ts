// @generated-by: codd implement
// @generated-from: docs/design/participation_connection_design.md (design:participation-connection-design)
// @design-node: docs/design/participation_connection_design.md
// @output-paths: src, tests
// @generated-from: docs/design/realtime_sync_design.md (design:realtime-sync-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { describe, it, expect } from "vitest";
import {
  registerParticipant,
  InvalidDisplayNameError,
  type RegisterParticipantInput,
} from "../../src/participants/registration.js";
import {
  DuplicateConnectionError,
  listParticipants,
  type ParticipantRow,
  type ParticipantStore,
} from "../../src/participants/participant_repository.js";
import { MAX_DISPLAY_NAME_LENGTH } from "../../src/participants/name.js";
import type { Participant } from "../../src/participants/participant.js";

/**
 * ParticipantStore（外部永続化境界・物理 DB は data-model-design のアダプタが所有）のインメモリ実装。
 * connection_id 一意の原子的 insert-if-absent と joined_at 昇順読み戻しという契約を満たし、
 * registerParticipant → insertParticipant → listParticipants の永続パスを決定的に統合検証する。
 */
class InMemoryParticipantStore implements ParticipantStore {
  readonly rows: ParticipantRow[] = [];

  async insertIfConnectionAbsent(row: ParticipantRow): Promise<boolean> {
    if (this.rows.some((existing) => existing.connection_id === row.connection_id)) {
      return false;
    }
    this.rows.push(row);
    return true;
  }

  async listParticipantsOrderedByJoinedAt(): Promise<readonly ParticipantRow[]> {
    return [...this.rows].sort((a, b) => a.joined_at.localeCompare(b.joined_at));
  }
}

describe("participants/registration registerParticipant（受入成立時の参加者永続 producer）", () => {
  // codd: covers vb=VB-07
  it("自己入力氏名で participants に 1 人 1 レコードを connection_id 紐付きで永続し読み戻せる", async () => {
    const store = new InMemoryParticipantStore();
    const input: RegisterParticipantInput = { name: "太郎", connectionId: "conn-1" };

    // 決定的検証のため id 採番器・時計を注入する。
    const created: Participant = await registerParticipant(store, input, {
      generateId: () => "participant-1",
      now: () => new Date("2026-08-16T00:00:00.000Z"),
    });

    // producer の戻り値を型付きアクセスで検証する。期待値は system 出力とは独立にリテラルで記述する。
    expect(created.id).toBe("participant-1");
    expect(created.name).toBe("太郎"); // 自己入力氏名をそのまま保持する
    expect(created.connectionId).toBe("conn-1"); // 1 台へ紐付く
    expect(created.joinedAt).toBe("2026-08-16T00:00:00.000Z"); // ISO-8601 で記録

    // 永続層から読み戻し、ちょうど 1 レコードが connection_id 紐付きで入っている。
    const roster = await listParticipants(store);
    expect(roster).toHaveLength(1);
    expect(roster[0]?.id).toBe("participant-1");
    expect(roster[0]?.name).toBe("太郎");
    expect(roster[0]?.connectionId).toBe("conn-1");
  });

  it("同一 connection_id への 2 度目の登録を拒否し 1 台 = 1 レコードを保つ（1 人 = 1 台）", async () => {
    const store = new InMemoryParticipantStore();
    await registerParticipant(store, { name: "太郎", connectionId: "conn-1" });

    await expect(
      registerParticipant(store, { name: "次郎", connectionId: "conn-1" }),
    ).rejects.toBeInstanceOf(DuplicateConnectionError);

    // 2 件目が拒否されても participants は 1 レコードのまま（氏名も最初のもの）。
    const roster = await listParticipants(store);
    expect(roster).toHaveLength(1);
    expect(roster[0]?.name).toBe("太郎");
  });

  it("同名の別人は connection_id が異なれば別レコードとして共に永続する（氏名は一意キーでない）", async () => {
    const store = new InMemoryParticipantStore();
    await registerParticipant(store, { name: "太郎", connectionId: "conn-1" });
    await registerParticipant(store, { name: "太郎", connectionId: "conn-2" });

    const roster = await listParticipants(store);
    expect(roster).toHaveLength(2);
    // 並び順に依存せず 2 つの別 connection_id が共存することを固定する。
    expect(roster.map((r) => r.connectionId).sort()).toEqual(["conn-1", "conn-2"]);
    expect(roster.every((r) => r.name === "太郎")).toBe(true);
  });

  it("空・空白のみ・上限長超過の氏名はサーバ側で拒否し participants に入れない（最終防衛）", async () => {
    const store = new InMemoryParticipantStore();
    const overLong = "あ".repeat(MAX_DISPLAY_NAME_LENGTH + 1);
    const invalidNames = ["", "   ", "　", "\t\n", overLong];

    let connSeq = 0;
    for (const invalid of invalidNames) {
      connSeq += 1;
      // 各不正氏名は insertParticipant の手前で拒否され、行は生成されない（distinct な connectionId）。
      await expect(
        registerParticipant(store, { name: invalid, connectionId: `conn-${connSeq}` }),
      ).rejects.toBeInstanceOf(InvalidDisplayNameError);
    }

    // どの不正氏名も participants へ 1 行も入らない。
    const roster = await listParticipants(store);
    expect(roster).toHaveLength(0);
  });

  it("上限長ちょうどの氏名は受理して永続する（境界の下側＝受理）", async () => {
    const store = new InMemoryParticipantStore();
    const atLimit = "あ".repeat(MAX_DISPLAY_NAME_LENGTH);

    const created = await registerParticipant(store, { name: atLimit, connectionId: "conn-1" });
    expect(created.name).toBe(atLimit);

    const roster = await listParticipants(store);
    expect(roster).toHaveLength(1);
    expect(roster[0]?.name).toBe(atLimit);
  });

  it("既定では登録ごとに一意な id を採番し joined_at を ISO-8601 で記録する", async () => {
    const store = new InMemoryParticipantStore();
    const a = await registerParticipant(store, { name: "花子", connectionId: "conn-a" });
    const b = await registerParticipant(store, { name: "次郎", connectionId: "conn-b" });

    // 別々の参加確定は別々の id（identity）を持つ。
    expect(a.id).not.toBe("");
    expect(b.id).not.toBe("");
    expect(a.id).not.toBe(b.id);
    // joined_at は round-trip で一致する正準 ISO-8601 文字列である。
    expect(new Date(a.joinedAt).toISOString()).toBe(a.joinedAt);
  });
});
