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
  DEFAULT_MAX_TABLET_CONNECTIONS,
  type ConfigSource,
} from "../../src/config/connection_limit.js";

describe("config/connection_limit 上限の設定外出し", () => {
  // codd: covers vb=VB-12
  it("MAX_TABLET_CONNECTIONS の設定注入で解決値が変わる（判定経路に固定 8 が無い）", () => {
    // env を明示注入して process.env に依存せず解決を固定する。
    const unset = resolveMaxTabletConnections({ env: {} });
    const at16 = resolveMaxTabletConnections({
      env: { [MAX_TABLET_CONNECTIONS_ENV]: "16" },
    });
    const at32 = resolveMaxTabletConnections({
      env: { [MAX_TABLET_CONNECTIONS_ENV]: "32" },
    });

    // 未設定は既定 8、注入で 16/32 へ同一コードのまま追随する。
    expect(unset).toBe(8);
    expect(at16).toBe(16);
    expect(at32).toBe(32);
    // 注入値が既定を上書きしている＝判定が固定 8 でない証左。
    expect(at16).not.toBe(unset);
    expect(at32).not.toBe(unset);
  });

  it("環境変数が無ければ設定ストア値（configured）へ追随する", () => {
    expect(resolveMaxTabletConnections({ env: {}, configured: 24 })).toBe(24);
  });
});

describe("config/connection_limit ConfigSource 経由の解決（§2.8・DM-4）", () => {
  // read(key) が env or config テーブルを抽象化する汎用リーダ（設計 §2.8）を模す。
  const source = (v?: string): ConfigSource => ({ read: (_key: string) => v });

  it("未設定（read が undefined）時の既定は 8", () => {
    expect(resolveMaxTabletConnections(source(undefined))).toBe(8);
  });

  it("設定 '32' を非改修で反映する", () => {
    expect(resolveMaxTabletConnections(source("32"))).toBe(32);
  });

  it("非正・非整数の設定値は既定 8 へフォールバックする（例外を投げない）", () => {
    // フォールバック先が既定値そのものであることを、既定 8 を独立に書いて検証する。
    expect(resolveMaxTabletConnections(source("0"))).toBe(8);
    expect(resolveMaxTabletConnections(source("-4"))).toBe(8);
    expect(resolveMaxTabletConnections(source("12.5"))).toBe(8);
    expect(resolveMaxTabletConnections(source("abc"))).toBe(8);
  });

  it("解決キーとして MAX_TABLET_CONNECTIONS が read へ渡る", () => {
    let requestedKey: string | undefined;
    const spySource: ConfigSource = {
      read: (key: string) => {
        requestedKey = key;
        return "16";
      },
    };
    expect(resolveMaxTabletConnections(spySource)).toBe(16);
    expect(requestedKey).toBe(MAX_TABLET_CONNECTIONS_ENV);
  });
});

describe("resolveMaxTabletConnections は process.env を単一解決点として読む（participation §2.5）", () => {
  afterEach(() => {
    delete process.env.MAX_TABLET_CONNECTIONS;
  });

  it("環境変数未設定なら既定 8 を解決する（判定経路に固定 8 リテラルを撒かない）", () => {
    delete process.env.MAX_TABLET_CONNECTIONS;
    const resolved = resolveMaxTabletConnections();
    // 期待値 8 は system 出力とは独立に書き、実解決値と突き合わせる。
    expect(resolved).toBe(8);
    // 解決値が既定値定数の唯一の宣言（DEFAULT_MAX_TABLET_CONNECTIONS）に由来することも固定。
    expect(resolved).toBe(DEFAULT_MAX_TABLET_CONNECTIONS);
  });

  it("環境変数 MAX_TABLET_CONNECTIONS を与えると解決値がその値へ追随する（16→32・非改修）", () => {
    process.env.MAX_TABLET_CONNECTIONS = "16";
    expect(resolveMaxTabletConnections()).toBe(16);

    process.env.MAX_TABLET_CONNECTIONS = "32";
    expect(resolveMaxTabletConnections()).toBe(32);
  });

  it("空・空白のみ・非整数・1 未満の環境変数値は既定 8 へフォールバックする（例外を投げない）", () => {
    // フォールバック先が既定値 8 であることを、期待値 8 を独立に書いて各不正値で検証する。
    for (const invalid of ["", "   ", "abc", "12.5", "0", "-4"]) {
      process.env.MAX_TABLET_CONNECTIONS = invalid;
      expect(resolveMaxTabletConnections()).toBe(8);
    }
  });
});
