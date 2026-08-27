/**
 * scrypt 導出そのものが失敗したときの照合（`accounts/password.ts`・AC-A8）。
 *
 * `verifyPassword` は「照合できなかった」も「一致しなかった」も `false` で答える。導出失敗の例外を
 * 素通しすると、資格 1 件の異常がログイン要求を 500 へ化けさせ、健全性ベースライン（< 500）を割る。
 * 失敗の原因は要求元へ漏らさない（ID の存否を区別させない方針と揃う）。
 *
 * 導出失敗は実機で狙って起こせぬため、`node:crypto` の `scrypt` だけを差し替えて再現する。
 */

import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("node:crypto");
});

describe("accounts/password 導出失敗時の照合", () => {
  it("scrypt が失敗しても例外を投げず false へ収束する", async () => {
    vi.resetModules();
    vi.doMock("node:crypto", async () => {
      const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
      return {
        ...actual,
        // コールバック版 scrypt の失敗（資源枯渇・異常なパラメータ等）を模す。
        scrypt: (
          _password: unknown,
          _salt: unknown,
          _keylen: number,
          callback: (err: Error | null, derivedKey: Buffer) => void,
        ) => {
          callback(new Error("scrypt failed"), Buffer.alloc(0));
        },
      };
    });
    const { verifyPassword, KEY_LENGTH } = await import("../../src/accounts/password.js");
    // 資格そのものは正しい形（16 進・所定長）。壊れているのは導出側だけ。
    const credential = { hash: "ab".repeat(KEY_LENGTH), salt: "cd".repeat(16) };
    await expect(verifyPassword("family-quiz-2026", credential)).resolves.toBe(false);
  });
});
