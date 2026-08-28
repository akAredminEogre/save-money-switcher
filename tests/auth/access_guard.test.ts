/**
 * 保護サーフェスの門番（`auth/access_guard.ts`・AC-A1 / AC-A2 / 設計 D5）。
 *
 * 固定する契約:
 *   - 未認証は素通りせず、ログイン入口を伴う「未認証」判定へ落ちる（401 / HTML 面は誘導）。
 *   - 認証済みの非 admin（contestant）は 403 であり、ログインへ誘導しない（再ログインで解決せぬ拒否）。
 *   - 判定は例外へ化けず、常に 3 分岐のいずれかへ収束する（保護面を 5xx にしない）。
 */

import { describe, it, expect } from "vitest";
import { guardAdminSurface, isSafeRedirectTarget } from "../../src/auth/access_guard.js";
import { LOGIN_PATH } from "../../src/auth/login_link.js";
import { createSessionRegistry } from "../../src/auth/session_registry.js";
import { HTTP_FORBIDDEN, HTTP_UNAUTHENTICATED } from "../../src/participants/authorize.js";

describe("auth/access_guard admin 専用サーフェスの門番", () => {
  it("admin セッションは通過し、host セッションとして返る", () => {
    const registry = createSessionRegistry();
    const outcome = guardAdminSurface(registry.issue("admin-1", "host"));
    expect(outcome.kind).toBe("granted");
    if (outcome.kind === "granted") expect(outcome.session.role).toBe("host");
  });

  it("未認証（セッション無し・偽装ロール）は 401 とログイン入口を返す", () => {
    for (const session of [undefined, null, {}, { role: "superuser" }, "host", 42]) {
      const outcome = guardAdminSurface(session);
      expect(outcome.kind).toBe("unauthenticated");
      if (outcome.kind === "unauthenticated") {
        expect(outcome.status).toBe(HTTP_UNAUTHENTICATED);
        expect(outcome.loginPath).toBe(LOGIN_PATH);
      }
    }
  });

  it("認証済みだが admin でないロールは 403（ログインへ誘導しない）", () => {
    const registry = createSessionRegistry();
    for (const role of ["contestant", "audience"] as const) {
      const outcome = guardAdminSurface(registry.issue("account-1", role));
      expect(outcome.kind).toBe("forbidden");
      if (outcome.kind === "forbidden") expect(outcome.status).toBe(HTTP_FORBIDDEN);
    }
  });

  it("ログイン後の戻り先は同一オリジンの絶対パスだけを受理する", () => {
    expect(isSafeRedirectTarget("/control-panel")).toBe(true);
    expect(isSafeRedirectTarget("/admin?tab=1")).toBe(true);
    // 外部サイトへの誘導（open redirect）を成立させない。
    expect(isSafeRedirectTarget("//evil.example.com")).toBe(false);
    expect(isSafeRedirectTarget("https://evil.example.com")).toBe(false);
    expect(isSafeRedirectTarget("/\\evil.example.com")).toBe(false);
    expect(isSafeRedirectTarget("control-panel")).toBe(false);
    expect(isSafeRedirectTarget(undefined)).toBe(false);
    expect(isSafeRedirectTarget(42)).toBe(false);
  });
});
