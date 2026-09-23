/**
 * パスワード管理ソフト（Google パスワードマネージャー / 1Password 等）が、
 * 本アプリのパスワード欄を**候補提示・自動生成・自動保存の対象として認識できる**ことを、
 * 実際に起動したアプリ実体が返す HTML で検証する（cmd_2553 追補・殿 2026-09-08 御下命）。
 *
 * 本スペックが証跡化する契約（HTML 上の標準形）:
 *   - 新しくパスワードを決める欄（はじめのパスワード・新しいパスワード）は `autocomplete="new-password"`。
 *   - ログイン面のパスワード欄は `autocomplete="current-password"`、ID 欄は `autocomplete="username"`。
 *   - どの欄も `type="password"` / `name` / `id` を持ち、`<form>` に囲われ、`<label for>` か
 *     隠しの username 欄で「誰のパスワードか」が機械可読である。
 *   - 各 `<form>` は一意の `id` / `name` を名乗る（1Password 公式の互換要件
 *     "Use a unique element id or name for every field and form" ―
 *     developer.1password.com/docs/web/compatible-website-design。登録面判定を確実にするため cmd_2553 redo で追補）。
 *
 * 実機のブラウザ拡張（Google PM / 1Password）が実際に候補を出すか否かは拡張の導入された
 * 殿のブラウザでしか確かめられぬゆえ、本スペックは**属性・構造の側**を機械検証する。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { startAppInstance, type AppInstance } from "./helpers/app-instance.js";
import { LOGIN_PATH } from "../../src/auth/login_link.js";

/** 実行ごとの使い捨て資格情報（解答者アカウント）。 */
const CONTESTANT_LOGIN_ID = `pwhint-${randomBytes(5).toString("hex")}`;
const CONTESTANT_PASSWORD = randomBytes(18).toString("hex");
const CONTESTANT_NAME = "はなこ";
const EPISODE_TITLE = "第1回 パスワード欄の確認";

/** ログインし、セッション Cookie を返す（素の HTML フォーム送信と同じ経路）。 */
async function login(baseUrl: string, loginId: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}${LOGIN_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ login_id: loginId, password }).toString(),
    redirect: "manual",
  });
  expect(res.status).toBe(302);
  const setCookie = res.headers.get("set-cookie");
  expect(setCookie).not.toBeNull();
  return (setCookie as string).split(";")[0] as string;
}

/** ログイン済みで面を取得して HTML を返す。 */
async function getHtml(baseUrl: string, path: string, cookie: string): Promise<string> {
  const res = await fetch(`${baseUrl}${path}`, { headers: { cookie }, redirect: "manual" });
  expect(res.status).toBe(200);
  return res.text();
}

/** form 要素 1 つ分の HTML を切り出す（`data-form` で同定する）。 */
function formOf(html: string, dataForm: string): string {
  const start = html.indexOf(`<form`, 0) === -1 ? -1 : html.indexOf(`data-form="${dataForm}"`);
  expect(start, `form[data-form="${dataForm}"] が面に無い`).toBeGreaterThan(-1);
  const open = html.lastIndexOf("<form", start);
  const close = html.indexOf("</form>", start);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return html.slice(open, close + "</form>".length);
}

/** 属性つきの input 要素 1 つ分を切り出す（`name` で同定する）。 */
function inputOf(fragment: string, name: string): string {
  const at = fragment.indexOf(`name="${name}"`);
  expect(at, `input[name="${name}"] が form に無い`).toBeGreaterThan(-1);
  const open = fragment.lastIndexOf("<input", at);
  const close = fragment.indexOf(">", at);
  return fragment.slice(open, close + 1);
}

