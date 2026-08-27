// @generated-by: codd implement
// @generated-from: docs/design/system_design.md (design:system-design)
// @design-node: docs/design/system_design.md
// @output-paths: src, tests
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { afterEach, describe, expect, it } from "vitest";
import {
  admitTablet,
  type AdmissionResult,
} from "../src/participants/admission.js";
import {
  resolveMaxTabletConnections,
  MAX_TABLET_CONNECTIONS_ENV,
} from "../src/config/connection_limit.js";
import { MAX_DISPLAY_NAME_LENGTH } from "../src/participants/name.js";

// participants/admission の受付ゲート（admitTablet）を、設定解決点 resolveMaxTabletConnections が
// 解決した実効上限だけを注入して駆動する。判定経路に数値リテラル 8 を置かず、上限は config の
// 単一解決点にのみ存在する（dod_limit_no_hardcode）。上限超過拒否は既存の接続会計を一切変えない
// 純粋判定であり（dod_limit_existing_unaffected）、connection_rejected＋WS close(4001) の通知は
// realtime_sync が担う消費者側の責務ゆえ本ユニットでは検証しない。期待値は SUT 出力とは独立に固定する。
describe("participants/admission admitTablet（設定上限を参照し受入可否が追随する）", () => {
  afterEach(() => {
    delete process.env[MAX_TABLET_CONNECTIONS_ENV];
  });

  // codd: covers vb=VB-10
  it("上限未設定(既定8)で 8 台目タブレット（connected=7）まで接続が成立する", () => {
    delete process.env[MAX_TABLET_CONNECTIONS_ENV];
    // 実効上限は config の単一解決点から取り、その値だけを admitTablet へ注入する。
    const limit = resolveMaxTabletConnections({ env: {} });
    // 期待値 8 は SUT 出力とは独立に記述し、解決値と突き合わせる。
    expect(limit).toBe(8);
    // 8 台目（既存 7 接続）の参加は成立する。
    const eighth: AdmissionResult = admitTablet({ limit, connected: 7 }, { name: "8人目" });
    expect(eighth.ok).toBe(true);
    expect(eighth.reason).toBeUndefined();
  });

  // codd: covers vb=VB-11
  it("9 台目のタブレット接続（connected=8・既定8）が受付ゲートで拒否される（over_limit）", () => {
    delete process.env[MAX_TABLET_CONNECTIONS_ENV];
    const limit = resolveMaxTabletConnections({ env: {} });
    // 8 台接続済みで 9 台目が接続を試みる → 上限到達で受理されず over_limit を返す。
    const ninth: AdmissionResult = admitTablet({ limit, connected: 8 }, { name: "9人目" });
    expect(ninth.ok).toBe(false);
    expect(ninth.reason).toBe("over_limit");
  });

  // codd: covers vb=VB-12
  it("上限が設定注入で外出しされ受入可否が設定値に追随する（判定経路に固定 8 が無い）", () => {
    const request = { name: "同一境界入力" };
    // 同じ connected=8 を、既定(8)・設定16・設定32 の各解決値のもとで判定する。
    const atDefault = admitTablet(
      { limit: resolveMaxTabletConnections({ env: {} }), connected: 8 },
      request,
    );
    const at16 = admitTablet(
      {
        limit: resolveMaxTabletConnections({ env: { [MAX_TABLET_CONNECTIONS_ENV]: "16" } }),
        connected: 8,
      },
      request,
    );
    const at32 = admitTablet(
      {
        limit: resolveMaxTabletConnections({ env: { [MAX_TABLET_CONNECTIONS_ENV]: "32" } }),
        connected: 8,
      },
      request,
    );
    // 既定(8)では connected=8 が上限到達で拒否される。
    expect(atDefault.ok).toBe(false);
    expect(atDefault.reason).toBe("over_limit");
    // 16/32 へ設定注入すると同じ connected=8 が受理される＝判定が設定解決値へ追随する（固定 8 でない）。
    expect(at16.ok).toBe(true);
    expect(at32.ok).toBe(true);
  });

  // codd: covers vb=VB-13
  it("MAX_TABLET_CONNECTIONS=16 で 16 台目まで接続可・17 台目拒否（コード改修なし追随）", () => {
    process.env[MAX_TABLET_CONNECTIONS_ENV] = "16";
    const limit = resolveMaxTabletConnections();
    expect(limit).toBe(16);
    // 16 台目 = connected 15 → 受理。
    expect(admitTablet({ limit, connected: 15 }, { name: "16台目" }).ok).toBe(true);
    // 17 台目 = connected 16 → over_limit で拒否。
    const seventeenth: AdmissionResult = admitTablet(
      { limit, connected: 16 },
      { name: "17台目" },
    );
    expect(seventeenth.ok).toBe(false);
    expect(seventeenth.reason).toBe("over_limit");
  });

  // codd: covers vb=VB-14
  it("MAX_TABLET_CONNECTIONS=32 で 32 台目まで接続可・33 台目拒否", () => {
    process.env[MAX_TABLET_CONNECTIONS_ENV] = "32";
    const limit = resolveMaxTabletConnections();
    expect(limit).toBe(32);
    // 32 台目 = connected 31 → 受理。
    expect(admitTablet({ limit, connected: 31 }, { name: "32台目" }).ok).toBe(true);
    // 33 台目 = connected 32 → over_limit で拒否。
    const thirtyThird: AdmissionResult = admitTablet(
      { limit, connected: 32 },
      { name: "33台目" },
    );
    expect(thirtyThird.ok).toBe(false);
    expect(thirtyThird.reason).toBe("over_limit");
  });

  // codd: covers vb=VB-15
  it("上限超過の拒否時に既存の接続会計が不変である（純粋判定・副作用なし）", () => {
    // 会計を凍結: admission が拒否時に既存接続数/上限へ書き込めば TypeError となり露見する。
    const state = Object.freeze({ limit: 8, connected: 8 });

    // 上限到達で拒否される。
    const rejected: AdmissionResult = admitTablet(state, { name: "溢れ" });
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toBe("over_limit");

    // 拒否は接続会計（既存接続数・上限）を変更しない。
    expect(state.connected).toBe(8);
    expect(state.limit).toBe(8);

    // 再試行しても同一に拒否される（隠れた状態変異でスロットが増減していない）。
    expect(admitTablet(state, { name: "溢れ再試行" }).ok).toBe(false);

    // 無関係な上限内の接続は依然として受理される（拒否がグローバル状態を壊していない）。
    expect(admitTablet({ limit: 8, connected: 5 }, { name: "別接続" }).ok).toBe(true);
  });

  it("氏名不正（空・空白のみ・上限長超過）は invalid_name を返す（サーバ側最終防衛）", () => {
    const limit = resolveMaxTabletConnections({ env: {} });
    // 接続数に空きがあっても、氏名が不正なら受理しない。
    const empty = admitTablet({ limit, connected: 0 }, { name: "" });
    expect(empty.ok).toBe(false);
    expect(empty.reason).toBe("invalid_name");

    expect(admitTablet({ limit, connected: 0 }, { name: "   " }).reason).toBe("invalid_name");

    // 上限長超過（MAX_DISPLAY_NAME_LENGTH + 1 コードポイント）も拒否する。
    const tooLong = "あ".repeat(MAX_DISPLAY_NAME_LENGTH + 1);
    expect(admitTablet({ limit, connected: 0 }, { name: tooLong }).reason).toBe("invalid_name");
  });

  it("氏名検証が上限判定より前に走る（両方不正なら invalid_name を優先して返す）", () => {
    // connected>=limit かつ氏名も不正な場合、氏名検証が先に走り invalid_name を返す。
    const limit = resolveMaxTabletConnections({ env: {} });
    const both = admitTablet({ limit, connected: limit }, { name: "" });
    expect(both.ok).toBe(false);
    expect(both.reason).toBe("invalid_name");
  });

  it("有効な氏名かつ上限未満は { ok: true }（reason 無し）で受理する", () => {
    const limit = resolveMaxTabletConnections({ env: {} });
    const granted = admitTablet({ limit, connected: 0 }, { name: "太郎" });
    expect(granted.ok).toBe(true);
    expect(granted.reason).toBeUndefined();
  });
});
