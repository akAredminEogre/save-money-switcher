/**
 * アカウント設定面 `/me` のビュー投影（`module:accounts`・設計 D4「/me をこの意味へ作り直す」）。
 *
 * 旧 `/me`（cmd_2159 のメンバー設定）は localStorage の participantId を身元にして「参加者の
 * 表示名」を編集する面であった。案A では身元はログインセッションが持つゆえ、本面は
 * **自分のアカウント**（表示名・パスワード）の設定面へ作り直す（AC-A7）。
 *
 * 純粋なビュー投影であり、照合も永続も行わない。パスワードは現在値を持たず表示もしない
 * （AC-A8）。入力欄の長さ上限は氏名検証の単一定義 {@link MAX_DISPLAY_NAME_LENGTH} と
 * パスワードの単一定義 {@link MIN_PASSWORD_LENGTH} を反映し、UI とサーバで受理境界を二重定義しない。
 */

import { MAX_DISPLAY_NAME_LENGTH } from "../participants/name.js";
import { MIN_PASSWORD_LENGTH } from "./password.js";
import type { PublicAccount } from "./account.js";

/** アカウント設定面の見出し。 */
export const ACCOUNT_SETTINGS_HEADING = "アカウント設定";

/** 表示名の変更セクションの見出し。 */
export const DISPLAY_NAME_SECTION_HEADING = "お名前";

/** パスワードの変更セクションの見出し。 */
export const PASSWORD_SECTION_HEADING = "パスワード";

/** 表示名の変更 CTA。 */
export const DISPLAY_NAME_SUBMIT_LABEL = "お名前を変更する";

/** パスワードの変更 CTA。 */
export const PASSWORD_SUBMIT_LABEL = "パスワードを変更する";

/** パスワード入力欄の前置き（最短長を可視に伝える）。 */
export const PASSWORD_PROMPT = `新しいパスワード（${MIN_PASSWORD_LENGTH}文字以上）`;

/** アカウント設定面のビューモデル。 */
export interface AccountSettingsViewModel {
  readonly heading: string;
  /** 画面表示名（現在値）。 */
  readonly displayName: string;
  /** ログイン ID（変更不可・自分が何者かを確かめるための参照表示）。 */
  readonly loginId: string;
  /** 表示名入力欄の長さ上限。 */
  readonly displayNameMaxLength: number;
  /** パスワード入力欄の前置き。 */
  readonly passwordPrompt: string;
}

/** 自分の公開アカウント射影からアカウント設定面を描画する。 */
export function renderAccountSettings(account: PublicAccount): AccountSettingsViewModel {
  return {
    heading: ACCOUNT_SETTINGS_HEADING,
    displayName: account.displayName,
    loginId: account.loginId,
    displayNameMaxLength: MAX_DISPLAY_NAME_LENGTH,
    passwordPrompt: PASSWORD_PROMPT,
  };
}
