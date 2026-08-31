/**
 * ログイン入口 `/login` のパスと公開 URL の組立（`module:auth`・設計 D4 / D6）。
 *
 * 案A（事前アカウント方式）への移行に伴い、参加への入口は「氏名を自己入力する `/join`」から
 * 「発行済みアカウントでログインする `/login`」へ移った。旧 `participants/join_link.ts` が担って
 * いた「QR が符号化する公開 URL の唯一の producer」という役割を、本モジュールが引き継ぐ。
 *
 * QR の意味は設計 D6 のとおり **付け替え**であり破棄ではない：QR は依然「配りにくい長い URL を
 * 家族の端末へ渡す手段」として有用で、符号化する先がログイン入口へ変わっただけである。
 * 分岐 A（URL 秘匿トークン）の付与は行わない。案A の家族限定アクセスは
 * `JOIN_ACCESS_MODE=authenticated`（ログイン）で成立し、URL 秘匿は用いないためである。
 */

import { resolvePublicBaseUrl } from "../config/public_base_url.js";

/**
 * ログイン面のパス（kebab-case ルート）。基底 URL に付与する `/login` の唯一の宣言点であり、
 * QR 読取り先の pathname の出所である。旧 `join_surface.JOIN_LOGIN_PATH` と同一の値を引き継ぎ、
 * 「未認証はログインへ誘導する」という既存の契約を保つ。
 */
export const LOGIN_PATH = "/login";

/** ログイン URL 組立の env 注入ソース（既定は実行環境の `process.env`）。 */
export interface LoginLinkSource {
  readonly env?: Record<string, string | undefined>;
}

/**
 * クラウド公開のログイン URL（`/login`）を組み立てて返す。戻り値の origin は `PUBLIC_BASE_URL` と
 * 一致し pathname は `/login` になる。
 *
 * @throws {PublicBaseUrlNotConfiguredError} `PUBLIC_BASE_URL` が未設定・空・空白のみの場合。
 * @throws {InvalidPublicBaseUrlError} `PUBLIC_BASE_URL` が絶対 URL（http/https）として解釈できない場合。
 */
export function buildLoginUrl(source: LoginLinkSource = {}): string {
  return new URL(LOGIN_PATH, resolvePublicBaseUrl(source)).toString();
}
