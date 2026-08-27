/**
 * ログイン面の描画（`auth/login_surface.ts`・設計 D4）。
 *
 * 旧 `tests/participants/join_surface.test.ts`（氏名自己入力の `/join` 面）を、2026-08-28 殿裁可
 * 案A に従って本スペックへ**書き直した**もの。固定する契約:
 *   - 面が持つ入力欄はログイン ID とパスワードの 2 つだけで、氏名の自己入力欄を型としても持たない
 *     （旧「その場参加」方式を復活させない）。
 *   - 失敗文言は単一の平易文で、「ID が無い」と「パスワードが違う」を区別できる言い方をしない。
 *   - 可視文言に内部ロール識別子・設定キー名・アクセス制御方式を露出しない。
 *   - パスワードは値を保持しない（面が平文を持ち回らない）。
 */

import { describe, it, expect } from "vitest";
import {
  LOGIN_FAILED_MESSAGE,
  LOGIN_HEADING,
  LOGIN_ID_LABEL,
  LOGIN_PASSWORD_LABEL,
  LOGIN_REQUIRED_MESSAGE,
  LOGIN_SUBMIT_LABEL,
  renderLoginSurface,
} from "../../src/auth/login_surface.js";

/** 可視文言へ出してはならない内部語・設定キー名。 */
const FORBIDDEN_TOKENS = [
  "host",
  "answerer",
  "audience",
  "JOIN_ACCESS_MODE",
  "JOIN_ACCESS_TOKEN",
  "MAX_TABLET_CONNECTIONS",
  "PUBLIC_BASE_URL",
  "ADMIN_INITIAL_PASSWORD",
  "scrypt",
];

/** ビューモデルの可視文言をすべて集める。 */
function visibleText(view: ReturnType<typeof renderLoginSurface>): string {
  return [view.heading, view.submitLabel, view.message ?? "", ...view.fields.map((f) => f.label)].join(
    " ",
  );
}

describe("auth/login_surface ログイン面の描画（案A・旧 /join 面の置換）", () => {
  it("入力欄はログイン ID とパスワードの 2 つだけで、氏名の自己入力欄を持たない", () => {
    const view = renderLoginSurface();
    expect(view.fields.map((f) => f.purpose)).toEqual(["login_id", "password"]);
    expect(view.fields.map((f) => f.control)).toEqual(["text", "password"]);
    expect(view.heading).toBe(LOGIN_HEADING);
    expect(view.submitLabel).toBe(LOGIN_SUBMIT_LABEL);
    expect(view.fields[0]?.label).toBe(LOGIN_ID_LABEL);
    expect(view.fields[1]?.label).toBe(LOGIN_PASSWORD_LABEL);
    // 入力欄は値を持たない構造仕様である（平文を面が持ち回らない）。
    expect(Object.keys(view.fields[1] ?? {})).toEqual(["purpose", "label", "control"]);
  });

  it("既定では告知文を持たない（何も起きていない面に理由を出さない）", () => {
    expect(renderLoginSurface().message).toBeUndefined();
  });

  it("照合失敗は理由を区別しない単一の平易文を出す", () => {
    expect(renderLoginSurface({ failed: true }).message).toBe(LOGIN_FAILED_MESSAGE);
    // ID の有無・パスワードの正否を言い分けない。
    expect(LOGIN_FAILED_MESSAGE).not.toMatch(/存在|登録されて|見つかりません/);
  });

  it("保護面からの誘導は要ログインの平易文を出し、直近の失敗があればそちらを優先する", () => {
    expect(renderLoginSurface({ loginRequired: true }).message).toBe(LOGIN_REQUIRED_MESSAGE);
    expect(renderLoginSurface({ loginRequired: true, failed: true }).message).toBe(
      LOGIN_FAILED_MESSAGE,
    );
  });

  it("戻り先は与えられたときだけ保持する", () => {
    expect(renderLoginSurface().redirectTo).toBeUndefined();
    expect(renderLoginSurface({ redirectTo: "/control-panel" }).redirectTo).toBe("/control-panel");
  });

  it("可視文言に内部ロール識別子・設定キー名・方式名を露出しない", () => {
    for (const input of [{}, { failed: true }, { loginRequired: true }]) {
      const text = visibleText(renderLoginSurface(input));
      for (const token of FORBIDDEN_TOKENS) {
        expect(text).not.toContain(token);
      }
    }
  });
});
