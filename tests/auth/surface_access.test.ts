/**
 * live 購読サーフェスの認可（`auth/surface_access.ts`・設計 D2 / D5）。
 *
 * 固定する契約:
 *   - クライアントが申告できるのは「面」だけで、投影ロールはサーバが決める
 *     （`role=host` と名乗るだけで司会者投影を受け取れない）。
 *   - 制御盤の購読は admin セッションのみ（未認証 401 / 非 admin 403）。
 *   - 解答面の購読はログイン済みなら誰でも可で、ロールに関わらず解答者投影が流れる。
 *   - TV は観客向け受動面ゆえ誰でも購読でき、観客投影だけが流れる。
 */

import { describe, it, expect } from "vitest";
import {
  authorizeLiveSurface,
  isLiveSurface,
  toLiveSurface,
} from "../../src/auth/surface_access.js";
import { createSessionRegistry } from "../../src/auth/session_registry.js";

const registry = createSessionRegistry();
const adminSession = registry.issue("admin-1", "host");
const contestantSession = registry.issue("contestant-1", "answerer");

describe("auth/surface_access 面の申告と投影ロールの決定", () => {
  it("未知・未指定の面の申告は観客面へ収束する（申告値で権限が上がらない）", () => {
    expect(isLiveSurface("control_panel")).toBe(true);
    expect(isLiveSurface("host")).toBe(false);
    expect(toLiveSurface("control_panel")).toBe("control_panel");
    expect(toLiveSurface("host")).toBe("tv");
    expect(toLiveSurface(undefined)).toBe("tv");
    expect(toLiveSurface(null)).toBe("tv");
  });

  it("制御盤の購読は admin セッションのみが通り、host 投影が流れる", () => {
    expect(authorizeLiveSurface("control_panel", adminSession)).toEqual({
      kind: "granted",
      role: "host",
    });
    expect(authorizeLiveSurface("control_panel", undefined)).toEqual({
      kind: "denied",
      status: 401,
    });
    expect(authorizeLiveSurface("control_panel", contestantSession)).toEqual({
      kind: "denied",
      status: 403,
    });
  });

  it("解答面の購読はログイン済みなら誰でも可で、ロールに関わらず解答者投影が流れる", () => {
    // 司会者が解答面を開いても、その面には解答面の投影が要る（制御盤の投影を流さない）。
    expect(authorizeLiveSurface("tablet", adminSession)).toEqual({
      kind: "granted",
      role: "answerer",
    });
    expect(authorizeLiveSurface("tablet", contestantSession)).toEqual({
      kind: "granted",
      role: "answerer",
    });
    expect(authorizeLiveSurface("tablet", undefined)).toEqual({ kind: "denied", status: 401 });
  });

  it("TV は誰でも購読でき、観客投影だけが流れる", () => {
    for (const session of [undefined, adminSession, contestantSession]) {
      expect(authorizeLiveSurface("tv", session)).toEqual({ kind: "granted", role: "audience" });
    }
  });
});