describe("パスワード管理ソフト向けの入力欄（cmd_2553 追補）", () => {
  let app: AppInstance;
  let adminCookie = "";
  let episodeId = "";

  beforeAll(async () => {
    app = await startAppInstance("pwhints");
    adminCookie = await login(app.baseUrl, app.adminLoginId, app.adminPassword);

    // 更新行（この人を保存する）を描かせるため、解答者を 1 人こしらえる。
    const created = await fetch(`${app.baseUrl}/admin/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: adminCookie },
      body: new URLSearchParams({
        login_id: CONTESTANT_LOGIN_ID,
        password: CONTESTANT_PASSWORD,
        display_name: CONTESTANT_NAME,
      }).toString(),
      redirect: "manual",
    });
    expect(created.headers.get("location")).toContain("notice=member_created");

    // 回の詳細（member-create フォーム）を描かせるため、回を 1 つこしらえる。
    const episode = await fetch(`${app.baseUrl}/admin/episodes`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: adminCookie },
      body: new URLSearchParams({ title: EPISODE_TITLE }).toString(),
      redirect: "manual",
    });
    const location = episode.headers.get("location") ?? "";
    episodeId = location.slice("/admin/episodes/".length).split("?")[0] as string;
    expect(episodeId).not.toBe("");
  }, 240_000);

  afterAll(async () => {
    if (app) await app.stop();
  });

  it("ログイン面は username / current-password を名乗り、label と id が結ばれている", async () => {
    const html = await (await fetch(`${app.baseUrl}${LOGIN_PATH}`)).text();
    const form = formOf(html, "login");
    const id = inputOf(form, "login_id");
    const password = inputOf(form, "password");

    expect(id).toContain('autocomplete="username"');
    expect(id).toContain('id="login-login_id"');
    expect(password).toContain('type="password"');
    expect(password).toContain('autocomplete="current-password"');
    expect(password).toContain('id="login-password"');
    expect(form).toContain('<label for="login-login_id">');
    expect(form).toContain('<label for="login-password">');
    expect(form).toContain(`action="${LOGIN_PATH}"`);
    // 1Password 互換要件: フォームは一意の id / name を名乗る。
    expect(form).toContain('id="login-form"');
    expect(form).toContain('name="login"');
  });

  it("解答者アカウント作成（はじめのパスワード）は username + new-password を名乗る", async () => {
    const html = await getHtml(app.baseUrl, "/admin/accounts", adminCookie);
    const form = formOf(html, "account-create");
    const id = inputOf(form, "login_id");
    const password = inputOf(form, "password");

    expect(form).toContain('method="post"');
    expect(form).toContain('action="/admin/accounts"');
    expect(id).toContain('autocomplete="username"');
    expect(id).toContain('id="account-create-login-id"');
    // cmd_2553 検証ラウンド2（殿ご裁可 2026-09-24・lp_2553_04）: 作成フォームの login_id から
    // data-1p-ignore を除去する。有力仮説＝この属性が 1Password に username 欄を無視させ、
    // new-password 欄との signup 対応付けを弱めて生成サジェストを抑止していた。
    expect(id).not.toContain("data-1p-ignore");
    expect(password).toContain('type="password"');
    expect(password).toContain('autocomplete="new-password"');
    expect(password).toContain('id="account-create-password"');
    expect(form).toContain('<label for="account-create-login-id">');
    expect(form).toContain('<label for="account-create-password">');
    // お名前は username と取り違えられぬよう明示的に対象外とする。
    expect(inputOf(form, "display_name")).toContain('autocomplete="off"');
    // 保存済みログインの一致を誘発せぬよう 1Password に無視させる（是正 cmd_2553 suppress-saved-login）。
    expect(inputOf(form, "display_name")).toContain("data-1p-ignore");
    // 1Password 互換要件: フォームは一意の id / name を名乗る。
    expect(form).toContain('id="account-create-form"');
    expect(form).toContain('name="account-create"');
  });

  it("解答者アカウント更新（この人を保存する）は new-password を持ち、PM から隠されている", async () => {
    const html = await getHtml(app.baseUrl, "/admin/accounts", adminCookie);
    const form = formOf(html, "account-update");
    const password = inputOf(form, "password");

    expect(password).toContain('type="password"');
    expect(password).toContain('autocomplete="new-password"');
    expect(password).toMatch(/id="account-update-password-[^"]+"/);
    // 更新行は管理者が他者のパスワードを変えるフォームゆえ PM に保存させない。
    expect(password).toContain("data-1p-ignore");
    // cmd_2553「次の手」: 更新行の隠しログインID欄（value 入り）は撤去した。値が残ると
    // 「この頁には既存資格情報が在る」と分類され、同頁の新規作成フォームで生成提案が抑止される
    // （autocomplete="off" は Chrome がパスワード欄向けに無視するうえ値自体が残るため無効化しきれぬ）。
    // ゆえに欄ごと除き、更新行に解答者のログインID値を DOM へ出さぬことを契約とする。
    expect(form).not.toContain(`value="${CONTESTANT_LOGIN_ID}"`);
    expect(form).not.toContain("readonly hidden");
    // 1Password 互換要件: 更新行のフォームは account.id を含む一意の id / name を名乗る。
    expect(form).toMatch(/id="account-update-form-[^"]+"/);
    expect(form).toMatch(/name="account-update-[^"]+"/);
  });

  it("回の解答者作成（はじめのパスワード）は username + new-password を名乗る", async () => {
    const html = await getHtml(app.baseUrl, `/admin/episodes/${episodeId}`, adminCookie);
    const form = formOf(html, "member-create");
    const id = inputOf(form, "login_id");
    const password = inputOf(form, "password");

    expect(form).toContain(`action="/admin/episodes/${episodeId}/contestants"`);
    expect(id).toContain('autocomplete="username"');
    expect(id).toContain('id="member-create-login-id"');
    // cmd_2553 検証ラウンド2（殿ご裁可 2026-09-24・lp_2553_04）: 作成フォームの login_id から
    // data-1p-ignore を除去（account-create と扱いを揃える）。
    expect(id).not.toContain("data-1p-ignore");
    expect(password).toContain('type="password"');
    expect(password).toContain('autocomplete="new-password"');
    expect(password).toContain('id="member-create-password"');
    expect(form).toContain('<label for="member-create-login-id">');
    expect(form).toContain('<label for="member-create-password">');
    // 保存済みログインの一致を誘発せぬよう 1Password に無視させる（是正 cmd_2553 suppress-saved-login）。
    expect(inputOf(form, "display_name")).toContain("data-1p-ignore");
    // 1Password 互換要件: フォームは一意の id / name を名乗る。
    expect(form).toContain('id="member-create-form"');
    expect(form).toContain('name="member-create"');
  });

  it("自分のパスワード変更（/me）は new-password と隠しの username を持つ", async () => {
    const cookie = await login(app.baseUrl, CONTESTANT_LOGIN_ID, CONTESTANT_PASSWORD);
    const html = await getHtml(app.baseUrl, "/me", cookie);
    const form = formOf(html, "password");
    const password = inputOf(form, "password");

    expect(password).toContain('type="password"');
    expect(password).toContain('autocomplete="new-password"');
    expect(password).toContain('id="me-new-password"');
    // 送信は client が横取りするが、素の HTML としても POST で成立させる（GET へ落として
    // パスワードを URL のクエリへ載せない）。
    expect(form).toContain('method="post"');
    expect(form).toContain('action="/me/password"');
    expect(form).toContain(
      `<input type="text" autocomplete="username" value="${CONTESTANT_LOGIN_ID}" readonly hidden>`,
    );
    // 1Password 互換要件: フォームは一意の id / name を名乗る。
    expect(form).toContain('id="me-password-form"');
    expect(form).toContain('name="me-password"');

    // お名前欄（rename フォーム）も username と取り違えられぬよう対象外を名乗る。
    const rename = formOf(html, "rename");
    expect(rename).toContain('method="post"');
    expect(rename).toContain('action="/me/display-name"');
    expect(inputOf(rename, "display_name")).toContain('autocomplete="off"');
    expect(rename).toContain('id="me-rename-form"');
    expect(rename).toContain('name="me-rename"');
  });
});
