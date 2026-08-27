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
 * 参加 URL の組立（`module:participants`・PC-INV-1 / op_display_join_qr）。
 *
 * participation_connection_design §2.4.1 が確定した release-blocking 制約を具体化する:
 * 制御盤（/control-panel）が提示する参加 QR は、クラウド公開 URL を基底として `/join` を
 * 組み立てた参加 URL を符号化し、読取りで /join 公開 URL へ到達させる
 * （dod_qr_encodes_public_join_url）。本モジュールの {@link buildJoinUrl} はその参加 URL を
 * 組み立てる唯一の producer であり、QR 符号化（`src/participants/qr.ts`）は本 URL を入力として
 * 受け取る消費者である（責務境界・§1.1）。
 *
 * 組立は 2 つの設定解決点だけを出所とし、参加受入の単一経路と往復整合する:
 *   - 基底 URL: `src/config/public_base_url.ts` の `resolvePublicBaseUrl`（`PUBLIC_BASE_URL`）。
 *     `op_display_join_qr` の precondition「PUBLIC_BASE_URL が設定済み」を満たさない
 *     （未設定・空・不正）場合は解決点がドメインエラーを送出し、ホスト PC の localhost 等を既定
 *     基底に代替せず、無基底のまま公開参加導線を成立させない（PC-INV-6）。
 *   - 秘匿トークン（分岐 A・URL 秘匿）: `src/config/access_control_config.ts` の
 *     `resolveJoinAccessToken`（`JOIN_ACCESS_TOKEN`）。設定された非空トークンのみをクエリ `t`
 *     として付与する（＝分岐 A が構成されているときのみ載る）。未設定（分岐 B / 未構成）なら
 *     付与しない。ここで載せる提示トークンと `checkJoinAccess` が照合する期待トークンは、いずれも
 *     `resolveJoinAccessToken` を単一出所とするため往復で一致する（dod_access_single_resolution と
 *     整合）。
 *
 * 戻り値は `new URL("/join", base)` を `toString()` した絶対 URL 文字列であり、origin は
 * `PUBLIC_BASE_URL` と一致し pathname は `/join` になる。QR は公開 URL の符号化に留まり参加の
 * 権威源にはならない（PC-INV-6）。
 */

import { resolvePublicBaseUrl } from "../config/public_base_url.js";
import { resolveJoinAccessToken } from "../config/access_control_config.js";

/**
 * 参加受付サーフェスのパス（kebab-case ルート）。基底 URL に付与する `/join` の唯一の宣言点であり、
 * QR 読取り先の pathname の出所である。
 */
export const JOIN_PATH = "/join";

/**
 * 分岐 A（URL 秘匿）の秘匿トークンを載せる参加 URL のクエリパラメータ名。/join 受信側が提示トークン
 * （`checkJoinAccess` の `AccessContext.presentedToken`）として読み取る受け渡し口であり、付与側と
 * 読取り側はこの名前で一致する。
 */
export const JOIN_ACCESS_TOKEN_QUERY_PARAM = "t";

/**
 * 参加 URL 組立の env 注入ソース。基底 URL 解決・アクセス制御設定解決と同型で、既定は実行環境の
 * `process.env` を読む。両解決点へ同一ソースを渡し、参加 URL の基底とトークンを単一の設定源から
 * 解決する（`src/config/` を単一解決点に保つ）。
 */
export interface JoinLinkSource {
  /** 環境変数ソース。未指定時は `process.env` を用いる。 */
  readonly env?: Record<string, string | undefined>;
}

/**
 * クラウド公開の参加 URL（`/join`）を組み立てて返す。
 *
 * `resolvePublicBaseUrl` が解決した基底へ `/join` を付与し、`resolveJoinAccessToken` が非空の秘匿
 * トークンを返す（分岐 A）場合はそれをクエリ `t` として付与する。トークンが未設定（分岐 B / 未構成）
 * なら付与しない。戻り値の origin は `PUBLIC_BASE_URL` と一致し pathname は `/join` になる
 * （dod_qr_encodes_public_join_url）。
 *
 * @param source 基底 URL・トークンを解決する env 注入ソース（省略時は `process.env`）。
 * @returns 参加受付（/join）へ到達する絶対 URL 文字列。
 * @throws {PublicBaseUrlNotConfiguredError} `PUBLIC_BASE_URL` が未設定・空・空白のみの場合。
 * @throws {InvalidPublicBaseUrlError} `PUBLIC_BASE_URL` が絶対 URL（http/https）として解釈できない場合。
 */
export function buildJoinUrl(source: JoinLinkSource = {}): string {
  const url = new URL(JOIN_PATH, resolvePublicBaseUrl(source));
  const token = resolveJoinAccessToken(source);
  if (token !== undefined) {
    url.searchParams.set(JOIN_ACCESS_TOKEN_QUERY_PARAM, token);
  }
  return url.toString();
}
