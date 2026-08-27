/**
 * パスワードのハッシュ生成と照合（`module:accounts`・AC-A8）。
 *
 * 設計 SoT の確定制約に従い、ハッシュは **`node:crypto` の scrypt** のみを用いる（bcrypt 等の
 * 外部依存を増やさない。現行の実行時依存は `qrcode` のみ）。平文パスワードは保存も記録も
 * 表示もしない：本モジュールの入力として一度だけ受け取り、`{hash, salt}` へ写して捨てる。
 *
 * 照合は {@link timingSafeEqual} で行い、比較の早期打切りによる時間差から正否が漏れることを
 * 避ける。長さの異なる入力は比較前に弾く（`timingSafeEqual` は長さ不一致で例外を投げるため）。
 *
 * scrypt は CPU 負荷の高い KDF ゆえ、HTTP 要求処理を止めないよう **非同期版**（コールバック）を
 * Promise へ包んで用いる（同期版は単一プロセスのイベントループを塞ぐ）。
 */

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/** 導出鍵の長さ（バイト）。scrypt の出力長。 */
export const KEY_LENGTH = 64;

/** ソルトの長さ（バイト）。アカウント 1 件ごとに新規採番する。 */
export const SALT_LENGTH = 16;

/**
 * 受理する最短パスワード長（コードポイント基準）。家族利用の実運用に耐える下限として設ける。
 * 上限は設けない（長いパスフレーズを拒まない）。
 */
export const MIN_PASSWORD_LENGTH = 8;

/** 永続化するパスワード資格（平文を含まない）。 */
export interface PasswordCredential {
  /** scrypt 導出鍵の 16 進表現。 */
  readonly hash: string;
  /** ソルトの 16 進表現。 */
  readonly salt: string;
}

/** パスワードが受理境界（最短長）を満たすか（前後空白は除去せず、そのまま長さを測る）。 */
export function isAcceptablePassword(raw: string): boolean {
  return [...raw].length >= MIN_PASSWORD_LENGTH;
}

/** scrypt 導出を Promise 化する（非同期版のみを用いる）。 */
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (err, derivedKey) => {
      if (err !== null) reject(err);
      else resolve(derivedKey);
    });
  });
}

/**
 * 平文パスワードから新しいソルトと scrypt ハッシュを生成する。
 * 同じ平文でも呼び出しごとにソルトが変わるため、生成結果は毎回異なる。
 */
export async function hashPassword(plain: string): Promise<PasswordCredential> {
  const salt = randomBytes(SALT_LENGTH).toString("hex");
  const derived = await derive(plain, salt);
  return { hash: derived.toString("hex"), salt };
}

/**
 * 平文パスワードが保存済み資格と一致するかを定数時間比較で判定する。
 * 資格が壊れている（16 進でない・長さ不一致）場合も例外を投げず `false` を返す
 * （認証経路を 5xx へ化けさせない・健全性ベースライン < 500）。
 */
export async function verifyPassword(
  plain: string,
  credential: PasswordCredential,
): Promise<boolean> {
  let expected: Buffer;
  try {
    expected = Buffer.from(credential.hash, "hex");
  } catch {
    return false;
  }
  if (expected.length !== KEY_LENGTH) {
    return false;
  }
  const actual = await derive(plain, credential.salt);
  return timingSafeEqual(actual, expected);
}
