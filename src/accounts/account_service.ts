/**
 * アカウントの発行・照合・編集（`module:accounts`・案A の identity 業務層）。
 *
 * 「誰がそのロールか」を決める唯一の業務層である。ロール認可の判定核（`participants/authorize.ts`）
 * も氏名の受理境界（`participants/name.ts`）も既存資産を再利用し、ここでは発明しない。
 *
 * 秘密の取り扱い（AC-A8）:
 *   - 平文パスワードは {@link createAccount} / {@link authenticate} / {@link changePassword} の
 *     引数としてのみ現れ、`password.ts` へ渡した後は保持しない。
 *   - 返り値・エラーメッセージ・例外に平文もハッシュも載せない。
 *   - {@link authenticate} は「ID が無い」と「パスワードが違う」を呼出側へ区別させない
 *     （どちらも `undefined`）。存在するログイン ID の列挙を許さないため。
 */

import { randomUUID } from "node:crypto";
import { isValidDisplayName, MAX_DISPLAY_NAME_LENGTH } from "../participants/name.js";
import type { Account, AccountRole } from "./account.js";
import { toAccount, toAccountRow, type AccountStore } from "./account_store.js";
import { hashPassword, isAcceptablePassword, verifyPassword, MIN_PASSWORD_LENGTH } from "./password.js";

/** ログイン ID の長さ上限（コードポイント基準）。 */
export const MAX_LOGIN_ID_LENGTH = 64;

/** ログイン ID が受理境界を満たすか（非空・空白を含まない・上限長以内）。 */
export function isValidLoginId(raw: string): boolean {
  if (raw !== raw.trim()) return false;
  const length = [...raw].length;
  if (length < 1 || length > MAX_LOGIN_ID_LENGTH) return false;
  return !/\s/u.test(raw);
}

/** ログイン ID が受理境界を満たさない。 */
export class InvalidLoginIdError extends Error {
  constructor() {
    super(`ログインIDは空白を含まない ${MAX_LOGIN_ID_LENGTH} 文字以内で指定してください。`);
    this.name = "InvalidLoginIdError";
  }
}

/** 同一ログイン ID のアカウントが既に在る（一意制約違反）。 */
export class DuplicateLoginIdError extends Error {
  constructor() {
    super("そのログインIDは既に使われています。");
    this.name = "DuplicateLoginIdError";
  }
}

/** パスワードが受理境界（最短長）を満たさない。平文は本エラーへ載せない。 */
export class WeakPasswordError extends Error {
  constructor() {
    super(`パスワードは ${MIN_PASSWORD_LENGTH} 文字以上で指定してください。`);
    this.name = "WeakPasswordError";
  }
}

/** 表示名が受理境界を満たさない（既存の氏名バリデータと同一境界）。 */
export class InvalidAccountDisplayNameError extends Error {
  constructor() {
    super(`お名前は ${MAX_DISPLAY_NAME_LENGTH} 文字以内で入力してください。`);
    this.name = "InvalidAccountDisplayNameError";
  }
}

/** 対象アカウントが存在しない。 */
export class AccountNotFoundError extends Error {
  constructor() {
    super("そのアカウントは存在しません。");
    this.name = "AccountNotFoundError";
  }
}

/** アカウント発行の入力（平文パスワードはここで一度だけ受け取る）。 */
export interface CreateAccountInput {
  readonly loginId: string;
  readonly password: string;
  readonly role: AccountRole;
  readonly displayName: string;
}

/** 識別子採番・時刻取得の注入口（テストが決定的に固定できるようにする）。 */
export interface AccountServiceDeps {
  /** 内部識別子の採番。既定は `randomUUID`。 */
  readonly newId?: () => string;
  /** 現在時刻（ISO-8601 文字列）。既定は `new Date().toISOString()`。 */
  readonly now?: () => string;
}

function resolveDeps(deps: AccountServiceDeps): { newId: () => string; now: () => string } {
  return {
    newId: deps.newId ?? ((): string => randomUUID()),
    now: deps.now ?? ((): string => new Date().toISOString()),
  };
}

/**
 * アカウントを 1 件発行する。ログイン ID・パスワード・表示名の受理境界を先に検査し、
 * 通ったものだけを scrypt ハッシュ化して永続する。同一ログイン ID の 2 件目は
 * 境界の原子的 insert-if-absent が拒否し {@link DuplicateLoginIdError} となる。
 *
 * @throws {InvalidLoginIdError} ログイン ID が受理境界を満たさない。
 * @throws {WeakPasswordError} パスワードが最短長を満たさない。
 * @throws {InvalidAccountDisplayNameError} 表示名が受理境界を満たさない。
 * @throws {DuplicateLoginIdError} 同一ログイン ID が既に在る。
 */
