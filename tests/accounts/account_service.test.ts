/**
 * アカウントの発行・照合・編集（`accounts/account_service.ts`・AC-A8 / AC-A7）。
 *
 * 固定する契約:
 *   - 受理境界（ログイン ID / パスワード / 表示名）は発行前に検査され、破った入力は永続に至らない。
 *   - 表示名の受理境界は `participants/name.ts` の既存バリデータと同一（二重定義しない）。
 *   - 照合は「ID が無い」と「パスワードが違う」を呼出側へ区別させない（列挙を許さない）。
 *   - 変更（表示名・パスワード）は当該アカウントの同一性（id / loginId / role）を動かさない。
 *   - 保存物に平文パスワードが一切現れない。
 */

import { describe, it, expect } from "vitest";
import {
  AccountNotFoundError,
  authenticate,
  changeDisplayName,
  changePassword,
  createAccount,
  DuplicateLoginIdError,
  findAccountById,
  InvalidAccountDisplayNameError,
  InvalidLoginIdError,
  isValidLoginId,
  listAccounts,
  MAX_LOGIN_ID_LENGTH,
  WeakPasswordError,
} from "../../src/accounts/account_service.js";
import { createInMemoryAccountStore } from "../../src/accounts/account_store.js";
import { MAX_DISPLAY_NAME_LENGTH } from "../../src/participants/name.js";
import { MIN_PASSWORD_LENGTH } from "../../src/accounts/password.js";
import { toPublicAccount, toSessionRole } from "../../src/accounts/account.js";

const PLAIN = "family-quiz-2026";

/** 決定的な採番・時刻を注入する（生成物を突き合わせられるようにする）。 */
function deterministicDeps(startAt = "2026-08-28T00:00:00.000Z") {
  let counter = 0;
  return { newId: () => `acc-${++counter}`, now: () => startAt };
}

describe("accounts/account_service 発行の受理境界", () => {
  it("正当な入力で 1 件発行され、保存物に平文パスワードが現れない", async () => {
    const store = createInMemoryAccountStore();
    const account = await createAccount(
      store,
      { loginId: "lord", password: PLAIN, role: "admin", displayName: "殿" },
      deterministicDeps(),
    );
    expect(account.id).toBe("acc-1");
    expect(account.loginId).toBe("lord");
    expect(account.role).toBe("admin");
    expect(account.displayName).toBe("殿");
    expect(account.passwordHash).not.toContain(PLAIN);
    expect(account.passwordSalt).not.toContain(PLAIN);
    expect(JSON.stringify(await store.listAccountsOrderedByCreatedAt())).not.toContain(PLAIN);
  });

  it("表示名は前後空白を落として保存する", async () => {
    const store = createInMemoryAccountStore();
    const account = await createAccount(store, {
      loginId: "lord",
      password: PLAIN,
      role: "admin",
      displayName: "  殿  ",
    });
    expect(account.displayName).toBe("殿");
  });

  it("ログイン ID の受理境界（非空・空白を含まない・上限長）を破ると発行されない", async () => {
    const store = createInMemoryAccountStore();
    for (const loginId of ["", " ", "has space", "a".repeat(MAX_LOGIN_ID_LENGTH + 1), " lord"]) {
      await expect(
        createAccount(store, { loginId, password: PLAIN, role: "admin", displayName: "殿" }),
      ).rejects.toThrow(InvalidLoginIdError);
    }
    expect(await store.listAccountsOrderedByCreatedAt()).toEqual([]);
    expect(isValidLoginId("a".repeat(MAX_LOGIN_ID_LENGTH))).toBe(true);
  });

  it("最短長に満たないパスワードでは発行されない", async () => {
    const store = createInMemoryAccountStore();
    await expect(
      createAccount(store, {
        loginId: "lord",
        password: "a".repeat(MIN_PASSWORD_LENGTH - 1),
        role: "admin",
        displayName: "殿",
      }),
    ).rejects.toThrow(WeakPasswordError);
    expect(await store.listAccountsOrderedByCreatedAt()).toEqual([]);
  });

  it("表示名の受理境界は既存の氏名バリデータと同一（空・上限超過を拒む）", async () => {
    const store = createInMemoryAccountStore();
    for (const displayName of ["", "   ", "あ".repeat(MAX_DISPLAY_NAME_LENGTH + 1)]) {
      await expect(
        createAccount(store, { loginId: "lord", password: PLAIN, role: "admin", displayName }),
      ).rejects.toThrow(InvalidAccountDisplayNameError);
    }
    // 境界値ちょうどは受理する。
    const account = await createAccount(store, {
      loginId: "lord",
      password: PLAIN,
      role: "contestant",
      displayName: "あ".repeat(MAX_DISPLAY_NAME_LENGTH),
    });
    expect([...account.displayName].length).toBe(MAX_DISPLAY_NAME_LENGTH);
  });

  it("同一ログイン ID の 2 件目は拒否され、1 件のままである", async () => {
    const store = createInMemoryAccountStore();
    await createAccount(store, { loginId: "lord", password: PLAIN, role: "admin", displayName: "殿" });
    await expect(
      createAccount(store, {
        loginId: "lord",
        password: PLAIN,
        role: "contestant",
        displayName: "別人",
      }),
    ).rejects.toThrow(DuplicateLoginIdError);
    expect((await listAccounts(store)).length).toBe(1);
  });
});

