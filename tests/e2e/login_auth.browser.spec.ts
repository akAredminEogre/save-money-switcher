/**
 * ログインと保護面の門番（E2E・案A / AC-A1 / AC-A2 / AC-A8・2026-08-28 殿裁可）。
 *
 * 旧 `tests/e2e/join_surface.browser.spec.ts`（氏名自己入力の `/join` 面）と
 * `tests/e2e/member_join_name.browser.spec.ts`（localStorage 身元のメンバー機能）を、案A の
 * 動線へ**書き直した**もの。実ブラウザ（Playwright）で描画し、宣言・検証は Vitest で行う。
 *
 * 本スペックが証跡化する契約:
 *   - AC-A1: 未ログインで `/control-panel` へ来ると `/login` へ誘導される（保護面が素通りしない）。
 *   - AC-A2: 管理者でログインすれば `/control-panel` と `/admin` に入れる。
 *   - 旧方式の破棄: `/join`（氏名自己入力）は到達不能で、ログイン面に氏名入力欄が存在しない。
 *   - AC-A8: 平文パスワードが面にも Cookie にも現れず、セッション Cookie は HttpOnly である。
 *   - 誤った資格情報は 401 で拒まれ、理由の詳細（ID の有無）を出さない。
 *
 * 検証は本スペック専用に起動した隔離実体に対して行う（`helpers/app-instance.ts`）。使い捨ての
 * 資格情報を実行ごとに採番するため、リポジトリにも証跡にも実資格情報は残らない。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { assertServerHealthy } from "./helpers/server-health.js";
import { startAppInstance, createAdminContext, type AppInstance } from "./helpers/app-instance.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/cookie.js";
import { LOGIN_FAILED_MESSAGE } from "../../src/auth/login_surface.js";

describe("ログインと保護面の門番（案A・AC-A1 / AC-A2 / AC-A8）", () => {
  let browser: Browser;
  let app: AppInstance;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    app = await startAppInstance("auth");
  }, 180_000);

  afterAll(async () => {
    if (browser) await browser.close();
    if (app) await app.stop();
  });

  it("AC-A1: 未ログインで /control-panel へ来ると /login へ誘導される", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      const res = await page.goto(`${app.baseUrl}/control-panel`, { waitUntil: "domcontentloaded" });
      expect(res).not.toBeNull();
      assertServerHealthy(res!);
      // 保護面の内容は一切描かれず、ログイン面へ着地している。
      expect(new URL(page.url()).pathname).toBe("/login");
      const text = await page.locator("body").innerText();
      expect(text).not.toContain("問題を読み込む");
      expect(await page.locator('[data-surface="login"]').count()).toBe(1);
    } finally {
      await context.close();
    }
  }, 120_000);

  it("未ログインでは /admin・/tablet・ホームも素通りせずログインへ誘導される", async () => {
    const context = await browser.newContext();
    try {
      for (const path of ["/admin", "/tablet", "/"]) {
        const page = await context.newPage();
        try {
          const res = await page.goto(`${app.baseUrl}${path}`, { waitUntil: "domcontentloaded" });
          assertServerHealthy(res!);
          expect(new URL(page.url()).pathname, `${path} はログインへ誘導される`).toBe("/login");
        } finally {
          await page.close();
        }
      }
    } finally {
      await context.close();
    }
  }, 120_000);

  it("旧「その場参加」の /join は到達不能で、ログイン面に氏名の自己入力欄が無い", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      const joinRes = await page.goto(`${app.baseUrl}/join`, { waitUntil: "domcontentloaded" });
      expect(joinRes).not.toBeNull();
      assertServerHealthy(joinRes!);
      expect(joinRes!.status()).toBe(404);

      const loginRes = await page.goto(`${app.baseUrl}/login`, { waitUntil: "domcontentloaded" });
      assertServerHealthy(loginRes!);
      // 入力欄はログイン ID とパスワードの 2 つだけ（氏名の自己入力欄を持たない）。
      const names = await page.locator("form[data-form='login'] input:not([type=hidden])").evaluateAll(
        (nodes) => nodes.map((n) => (n as HTMLInputElement).name),
      );
      expect(names).toEqual(["login_id", "password"]);
      const text = await page.locator("body").innerText();
      expect(text).not.toContain("お名前を入力してください");
      expect(text).not.toContain("参加する");
    } finally {
      await context.close();
    }
  }, 120_000);

  it("誤った資格情報は 401 で拒まれ、理由の詳細を出さない", async () => {
    const res = await fetch(`${app.baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ login_id: app.adminLoginId, password: "definitely-wrong" }).toString(),
      redirect: "manual",
    });
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).toContain(LOGIN_FAILED_MESSAGE);
    // セッションは発行されない。
    expect(res.headers.get("set-cookie")).toBeNull();

    // 存在しないログイン ID でも同じ扱い（ID の有無を区別させない）。
    const unknown = await fetch(`${app.baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ login_id: "no-such-account", password: "definitely-wrong" }).toString(),
      redirect: "manual",
    });
    expect(unknown.status).toBe(401);
    expect(await unknown.text()).toContain(LOGIN_FAILED_MESSAGE);
  }, 60_000);

  it("AC-A8: 発行されるセッション Cookie は HttpOnly / SameSite=Lax で、平文パスワードを含まない", async () => {
    const res = await fetch(`${app.baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        login_id: app.adminLoginId,
        password: app.adminPassword,
      }).toString(),
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).not.toContain(app.adminPassword);
    // http のローカル検証では Secure を付けない（付けると Cookie が送られずログインできない）。
    expect(setCookie).not.toContain("Secure");
  }, 60_000);

  it("AC-A2: 管理者でログインすると /control-panel と /admin に入れる", async () => {
    const context = await createAdminContext(browser, app);
    try {
      const cpPage = await context.newPage();
      try {
        const res = await cpPage.goto(`${app.baseUrl}/control-panel`, { waitUntil: "domcontentloaded" });
        assertServerHealthy(res!);
        expect(res!.status()).toBe(200);
        expect(new URL(cpPage.url()).pathname).toBe("/control-panel");
        // 司会者操作語が可視要素として在る（保護面の中身が描かれている）。
        expect(await cpPage.locator("body").innerText()).toContain("問題を読み込む");
      } finally {
        await cpPage.close();
      }

      const adminPage = await context.newPage();
      try {
        const res = await adminPage.goto(`${app.baseUrl}/admin`, { waitUntil: "domcontentloaded" });
        assertServerHealthy(res!);
        expect(res!.status()).toBe(200);
        expect(await adminPage.locator('[data-surface="admin"]').count()).toBe(1);
      } finally {
        await adminPage.close();
      }
    } finally {
      await context.close();
    }
  }, 120_000);

  it("ログアウトするとセッションが失効し、保護面は再びログインへ誘導される", async () => {
    const context: BrowserContext = await createAdminContext(browser, app);
    const page = await context.newPage();
    try {
      await page.goto(`${app.baseUrl}/`, { waitUntil: "domcontentloaded" });
      await Promise.all([
        page.waitForURL((url) => url.pathname === "/login", { timeout: 15_000 }),
        page.click('button[data-op="logout"]'),
      ]);
      const res = await page.goto(`${app.baseUrl}/control-panel`, { waitUntil: "domcontentloaded" });
      assertServerHealthy(res!);
      expect(new URL(page.url()).pathname).toBe("/login");
    } finally {
      await context.close();
    }
  }, 120_000);

  it("ホスト操作コマンドは未ログインでは 401 で拒まれる（UI を迂回しても発動しない）", async () => {
    const res = await fetch(`${app.baseUrl}/host/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "load_questions" }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
  }, 60_000);
});
