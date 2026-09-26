/**
 * PostgreSQL 実装の {@link AccountStore}（`module:accounts` / `module:persistence`・
 * cmd_2553 B案 移行設計 S3）。
 *
 * 境界（`account_store.ts`）の契約はそのままに、物理永続だけを JSON ファイルから PG へ差し替える
 * （設計 D7 の「差し替えは Store 実装だけに閉じる」の実行）。生 SQL・ORM 無し。
 *
 * `insertIfLoginIdAbsent` の原子性は JSON 実装の「単一プロセス内の直列化」ではなく、PG の
 * UNIQUE 制約 ＋ `ON CONFLICT DO NOTHING` が担う（TOCTOU 回避契約と等価・複数プロセスでも安全）。
 */

import type pg from "pg";
import { isAccountRow, type AccountRow, type AccountStore } from "./account_store.js";

/** SELECT 列の並び（`AccountRow` のフィールド順と一致させる）。 */
const COLUMNS =
  "id, login_id, password_hash, password_salt, role, display_name, created_at, updated_at";

/** 読み戻した行を境界の型ガードへ通す（壊れた行を素通しさせない最終防衛・JSON 実装と同じ作法）。 */
function toRow(value: unknown): AccountRow {
  if (!isAccountRow(value)) {
    throw new Error("accounts テーブルから解釈できない行を読み出しました。");
  }
  return value;
}

/** PostgreSQL 実装の {@link AccountStore} を生成する（Pool は共有・所有しない）。 */
export function createPgAccountStore(pool: pg.Pool): AccountStore {
  return {
    async insertIfLoginIdAbsent(row: AccountRow): Promise<boolean> {
      // UNIQUE(login_id) と ON CONFLICT DO NOTHING が挿入可否を原子的に決める。
      const result = await pool.query(
        `INSERT INTO accounts (${COLUMNS})
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (login_id) DO NOTHING`,
        [
          row.id,
          row.login_id,
          row.password_hash,
          row.password_salt,
          row.role,
          row.display_name,
          row.created_at,
          row.updated_at,
        ],
      );
      return (result.rowCount ?? 0) > 0;
    },
    async findById(id: string): Promise<AccountRow | undefined> {
      const result = await pool.query(`SELECT ${COLUMNS} FROM accounts WHERE id = $1`, [id]);
      const first: unknown = result.rows[0];
      return first === undefined ? undefined : toRow(first);
    },
    async findByLoginId(loginId: string): Promise<AccountRow | undefined> {
      const result = await pool.query(`SELECT ${COLUMNS} FROM accounts WHERE login_id = $1`, [
        loginId,
      ]);
      const first: unknown = result.rows[0];
      return first === undefined ? undefined : toRow(first);
    },
    async listAccountsOrderedByCreatedAt(): Promise<readonly AccountRow[]> {
      const result = await pool.query(
        `SELECT ${COLUMNS} FROM accounts ORDER BY created_at ASC`,
      );
      return result.rows.map((row: unknown) => toRow(row));
    },
    async updateIfPresent(row: AccountRow): Promise<boolean> {
      // `login_id` は境界の契約上不変ゆえ SET に含めない。
      const result = await pool.query(
        `UPDATE accounts
         SET password_hash = $2, password_salt = $3, role = $4, display_name = $5,
             created_at = $6, updated_at = $7
         WHERE id = $1`,
        [
          row.id,
          row.password_hash,
          row.password_salt,
          row.role,
          row.display_name,
          row.created_at,
          row.updated_at,
        ],
      );
      return (result.rowCount ?? 0) > 0;
    },
  };
}
