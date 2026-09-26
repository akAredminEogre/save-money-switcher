/**
 * セッション Cookie の組立と解釈（`module:auth`・設計 D2）。
 *
 * 案A の identity 権威は **サーバ側セッション ＋ HttpOnly Cookie** である。旧方式の
 * localStorage identity（participantId をクライアントが保持する）は廃止した：クライアントが
 * 書き換えられる値を identity にしてはならないため、ログイン後は本 Cookie が唯一の権威となる。
 *
 * 付与する属性は次のとおりで、いずれも構造的な防御である:
 *   - `HttpOnly`  : スクリプトから読めない（XSS でセッションを持ち去れない）。
 *   - `SameSite=Lax`: 別サイトからの遷移で Cookie を自動送信させない（CSRF 面の縮小）。
 *   - `Path=/`    : 全サーフェスで一貫して送られる。
 *   - `Secure`    : **https 配信時のみ**付与する（設計 D8・本番 Lightsail は https 前提）。
 *                   http のローカル試遊で Secure を付けると Cookie が送られずログインできぬため、
 *                   公開基底 URL のスキームから機械的に決める（環境変数を新設しない）。
 */

/** セッション識別子を載せる Cookie 名。 */
export const SESSION_COOKIE_NAME = "sid";

/** Cookie ヘッダを名前 → 値の写像へ解釈する。壊れた断片は読み捨て、例外を投げない。 */
export function parseCookies(header: string | undefined): Record<string, string> {
  const jar: Record<string, string> = {};
  if (header === undefined) return jar;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const rawValue = part.slice(index + 1).trim();
    if (name === "") continue;
    try {
      jar[name] = decodeURIComponent(rawValue);
    } catch {
      jar[name] = rawValue;
    }
  }
  return jar;
}

/** Cookie ヘッダからセッション識別子を取り出す（無ければ `undefined`）。 */
export function readSessionId(header: string | undefined): string | undefined {
  const value = parseCookies(header)[SESSION_COOKIE_NAME];
  return value === undefined || value === "" ? undefined : value;
}

/** 公開基底 URL が https なら Secure 属性を付ける（http のローカル試遊では付けない）。 */
export function isSecureOrigin(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).protocol === "https:";
  } catch {
    return false;
  }
}

/** セッション発行時の `Set-Cookie` 値を組み立てる。 */
export function buildSessionCookie(sessionId: string, secure: boolean): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

/** セッション破棄時の `Set-Cookie` 値を組み立てる（即時失効）。 */
export function buildClearedSessionCookie(secure: boolean): string {
  const attributes = [`${SESSION_COOKIE_NAME}=`, "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=0"];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}
