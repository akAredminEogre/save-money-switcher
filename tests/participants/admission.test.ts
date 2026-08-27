// @generated-by: codd implement
// @generated-from: docs/design/participation_connection_design.md (design:participation-connection-design)
// @design-node: docs/design/participation_connection_design.md
// @output-paths: src, tests
// @generated-from: docs/design/realtime_sync_design.md (design:realtime-sync-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { describe, it, expect, afterEach } from "vitest";
import {
  resolveMaxTabletConnections,
  MAX_TABLET_CONNECTIONS_ENV,
} from "../../src/config/connection_limit.js";
import {
  admitTablet,
  type AdmissionResult,
} from "../../src/participants/admission.js";
import { MAX_DISPLAY_NAME_LENGTH } from "../../src/participants/name.js";

describe("participants/admission タブレット受付の純関数（設定上限を参照し追随する）", () => {
  afterEach(() => {
    delete process.env.MAX_TABLET_CONNECTIONS;
  });

  // codd: covers vb=VB-10
  it("既定 8：8 台目（connected=7）は受理され、9 台目（connected=8）は over_limit で拒否される", () => {
    // 上限は config の単一解決点から取り、その値だけを admitTablet へ注入する
    // （判定経路に固定 8 リテラルを置かない）。
    const limit = resolveMaxTabletConnections({ env: {} });
    // 期待値 8 は system 出力とは独立に記述し、解決値と突き合わせる。
    expect(limit).toBe(8);

    // 8 台目（既存 7 接続）の参加は成立する。
    const eighth: AdmissionResult = admitTablet({ limit, connected: 7 }, { name: "8人目" });
    expect(eighth.ok).toBe(true);
    expect(eighth.reason).toBeUndefined();

    // 9 台目（既存 8 接続＝上限到達）は受理されず over_limit を返す。
    const ninth: AdmissionResult = admitTablet({ limit, connected: 8 }, { name: "9人目" });
    expect(ninth.ok).toBe(false);
    expect(ninth.reason).toBe("over_limit");
  });

  // codd: covers vb=VB-14
  it("設定 32：32 台目（connected=31）は受理され、33 台目（connected=32）は over_limit で拒否される", () => {
    // process.env を単一解決点として読ませ、設定注入が受入境界へ追随することを固定する。
    process.env.MAX_TABLET_CONNECTIONS = "32";
    const limit = resolveMaxTabletConnections();
    expect(limit).toBe(32);

    const thirtySecond: AdmissionResult = admitTablet(
      { limit, connected: 31 },
      { name: "32人目" },
    );
    expect(thirtySecond.ok).toBe(true);

    const thirtyThird: AdmissionResult = admitTablet(
      { limit, connected: 32 },
      { name: "33人目" },
    );
    expect(thirtyThird.ok).toBe(false);
    expect(thirtyThird.reason).toBe("over_limit");
  });

  // codd: covers vb=VB-12
  it("同一 connected でも設定値注入で受入可否が変わる（判定は解決値を参照し固定 8 でない）", () => {
    // 同じ connected=8 を、既定(8)・設定16・設定32 の各解決値のもとで判定する。
    const request = { name: "同一境界入力" };

    const atDefault = admitTablet(
      { limit: resolveMaxTabletConnections({ env: {} }), connected: 8 },
      request,
    );
    const at16 = admitTablet(
      {
        limit: resolveMaxTabletConnections({
          env: { [MAX_TABLET_CONNECTIONS_ENV]: "16" },
        }),
        connected: 8,
      },
      request,
    );
    const at32 = admitTablet(
      {
        limit: resolveMaxTabletConnections({
          env: { [MAX_TABLET_CONNECTIONS_ENV]: "32" },
        }),
        connected: 8,
      },
      request,
    );

    // 既定(8)では connected=8 が上限到達で拒否される。
    expect(atDefault.ok).toBe(false);
    expect(atDefault.reason).toBe("over_limit");
    // 16/32 へ設定注入すると、同じ connected=8 が受理される＝判定が設定解決値へ追随する。
    expect(at16.ok).toBe(true);
    expect(at32.ok).toBe(true);
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