describe("accounts/account_service 照合", () => {
  it("正しい ID とパスワードの組だけが通る", async () => {
    const store = createInMemoryAccountStore();
    const created = await createAccount(store, {
      loginId: "lord",
      password: PLAIN,
      role: "admin",
      displayName: "殿",
    });
    const authenticated = await authenticate(store, "lord", PLAIN);
    expect(authenticated?.id).toBe(created.id);
    expect(toSessionRole(created.role)).toBe("host");
  });

  it("ID が無い場合とパスワードが違う場合を呼出側へ区別させない", async () => {
    const store = createInMemoryAccountStore();
    await createAccount(store, { loginId: "lord", password: PLAIN, role: "admin", displayName: "殿" });
    expect(await authenticate(store, "unknown-id", PLAIN)).toBeUndefined();
    expect(await authenticate(store, "lord", "wrong-password")).toBeUndefined();
  });

  it("文字列でない入力でも例外を投げず undefined を返す", async () => {
    const store = createInMemoryAccountStore();
    expect(await authenticate(store, 42, PLAIN)).toBeUndefined();
    expect(await authenticate(store, "lord", null)).toBeUndefined();
    expect(await authenticate(store, undefined, undefined)).toBeUndefined();
  });
});

describe("accounts/account_service 自分のアカウントの編集（AC-A7）", () => {
  it("表示名だけが変わり、同一性（id / loginId / role）は動かない", async () => {
    const store = createInMemoryAccountStore();
    const created = await createAccount(
      store,
      { loginId: "lord", password: PLAIN, role: "admin", displayName: "殿" },
      deterministicDeps("2026-08-28T00:00:00.000Z"),
    );
    const updated = await changeDisplayName(store, created.id, " 御館様 ", {
      now: () => "2026-08-28T01:00:00.000Z",
    });
    expect(updated.displayName).toBe("御館様");
    expect(updated.id).toBe(created.id);
    expect(updated.loginId).toBe(created.loginId);
    expect(updated.role).toBe(created.role);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).toBe("2026-08-28T01:00:00.000Z");
    expect((await findAccountById(store, created.id))?.displayName).toBe("御館様");
  });

  it("受理境界を破る表示名では変更されない", async () => {
    const store = createInMemoryAccountStore();
    const created = await createAccount(store, {
      loginId: "lord",
      password: PLAIN,
      role: "admin",
      displayName: "殿",
    });
    await expect(changeDisplayName(store, created.id, "   ")).rejects.toThrow(
      InvalidAccountDisplayNameError,
    );
    expect((await findAccountById(store, created.id))?.displayName).toBe("殿");
  });

  it("パスワード変更後は新しい平文だけが通り、古い平文は通らない", async () => {
    const store = createInMemoryAccountStore();
    const created = await createAccount(store, {
      loginId: "lord",
      password: PLAIN,
      role: "admin",
      displayName: "殿",
    });
    const updated = await changePassword(store, created.id, "new-secret-phrase");
    expect(updated.passwordHash).not.toBe(created.passwordHash);
    expect(await authenticate(store, "lord", "new-secret-phrase")).toBeDefined();
    expect(await authenticate(store, "lord", PLAIN)).toBeUndefined();
  });

  it("弱いパスワードへの変更は拒否され、元のパスワードのまま残る", async () => {
    const store = createInMemoryAccountStore();
    const created = await createAccount(store, {
      loginId: "lord",
      password: PLAIN,
      role: "admin",
      displayName: "殿",
    });
    await expect(changePassword(store, created.id, "short")).rejects.toThrow(WeakPasswordError);
    expect(await authenticate(store, "lord", PLAIN)).toBeDefined();
  });

  it("存在しないアカウントの編集は業務エラーになる", async () => {
    const store = createInMemoryAccountStore();
    await expect(changeDisplayName(store, "missing", "誰か")).rejects.toThrow(AccountNotFoundError);
    await expect(changePassword(store, "missing", "long-enough-password")).rejects.toThrow(
      AccountNotFoundError,
    );
  });

  it("公開射影は秘密列（ハッシュ・ソルト）を持たない", async () => {
    const store = createInMemoryAccountStore();
    const created = await createAccount(store, {
      loginId: "lord",
      password: PLAIN,
      role: "admin",
      displayName: "殿",
    });
    const publicView = toPublicAccount(created);
    expect(publicView).toEqual({
      id: created.id,
      loginId: "lord",
      role: "admin",
      displayName: "殿",
    });
    expect(JSON.stringify(publicView)).not.toContain(created.passwordHash);
  });
});
