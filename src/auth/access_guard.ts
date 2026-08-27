/**
 * 保護サーフェスの門番（`module:auth`・設計 D5 / AC-A1 / AC-A2）。
 *
 * `/control-panel` と `/admin/*` は admin セッション必須である。判定そのものは既存の単一決定点
 * {@link requireHost}（`participants/authorize.ts`）に委ね、本モジュールは **その拒否を
 * サーフェス種別に応じた応答へ写す**だけを担う（新しい判定核を発明しない）。
 *
 * 写像の規約:
 *   - 未認証（セッション無し・不正ロール）… HTML 面は {@link LOGIN_PATH} へ 302 で誘導し
 *     （AC-A1「素通りさせない」）、API は 401 を返す。
 *   - 認証済みだが admin でない（contestant）… いずれも 403（AC-A2）。ログインし直しても解決
 *     しない拒否ゆえログインへ誘導しない。
 *   - 通過… `HostSession` を返し、以降の処理の前提とする。
 */

import {
  ForbiddenRoleError,
  UnauthenticatedError,
  requireHost,
  HTTP_FORBIDDEN,
  HTTP_UNAUTHENTICATED,
  type HostSession,
} from "../participants/authorize.js";
import { LOGIN_PATH } from "./login_link.js";

/** 門番の判定結果。 */
export type GuardOutcome =
  | { readonly kind: "granted"; readonly session: HostSession }
  | {
      readonly kind: "unauthenticated";
      readonly status: typeof HTTP_UNAUTHENTICATED;
      /** HTML 面が誘導すべきログイン入口。 */
      readonly loginPath: string;
    }
  | { readonly kind: "forbidden"; readonly status: typeof HTTP_FORBIDDEN };

/**
 * admin 専用サーフェスへのアクセスを判定する。例外は投げず {@link GuardOutcome} へ収束させる
 * （保護面の拒否を 5xx へ化けさせない・健全性ベースライン < 500）。
 */
export function guardAdminSurface(session: unknown): GuardOutcome {
  try {
    return { kind: "granted", session: requireHost(session) };
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return { kind: "unauthenticated", status: HTTP_UNAUTHENTICATED, loginPath: LOGIN_PATH };
    }
    if (err instanceof ForbiddenRoleError) {
      return { kind: "forbidden", status: HTTP_FORBIDDEN };
    }
    throw err;
  }
}

/** ログイン後に戻る先として受理してよい遷移先か（同一オリジン内の絶対パスのみ）。 */
export function isSafeRedirectTarget(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\")
  );
}
