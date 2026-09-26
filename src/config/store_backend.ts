/**
 * 永続バックエンドの選択点（`module:config`・cmd_2553 B案 移行設計 S5）。
 *
 * 環境変数 `STORE_BACKEND` を唯一の設定源として `json`（既定）⇄ `pg` を切り替える。既定を
 * `json` に置くことで、PG 移行に失敗しても env を戻す（または外す）だけで即ロールバックできる
 * （非破壊移行の要・`data/*.json` は移行後も温存される）。
 *
 * 他の `src/config/*` と同型の全域関数であり、未知の値は既定 `json` へ収束させ例外を投げない
 * （誤設定でアプリを落とすより、安全側＝実績ある JSON 永続で立ち上げる）。
 */

/** 永続バックエンドを与える環境変数名（SCREAMING_SNAKE_CASE）。 */
export const STORE_BACKEND_ENV = "STORE_BACKEND";

/** 選択可能な永続バックエンド。 */
export type StoreBackend = "json" | "pg";

/** `STORE_BACKEND` 未設定・未知値のときの既定（ロールバック先でもある）。 */
export const DEFAULT_STORE_BACKEND: StoreBackend = "json";

/** 設定解決に用いる env 注入ソース。未指定時は実行環境の `process.env` を読む。 */
export interface StoreBackendSource {
  readonly env?: Record<string, string | undefined>;
}

/** 永続バックエンドを解決する。`pg` の明示だけが PG を選び、それ以外は既定 `json`。 */
export function resolveStoreBackend(source: StoreBackendSource = {}): StoreBackend {
  const env = source.env ?? process.env;
  const raw = env[STORE_BACKEND_ENV]?.trim().toLowerCase();
  return raw === "pg" ? "pg" : DEFAULT_STORE_BACKEND;
}
