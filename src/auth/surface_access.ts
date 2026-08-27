/**
 * live 購読サーフェスの認可（`module:auth`・設計 D2 / D5）。
 *
 * SSE の購読口 `/events` はどのロールの投影を流すかを決める必要がある。旧実装はクライアントが
 * 申告した `role` をそのまま用いていたが、それでは観客が `role=host` と名乗るだけで司会者投影
 * （他者の解答・精算台帳）を受け取れてしまう。
 *
 * 案A では次のように分ける:
 *   - クライアントが申告するのは **今どの面を開いているか**（{@link LiveSurface}）だけである。
 *   - その面を開いてよいかはサーバが**セッション**から判定し、流す投影ロールもサーバが決める。
 *
 * これにより「面の選択」（クライアントの正当な関心）と「権限」（サーバの専管）が分かれ、
 * 申告値で権限が上がる経路が構造的に消える。判定核は既存 `participants/authorize.ts` を用いる。
 */

import type { Role } from "../participants/authorize.js";
import { guardAdminSurface } from "./access_guard.js";
import type { AuthSession } from "./session_registry.js";

/** live 購読しうる面の宣言集合。 */
export const LIVE_SURFACES = ["control_panel", "tablet", "tv"] as const;

/** live 購読しうる面。未知の申告は観客面（`tv`）へ収束させる。 */
export type LiveSurface = (typeof LIVE_SURFACES)[number];

/** 値が正当な {@link LiveSurface} かを判定する型ガード。 */
export function isLiveSurface(value: unknown): value is LiveSurface {
  return typeof value === "string" && (LIVE_SURFACES as readonly string[]).includes(value);
}

/** クライアントの申告を面へ解釈する（未知・未指定は観客面）。 */
export function toLiveSurface(value: unknown): LiveSurface {
  return isLiveSurface(value) ? value : "tv";
}

/** 購読の可否と、許可した場合に流す投影ロール。 */
export type LiveSubscription =
  | { readonly kind: "granted"; readonly role: Role }
  | { readonly kind: "denied"; readonly status: 401 | 403 };

/**
 * 当該セッションが当該面を live 購読してよいかを判定する。
 *
 *   - `control_panel`: admin セッションのみ（未認証 401 / 非 admin 403）。host 投影を流す。
 *   - `tablet`: ログイン済みなら誰でも（未認証 401）。**ロールに関わらず answerer 投影**を流す
 *     （司会者が解答面を開いても、その面には解答面の投影が要る）。
 *   - `tv`: 観客向け受動面ゆえ誰でも購読でき、audience 投影を流す。
 */
export function authorizeLiveSurface(
  surface: LiveSurface,
  session: AuthSession | undefined,
): LiveSubscription {
  switch (surface) {
    case "control_panel": {
      const outcome = guardAdminSurface(session);
      return outcome.kind === "granted"
        ? { kind: "granted", role: "host" }
        : { kind: "denied", status: outcome.status };
    }
    case "tablet":
      return session === undefined
        ? { kind: "denied", status: 401 }
        : { kind: "granted", role: "answerer" };
    case "tv":
      return { kind: "granted", role: "audience" };
  }
}
