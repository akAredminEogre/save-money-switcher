/**
 * メンバー参加動線とメンバー名の設定・参照（E2E・cmd_2159 機能追加 AC-1〜AC-5）。
 *
 * 殿御下命「メンバー設定・参照の動線が無い」への対処が、実ブラウザで**辿れること**を証跡化する:
 *   - AC-1: アプリの入口（`/`）に参加導線があり、押下で `/join` に達する。
 *   - AC-2: `/join` で氏名を自己入力して参加すると `/tablet` へ遷移し、自分の名が面に出る。
 *   - AC-3: `/me` で改名すると、(a) 設定面 (b) 解答面 (c) 司会者の参加者一覧（手動リロード無しの
 *           SSE 反映）の三面すべてが新しい名に揃う。
 *   - AC-4: `participantId` クエリ無しで `/tablet` をリロードしても、この端末の保存済み身元で
 *           同じ参加者に復帰する（匿名化して残額 0 に落ちない）。
 *   - AC-5: 空白のみ・上限超過の氏名は拒否され、氏名も参加者一覧も変更前のまま。
 *
 * 面の描画は Playwright（ライブラリ import）、宣言・検証は Vitest（describe/it/expect）で行う
 * 既存 E2E 契約に従う。サーバは単一の揮発セッションを共有するため、各テストは固有の氏名で
 * 参加して自分の参加者だけを見る（テスト間で他の参加者が残っていても判定が濁らない）。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { assertServerHealthy } from "./helpers/server-health.js";
import { MAX_DISPLAY_NAME_LENGTH } from "../../src/participants/name.js";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/** 参加確定 CTA の可視ラベル（surface_copy_obligations §2.6 が verbatim に固定）。 */
const JOIN_CTA_LABEL = "参加する";

/** 参加直後の残額（先渡し 10,000 円・SC-1）の可視文言。 */
const INITIAL_BALANCE_TEXT = "10,000円";

/** SSE 反映・遷移待ちの上限（ローカル/CI いずれでも十分な余裕）。 */
const WAIT_MS = 15_000;

/** テスト間で衝突しない氏名を作る（サーバは単一セッションを共有する）。 */
let nameSeq = 0;
function uniqueName(prefix: string): string {
  nameSeq += 1;
  return `${prefix}${nameSeq}`;
}

/** `/join` で氏名を自己入力して参加し、`/tablet` に着いた page と participantId を返す。 */
async function joinAs(browser: Browser, name: string): Promise<{ page: Page; participantId: string }> {
  const page = await browser.newPage();
  const res = await page.goto(`${BASE_URL}/join`, { waitUntil: "domcontentloaded" });
  expect(res).not.toBeNull();
  assertServerHealthy(res!);

  await page.locator('form input[type="text"]').fill(name);
  await page.getByRole("button", { name: JOIN_CTA_LABEL }).click();

  await page.waitForURL(/\/tablet/, { timeout: WAIT_MS });
  // 自分の名は SSE 反映後に現れる（静的 chrome は身元を持たない）。
  await page.locator('[data-field="display-name"]').waitFor({ timeout: WAIT_MS });
  expect(await page.locator('[data-field="display-name"]').innerText()).toBe(name);

  const participantId = await page.evaluate(() => localStorage.getItem("smsw.participantId"));
  expect(participantId, "参加確定でこの端末へ身元が保存されること").toBeTruthy();
  return { page, participantId: participantId as string };
}

