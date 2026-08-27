/**
 * セッション Cookie の組立と解釈（`auth/cookie.ts`・設計 D2）。
 *
 * 固定する契約:
 *   - 発行 Cookie は必ず HttpOnly / SameSite=Lax / Path=/ を持つ（スクリプトから読めず、
 *     別サイトからの遷移で自動送信されない）。
 *   - `Secure` は https 配信のときだけ付く（http のローカル試遊で Cookie が落ちない）。
 *   - 壊れた Cookie ヘッダでも例外を投げず、読めた断片だけを返す。
 */

import { describe, it, expect } from "vitest";
import {
  SESSION_COOKIE_NAME,
  buildClearedSessionCookie,
  buildSessionCookie,
  isSecureOrigin,
  parseCookies,
  readSessionId,
} from "../../src/auth/cookie.js";

describe("auth/cookie セッション Cookie の属性と解釈", () => {
  it("発行 Cookie は HttpOnly / SameSite=Lax / Path=/ を必ず持つ", () => {
    const header = buildSessionCookie("abc123", false);
    expect(header.startsWith(`${SESSION_COOKIE_NAME}=abc123`)).toBe(true);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
  });

  it("Secure は https 配信のときだけ付く", () => {
    expect(buildSessionCookie("abc123", true)).toContain("Secure");
    expect(buildSessionCookie("abc123", false)).not.toContain("Secure");
    expect(isSecureOrigin("https://save-money.example.com")).toBe(true);
    expect(isSecureOrigin("http://127.0.0.1:3000")).toBe(false);
    expect(isSecureOrigin("not a url")).toBe(false);
  });

  it("破棄 Cookie は空値と Max-Age=0 で即時失効させる", () => {
    const header = buildClearedSessionCookie(false);
    expect(header).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("HttpOnly");
  });

  it("Cookie ヘッダから当該名の値を取り出し、無ければ undefined を返す", () => {
    expect(readSessionId(`${SESSION_COOKIE_NAME}=s3cr3t; other=1`)).toBe("s3cr3t");
    expect(readSessionId("other=1")).toBeUndefined();
    expect(readSessionId(undefined)).toBeUndefined();
    expect(readSessionId(`${SESSION_COOKIE_NAME}=`)).toBeUndefined();
  });

  it("壊れたヘッダでも例外を投げず、読めた断片だけを返す", () => {
    expect(parseCookies("=novalue; ; a=1; broken")).toEqual({ a: "1" });
    expect(parseCookies("a=%E6%97%A5")).toEqual({ a: "日" });
    // 不正な %エスケープは復号せず生値のまま返す（例外にしない）。
    expect(parseCookies("a=%zz")).toEqual({ a: "%zz" });
  });
});
