/**
 * アカウント設定面 `/me` の描画（`accounts/account_surface.ts`・設計 D4 / AC-A7 / AC-A8）。
 *
 * 旧「メンバー設定（participantId 由来）」から案A の「自分のアカウント設定」へ作り直した面の
 * 契約を固定する。とりわけ **パスワードの現在値を面が持たない**ことを型と値の双方で確かめる。
 */

import { describe, it, expect } from "vitest";
import {
  ACCOUNT_SETTINGS_HEADING,
  PASSWORD_PROMPT,
  renderAccountSettings,
} from "../../src/accounts/account_surface.js";
import { MAX_DISPLAY_NAME_LENGTH } from "../../src/participants/name.js";
import { MIN_PASSWORD_LENGTH } from "../../src/accounts/password.js";
import type { PublicAccount } from "../../src/accounts/account.js";

const ACCOUNT: PublicAccount = {
  id: "acc-1",
  loginId: "lord",
  role: "admin",
  displayName: "殿",
};

describe("accounts/account_surface アカウント設定面の描画", () => {
  it("自分の表示名とログイン ID を参照でき、内部識別子は面へ出さない", () => {
    const view = renderAccountSettings(ACCOUNT);
    expect(view.heading).toBe(ACCOUNT_SETTINGS_HEADING);
    expect(view.displayName).toBe("殿");
    expect(view.loginId).toBe("lord");
    // 内部識別子（accounts.id・ロールの内部語）は面のモデルに含めない。
    expect(JSON.stringify(view)).not.toContain("acc-1");
    expect(JSON.stringify(view)).not.toContain("admin");
  });

  it("入力欄の受理境界は単一定義（氏名上限・パスワード最短長）を反映する", () => {
    const view = renderAccountSettings(ACCOUNT);
    expect(view.displayNameMaxLength).toBe(MAX_DISPLAY_NAME_LENGTH);
    expect(view.passwordPrompt).toBe(PASSWORD_PROMPT);
    expect(view.passwordPrompt).toContain(String(MIN_PASSWORD_LENGTH));
  });

  it("パスワードの現在値を面が持たない（型としても値としても）", () => {
    const view = renderAccountSettings(ACCOUNT);
    expect(Object.keys(view).sort()).toEqual(
      ["displayName", "displayNameMaxLength", "heading", "loginId", "passwordPrompt"].sort(),
    );
  });
});
