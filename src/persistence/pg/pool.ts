/**
 * PostgreSQL 接続プールの唯一の生成点（`module:persistence`・cmd_2553 B案 移行設計 S1）。
 *
 * 単一 Node プロセスが唯一の書き手である本アプリでは、接続も **単一の {@link Pool}** に集約する
 * （store 実装ごとに Pool を作らない）。接続文字列は環境変数 `DATABASE_URL` を唯一の設定源と
 * し、値そのものはログ・エラーメッセージへ載せない（機密・1Password 管理）。
 *
 * `Pool` の生成は同期・接続は遅延ゆえ、bootstrap（CJS・top-level await 不可）から同期に呼べる。
 * 到達性の実証は `ensure_schema.ts` の `assertReleaseReady()` が担う。
 */

import pg from "pg";

/** 接続文字列を与える環境変数名（SCREAMING_SNAKE_CASE）。 */
export const DATABASE_URL_ENV = "DATABASE_URL";

/** env 注入ソース（他の `src/config/*` と同型・テストから差し替え可能）。 */
export interface PgConfigSource {
  readonly env?: Record<string, string | undefined>;
}

/** `DATABASE_URL` を解決する（未設定・空・空白のみなら `undefined`）。値はログへ出さない。 */
export function resolveDatabaseUrl(source: PgConfigSource = {}): string | undefined {
  const env = source.env ?? process.env;
  const raw = env[DATABASE_URL_ENV];
  if (raw === undefined || raw.trim() === "") return undefined;
  return raw;
}

/**
 * 単一の {@link pg.Pool} を生成する。`DATABASE_URL` 未設定なら明快なエラーで拒む
 * （エラーメッセージに接続文字列の値は含めない）。
 */
export function createPgPool(source: PgConfigSource = {}): pg.Pool {
  const connectionString = resolveDatabaseUrl(source);
  if (connectionString === undefined) {
    throw new Error(
      `${DATABASE_URL_ENV} が未設定です。STORE_BACKEND=pg には PostgreSQL 接続文字列が必要です。`,
    );
  }
  // 家族規模（同時接続〜数十）ゆえ既定の max=10 で足りる。単一 Pool を全 store が共有する。
  return new pg.Pool({ connectionString });
}

/** 検索パス等に依存しない素の 1 クエリ実行（薄ラッパ・生SQL 方針）。 */
export async function query(
  pool: pg.Pool,
  text: string,
  values: readonly unknown[] = [],
): Promise<pg.QueryResult> {
  return pool.query(text, values as unknown[]);
}

export type { Pool } from "pg";
