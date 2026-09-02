/**
 * PG スキーマの成立と稼働前検証（`module:persistence`・cmd_2553 B案 移行設計 S2）。
 *
 * - {@link ensureSchema}: `APP_SCHEMA` の全表を FK 依存順に `CREATE TABLE IF NOT EXISTS` で
 *   作成する。冪等ゆえ再実行してもエラーにならない（設計 deliverable4 (b)）。
 * - {@link assertReleaseReady}: `DATABASE_URL` の設定・DB 到達・主要テーブルの存在を検証し、
 *   欠けていれば **理由を持つ例外** で拒む。bootstrap はこれを捕捉して非 0 終了する
 *   （壊れた永続層で受付を始めない）。エラーメッセージに接続文字列の値は載せない。
 */

import type pg from "pg";
import { APP_SCHEMA, emitCreateTableIfNotExistsSql } from "./app_schema.js";
import { DATABASE_URL_ENV, resolveDatabaseUrl, type PgConfigSource } from "./pool.js";

/** `APP_SCHEMA` の全表を依存順に作成する（IF NOT EXISTS ゆえ何度呼んでも安全）。 */
export async function ensureSchema(pool: pg.Pool): Promise<void> {
  for (const table of APP_SCHEMA) {
    await pool.query(emitCreateTableIfNotExistsSql(table));
  }
}

/** リリース前検証の失敗（bootstrap が捕捉して非 0 終了する契約）。 */
export class ReleaseNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseNotReadyError";
  }
}

/**
 * PG バックエンドで受付を始めてよいかを検証する。
 *   1. `DATABASE_URL` が設定されている（値は検査のみ・メッセージへ載せない）。
 *   2. DB へ到達できる（`SELECT 1`）。
 *   3. `APP_SCHEMA` の全テーブルが存在する（`to_regclass`）。
 * いずれかを欠けば {@link ReleaseNotReadyError} を投げる。
 */
export async function assertReleaseReady(
  pool: pg.Pool,
  source: PgConfigSource = {},
): Promise<void> {
  if (resolveDatabaseUrl(source) === undefined) {
    throw new ReleaseNotReadyError(`${DATABASE_URL_ENV} が未設定です（PG バックエンド起動不可）。`);
  }
  try {
    await pool.query("SELECT 1");
  } catch {
    // 到達失敗の生エラーは接続情報を含み得るため要約だけを持つ（機密非表示）。
    throw new ReleaseNotReadyError("PostgreSQL へ到達できません（接続失敗）。");
  }
  for (const table of APP_SCHEMA) {
    const result = await pool.query("SELECT to_regclass($1) AS oid", [`public.${table.name}`]);
    if ((result.rows[0] as { oid: string | null } | undefined)?.oid == null) {
      throw new ReleaseNotReadyError(`必要テーブル ${table.name} が存在しません。`);
    }
  }
}
