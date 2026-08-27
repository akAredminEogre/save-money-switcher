// @generated-by: codd implement
// @generated-from: docs/design/surface_copy_obligations.md (design:surface-copy-obligations)
// @design-node: docs/design/surface_copy_obligations.md
// @output-paths: tests
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @generated-from: docs/design/operational_behavior_model.md (design:operational-behavior-model)
// @generated-from: docs/design/participation_connection_design.md (design:participation-connection-design)
// @generated-from: docs/design/question_media_intake_design.md (design:question-media-intake-design)
// @generated-from: docs/design/realtime_sync_design.md (design:realtime-sync-design)
// @generated-from: docs/design/scoring_engine_design.md (design:scoring-engine-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

/**
 * 全サーフェス横断の金額文言・円建て走査（E2E・SCO-4 /
 * surface_copy_obligations §2.5・§2.11 / op_enforce_currency_yen_copy の
 * dod_currency_no_point_token / dod_currency_no_pointization_phrase /
 * dod_currency_yen_all_surfaces）。
 *
 * 四つのアクター向けサーフェス（制御盤 /control-panel・タブレット /tablet・TV /tv・
 * ログイン /login）を Playwright（ライブラリ import）で実ブラウザ描画し、宣言・検証は
 * Vitest（describe/it/expect）で行う（§1.2・§2.11・§3.1）。本スペックは金額文言の
 * 「円建て固定・点化禁止」という見え方の契約を、面横断の可視コピー走査で証跡化する:
 *   - VB-35: 金額が全サーフェスの可視文言で円建て（円）で表され、point/pt/点 の語が
 *            存在しない。
 *
 * 本タスクはサーフェス面の走査を担い、API 応答の円建て走査は兄弟
 * operational-behavior-model が所有するため範囲外とする（可視コピー面のみを駆動する）。
 * 走査は健全性ベースライン（status < 500・§2.10）を先に担保した上で、可視コピー
 * （innerText＝属性/マークアップ/生成 id を含まない描画テキスト）に対して行う。点化文言
 * （point/pt/点・◯◯点/◯◯pt）の非露出は正準ヘルパ scanForbiddenCopy（currency_token 分類・
 * dod_currency_no_point_token と dod_currency_no_pointization_phrase の双方を担う）を経由し、
 * 金額を提示する消費面（op_enforce_currency_yen_copy の consumer_surfaces＝tv_mode_d /
 * tv_mode_e / answerer_tablets）が円建て単位「円」で表示されることを assertYenDenominated で
 * 押さえる。個々の金額値（例 -100円/-500円/+1000円）は稼働ゲートを進めた game_state・
 * balances を要するため、単一の整形点 formatYen の境界は tests/scoring/currency.test.ts の
 * 単体が担い、本 E2E は面横断の可視コピー走査を担う。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { assertServerHealthy } from "./helpers/server-health.js";
import {
  scanForbiddenCopy,
  assertYenDenominated,
  CURRENCY_UNIT,
} from "./helpers/assertions.js";
import { startAppInstance, createAdminContext, type AppInstance } from "./helpers/app-instance.js";

/**
 * 走査対象サーフェスの指定。`authenticated` の面は案A（2026-08-28 殿裁可）で admin セッションを
 * 要するため、ログイン済み文脈から開く。ログイン面は未ログインの文脈で開く（ログイン済みだと
 * ホームへ返されるため）。
 */
interface SurfaceTarget {
  readonly label: string;
  readonly path: string;
  readonly authenticated: boolean;
}

/** 四つのアクター向けサーフェス（案A では参加の入口はログイン面である）。 */
const ALL_SURFACES: readonly SurfaceTarget[] = [
  { label: "制御盤", path: "/control-panel", authenticated: true },
  { label: "タブレット", path: "/tablet", authenticated: true },
  { label: "TV", path: "/tv", authenticated: false },
  { label: "ログイン", path: "/login", authenticated: false },
];

/**
 * 金額を提示する消費面（op_enforce_currency_yen_copy の consumer_surfaces＝
 * tv_mode_d / tv_mode_e / answerer_tablets）。TV はモード指定 URL で d/e へ到達する。
 */
const MONEY_SURFACES: readonly SurfaceTarget[] = [
  { label: "TV(d) 当該問精算表", path: "/tv?mode=d", authenticated: false },
  { label: "TV(e) 全問通算一覧", path: "/tv?mode=e", authenticated: false },
  { label: "タブレット残額", path: "/tablet", authenticated: true },
];

