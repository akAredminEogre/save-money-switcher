// @generated-by: codd implement
// @generated-from: docs/design/participation_connection_design.md (design:participation-connection-design)
// @design-node: docs/design/participation_connection_design.md
// @output-paths: src, tests
// @generated-from: docs/design/realtime_sync_design.md (design:realtime-sync-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

/**
 * 家族限定アクセス制御の設定解決点（`module:config` / `module:participants`・PC-INV-3）。
 *
 * participation_connection_design §2.6 / §2.2 / §3.1 が確定した release-blocking 制約
 * 「無認証の無制限公開を採らない」を、設定解決の側から具体化する。参加ベクタ（制御盤の QR が
 * 指すクラウド公開 `/join`）に課すアクセス制御方式を、環境変数を唯一の設定源として解決する:
 *
 *   - 分岐 A（URL 秘匿）: `JOIN_ACCESS_MODE=url_secret` ＋ 秘匿トークン `JOIN_ACCESS_TOKEN`。
 *     提示トークンが設定トークンと一致したときだけ `/join` 参加を許可する。
 *   - 分岐 B（認証）: `JOIN_ACCESS_MODE=authenticated`。セッション認証済のときだけ許可する。
 *
 * 本モジュールは受入判定そのものを持たず、`src/participants/access_control.ts` の
 * `checkJoinAccess` が唯一のゲートとして本モジュールの解決値を参照する。ゆえに本モジュールの
 * 責務は「どちらの制御も未構成」という状態を **表現可能にする**ことにあり、そのために
 * {@link resolveAccessMode} は未構成時に `undefined` を返す。`checkJoinAccess` は `undefined`
 * を「参加不可」へ写像するため、設定を与えなければ誰も参加できない fail-closed が構成上も
 * 実行時にも成立し、無制御公開が成り立たない（dod_access_no_open_public）。
 *
 * 解決は例外を投げない全域関数である。`checkJoinAccess` は本モジュールの戻り値を分岐条件と
 * してのみ用い（例外を捕捉しない）、健全性ベースライン「全 HTTP 応答 < 500」を保つ。ゆえに
 * 未設定・空・空白のみ・未知の値はいずれも「未構成」へ収束させ、受入ゲートを 5xx へ化けさせ
 * ない。
 *
 * env の注入口（{@link JoinAccessConfigSource}）は上限解決（`ConnectionLimitSource`）・基底
 * URL 解決（`PublicBaseUrlSource`）と同型で、既定は実行環境の `process.env` を読む。設定機構は
 * 環境変数を既定とし、`src/config/` を単一解決点に保つため設定ストアを直接 import しない。
 */

/** 参加アクセス制御方式を与える環境変数名（SCREAMING_SNAKE_CASE）。 */
export const JOIN_ACCESS_MODE_ENV = "JOIN_ACCESS_MODE";

/** 分岐 A（URL 秘匿）の秘匿トークンを与える環境変数名（SCREAMING_SNAKE_CASE）。 */
export const JOIN_ACCESS_TOKEN_ENV = "JOIN_ACCESS_TOKEN";

/**
 * 認識されるアクセス制御方式の唯一の語彙（分岐 A / 分岐 B）。判定と型をここから導出し、
 * 実行時語彙と型面のドリフトを排除する。ここに無い値は「未構成」として扱う。
 */
export const ACCESS_MODES = ["url_secret", "authenticated"] as const;

/** 家族限定アクセス制御の方式。未構成は本型に含めず `undefined` で表す。 */
export type AccessMode = (typeof ACCESS_MODES)[number];

/**
 * 設定解決に用いる env 注入ソース。未指定時は実行環境の `process.env` を読む。
 * テスト・呼び出し側が env を注入して解決を固定できる（`src/config/` を単一解決点に保つ）。
 */
export interface JoinAccessConfigSource {
  /** 環境変数ソース。未指定時は `process.env` を用いる。 */
  readonly env?: Record<string, string | undefined>;
}

/** 値が認識されるアクセス制御方式かを判定する型ガード。 */
export function isAccessMode(value: unknown): value is AccessMode {
  return (
    typeof value === "string" && (ACCESS_MODES as readonly string[]).includes(value)
  );
}

/**
 * 家族限定アクセス制御の方式を解決する（環境変数 `JOIN_ACCESS_MODE`）。
 *
 * 認識される方式（`url_secret` / `authenticated`）のときだけその方式を返し、未設定・空・
 * 空白のみ・未知の値はいずれも `undefined`（＝未構成）を返す。`undefined` は `checkJoinAccess`
 * により「参加不可」へ写像され、URL 秘匿トークンも認証も未構成の「無制御公開」を構成上も
 * 実行時にも成立させない（PC-INV-3 / dod_access_no_open_public）。設定ミスで例外を投げず、
 * 常に上記 3 値のいずれかへ収束させる全域関数である（受入ゲートを 5xx へ化けさせない）。
 */
export function resolveAccessMode(
  source: JoinAccessConfigSource = {},
): AccessMode | undefined {
  const env = source.env ?? process.env;
  const raw = env[JOIN_ACCESS_MODE_ENV];
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  return isAccessMode(trimmed) ? trimmed : undefined;
}

/**
 * 分岐 A（URL 秘匿）の秘匿トークンを解決する（環境変数 `JOIN_ACCESS_TOKEN`）。
 *
 * 設定された非空のトークン（前後空白は除去）を返し、未設定・空・空白のみはいずれも `undefined`
 * を返す。空・空白のみを非 `undefined` として通すと url_secret 方式で「空トークン一致」による
 * 実質無防備が成立し得るため、非空でない値は未構成として扱い、`checkJoinAccess` の
 * `expected !== undefined` ガードで fail-closed させる。`buildJoinUrl` が参加 URL のクエリ `t`
 * へ載せる値と `checkJoinAccess` が照合する期待値は、いずれも本関数を単一出所とするため往復で
 * 一致する。例外は投げない全域関数である。
 */
export function resolveJoinAccessToken(
  source: JoinAccessConfigSource = {},
): string | undefined {
  const env = source.env ?? process.env;
  const raw = env[JOIN_ACCESS_TOKEN_ENV];
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}
