/**
 * サーバ側セッション台帳（`auth/session_registry.ts`・設計 D2）。
 *
 * 固定する契約:
 *   - 発行したセッションは `sid` で解決でき、破棄すると解決できなくなる。
 *   - 発行するセッションは既存 {@link Session}（`participants/authorize.ts`）を満たし、
 *     `requireHost` の判定へそのまま渡せる（判定核を二重に作らない）。
 *   - `sid` は推測不能な 128bit の乱数であり、発行ごとに異なる。
 */

import { describe, it, expect } from "vitest";
import {
  createSessionRegistry,
  newSessionId,
  SESSION_ID_BYTES,
} from "../../src/auth/session_registry.js";
import { requireHost, ForbiddenRoleError, UnauthenticatedError } from "../../src/participants/authorize.js";

describe("auth/session_registry セッションの発行・解決・破棄", () => {
  it("発行したセッションは sid で解決でき、破棄すると解決できない", () => {
    const registry = createSessionRegistry();
    const session = registry.issue("account-1", "host");
    expect(registry.get(session.sid)).toEqual(session);
    expect(registry.size()).toBe(1);
    registry.destroy(session.sid);
    expect(registry.get(session.sid)).toBeUndefined();
    expect(registry.size()).toBe(0);
  });

  it("未知・未指定の sid は undefined を返し、破棄も失敗しない", () => {
    const registry = createSessionRegistry();
    expect(registry.get("unknown")).toBeUndefined();
    expect(registry.get(undefined)).toBeUndefined();
    expect(() => registry.destroy("unknown")).not.toThrow();
    expect(() => registry.destroy(undefined)).not.toThrow();
  });

  it("発行したセッションは既存の認可判定 requireHost へそのまま渡せる", () => {
    const registry = createSessionRegistry();
    const host = registry.issue("admin-1", "host");
    expect(requireHost(host).role).toBe("host");

    const contestant = registry.issue("contestant-1", "contestant");
    expect(() => requireHost(contestant)).toThrow(ForbiddenRoleError);
    // 未ログイン（解決できない）は 401 側へ落ちる。
    expect(() => requireHost(registry.get("nope"))).toThrow(UnauthenticatedError);
  });

  it("sid は 128bit の乱数を 16 進で表し、発行ごとに異なる", () => {
    const first = newSessionId();
    const second = newSessionId();
    expect(first).toMatch(/^[0-9a-f]+$/);
    expect(first.length).toBe(SESSION_ID_BYTES * 2);
    expect(first).not.toBe(second);
  });

  it("採番・時刻は注入でき、決定的に固定できる", () => {
    let counter = 0;
    const registry = createSessionRegistry({
      newSessionId: () => `sid-${++counter}`,
      now: () => "2026-08-28T00:00:00.000Z",
    });
    const session = registry.issue("account-1", "contestant");
    expect(session.sid).toBe("sid-1");
    expect(session.issuedAt).toBe("2026-08-28T00:00:00.000Z");
    expect(session.accountId).toBe("account-1");
  });
});
