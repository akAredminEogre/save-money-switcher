// @generated-by: codd implement
// @generated-from: docs/design/participation_connection_design.md (design:participation-connection-design)
// @design-node: docs/design/participation_connection_design.md
// @output-paths: src, tests
// @generated-from: docs/design/realtime_sync_design.md (design:realtime-sync-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  checkJoinAccess,
  type AccessDecision,
} from "../../src/participants/access_control.js";
import {
  JOIN_ACCESS_MODE_ENV,
  JOIN_ACCESS_TOKEN_ENV,
} from "../../src/config/access_control_config.js";

describe("participants/access_control 家族限定アクセスゲート（無制御公開を成立させない）", () => {
  // 既定(process.env)経路の判定を決定的にするため、各テスト前後で設定を確実に未構成へ戻す。
  // 注入ソース（{ env }）を渡すテストは process.env に依存しないため本クリーンアップの影響を受けない。
  beforeEach(() => {
    delete process.env[JOIN_ACCESS_MODE_ENV];
    delete process.env[JOIN_ACCESS_TOKEN_ENV];
  });
  afterEach(() => {
    delete process.env[JOIN_ACCESS_MODE_ENV];
    delete process.env[JOIN_ACCESS_TOKEN_ENV];
  });

  // codd: covers vb=VB-56
  it("アクセス制御が未構成なら参加を許可しない（無制御公開は成立しない・fail-closed）", () => {
    // 既定(process.env)経路：方式未設定＝無構成。認証状態・トークン提示に依らず拒否する。
    expect(checkJoinAccess({ authenticated: false }).granted).toBe(false);
    // 認証済を主張しても、方式が未構成なら分岐Bは作動せず拒否される。
    expect(checkJoinAccess({ authenticated: true }).granted).toBe(false);
    // 秘匿トークンを提示しても、方式が未構成なら分岐Aは作動せず拒否される。
    expect(
      checkJoinAccess({ presentedToken: "any-token", authenticated: false }).granted,
    ).toBe(false);
    // 注入ソース（空 env）経路でも同様に未構成は拒否される。
    expect(checkJoinAccess({ authenticated: true }, { env: {} }).granted).toBe(false);
  });

  // codd: covers vb=VB-57
  it("分岐A（URL 秘匿）：提示トークンが設定トークンと一致するときのみ許可し、不一致・未提示は拒否する", () => {
    process.env[JOIN_ACCESS_MODE_ENV] = "url_secret";
    process.env[JOIN_ACCESS_TOKEN_ENV] = "family-secret";

    // 一致 → 許可。
    expect(
      checkJoinAccess({ presentedToken: "family-secret", authenticated: false }).granted,
    ).toBe(true);
    // 不一致 → 拒否。
    expect(
      checkJoinAccess({ presentedToken: "wrong-token", authenticated: false }).granted,
    ).toBe(false);
    // 未提示 → 拒否。
    expect(checkJoinAccess({ authenticated: false }).granted).toBe(false);
    // 分岐Aではトークン一致のみが根拠であり、認証済でも不一致なら拒否される。
    expect(
      checkJoinAccess({ presentedToken: "wrong-token", authenticated: true }).granted,
    ).toBe(false);
  });

  it("分岐A（URL 秘匿）：設定トークンが未構成なら提示に依らず拒否する（空トークン一致による無防備を作らない）", () => {
    // 方式は url_secret だが設定トークンは未設定（beforeEach で削除済み）。
    process.env[JOIN_ACCESS_MODE_ENV] = "url_secret";
    expect(checkJoinAccess({ authenticated: false }).granted).toBe(false);
    expect(checkJoinAccess({ presentedToken: "", authenticated: false }).granted).toBe(false);
    expect(
      checkJoinAccess({ presentedToken: "family-secret", authenticated: false }).granted,
    ).toBe(false);

    // 空白のみのトークン設定も未構成扱い（resolveJoinAccessToken が undefined 化）。提示が空白でも拒否。
    const whitespaceToken = {
      env: {
        [JOIN_ACCESS_MODE_ENV]: "url_secret",
        [JOIN_ACCESS_TOKEN_ENV]: "   ",
      },
    };
    expect(
      checkJoinAccess({ presentedToken: "   ", authenticated: false }, whitespaceToken).granted,
    ).toBe(false);
  });

  it("分岐B（認証）：認証済のときのみ許可し、未認証は拒否する", () => {
    process.env[JOIN_ACCESS_MODE_ENV] = "authenticated";

    expect(checkJoinAccess({ authenticated: true }).granted).toBe(true);
    expect(checkJoinAccess({ authenticated: false }).granted).toBe(false);
    // 分岐Bでは提示トークンは根拠にならず、未認証なら拒否される。
    expect(
      checkJoinAccess({ presentedToken: "family-secret", authenticated: false }).granted,
    ).toBe(false);
  });

  it("方式・トークンは注入ソースから単一経路で解決でき、既定(process.env)に依存せず判定できる", () => {
    const urlSecret = {
      env: {
        [JOIN_ACCESS_MODE_ENV]: "url_secret",
        [JOIN_ACCESS_TOKEN_ENV]: "s3cr3t-link",
      },
    };
    expect(
      checkJoinAccess({ presentedToken: "s3cr3t-link", authenticated: false }, urlSecret).granted,
    ).toBe(true);
    expect(
      checkJoinAccess({ presentedToken: "nope", authenticated: false }, urlSecret).granted,
    ).toBe(false);

    const authenticated = { env: { [JOIN_ACCESS_MODE_ENV]: "authenticated" } };
    expect(checkJoinAccess({ authenticated: true }, authenticated).granted).toBe(true);
    expect(checkJoinAccess({ authenticated: false }, authenticated).granted).toBe(false);
  });

  it("戻り値は granted 判定を持つ AccessDecision であり、typed access で形状へ束縛できる", () => {
    // producer が宣言する型で束縛し、形状（granted）のドリフトをコンパイル時に検知する。
    const decision: AccessDecision = checkJoinAccess({ authenticated: false }, { env: {} });
    expect(decision.granted).toBe(false);
    expect(typeof decision.granted).toBe("boolean");
  });
});