describe("メンバー参加動線とメンバー名の設定・参照（cmd_2159 AC-1〜AC-5）", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  }, 60_000);

  afterAll(async () => {
    if (browser) await browser.close();
  });

  // AC-1
  it("アプリの入口（/）に参加導線があり、押下で /join に達する", async () => {
    const page = await browser.newPage();
    try {
      const res = await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
      expect(res).not.toBeNull();
      assertServerHealthy(res!);

      const home = page.locator('[data-surface="home"]');
      await home.waitFor({ timeout: WAIT_MS });

      const joinLink = home.locator('a[href="/join"]');
      expect(await joinLink.count(), "ホームに参加導線があること").toBeGreaterThan(0);
      expect(await joinLink.first().isVisible()).toBe(true);
      // メンバー自身の設定面への導線も入口に置かれる（司会者面を経由せず辿れる）。
      expect(await home.locator('a[href="/me"]').count()).toBeGreaterThan(0);

      await joinLink.first().click();
      await page.waitForURL(/\/join$/, { timeout: WAIT_MS });
      expect(await page.getByRole("button", { name: JOIN_CTA_LABEL }).count()).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  }, 60_000);

  // AC-2
  it("/join で氏名を入力して参加すると /tablet へ遷移し、自分の名が面に表示される", async () => {
    const name = uniqueName("たろう");
    const { page } = await joinAs(browser, name);
    try {
      expect(page.url()).toContain("/tablet");
      expect(await page.locator('[data-field="display-name"]').innerText()).toBe(name);
      // 参加確定で先渡し 10,000 円が自分の残額として見える。
      await expect
        .poll(async () => page.locator('[data-field="own-balance"]').innerText(), { timeout: WAIT_MS })
        .toContain(INITIAL_BALANCE_TEXT);
    } finally {
      await page.close();
    }
  }, 60_000);

  // AC-3
  it("/me で改名すると 設定面・解答面・司会者の参加者一覧（SSE 反映）の三面が新しい名に揃う", async () => {
    const before = uniqueName("たろう");
    const after = uniqueName("タロウ");
    const { page: tablet, participantId } = await joinAs(browser, before);
    const controlPanel = await browser.newPage();
    const me = await browser.newPage();
    try {
      // 司会者は改名前の名でロスターを見ており、以後リロードしない（SSE 反映のみで追随すること）。
      const cpRes = await controlPanel.goto(`${BASE_URL}/control-panel`, { waitUntil: "domcontentloaded" });
      assertServerHealthy(cpRes!);
      const rosterItem = controlPanel.locator(`li[data-participant-id="${participantId}"]`);
      await rosterItem.waitFor({ timeout: WAIT_MS });
      expect(await rosterItem.innerText()).toBe(before);

      const meRes = await me.goto(`${BASE_URL}/me?participantId=${encodeURIComponent(participantId)}`, {
        waitUntil: "domcontentloaded",
      });
      assertServerHealthy(meRes!);
      expect(await me.locator('[data-field="display-name"]').innerText()).toBe(before);

      await me.locator('form[data-form="rename"] input[type="text"]').fill(after);
      await me.locator('form[data-form="rename"] button[type="submit"]').click();

      // (a) 設定面が新しい名になる。
      await expect
        .poll(async () => me.locator('[data-field="display-name"]').innerText(), { timeout: WAIT_MS })
        .toBe(after);

      // (b) 解答面（開き直し）が新しい名になる。
      await tablet.reload({ waitUntil: "domcontentloaded" });
      await expect
        .poll(async () => tablet.locator('[data-field="display-name"]').innerText(), { timeout: WAIT_MS })
        .toBe(after);

      // (c) 司会者の参加者一覧が手動リロード無し（SSE 配信）で新しい名に追随する。
      await expect
        .poll(async () => rosterItem.innerText(), { timeout: WAIT_MS })
        .toBe(after);
    } finally {
      await me.close();
      await controlPanel.close();
      await tablet.close();
    }
  }, 90_000);

  // AC-4
  it("participantId クエリ無しで /tablet をリロードしても、この端末の身元で同じ参加者に復帰する", async () => {
    const name = uniqueName("たろう");
    const { page } = await joinAs(browser, name);
    try {
      // クエリを落として素の /tablet を開く（URL 依存を脱していれば匿名化しない）。
      await page.goto(`${BASE_URL}/tablet`, { waitUntil: "domcontentloaded" });
      expect(new URL(page.url()).search).toBe("");

      await expect
        .poll(async () => page.locator('[data-field="display-name"]').innerText(), { timeout: WAIT_MS })
        .toBe(name);
      await expect
        .poll(async () => page.locator('[data-field="own-balance"]').innerText(), { timeout: WAIT_MS })
        .toContain(INITIAL_BALANCE_TEXT);
    } finally {
      await page.close();
    }
  }, 60_000);

  // AC-5
  it("空白のみ・上限超過の氏名は拒否され、氏名も司会者の参加者一覧も変更前のまま", async () => {
    const name = uniqueName("たろう");
    const { page: tablet, participantId } = await joinAs(browser, name);
    const controlPanel = await browser.newPage();
    const me = await browser.newPage();
    try {
      const cpRes = await controlPanel.goto(`${BASE_URL}/control-panel`, { waitUntil: "domcontentloaded" });
      assertServerHealthy(cpRes!);
      const rosterItem = controlPanel.locator(`li[data-participant-id="${participantId}"]`);
      await rosterItem.waitFor({ timeout: WAIT_MS });

      const meRes = await me.goto(`${BASE_URL}/me?participantId=${encodeURIComponent(participantId)}`, {
        waitUntil: "domcontentloaded",
      });
      assertServerHealthy(meRes!);

      const input = me.locator('form[data-form="rename"] input[type="text"]');
      const submit = me.locator('form[data-form="rename"] button[type="submit"]');
      const message = me.locator('[data-field="message"]');

      for (const rejected of ["   ", "あ".repeat(MAX_DISPLAY_NAME_LENGTH + 1)]) {
        // maxlength は UI の一次防衛ゆえ、サーバの最終防衛を検証するため値を直接注入する。
        await input.evaluate((el, value) => {
          (el as HTMLInputElement).value = value;
        }, rejected);
        await submit.click();

        // 画面に平易な理由が出る（内部語・スタックを出さない）。
        await expect.poll(async () => message.innerText(), { timeout: WAIT_MS }).not.toBe("");
        const reason = await message.innerText();
        expect(reason).not.toContain("Error");
        expect(reason).not.toContain("participantId");

        // 氏名は変更前のまま（設定面・司会者の参加者一覧のいずれも動かない）。
        expect(await me.locator('[data-field="display-name"]').innerText()).toBe(name);
        expect(await rosterItem.innerText()).toBe(name);
      }

      // 解答面を開き直しても変更前の氏名のままである。
      await tablet.reload({ waitUntil: "domcontentloaded" });
      await expect
        .poll(async () => tablet.locator('[data-field="display-name"]').innerText(), { timeout: WAIT_MS })
        .toBe(name);
    } finally {
      await me.close();
      await controlPanel.close();
      await tablet.close();
    }
  }, 90_000);
});
