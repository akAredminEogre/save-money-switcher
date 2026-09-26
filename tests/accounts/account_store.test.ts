/**
 * アカウント行の永続化境界（`accounts/account_store.ts` / `accounts/json_account_store.ts`・設計 D7）。
 *
 * 固定する契約:
 *   - `login_id` の一意性は境界の insert-if-absent が担保する（2 件目は挿入されない）。
 *   - 行 ⇄ ドメイン型の写像は往復して同値（snake_case ⇄ camelCase のドリフトを作らない）。
 *   - JSON ファイル実装は再生成しても内容を失わず（アトミック書込）、壊れたファイル・壊れた行は
 *     読み捨てて起動を止めない。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createInMemoryAccountStore,
  isAccountRow,
  toAccount,
  toAccountRow,
  type AccountRow,
} from "../../src/accounts/account_store.js";
import {
  accountsFilePath,
  ACCOUNTS_FILE_NAME,
  createJsonAccountStore,
} from "../../src/accounts/json_account_store.js";

function row(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: "acc-1",
    login_id: "host-lord",
    password_hash: "ab".repeat(64),
    password_salt: "cd".repeat(16),
    role: "admin",
    display_name: "司会者",
    created_at: "2026-08-28T00:00:00.000Z",
    updated_at: "2026-08-28T00:00:00.000Z",
    ...overrides,
  };
}

describe("accounts/account_store 行 ⇄ ドメイン型の写像と一意性の受入", () => {
  it("行 → ドメイン型 → 行 の往復で同値になる", () => {
    const original = row();
    expect(toAccountRow(toAccount(original))).toEqual(original);
  });

  it("未検査の値は必須列と正当なロールを備えるときだけ行として受理する", () => {
    expect(isAccountRow(row())).toBe(true);
    expect(isAccountRow({ ...row(), role: "superuser" })).toBe(false);
    expect(isAccountRow({ ...row(), login_id: 42 })).toBe(false);
    expect(isAccountRow(null)).toBe(false);
    expect(isAccountRow("not an object")).toBe(false);
  });

  it("同一 login_id の 2 件目は挿入されない（in-memory 実装）", async () => {
    const store = createInMemoryAccountStore();
    expect(await store.insertIfLoginIdAbsent(row())).toBe(true);
    expect(await store.insertIfLoginIdAbsent(row({ id: "acc-2" }))).toBe(false);
    expect((await store.listAccountsOrderedByCreatedAt()).length).toBe(1);
  });

  it("更新は既存 id にのみ作用し、存在しない id では何も起きない（in-memory 実装）", async () => {
    const store = createInMemoryAccountStore([row()]);
    expect(await store.updateIfPresent(row({ display_name: "殿" }))).toBe(true);
    expect((await store.findById("acc-1"))?.display_name).toBe("殿");
    expect(await store.updateIfPresent(row({ id: "missing" }))).toBe(false);
  });

  it("一覧は created_at 昇順で返る", async () => {
    const store = createInMemoryAccountStore([
      row({ id: "b", login_id: "b", created_at: "2026-08-28T02:00:00.000Z" }),
      row({ id: "a", login_id: "a", created_at: "2026-08-28T01:00:00.000Z" }),
    ]);
    expect((await store.listAccountsOrderedByCreatedAt()).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("accounts/json_account_store JSON ファイル永続（設計 D7）", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "smsw-accounts-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("挿入した行はファイルへ書かれ、新しいストアからも読み戻せる", async () => {
    const path = accountsFilePath(dir);
    expect(path.endsWith(ACCOUNTS_FILE_NAME)).toBe(true);

    const writer = createJsonAccountStore(path);
    expect(await writer.insertIfLoginIdAbsent(row())).toBe(true);

    // 別インスタンス（＝プロセス再起動相当）から読み戻す。
    const reader = createJsonAccountStore(path);
    expect(await reader.findByLoginId("host-lord")).toEqual(row());
    expect(await reader.findById("acc-1")).toEqual(row());

    // 実体は JSON 配列で、平文パスワードを持たない。
    const text = await readFile(path, "utf8");
    expect(JSON.parse(text)).toEqual([row()]);
  });

  it("更新は永続され、同一 login_id の 2 件目は拒まれる", async () => {
    const path = accountsFilePath(dir);
    const store = createJsonAccountStore(path);
    await store.insertIfLoginIdAbsent(row());
    expect(await store.insertIfLoginIdAbsent(row({ id: "acc-2" }))).toBe(false);
    expect(await store.updateIfPresent(row({ display_name: "殿" }))).toBe(true);

    const reader = createJsonAccountStore(path);
    expect((await reader.findById("acc-1"))?.display_name).toBe("殿");
  });

  it("ファイルが無いときは空集合として振る舞う（起動を止めない）", async () => {
    const store = createJsonAccountStore(join(dir, "nonexistent", ACCOUNTS_FILE_NAME));
    expect(await store.listAccountsOrderedByCreatedAt()).toEqual([]);
    expect(await store.findByLoginId("host-lord")).toBeUndefined();
  });

  it("壊れた JSON は退避され、空集合として読み進む", async () => {
    const path = accountsFilePath(dir);
    await mkdir(dir, { recursive: true });
    await writeFile(path, "{ this is not json", "utf8");

    const store = createJsonAccountStore(path);
    expect(await store.listAccountsOrderedByCreatedAt()).toEqual([]);
    // 壊れた実体は黙って失わず退避名へ残る。
    expect(await readFile(`${path}.corrupt-1`, "utf8")).toBe("{ this is not json");
  });

  it("壊れた行だけを読み捨て、正しい行は残す", async () => {
    const path = accountsFilePath(dir);
    await mkdir(dir, { recursive: true });
    await writeFile(path, JSON.stringify([row(), { id: "broken" }]), "utf8");

    const store = createJsonAccountStore(path);
    expect(await store.listAccountsOrderedByCreatedAt()).toEqual([row()]);
  });
});