export async function createAccount(
  store: AccountStore,
  input: CreateAccountInput,
  deps: AccountServiceDeps = {},
): Promise<Account> {
  if (!isValidLoginId(input.loginId)) throw new InvalidLoginIdError();
  if (!isAcceptablePassword(input.password)) throw new WeakPasswordError();
  if (!isValidDisplayName(input.displayName)) throw new InvalidAccountDisplayNameError();

  const { newId, now } = resolveDeps(deps);
  const credential = await hashPassword(input.password);
  const timestamp = now();
  const account: Account = {
    id: newId(),
    loginId: input.loginId,
    passwordHash: credential.hash,
    passwordSalt: credential.salt,
    role: input.role,
    displayName: input.displayName.trim(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const inserted = await store.insertIfLoginIdAbsent(toAccountRow(account));
  if (!inserted) throw new DuplicateLoginIdError();
  return account;
}

/**
 * ログイン ID と平文パスワードでアカウントを照合する。一致したときだけ {@link Account} を返し、
 * ID が無い場合もパスワードが違う場合も同じく `undefined` を返す（区別させない）。
 * 例外は投げない（認証経路を 5xx へ化けさせない）。
 */
export async function authenticate(
  store: AccountStore,
  loginId: unknown,
  password: unknown,
): Promise<Account | undefined> {
  if (typeof loginId !== "string" || typeof password !== "string") return undefined;
  const row = await store.findByLoginId(loginId);
  if (row === undefined) return undefined;
  const account = toAccount(row);
  const ok = await verifyPassword(password, {
    hash: account.passwordHash,
    salt: account.passwordSalt,
  });
  return ok ? account : undefined;
}

/** `id` でアカウントを引く（セッション → アカウントの解決に用いる）。 */
export async function findAccountById(
  store: AccountStore,
  id: string,
): Promise<Account | undefined> {
  const row = await store.findById(id);
  return row === undefined ? undefined : toAccount(row);
}

/** 全アカウントを作成順で返す（管理面の一覧が消費する）。 */
export async function listAccounts(store: AccountStore): Promise<readonly Account[]> {
  return (await store.listAccountsOrderedByCreatedAt()).map(toAccount);
}

/**
 * パスワードを変更する。新しい平文を新しいソルトで再ハッシュし、`updated_at` を進める。
 * `login_id` / `id` / `role` は動かさない。
 *
 * @throws {WeakPasswordError} 新パスワードが最短長を満たさない。
 * @throws {AccountNotFoundError} 対象アカウントが存在しない。
 */
export async function changePassword(
  store: AccountStore,
  accountId: string,
  newPassword: string,
  deps: AccountServiceDeps = {},
): Promise<Account> {
  if (!isAcceptablePassword(newPassword)) throw new WeakPasswordError();
  const existing = await store.findById(accountId);
  if (existing === undefined) throw new AccountNotFoundError();
  const { now } = resolveDeps(deps);
  const credential = await hashPassword(newPassword);
  const updated: Account = {
    ...toAccount(existing),
    passwordHash: credential.hash,
    passwordSalt: credential.salt,
    updatedAt: now(),
  };
  await store.updateIfPresent(toAccountRow(updated));
  return updated;
}

/**
 * 表示名を変更する。受理境界は既存の {@link isValidDisplayName} を共有し、二重定義しない。
 *
 * @throws {InvalidAccountDisplayNameError} 表示名が受理境界を満たさない。
 * @throws {AccountNotFoundError} 対象アカウントが存在しない。
 */
export async function changeDisplayName(
  store: AccountStore,
  accountId: string,
  displayName: string,
  deps: AccountServiceDeps = {},
): Promise<Account> {
  if (!isValidDisplayName(displayName)) throw new InvalidAccountDisplayNameError();
  const existing = await store.findById(accountId);
  if (existing === undefined) throw new AccountNotFoundError();
  const { now } = resolveDeps(deps);
  const updated: Account = {
    ...toAccount(existing),
    displayName: displayName.trim(),
    updatedAt: now(),
  };
  await store.updateIfPresent(toAccountRow(updated));
  return updated;
}
