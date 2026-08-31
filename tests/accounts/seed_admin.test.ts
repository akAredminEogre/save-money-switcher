/**
 * 初期管理者の投入（`accounts/seed_admin.ts`・殿裁可 案i / 設計 Q1）。
 *
 * 固定する契約:
 *   - 資格情報は環境変数からのみ入り、コード・保存物へ平文が残らない（AC-A8）。
 *   - 冪等: 何度呼んでも管理者は 1 件のまま増えず、既存のパスワードを上書きしない
 *     （殿が変更したパスワードを次回起動で初期値へ戻さない）。
 *   - env 未構成なら何もせず `not_configured` を返す（初期投入前でも起動を止めない）。
 */

import { describe, it, expect } from "vitest";
import {
  ADMIN_DISPLAY_NAME_ENV,
  ADMIN_INITIAL_PASSWORD_ENV,
  ADMIN_LOGIN_ID_ENV,
  DEFAULT_ADMIN_DISPLAY_NAME,
  resolveInitialAdminCredentials,
  seedInitialAdmin,
  seedInitialAdminFromEnv,
} from "../../src/accounts/seed_admin.js";
import { createInMemoryAccountStore } from "../../src/accounts/account_store.js";
import { authenticate, changePassword, listAccounts, WeakPasswordError } from "../../src/accounts/account_service.js";
import { ROLE_LABELS } from "../../src/game_state/role_labels.js";

const PLAIN = "initial-admin-secret";

describe("accounts/seed_admin env からの資格情報解決", () => {
  it("ログイン ID とパスワードが揃っているときだけ資格情報を返す", () => {
    expect(
      resolveInitialAdminCredentials({
        env: { [ADMIN_LOGIN_ID_ENV]: "lord", [ADMIN_INITIAL_PASSWORD_ENV]: PLAIN },
      }),
    ).toEqual({ loginId: "lord", password: PLAIN, displayName: DEFAULT_ADMIN_DISPLAY_NAME });

    expect(resolveInitialAdminCredentials({ env: {} })).toBeUndefined();
    expect(
      resolveInitialAdminCredentials({ env: { [ADMIN_LOGIN_ID_ENV]: "lord" } }),
    ).toBeUndefined();
    expect(
      resolveInitialAdminCredentials({ env: { [ADMIN_INITIAL_PASSWORD_ENV]: PLAIN } }),
    ).toBeUndefined();
    expect(
      resolveInitialAdminCredentials({
        env: { [ADMIN_LOGIN_ID_ENV]: "   ", [ADMIN_INITIAL_PASSWORD_ENV]: PLAIN },
      }),
    ).toBeUndefined();
  });

  it("表示名は任意で、未設定なら可視ラベル「司会者」を用いる（内部識別子を出さない）", () => {
    expect(DEFAULT_ADMIN_DISPLAY_NAME).toBe(ROLE_LABELS.host);
    expect(
      resolveInitialAdminCredentials({
        env: {
          [ADMIN_LOGIN_ID_ENV]: "lord",
          [ADMIN_INITIAL_PASSWORD_ENV]: PLAIN,
          [ADMIN_DISPLAY_NAME_ENV]: "殿",
        },
      })?.displayName,
    ).toBe("殿");
  });
});

describe("accounts/seed_admin 投入の冪等性", () => {
  it("初回は admin を 1 件作り、その資格情報でログインできる", async () => {
    const store = createInMemoryAccountStore();
    const outcome = await seedInitialAdmin(store, {
      loginId: "lord",
      password: PLAIN,
      displayName: "殿",
    });
    expect(outcome.status).toBe("created");
    const accounts = await listAccounts(store);
    expect(accounts.length).toBe(1);
    expect(accounts[0]?.role).toBe("admin");
    expect(await authenticate(store, "lord", PLAIN)).toBeDefined();
    // 保存物に平文が残らない。
    expect(JSON.stringify(accounts)).not.toContain(PLAIN);
  });

  it("二度目以降は何もせず、アカウントは 1 件のまま", async () => {
    const store = createInMemoryAccountStore();
    await seedInitialAdmin(store, { loginId: "lord", password: PLAIN, displayName: "殿" });
    const second = await seedInitialAdmin(store, {
      loginId: "lord",
      password: PLAIN,
      displayName: "殿",
    });
    expect(second.status).toBe("already_exists");
    expect((await listAccounts(store)).length).toBe(1);
  });

  it("殿が変更したパスワードを再投入で初期値へ戻さない", async () => {
    const store = createInMemoryAccountStore();
    const created = await seedInitialAdmin(store, {
      loginId: "lord",
      password: PLAIN,
      displayName: "殿",
    });
    expect(created.status).toBe("created");
    if (created.status !== "created") return;
    await changePassword(store, created.account.id, "changed-by-the-lord");

    await seedInitialAdmin(store, { loginId: "lord", password: PLAIN, displayName: "殿" });
    expect(await authenticate(store, "lord", "changed-by-the-lord")).toBeDefined();
    expect(await authenticate(store, "lord", PLAIN)).toBeUndefined();
  });

  it("env 未構成なら何もせず not_configured を返す（起動を止めない）", async () => {
    const store = createInMemoryAccountStore();
    expect((await seedInitialAdminFromEnv(store, { env: {} })).status).toBe("not_configured");
    expect(await listAccounts(store)).toEqual([]);
  });

  it("env 構成済みなら env の資格情報で投入する", async () => {
    const store = createInMemoryAccountStore();
    const outcome = await seedInitialAdminFromEnv(store, {
      env: {
        [ADMIN_LOGIN_ID_ENV]: "lord",
        [ADMIN_INITIAL_PASSWORD_ENV]: PLAIN,
        [ADMIN_DISPLAY_NAME_ENV]: "殿",
      },
    });
    expect(outcome.status).toBe("created");
    expect(await authenticate(store, "lord", PLAIN)).toBeDefined();
  });

  it("受理境界を破る資格情報は握り潰さず呼出側へ返す（設定誤りを黙らせない）", async () => {
    const store = createInMemoryAccountStore();
    await expect(
      seedInitialAdmin(store, { loginId: "lord", password: "short", displayName: "殿" }),
    ).rejects.toThrow(WeakPasswordError);
    expect(await listAccounts(store)).toEqual([]);
  });
});
