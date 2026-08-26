// @generated-by: codd implement
// @generated-from: docs/design/system_design.md (design:system-design)
// @design-node: docs/design/system_design.md
// @output-paths: src, tests
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { afterEach, describe, expect, it } from "vitest";
import {
  InvalidConnectionLimitError,
  MAX_TABLET_CONNECTIONS_ENV,
  resolveMaxTabletConnections,
} from "../src/config/connection_limit.js";

describe("config/connection_limit resolveMaxTabletConnections", () => {
  afterEach(() => {
    delete process.env[MAX_TABLET_CONNECTIONS_ENV];
  });

  it("未設定時は既定 8 台へ解決する", () => {
    delete process.env[MAX_TABLET_CONNECTIONS_ENV];
    expect(resolveMaxTabletConnections()).toBe(8);
  });

  // codd: covers vb=VB-12
  it("MAX_TABLET_CONNECTIONS の注入で解決値が変わりコード改修なしに追随する（判定経路に固定 8 が無い）", () => {
    delete process.env[MAX_TABLET_CONNECTIONS_ENV];
    const unset = resolveMaxTabletConnections();

    process.env[MAX_TABLET_CONNECTIONS_ENV] = "32";
    const injected32 = resolveMaxTabletConnections();

    process.env[MAX_TABLET_CONNECTIONS_ENV] = "16";
    const injected16 = resolveMaxTabletConnections();

    // 既定は 8、注入で 32/16 へ同一コードのまま追随する。
    expect(unset).toBe(8);
    expect(injected32).toBe(32);
    expect(injected16).toBe(16);
    // 判定経路が固定 8 でない証左: 注入値が既定を上書きしている。
    expect(injected32).not.toBe(unset);
    expect(injected16).not.toBe(unset);
  });

  it("公開された環境変数名が実際の解決キーとして用いられる", () => {
    process.env[MAX_TABLET_CONNECTIONS_ENV] = "24";
    expect(resolveMaxTabletConnections()).toBe(24);
  });

  it("環境変数が未設定なら注入された設定ストア値へ解決する", () => {
    delete process.env[MAX_TABLET_CONNECTIONS_ENV];
    expect(resolveMaxTabletConnections({ configured: 16 })).toBe(16);
    expect(resolveMaxTabletConnections({ configured: "20" })).toBe(20);
  });

  it("環境変数は設定ストア値より優先される（env→config→default 順）", () => {
    process.env[MAX_TABLET_CONNECTIONS_ENV] = "32";
    expect(resolveMaxTabletConnections({ configured: 16 })).toBe(32);
  });

  it("注入した env ソースからも解決できる（グローバルに依存しない）", () => {
    delete process.env[MAX_TABLET_CONNECTIONS_ENV];
    const resolved = resolveMaxTabletConnections({
      env: { [MAX_TABLET_CONNECTIONS_ENV]: "40" },
    });
    expect(resolved).toBe(40);
  });

  it("空文字・空白のみは未設定として既定へフォールバックする", () => {
    process.env[MAX_TABLET_CONNECTIONS_ENV] = "";
    expect(resolveMaxTabletConnections()).toBe(8);
    process.env[MAX_TABLET_CONNECTIONS_ENV] = "   ";
    expect(resolveMaxTabletConnections()).toBe(8);
  });

  it("正の整数として解釈できない設定ストア値（configured）は InvalidConnectionLimitError で拒否する", () => {
    delete process.env[MAX_TABLET_CONNECTIONS_ENV];
    // 明示注入された設定ストア値の不正値は厳格に拒否する（設計 §2.8・§4.4）。
    expect(() => resolveMaxTabletConnections({ configured: "abc" })).toThrow(
      InvalidConnectionLimitError,
    );
    expect(() => resolveMaxTabletConnections({ configured: -5 })).toThrow(
      InvalidConnectionLimitError,
    );
    expect(() => resolveMaxTabletConnections({ configured: 3.5 })).toThrow(
      InvalidConnectionLimitError,
    );
    expect(() => resolveMaxTabletConnections({ configured: 0 })).toThrow(
      InvalidConnectionLimitError,
    );
    // 一方、環境変数経由の不正値は寛容に既定 8 へフォールバックする（例外を投げない）。
    process.env[MAX_TABLET_CONNECTIONS_ENV] = "abc";
    expect(resolveMaxTabletConnections()).toBe(8);
  });
});
