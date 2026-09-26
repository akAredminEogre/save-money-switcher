/**
 * パスワードのハッシュ生成と照合（`accounts/password.ts`・AC-A8）。
 *
 * 固定する契約:
 *   - 平文は資格（{@link PasswordCredential}）へ一切現れない（保存物から平文が復元できない）。
 *   - 同じ平文でも呼び出しごとにソルトが変わり、ハッシュも変わる（レインボー表・使い回し検知を封じる）。
 *   - 正しい平文だけが照合を通り、誤った平文・壊れた資格は例外ではなく `false` へ収束する
 *     （認証経路を 5xx へ化けさせない）。
 */

import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  isAcceptablePassword,
  MIN_PASSWORD_LENGTH,
  KEY_LENGTH,
} from "../../src/accounts/password.js";

describe("accounts/password scrypt によるハッシュ生成と定数時間照合", () => {
  it("生成した資格に平文が現れず、hash/salt は 16 進で所定の長さになる", async () => {
    const plain = "correct horse battery staple";
    const credential = await hashPassword(plain);
    expect(credential.hash).not.toContain(plain);
    expect(credential.salt).not.toContain(plain);
    expect(credential.hash).toMatch(/^[0-9a-f]+$/);
    expect(credential.salt).toMatch(/^[0-9a-f]+$/);
    // 16 進 2 文字 = 1 バイト。導出鍵長はモジュールの単一定義から導く。
    expect(credential.hash.length).toBe(KEY_LENGTH * 2);
  });

  it("同じ平文でも毎回ソルトが変わり、ハッシュも一致しない", async () => {
    const first = await hashPassword("same-password-value");
    const second = await hashPassword("same-password-value");
    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
  });

  it("正しい平文だけが照合を通る", async () => {
    const credential = await hashPassword("family-quiz-2026");
    expect(await verifyPassword("family-quiz-2026", credential)).toBe(true);
    expect(await verifyPassword("family-quiz-2025", credential)).toBe(false);
    expect(await verifyPassword("", credential)).toBe(false);
  });

  it("壊れた資格（16 進でない・長さ不一致）は例外を投げず false を返す", async () => {
    expect(await verifyPassword("whatever", { hash: "zzzz", salt: "abcd" })).toBe(false);
    expect(await verifyPassword("whatever", { hash: "ab", salt: "abcd" })).toBe(false);
    expect(await verifyPassword("whatever", { hash: "", salt: "" })).toBe(false);
  });

  it("受理境界は最短長のみで、境界値の直下は拒否し直上は受理する", () => {
    expect(MIN_PASSWORD_LENGTH).toBeGreaterThan(0);
    expect(isAcceptablePassword("a".repeat(MIN_PASSWORD_LENGTH - 1))).toBe(false);
    expect(isAcceptablePassword("a".repeat(MIN_PASSWORD_LENGTH))).toBe(true);
    // 上限は設けない（長いパスフレーズを拒まない）。
    expect(isAcceptablePassword("a".repeat(200))).toBe(true);
  });
});
