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
  resolveMaxTabletConnections,
  MAX_TABLET_CONNECTIONS_ENV,
} from "../../src/config/connection_limit.js";
import { admitTablet } from "../../src/participants/admission.js";

// 受付判定は config の単一解決点 resolveMaxTabletConnections が返す上限を参照して
// 追随する。本スイートは env を注入して解決を固定し、resolver → admitTablet の配線が
// 8/9・16/17・32/33 の各境界で受入可否を正しく切り替えることを証す。受入は
// { ok: true } を返し、上限超過は例外を投げず { ok: false, reason: "over_limit" } を
// 返す純粋判定である（src/participants/admission.ts の確定契約・副作用なし）。
describe("participants/admission タブレット受付判定は設定上限へ追随する", () => {
  // codd: covers vb=VB-10
  it("上限未設定の既定 8：8 台目まで受入が成立する", () => {
    const limit = resolveMaxTabletConnections({ env: {} });
    // 期待値 8 は resolver 出力とは独立に書き、実解決値と突き合わせる。
    expect(limit).toBe(8);
    // connected 0..7（＝1〜8 台目）はいずれも受理される。上限は解決値へ束ねる。
    for (let connected = 0; connected < limit; connected++) {
      const decision = admitTablet({ limit, connected }, { name: `参加者${connected + 1}` });
      expect(decision.ok).toBe(true);
    }
  });

  // codd: covers vb=VB-12
  it("設定注入で同一接続数の受入可否が変わる（判定経路に固定 8 が無い）", () => {
    const at8 = resolveMaxTabletConnections({ env: {} });
    const at16 = resolveMaxTabletConnections({
      env: { [MAX_TABLET_CONNECTIONS_ENV]: "16" },
    });
    expect(at8).toBe(8);
    expect(at16).toBe(16);
    // 同一 connected 8（＝9 台目）で判定が反転する：既定 8 は拒否・設定 16 は受理。
    // 判定が設定解決値のみに依存し固定リテラル 8 に依らない証左。
    const rejected = admitTablet({ limit: at8, connected: 8 }, { name: "9人目" });
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toBe("over_limit");
    expect(admitTablet({ limit: at16, connected: 8 }, { name: "9人目" }).ok).toBe(true);
  });

  // codd: covers vb=VB-13
  it("設定 16：16 台目まで受理・17 台目拒否（コード改修なし追随）", () => {
    const limit = resolveMaxTabletConnections({
      env: { [MAX_TABLET_CONNECTIONS_ENV]: "16" },
    });
    expect(limit).toBe(16);
    // 16 台目 = connected 15 は受理される。
    expect(admitTablet({ limit, connected: 15 }, { name: "16人目" }).ok).toBe(true);
    // 17 台目 = connected 16 は拒否される。
    const rejected = admitTablet({ limit, connected: 16 }, { name: "17人目" });
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toBe("over_limit");
  });

  // codd: covers vb=VB-14
  it("設定 32：32 台目まで受理・33 台目拒否", () => {
    const limit = resolveMaxTabletConnections({
      env: { [MAX_TABLET_CONNECTIONS_ENV]: "32" },
    });
    expect(limit).toBe(32);
    // 32 台目 = connected 31 は受理される。
    expect(admitTablet({ limit, connected: 31 }, { name: "32人目" }).ok).toBe(true);
    // 33 台目 = connected 32 は拒否される。
    const rejected = admitTablet({ limit, connected: 32 }, { name: "33人目" });
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toBe("over_limit");
  });

  // codd: covers vb=VB-15
  it("上限超過拒否は純粋判定で入力を変えず、スロット解放後は同数まで再受入できる", () => {
    const limit = resolveMaxTabletConnections({ env: {} });
    const state = Object.freeze({ limit, connected: 8 });
    const request = Object.freeze({ name: "9人目" });
    // 拒否は判定結果（{ ok: false }）のみで、渡した会計・要求を書き換えない（副作用なし）。
    const rejected = admitTablet(state, request);
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toBe("over_limit");
    expect(state.connected).toBe(8);
    expect(request.name).toBe("9人目");
    // 拒否は恒久的にスロットを消費しない：切断で 1 枠空けば（connected 7）同数まで再受入可。
    expect(admitTablet({ limit, connected: 7 }, { name: "再参加" }).ok).toBe(true);
  });
});
