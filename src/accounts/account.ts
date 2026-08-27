/**
 * アカウントのドメイン型（`module:accounts`・案A「事前アカウント方式」の identity 権威）。
 *
 * 2026-08-28 の殿裁可（案A 全面採用・decision_records 論点9改の改定）により、参加は
 * 「その場で氏名を自己入力して参加する」方式を廃し、**事前に発行されたアカウントでログインする**
 * 方式へ移行した。本型はその identity を表す唯一のドメイン表現である。
 *
 * ロールは `admin`（司会者＝殿）と `contestant`（解答者）の 2 値のみを持つ。認可の判定核は
 * 既存の `src/participants/authorize.ts`（`requireHost` / 401 / 403）が単一決定点であり、本
 * モジュールはそこへ「誰がどのロールか」を供給するだけで、判定を再実装しない。ゆえに
 * {@link toSessionRole} がアカウントロール → 認可ロールの唯一の写像点となる。
 *
 * 平文パスワードは本型に一切現れない（保存も表示もしない・AC-A8）。照合に要する値は
 * `passwordHash` / `passwordSalt` のみで、生成と照合は `src/accounts/password.ts` が担う。
 */

import type { Role } from "../participants/authorize.js";

/** アカウントロールの宣言集合（admin=司会者 / contestant=解答者）。 */
export const ACCOUNT_ROLES = ["admin", "contestant"] as const;

/** アカウントロール。role 列 1 本で足りる（MC は現時点で admin のみ）。 */
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/** 値が正当な {@link AccountRole} かを判定する型ガード（永続層から読み戻した値の検査に用いる）。 */
export function isAccountRole(value: unknown): value is AccountRole {
  return typeof value === "string" && (ACCOUNT_ROLES as readonly string[]).includes(value);
}

/**
 * アカウントロール → 認可ロール（`participants/authorize.ts` の {@link Role}）の唯一の写像。
 *
 * admin は制御盤・管理面の権限主体ゆえ `host`、contestant は解答者ゆえ `answerer` へ写す。
 * `audience`（TV 観客）はアカウントを要さぬ受動面のロールゆえ本写像の像に含めない。
 */
export function toSessionRole(role: AccountRole): Role {
  return role === "admin" ? "host" : "answerer";
}

/**
 * アカウント（`accounts` テーブル）のドメイン型。
 *
 * `id` は内部識別子で画面へ表示しない。`loginId` が殿・解答者の入力するログイン ID であり
 * 一意である。`displayName` は画面表示名で、受理境界は既存の氏名バリデータ
 * （`participants/name.ts` の `isValidDisplayName` / 上限 20）を再利用する。
 */
export interface Account {
  /** 内部識別子（`accounts.id`・主キー・表示しない）。 */
  readonly id: string;
  /** ログイン ID（`accounts.login_id`・一意）。 */
  readonly loginId: string;
  /** scrypt ハッシュ（`accounts.password_hash`・16 進）。平文は保持しない。 */
  readonly passwordHash: string;
  /** scrypt ソルト（`accounts.password_salt`・16 進）。 */
  readonly passwordSalt: string;
  /** ロール（`accounts.role`）。 */
  readonly role: AccountRole;
  /** 画面表示名（`accounts.display_name`）。 */
  readonly displayName: string;
  /** 作成時刻（`accounts.created_at`・ISO-8601）。 */
  readonly createdAt: string;
  /** 更新時刻（`accounts.updated_at`・ISO-8601）。 */
  readonly updatedAt: string;
}

/**
 * 画面・ログ・イベントへ渡してよいアカウントの公開射影。
 *
 * `passwordHash` / `passwordSalt` を型として持たないことが「秘密を面へ持ち出さない」ことの
 * 構造的担保である（AC-A8）。
 */
export interface PublicAccount {
  readonly id: string;
  readonly loginId: string;
  readonly role: AccountRole;
  readonly displayName: string;
}

/** アカウントから公開射影を取り出す（秘密列を落とす唯一の変換点）。 */
export function toPublicAccount(account: Account): PublicAccount {
  return {
    id: account.id,
    loginId: account.loginId,
    role: account.role,
    displayName: account.displayName,
  };
}
