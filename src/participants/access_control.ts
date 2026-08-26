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
 * 家族限定アクセスゲート（`module:participants`・PC-INV-3 / op_guard_family_access）。
 *
 * participation_connection_design §2.6 / §2.8 と OBM `op_guard_family_access` が確定した
 * release-blocking 制約「無認証の無制限公開を採らない」を、参加受入の唯一のアクセスゲートとして
 * 具体化する。参加ベクタ（制御盤の QR が指すクラウド公開 `/join`）へ到達した解答者が参加確定を
 * 試みるたびに、本ゲート {@link checkJoinAccess} が分岐 A / 分岐 B の許可判定を下す。
 *
 *   - 分岐 A（URL 秘匿・`JOIN_ACCESS_MODE=url_secret`）:
 *     提示トークンが設定トークンと **一致したときのみ** 許可する。設定トークンが未構成
 *     （空・空白のみを含む）なら提示が何であれ許可しない（空トークン一致による実質無防備を
 *     成立させない）。不一致・未提示も許可しない（VB-57）。
 *   - 分岐 B（認証・`JOIN_ACCESS_MODE=authenticated`）:
 *     セッションが認証済（`ctx.authenticated === true`）のときのみ許可する。
 *   - どちらの制御も未構成（方式が `undefined`）なら許可しない。URL 秘匿トークンも認証も無い
 *     「無制御公開」を構成上も実行時にも成立させない fail-closed（dod_access_no_open_public /
 *     VB-56）。
 *
 * 本ゲートはアクセス制御設定を自ら読まず、`src/config/access_control_config.ts` の
 * {@link resolveAccessMode} / {@link resolveJoinAccessToken} を **単一の設定出所** として参照する
 * （dod_access_single_resolution）。両解決関数は例外を投げない全域関数であり、本ゲートもその戻り値を
 * 分岐条件としてのみ用いる純関数であるため、受入判定が 5xx へ化けない（健全性ベースライン < 500 と
 * 整合）。判定は永続状態を持たず、設定と提示情報からのみ導出する（OBM `durable_state: なし`）。
 *
 * 未認証・未参加の `/join` に保護ナビ（制御盤操作）を露出させない義務（dod_access_no_protected_nav /
 * VB-58）は参加ページ描画側の責務であり、本ゲートはその根拠となる受入可否のみを供給する。
 */

import type { JoinAccessConfigSource } from "../config/access_control_config.js";
import {
  resolveAccessMode,
  resolveJoinAccessToken,
} from "../config/access_control_config.js";

/**
 * 参加受入判定に用いる提示コンテキスト。アクセス制御 **設定**（方式・設定トークン）とは独立に、
 * 解答者側から提示された情報のみを保持する。
 */
export interface AccessContext {
  /**
   * 分岐 A（URL 秘匿）で解答者が提示した秘匿トークン（参加 URL のクエリ `t` 由来）。未提示なら
   * `undefined`。設定トークンとの一致判定にのみ用い、分岐 B では参照しない。
   */
  readonly presentedToken?: string;

  /**
   * 分岐 B（認証）でセッションが認証済かどうか。分岐 B のときのみ許可判定に用い、分岐 A では
   * 参照しない（分岐 A の可否はトークン一致のみが根拠）。
   */
  readonly authenticated: boolean;
}

/**
 * アクセスゲートの判定結果。参加確定フローはこの `granted` 1 フィールドだけで参加の可否を分岐する。
 */
export interface AccessDecision {
  /** 参加を許可するなら `true`、拒否するなら `false`。 */
  readonly granted: boolean;
}

/**
 * 家族限定アクセス制御ゲート。参加確定を試みる解答者の提示コンテキストと、`src/config` が解決した
 * アクセス制御設定から、参加受入の可否を判定する唯一のゲートである。
 *
 * 判定は次の単一経路で行う:
 *   1. {@link resolveAccessMode} で方式を解決する。
 *   2. `url_secret` なら {@link resolveJoinAccessToken} の設定トークンが存在し、かつ提示トークンと
 *      一致するときだけ許可する（設定トークン未構成・不一致・未提示は拒否）。
 *   3. `authenticated` なら `ctx.authenticated` が真のときだけ許可する。
 *   4. いずれの方式でもない（未構成）なら拒否する（無制御公開を成立させない fail-closed）。
 *
 * @param ctx 解答者側の受入コンテキスト（分岐 A の秘匿トークン／分岐 B の認証状態）。
 * @param source アクセス制御設定の env 注入ソース（省略時は実行環境の `process.env` を読む）。方式・
 *   トークンの双方を同一ソースから解決し、単一経路を保つ。
 * @returns 参加受入の可否（`{ granted }`）。
 */
export function checkJoinAccess(
  ctx: AccessContext,
  source: JoinAccessConfigSource = {},
): AccessDecision {
  const mode = resolveAccessMode(source);

  if (mode === "url_secret") {
    const expected = resolveJoinAccessToken(source);
    // 設定トークンが未構成なら fail-closed。存在し、かつ提示トークンと一致するときのみ許可する。
    return { granted: expected !== undefined && ctx.presentedToken === expected };
  }

  if (mode === "authenticated") {
    return { granted: ctx.authenticated };
  }

  // どちらの制御も未構成なら参加を許可しない：無制御公開は構成上も実行時にも成立させない。
  return { granted: false };
}
