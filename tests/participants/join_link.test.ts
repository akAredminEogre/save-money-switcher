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
import { buildJoinUrl } from "../../src/participants/join_link.js";
import {
  PUBLIC_BASE_URL_ENV,
  PublicBaseUrlNotConfiguredError,
} from "../../src/config/public_base_url.js";
import {
  JOIN_ACCESS_MODE_ENV,
  JOIN_ACCESS_TOKEN_ENV,
  resolveJoinAccessToken,
} from "../../src/config/access_control_config.js";

describe("participants/join_link 参加 URL の組立（クラウド公開 /join を符号化する）", () => {
  // process.env 経路のテストを決定的にするため、各テスト後に設定を確実に未構成へ戻す。
  // 注入ソース（{ env }）経路のテストは process.env に依存しないため本クリーンアップの影響を受けない。
  afterEach(() => {
    delete process.env[PUBLIC_BASE_URL_ENV];
    delete process.env[JOIN_ACCESS_MODE_ENV];
    delete process.env[JOIN_ACCESS_TOKEN_ENV];
  });

  // codd: covers vb=VB-06
  it("origin が PUBLIC_BASE_URL と一致し pathname が /join になる（QR が符号化する公開 URL）", () => {
    // process.env を単一解決点として読ませ、基底が参加 URL の origin/path に反映されることを固定する。
    process.env[PUBLIC_BASE_URL_ENV] = "https://save-money.example.com";
    const url = new URL(buildJoinUrl());
    // 期待値は system 出力とは独立にリテラルで記述し、組み立てられた URL と突き合わせる。
    expect(url.origin).toBe("https://save-money.example.com");
    expect(url.pathname).toBe("/join");
  });

  it("注入ソース（env）でも process.env に依存せず origin/pathname を解決する", () => {
    const url = new URL(
      buildJoinUrl({ env: { [PUBLIC_BASE_URL_ENV]: "https://family.example.net" } }),
    );
    expect(url.origin).toBe("https://family.example.net");
    expect(url.pathname).toBe("/join");
  });

  it("基底 URL にパス・末尾スラッシュがあっても /join を絶対パスとして解決する", () => {
    const url = new URL(
      buildJoinUrl({
        env: { [PUBLIC_BASE_URL_ENV]: "https://save-money.example.com/app/" },
      }),
    );
    // "/join" は絶対パスゆえ基底のパス(/app/)を置換し、origin は保たれる。
    expect(url.origin).toBe("https://save-money.example.com");
    expect(url.pathname).toBe("/join");
  });

  it("分岐A（URL 秘匿）：設定された秘匿トークンをクエリ t として付与する", () => {
    const url = new URL(
      buildJoinUrl({
        env: {
          [PUBLIC_BASE_URL_ENV]: "https://save-money.example.com",
          [JOIN_ACCESS_MODE_ENV]: "url_secret",
          [JOIN_ACCESS_TOKEN_ENV]: "family-secret",
        },
      }),
    );
    // 期待トークンはリテラルで独立に記述し、クエリ "t" から読み出した値と突き合わせる。
    expect(url.searchParams.get("t")).toBe("family-secret");
    // 経路は /join のまま保たれる。
    expect(url.pathname).toBe("/join");
  });

  it("トークン未設定（分岐 B / 未構成）ではクエリ t を付与しない", () => {
    const url = new URL(
      buildJoinUrl({ env: { [PUBLIC_BASE_URL_ENV]: "https://save-money.example.com" } }),
    );
    expect(url.searchParams.has("t")).toBe(false);
  });

  it("空・空白のみのトークン設定ではクエリ t を付与しない（空トークン一致による無防備を作らない）", () => {
    const url = new URL(
      buildJoinUrl({
        env: {
          [PUBLIC_BASE_URL_ENV]: "https://save-money.example.com",
          [JOIN_ACCESS_MODE_ENV]: "url_secret",
          [JOIN_ACCESS_TOKEN_ENV]: "   ",
        },
      }),
    );
    expect(url.searchParams.has("t")).toBe(false);
  });

  it("クエリ t に載る提示トークンは resolveJoinAccessToken の照合期待値と単一出所で一致する", () => {
    const env = {
      [PUBLIC_BASE_URL_ENV]: "https://save-money.example.com",
      [JOIN_ACCESS_MODE_ENV]: "url_secret",
      [JOIN_ACCESS_TOKEN_ENV]: "s3cr3t-link",
    };
    const presented = new URL(buildJoinUrl({ env })).searchParams.get("t");
    const expectedByGate = resolveJoinAccessToken({ env });
    // 設定した秘匿トークン（リテラル）に対し、URL に載せた値・ゲートの照合期待値の双方が一致する。
    expect(presented).toBe("s3cr3t-link");
    expect(expectedByGate).toBe("s3cr3t-link");
    // 提示⇄照合の往復が同一値になる（buildJoinUrl はトークンを発明・変形しない）。
    expect(presented).toBe(expectedByGate);
  });

  it("PUBLIC_BASE_URL 未設定なら参加 URL を組み立てず fail-closed で失敗する（無基底の公開参加を成立させない）", () => {
    // 既定基底（localhost 等）へ代替せず、基底解決点の設定不備エラーを伝播する（PC-INV-6）。
    expect(() => buildJoinUrl({ env: {} })).toThrow(PublicBaseUrlNotConfiguredError);
  });
});
