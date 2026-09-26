/**
 * ログイン URL の組立（`auth/login_link.ts`・設計 D4 / D6）。
 *
 * 旧 `tests/participants/join_link.test.ts`（QR が `/join` を符号化する契約）を、案A の
 * 「QR はログイン入口を符号化する」へ**書き直した**もの。QR は破棄せず意味を付け替える（D6）。
 */

import { describe, it, expect, afterEach } from "vitest";
import { buildLoginUrl, LOGIN_PATH } from "../../src/auth/login_link.js";
import {
  PUBLIC_BASE_URL_ENV,
  PublicBaseUrlNotConfiguredError,
} from "../../src/config/public_base_url.js";

describe("auth/login_link ログイン URL の組立（QR が符号化する公開 URL）", () => {
  afterEach(() => {
    delete process.env[PUBLIC_BASE_URL_ENV];
  });

  it("パスの唯一の宣言点は /login である（旧 join_surface の誘導先を引き継ぐ）", () => {
    expect(LOGIN_PATH).toBe("/login");
  });

  it("origin が PUBLIC_BASE_URL と一致し pathname が /login になる", () => {
    process.env[PUBLIC_BASE_URL_ENV] = "https://save-money.example.com";
    const url = new URL(buildLoginUrl());
    expect(url.origin).toBe("https://save-money.example.com");
    expect(url.pathname).toBe("/login");
  });

  it("注入ソース（env）でも process.env に依存せず解決する", () => {
    const url = new URL(buildLoginUrl({ env: { [PUBLIC_BASE_URL_ENV]: "https://family.example.net" } }));
    expect(url.origin).toBe("https://family.example.net");
    expect(url.pathname).toBe("/login");
  });

  it("基底 URL にパス・末尾スラッシュがあっても /login を絶対パスとして解決する", () => {
    const url = new URL(
      buildLoginUrl({ env: { [PUBLIC_BASE_URL_ENV]: "https://save-money.example.com/app/" } }),
    );
    expect(url.origin).toBe("https://save-money.example.com");
    expect(url.pathname).toBe("/login");
  });

  it("秘匿トークンのクエリを付与しない（案A の家族限定アクセスは認証で成立する）", () => {
    const url = new URL(
      buildLoginUrl({ env: { [PUBLIC_BASE_URL_ENV]: "https://save-money.example.com" } }),
    );
    expect(url.search).toBe("");
  });

  it("PUBLIC_BASE_URL 未設定は設定不備として拒否する（誤った URL を捏造しない）", () => {
    expect(() => buildLoginUrl({ env: {} })).toThrow(PublicBaseUrlNotConfiguredError);
  });
});
