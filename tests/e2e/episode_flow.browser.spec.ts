/**
 * エピソードの動線（E2E・案A P2 / AC-A3〜AC-A6・issue #2 R3〜R6・2026-08-28 殿裁可）。
 *
 * 実ブラウザ（Playwright）で案A P2 の動線を通しで辿り、宣言・検証は Vitest で行う。
 * 本スペックが証跡化する契約:
 *   - AC-A3: 管理者が回を作り、一覧 → 詳細へ遷移し、問題・正解を登録できる。
 *   - AC-A4: 管理者が解答者アカウント（ログインID・はじめのパスワード）を作り、当該回へ招待できる。
 *   - AC-A5: 解答者がログインすると**招待された回だけ**が一覧に出る（招待されていない回は出ない）。
 *   - AC-A6: 解答者が一覧から参加でき、解答面に自分の表示名と残額が出る。参加後は解答が受理され、
 *     既存の採点・精算がそのまま働いて残額が動く。
 *   - 招待されていない回へ URL を直に叩いても参加できない（UI を迂回しても成立しない）。
 *
 * 検証は本スペック専用に起動した隔離実体に対して行い、資格情報は実行ごとに採番する
 * （リポジトリにも証跡にも実資格情報を残さない）。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { randomBytes } from "node:crypto";
import { assertServerHealthy } from "./helpers/server-health.js";
import {
  startAppInstance,
  createAdminContext,
  createLoginContext,
  type AppInstance,
} from "./helpers/app-instance.js";
import { formatYen } from "../../src/scoring/currency.js";
import { INITIAL_GRANT } from "../../src/scoring/yen.js";

/** 実行ごとの使い捨て資格情報（解答者アカウント）。 */
const CONTESTANT_LOGIN_ID = `child-${randomBytes(5).toString("hex")}`;
const CONTESTANT_PASSWORD = randomBytes(18).toString("hex");
const CONTESTANT_NAME = "たろう";

/** 招待する回と、招待しない回（AC-A5 の対照）。 */
const INVITED_TITLE = "第1回 家族戦";
const OTHER_TITLE = "第2回 まだ内緒";

/** 出題する 1 問（正解 47・解答 45 → 誤差 2）。 */
const QUESTION_TEXT = "日本の都道府県はいくつ？";
const CORRECT_VALUE = 47;
const ANSWER_VALUE = 45;

