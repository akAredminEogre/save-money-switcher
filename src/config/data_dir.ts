/**
 * 永続データ置き場の解決点（`module:config`・設計 D7 / D8）。
 *
 * 設計 D7 が確定した zero-dependency の JSON ファイル永続層が書き込む先を、環境変数
 * `DATA_DIR` を唯一の設定源として解決する。他の `src/config/*`（上限・公開 URL・アクセス制御）と
 * 同型の全域関数であり、例外を投げない。
 *
 * 既定は実行 CWD 直下の `data/`（`npm run start` はリポジトリルートから起動する契約・README）。
 * 本番（Lightsail・D8）はデプロイで消えぬ絶対パスを `DATA_DIR` に与える。
 */

import { isAbsolute, join } from "node:path";

/** 永続データ置き場を与える環境変数名（SCREAMING_SNAKE_CASE）。 */
export const DATA_DIR_ENV = "DATA_DIR";

/** `DATA_DIR` 未設定時の既定ディレクトリ名（CWD 相対）。 */
export const DEFAULT_DATA_DIR_NAME = "data";

/** 設定解決に用いる env 注入ソース。未指定時は実行環境の `process.env` を読む。 */
export interface DataDirSource {
  readonly env?: Record<string, string | undefined>;
  /** 相対パス解決の基点。未指定時は `process.cwd()`。 */
  readonly cwd?: string;
}

/**
 * 永続データ置き場の絶対パスを解決する。`DATA_DIR` が非空なら（相対指定は基点からの解決を経て）
 * それを、未設定・空・空白のみなら基点直下の `data/` を返す。例外は投げない。
 */
export function resolveDataDir(source: DataDirSource = {}): string {
  const env = source.env ?? process.env;
  const cwd = source.cwd ?? process.cwd();
  const raw = env[DATA_DIR_ENV];
  const trimmed = raw === undefined ? "" : raw.trim();
  if (trimmed === "") {
    return join(cwd, DEFAULT_DATA_DIR_NAME);
  }
  return isAbsolute(trimmed) ? trimmed : join(cwd, trimmed);
}
