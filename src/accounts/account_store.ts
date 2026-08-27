/**
 * アカウント行の永続化境界と行 ⇄ ドメイン型の写像（`module:accounts`・`accounts` テーブル）。
 *
 * `participants/participant_repository.ts` と同じ作法で「境界（{@link AccountStore}）と実装の
 * 分離」を採る。ゆえに物理永続の実装（設計 D7 の zero-dependency JSON ファイル）は差し替え可能で
 * あり、将来 SQLite へ移す際も影響は Store 実装だけに閉じる。本モジュールが所有するのは
 * 行 ⇄ ドメイン型の写像と `login_id` 一意性の受入判定であり、生の行 I/O は実装側が担う。
 *
 * DB カラムは snake_case（`login_id` / `password_hash` / `display_name`）、ドメイン型
 * {@link Account} のフィールドは camelCase で対応する。
 */

import type { Account, AccountRole } from "./account.js";
import { isAccountRole } from "./account.js";

/** `accounts` テーブルの 1 行（DB カラムは snake_case）。 */
export interface AccountRow {
  readonly id: string;
  readonly login_id: string;
  readonly password_hash: string;
  readonly password_salt: string;
  readonly role: AccountRole;
  readonly display_name: string;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * アカウント行の外部永続化境界。生の行 I/O のみを持ち、業務判断（ロール写像・氏名検証・
 * パスワード照合）は上位の `account_service` が所有する。
 */
export interface AccountStore {
  /**
   * `login_id` がまだ存在しない場合に限り 1 行を **原子的に** 挿入する。挿入できたら `true`、
   * 同一 `login_id` の行が既に在り挿入しなかった場合は `false` を返す（一意制約）。
   * 事前照会と挿入の競合（TOCTOU）を避けるため原子的な insert-if-absent として実装する。
   */
  insertIfLoginIdAbsent(row: AccountRow): Promise<boolean>;
  /** `id` で 1 行を引く（無ければ `undefined`）。 */
  findById(id: string): Promise<AccountRow | undefined>;
  /** `login_id` で 1 行を引く（無ければ `undefined`）。ログイン照合の入口。 */
  findByLoginId(loginId: string): Promise<AccountRow | undefined>;
  /** 全行を `created_at` 昇順で返す（管理面のアカウント一覧が消費する）。 */
  listAccountsOrderedByCreatedAt(): Promise<readonly AccountRow[]>;
  /**
   * `id` が既に在る場合に限り 1 行を置換する。置換できたら `true`、対象が無ければ `false`。
   * `login_id` は不変（変更は本境界では扱わない）。
   */
  updateIfPresent(row: AccountRow): Promise<boolean>;
}

/** 行 → ドメイン型の写像。 */
export function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    loginId: row.login_id,
    passwordHash: row.password_hash,
    passwordSalt: row.password_salt,
    role: row.role,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** ドメイン型 → 行の写像。 */
export function toAccountRow(account: Account): AccountRow {
  return {
    id: account.id,
    login_id: account.loginId,
    password_hash: account.passwordHash,
    password_salt: account.passwordSalt,
    role: account.role,
    display_name: account.displayName,
    created_at: account.createdAt,
    updated_at: account.updatedAt,
  };
}

/**
 * 外部（JSON ファイル等）から読み戻した未検査の値が {@link AccountRow} として解釈できるかを
 * 判定する。壊れた行を素通しさせず、読み戻し時に落とすための最終防衛。
 */
export function isAccountRow(value: unknown): value is AccountRow {
  if (value === null || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const strings = [
    "id",
    "login_id",
    "password_hash",
    "password_salt",
    "display_name",
    "created_at",
    "updated_at",
  ];
  return strings.every((key) => typeof row[key] === "string") && isAccountRole(row["role"]);
}

/**
 * in-memory な {@link AccountStore}（テストとローカル試遊の既定）。プロセスが終われば失われる。
 * 挿入・更新は同期的に完了するが、境界の契約に合わせて Promise を返す。
 */
export function createInMemoryAccountStore(seed: readonly AccountRow[] = []): AccountStore {
  const rows = new Map<string, AccountRow>();
  for (const row of seed) rows.set(row.id, row);

  return {
    async insertIfLoginIdAbsent(row: AccountRow): Promise<boolean> {
      for (const existing of rows.values()) {
        if (existing.login_id === row.login_id) return false;
      }
      rows.set(row.id, row);
      return true;
    },
    async findById(id: string): Promise<AccountRow | undefined> {
      return rows.get(id);
    },
    async findByLoginId(loginId: string): Promise<AccountRow | undefined> {
      for (const existing of rows.values()) {
        if (existing.login_id === loginId) return existing;
      }
      return undefined;
    },
    async listAccountsOrderedByCreatedAt(): Promise<readonly AccountRow[]> {
      return [...rows.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
    },
    async updateIfPresent(row: AccountRow): Promise<boolean> {
      if (!rows.has(row.id)) return false;
      rows.set(row.id, row);
      return true;
    },
  };
}