describe("エピソードの動線（案A P2・AC-A3〜AC-A6）", () => {
  let browser: Browser;
  let app: AppInstance;
  let admin: BrowserContext;
  let contestant: BrowserContext;
  let invitedEpisodeId = "";
  let otherEpisodeId = "";

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    app = await startAppInstance("episode");
    admin = await createAdminContext(browser, app);
  }, 240_000);

  afterAll(async () => {
    if (contestant) await contestant.close();
    if (admin) await admin.close();
    if (browser) await browser.close();
    if (app) await app.stop();
  });

  /** 管理者として回を 1 つ作り、その識別子（詳細 URL 由来）を返す。 */
  async function createEpisodeAs(title: string): Promise<string> {
    const page = await admin.newPage();
    try {
      const res = await page.goto(`${app.baseUrl}/admin/episodes`, { waitUntil: "domcontentloaded" });
      assertServerHealthy(res!);
      await page.fill('form[data-form="episode-create"] input[name="title"]', title);
      await Promise.all([
        page.waitForURL((url) => /\/admin\/episodes\/.+/.test(url.pathname), { timeout: 15_000 }),
        page.click('button[data-op="create-episode"]'),
      ]);
      const id = new URL(page.url()).pathname.split("/").pop() as string;
      expect(await page.locator('[data-field="episode-title"]').innerText()).toBe(title);
      return id;
    } finally {
      await page.close();
    }
  }

  it("AC-A3: 管理者が回を作り、一覧から詳細へ遷移して問題・正解を登録できる", async () => {
    invitedEpisodeId = await createEpisodeAs(INVITED_TITLE);
    otherEpisodeId = await createEpisodeAs(OTHER_TITLE);
    expect(invitedEpisodeId).not.toBe(otherEpisodeId);

    const page = await admin.newPage();
    try {
      // 一覧に両方の回が出て、詳細へ遷移できる。
      const res = await page.goto(`${app.baseUrl}/admin/episodes`, { waitUntil: "domcontentloaded" });
      assertServerHealthy(res!);
      const listText = await page.locator('[data-field="episode-list"]').innerText();
      expect(listText).toContain(INVITED_TITLE);
      expect(listText).toContain(OTHER_TITLE);
      await Promise.all([
        page.waitForURL((url) => url.pathname === `/admin/episodes/${invitedEpisodeId}`, { timeout: 15_000 }),
        page.click(`a[href="/admin/episodes/${invitedEpisodeId}"]`),
      ]);

      // 問題・正解を登録すると、その回の問一覧へ出る。
      await page.fill('form[data-form="question-create"] input[name="question_number"]', "1");
      await page.fill('form[data-form="question-create"] input[name="text"]', QUESTION_TEXT);
      await page.fill('form[data-form="question-create"] input[name="correct_value"]', String(CORRECT_VALUE));
      await Promise.all([
        page.waitForURL((url) => url.searchParams.get("notice") === "question_saved", { timeout: 15_000 }),
        page.click('button[data-op="register-question"]'),
      ]);
      const questions = await page.locator('[data-field="question-list"]').innerText();
      expect(questions).toContain(QUESTION_TEXT);
      expect(questions).toContain(String(CORRECT_VALUE));
    } finally {
      await page.close();
    }
  }, 180_000);

  it("AC-A4: 管理者が解答者アカウントを作り、その回へ招待できる", async () => {
    const page = await admin.newPage();
    try {
      const res = await page.goto(`${app.baseUrl}/admin/episodes/${invitedEpisodeId}`, {
        waitUntil: "domcontentloaded",
      });
      assertServerHealthy(res!);
      await page.fill('form[data-form="member-create"] input[name="login_id"]', CONTESTANT_LOGIN_ID);
      await page.fill('form[data-form="member-create"] input[name="password"]', CONTESTANT_PASSWORD);
      await page.fill('form[data-form="member-create"] input[name="display_name"]', CONTESTANT_NAME);
      await Promise.all([
        page.waitForURL((url) => url.searchParams.get("notice") === "member_created", { timeout: 15_000 }),
        page.click('button[data-op="create-member"]'),
      ]);
      const members = await page.locator('[data-field="member-list"]').innerText();
      expect(members).toContain(CONTESTANT_NAME);
      expect(members).toContain("招待済み");
      // はじめのパスワードは面に再表示されない（秘密を面へ持ち出さない）。
      expect(await page.locator("body").innerText()).not.toContain(CONTESTANT_PASSWORD);
    } finally {
      await page.close();
    }
  }, 180_000);

  it("AC-A5: 解答者には招待された回だけが出る（招待されていない回は出ない）", async () => {
    contestant = await createLoginContext(browser, app, CONTESTANT_LOGIN_ID, CONTESTANT_PASSWORD);
    const page = await contestant.newPage();
    try {
      const res = await page.goto(`${app.baseUrl}/episodes`, { waitUntil: "domcontentloaded" });
      assertServerHealthy(res!);
      const text = await page.locator('[data-surface="episodes"]').innerText();
      expect(text).toContain(INVITED_TITLE);
      expect(text).not.toContain(OTHER_TITLE);
    } finally {
      await page.close();
    }
  }, 180_000);

  it("招待されていない回は URL を直に叩いても参加できない", async () => {
    const res = await contestant.request.post(`${app.baseUrl}/episodes/${otherEpisodeId}/join`, {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(302);
    expect(res.headers()["location"]).toContain("error=not_invited");
  }, 60_000);

  it("解答者は管理面へ入れない（回の作成・招待は管理者の専管）", async () => {
    const res = await contestant.request.get(`${app.baseUrl}/admin/episodes`, { maxRedirects: 0 });
    expect(res.status()).toBe(403);
  }, 60_000);

  it("AC-A6: 解答者が一覧から参加でき、解答面に自分の表示名と残額が出る", async () => {
    const page = await contestant.newPage();
    try {
      await page.goto(`${app.baseUrl}/episodes`, { waitUntil: "domcontentloaded" });
      await Promise.all([
        page.waitForURL((url) => url.pathname === "/tablet", { timeout: 15_000 }),
        page.click('button[data-op="join"]'),
      ]);
      const text = await page.locator("body").innerText();
      expect(text).toContain(CONTESTANT_NAME);
      expect(text).toContain(formatYen(INITIAL_GRANT));
    } finally {
      await page.close();
    }

    // 参加は制御盤（エピソード詳細に埋め込まれた進行制御盤）の参加者一覧へ反映される。
    const adminPage = await admin.newPage();
    try {
      await adminPage.goto(`${app.baseUrl}/admin/episodes/${invitedEpisodeId}`, {
        waitUntil: "domcontentloaded",
      });
      expect(await adminPage.locator('[data-field="member-list"]').innerText()).toContain("参加済み");
      expect(await adminPage.locator('[data-field="control-panel"]').innerText()).toContain(CONTESTANT_NAME);
    } finally {
      await adminPage.close();
    }
  }, 180_000);

  it("参加した解答者の解答が受理され、精算まで進むと残額が動く", async () => {
    // 司会者が出題を始める（保護された操作ゆえ管理者の文脈で送る）。
    const load = await admin.request.post(`${app.baseUrl}/host/command`, {
      data: { command: "load_questions" },
    });
    expect(load.status()).toBe(200);

    const answer = await contestant.request.post(`${app.baseUrl}/tablet/answer`, {
      data: { value: ANSWER_VALUE },
    });
    expect(answer.status()).toBe(200);

    for (const command of ["lock_answers", "open_answers", "reveal_answer", "compute_settlement"]) {
      const res = await admin.request.post(`${app.baseUrl}/host/command`, { data: { command } });
      expect(res.status(), command).toBe(200);
    }

    const page = await contestant.newPage();
    try {
      await page.goto(`${app.baseUrl}/tablet`, { waitUntil: "domcontentloaded" });
      // 誤差 2（正解 47・解答 45）ゆえ、先渡し 10,000 円から 200 円分動く（規則は既存の採点が持つ）。
      const expected = formatYen(INITIAL_GRANT - Math.abs(CORRECT_VALUE - ANSWER_VALUE) * 100);
      expect(await page.locator('[data-field="own-balance"]').innerText()).toContain(expected);
    } finally {
      await page.close();
    }
  }, 180_000);
});
