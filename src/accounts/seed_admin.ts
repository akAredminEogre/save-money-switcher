/**
 * 初期管理者アカウントの投入（`module:accounts`・設計 open_question Q1 案i / 殿裁可 2026-08-28）。
 *
 * 殿の裁可した案i に従い、初期管理者の資格情報は **環境変数**（{@link ADMIN_LOGIN_ID_ENV} /
 * {@link ADMIN_INITIAL_PASSWORD_ENV}）から与える。MAS もリポジトリも平文を持たない：資格情報は
 * 秘密保管庫から実行時に env へ注入され、本モジュールはそれを scrypt ハッシュへ写して捨てる
 * （AC-A8）。ゆえに **本ファイルにも証跡にもコミット履歴にも平文は現れない**。
 *
 * 冪等（idempotent）である。既に同一ログイン ID の管理者が在れば何もせず `already_exists` を
 * 返す。起動のたびに呼んでも重複を作らず、既存アカウントのパスワードを勝手に上書きもしない
 * （殿が `/me` で変えたパスワードを次回起動で env の初期値へ戻してしまわないため）。
 *
 * env が未設定なら {@link seedInitialAdminFromEnv} は `not_configured` を返して何もしない。
 * 初期投入前の起動を失敗させない（`/healthz` は依然 200 を返す・system_design §2.11）。
 */

import { ROLE_LABELS } from "../game_state/role_labels.js";
import type { AccountStore } from "./account_store.js";
import { createAccount, type AccountServiceDeps } from "./account_service.js";
import type { Account } from "./account.js";

/** 初期管理者のログイン ID を与える環境変数名。 */
export const ADMIN_LOGIN_ID_ENV = "ADMIN_LOGIN_ID";

/** 初期管理者の初期パスワードを与える環境変数名（平文はここにだけ現れ、保存されない）。 */
export const ADMIN_INITIAL_PASSWORD_ENV = "ADMIN_INITIAL_PASSWORD";

/** 初期管理者の表示名を与える環境変数名（任意・未設定なら可視ラベル「司会者」を用いる）。 */
export const ADMIN_DISPLAY_NAME_ENV = "ADMIN_DISPLAY_NAME";

/** 表示名の既定値。内部ロール識別子を出さぬよう単一供給点 {@link ROLE_LABELS} から取る。 */
export const DEFAULT_ADMIN_DISPLAY_NAME = ROLE_LABELS.host;

/** 初期管理者の資格情報（env から解決した値）。 */
export interface InitialAdminCredentials {
  readonly loginId: string;
  readonly password: string;
  readonly displayName: string;
}

/** 設定解決に用いる env 注入ソース。未指定時は実行環境の `process.env` を読む。 */
export interface InitialAdminSource {
  readonly env?: Record<string, string | undefined>;
}

/**
 * 初期管理者の資格情報を env から解決する。ログイン ID とパスワードの双方が非空のときだけ
 * 資格情報を返し、片方でも欠ければ `undefined`（＝未構成）を返す。例外は投げない。
 */
export function resolveInitialAdminCredentials(
  source: InitialAdminSource = {},
): InitialAdminCredentials | undefined {
  const env = source.env ?? process.env;
  const loginId = (env[ADMIN_LOGIN_ID_ENV] ?? "").trim();
  const password = env[ADMIN_INITIAL_PASSWORD_ENV] ?? "";
  if (loginId === "" || password === "") return undefined;
  const displayNameRaw = (env[ADMIN_DISPLAY_NAME_ENV] ?? "").trim();
  return {
    loginId,
    password,
    displayName: displayNameRaw === "" ? DEFAULT_ADMIN_DISPLAY_NAME : displayNameRaw,
  };
}

/** 投入の結果。`created` のときだけ新しいアカウントが 1 件生まれている。 */
export type SeedOutcome =
  | { readonly status: "created"; readonly account: Account }
  | { readonly status: "already_exists" }
  | { readonly status: "not_configured" };

/**
 * 初期管理者を 1 件だけ投入する（冪等）。同一ログイン ID が既に在れば何もしない。
 *
 * @throws {InvalidLoginIdError | WeakPasswordError | InvalidAccountDisplayNameError}
 *   与えられた資格情報が受理境界を満たさない場合（設定の誤りゆえ握り潰さず呼出側へ返す）。
 */
export async function seedInitialAdmin(
  store: AccountStore,
  credentials: InitialAdminCredentials,
  deps: AccountServiceDeps = {},
): Promise<SeedOutcome> {
  const existing = await store.findByLoginId(credentials.loginId);
  if (existing !== undefined) return { status: "already_exists" };
  const account = await createAccount(
    store,
    {
      loginId: credentials.loginId,
      password: credentials.password,
      role: "admin",
      displayName: credentials.displayName,
    },
    deps,
  );
  return { status: "created", account };
}

/**
 * env から解決した資格情報で初期管理者を投入する。未構成なら `not_configured` を返して
 * 何もしない（起動を止めない）。
 */
export async function seedInitialAdminFromEnv(
  store: AccountStore,
  source: InitialAdminSource = {},
  deps: AccountServiceDeps = {},
): Promise<SeedOutcome> {
  const credentials = resolveInitialAdminCredentials(source);
  if (credentials === undefined) return { status: "not_configured" };
  return seedInitialAdmin(store, credentials, deps);
}