describe("全サーフェスの金額文言・円建て固定/点化禁止（SCO-4・dod_currency_*）", () => {
  let browser: Browser;
  let app: AppInstance;
  let adminContext: BrowserContext;
  let anonContext: BrowserContext;
  let TV_MODE_D_URL: string;

  /** 当該サーフェスを開くべき文脈（ログイン済み／未ログイン）を返す。 */
  function contextFor(surface: SurfaceTarget): BrowserContext {
    return surface.authenticated ? adminContext : anonContext;
  }

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    app = await startAppInstance("currency");
    TV_MODE_D_URL = `${app.baseUrl}/tv?mode=d`;
    adminContext = await createAdminContext(browser, app);
    anonContext = await browser.newContext();
  }, 180_000);

  afterAll(async () => {
    if (adminContext) await adminContext.close();
    if (anonContext) await anonContext.close();
    if (browser) await browser.close();
    if (app) await app.stop();
  });

  // codd: covers vb=VB-35
  it("四つの全サーフェスの可視文言に point/pt/点 が存在せず、金額提示面が円建て（円）で表示される", async () => {
    // 制御盤・タブレット・TV・ログインの各サーフェスを実ブラウザで描画し、SUT の観測結果
    // （応答ステータスと描画済み可視テキスト）に対してアサートする。可視コピー（innerText）は
    // 属性・マークアップ・生成 id を含まないため、dod が govern する「可視文言」そのものへ
    // スコープされる（§3.1 の走査方式）。API 応答の走査は兄弟 operational-behavior-model が
    // 所有するため本 E2E の範囲外（サーフェス面のみを駆動する）。
    for (const surface of ALL_SURFACES) {
      const page = await contextFor(surface).newPage();
      try {
        const res = await page.goto(`${app.baseUrl}${surface.path}`, { waitUntil: "domcontentloaded" });
        expect(res, `${surface.label} の応答が得られること`).not.toBeNull();
        // 健全性ベースライン: 5xx を業務ステータスと混同せず、まず status < 500 を担保する。
        assertServerHealthy(res!);

        const visibleText = await page.locator("body").innerText();

        // dod_currency_no_point_token / dod_currency_no_pointization_phrase:
        // 可視コピーへスコープした点化文言（point/pt/点・◯◯点/◯◯pt）の非露出を、正準ヘルパ
        // scanForbiddenCopy（currency_token 分類）で確かめる。いずれかの面が「点」「pt」「point」を
        // 可視文言へ出せば違反が 1 件以上返り toHaveLength(0) が RED になる。
        expect(
          scanForbiddenCopy(visibleText, { categories: ["currency_token"] }),
          `${surface.label} の可視文言に point/pt/点 が無いこと`,
        ).toHaveLength(0);
      } finally {
        await page.close();
      }
    }

    // dod_currency_yen_all_surfaces（円建て側）: 金額を提示する TV(d) 面が円建て単位「円」で
    // 表示され点化語を含まないことを確かめる。TV(d) は 6 列精算表（増減円/残額を含む）ゆえ
    // 描画テキストへ円建て単位が現れる。金額が単位無し・点化単位へ差し替わると
    // assertYenDenominated（円の存在＋点化語の不在を同時検証）が throw して RED になる。
    const dPage = await anonContext.newPage();
    try {
      const res = await dPage.goto(TV_MODE_D_URL, { waitUntil: "domcontentloaded" });
      expect(res, "TV(d) の応答が得られること").not.toBeNull();
      assertServerHealthy(res!);

      const dVisibleText = await dPage.locator("body").innerText();
      // 円建て単位「円」の存在 ＋ 点化語（point/pt/点）の不在 を同時に検証する。
      expect(() => assertYenDenominated(dVisibleText)).not.toThrow();
      // 円建て単位が実際に描画済み可視テキストへ現れることも独立に押さえる（円建て提示の正側）。
      expect(dVisibleText, "TV(d) の金額提示が円建て単位『円』を含むこと").toContain(CURRENCY_UNIT);
    } finally {
      await dPage.close();
    }
  }, 120_000);

  it("金額を提示する消費面（TV d/e・タブレット残額）の可視文言に点化文言が存在しない", async () => {
    // op_enforce_currency_yen_copy の consumer_surfaces（tv_mode_d / tv_mode_e / answerer_tablets）を
    // 各々描画し、金額を扱う面の可視コピーに point/pt/点・◯◯点/◯◯pt が現れないことを確かめる。
    // 金額提示面で得点の点数化・ポイント化が起きれば currency_token 分類の違反が返り RED になる
    // （dod_currency_no_point_token / dod_currency_no_pointization_phrase を消費面で補強）。
    for (const surface of MONEY_SURFACES) {
      const page = await contextFor(surface).newPage();
      try {
        const res = await page.goto(`${app.baseUrl}${surface.path}`, { waitUntil: "domcontentloaded" });
        expect(res, `${surface.label} の応答が得られること`).not.toBeNull();
        assertServerHealthy(res!);

        const visibleText = await page.locator("body").innerText();
        expect(
          scanForbiddenCopy(visibleText, { categories: ["currency_token"] }),
          `${surface.label} の可視文言に point/pt/点 が無いこと`,
        ).toHaveLength(0);
      } finally {
        await page.close();
      }
    }
  }, 120_000);
});
