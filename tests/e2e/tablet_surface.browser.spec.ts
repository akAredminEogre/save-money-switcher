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
 * タブレット面の可視要素・禁止コピー・禁止導線の走査（E2E・SCO-2 /
 * surface_copy_obligations §2.3・§2.8・§2.11 / op_render_tablet_surface の
 * dod_tablet_minimal_elements_only / dod_tablet_no_others_info /
 * dod_tablet_no_control_actions / dod_tablet_contestant_copy_only）。
 *
 * /tablet を Playwright（ライブラリ import）で実ブラウザ描画し、宣言・検証は Vitest
 * （describe/it/expect）で行う（§1.2・§2.11・§3.1）。本スペックは解答者タブレットの
 * 「入力専用最小 UI」という見え方の契約を、面ごとの走査で証跡化する:
 *   - VB-41: /tablet の可視要素・可視文言が解答者向け入力専用に限られ、司会者操作語・
 *            内部ロール識別子・内部イベント名・設定キー名・デモ/テスト表記・point/pt/点 が
 *            露出しない（可視コピーを解答者向けに閉じることで「限られる」の上界を担保）。
 *   - VB-44: 他者の氏名・解答・残額・得点、出題本文・メディア、全体一覧が /tablet に
 *            表示されない（プライバシー投影・§2.8）。
 *   - VB-24: 締切・開示・正解発表・精算・モード切替・取消の操作要素が /tablet に存在しない。
 *
 * 走査は健全性ベースライン（status < 500・§2.10）を先に担保した上で、可視コピー
 * （innerText）と構造要素（table/video・data-op ロケータ・ロール名ボタン）に対して行う。
 * point/pt/点 と内部ロール識別子の走査は正準ヘルパ scanForbiddenCopy を経由し、金額円建て
 * （VB-35）・可視ラベル（VB-80）・内部露出（VB-79）の各クロスカット義務をタブレット面でも
 * 補強する（それらの正準 owner は currency / role_labels / control_panel の各スペックであり、
 * ここでは VB-41 の「入力専用に限られる」判定を支える補助アサートとして用いる）。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { assertServerHealthy } from "./helpers/server-health.js";
import { startAppInstance, createAdminContext, type AppInstance } from "./helpers/app-instance.js";
import { scanForbiddenCopy } from "./helpers/assertions.js";



/** 司会者向け操作語（§2.2・§2.7 が verbatim に固定・可視文言として /tablet に不在）。 */
const HOST_OPERATIONAL_WORDS = [
  "問題を読み込む",
  "そこまで",
  "解答オープン",
  "正解発表",
  "精算",
  "次へ",
  "戻る",
  "個別ジャンプ",
  "取消",
] as const;

/** 締切・開示・正解発表・精算・モード切替・取消の司会者操作語（/tablet にボタンとして不在）。 */
const CONTROL_ACTION_WORDS = [
  "そこまで",
  "解答オープン",
  "正解発表",
  "精算",
  "次へ",
  "戻る",
  "取消",
] as const;

/** 運用語で表すべき内部イベント名（可視文言に露出してはならない・§1.3）。 */
const INTERNAL_EVENT_NAMES = [
  "accepting",
  "answers_locked",
  "answers_opened",
  "answer_revealed",
  "settlement_computed",
  "tv_mode_changed",
];

/** 露出禁止の設定キー名（§2.8・接続数会計/アクセス制御方式の内部名を出さない）。 */
const CONFIG_KEY_NAMES = [
  "MAX_TABLET_CONNECTIONS",
  "JOIN_ACCESS_TOKEN",
  "JOIN_ACCESS_MODE",
  "PUBLIC_BASE_URL",
  "QUESTION_MEDIA_ROOT",
];

/** 露出禁止のデモ/テスト/サンプル表記（本番用可視コピーのみ）。 */
const DEMO_TEST_LABELS = ["デモ", "テスト", "サンプル"];

/**
 * 司会者操作の制御要素セレクタ。data-op の値は §2.11 の受け入れ例が verbatim に固定した
 * lock/open/switch に限る（reveal/settle/undo の data-op 内部名は設計に固定値が無いため、
 * 当該操作の不在はロール名ボタン走査で担保する）。
 */
const HOST_CONTROL_OP_SELECTOR = '[data-op="lock"],[data-op="open"],[data-op="switch"]';

/** 全体一覧・他者情報を示唆するロスター系の可視文言（司会者面/TV(e) の語・/tablet に不在）。 */
const ROSTER_COPY = ["参加者", "全員", "一覧"];

describe("タブレット面の可視要素・禁止コピー・禁止導線（SCO-2・dod_tablet_*）", () => {
  let browser: Browser;
  let app: AppInstance;
  let context: BrowserContext;
  let TABLET_URL: string;

  // 案A（2026-08-28 殿裁可）で解答面の身元は Cookie セッションが持つため、本スペック専用の
  // 隔離実体を起動し、使い捨ての資格情報でログインした文脈から面を開く。
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    app = await startAppInstance("tablet");
    TABLET_URL = `${app.baseUrl}/tablet`;
    context = await createAdminContext(browser, app);
  }, 180_000);

  afterAll(async () => {
    if (context) await context.close();
    if (browser) await browser.close();
    if (app) await app.stop();
  });

  // codd: covers vb=VB-41
  it("可視要素・可視文言が解答者向け入力専用に限られ、司会者操作語・内部露出・point/pt/点 が無い", async () => {
    const page = await context.newPage();
    try {
      const res = await page.goto(TABLET_URL, { waitUntil: "domcontentloaded" });
      expect(res).not.toBeNull();
      // 健全性ベースライン: 5xx を業務ステータスと混同せず、まず status < 500 を担保する。
      assertServerHealthy(res!);

      // 可視コピー（描画済みテキスト）を取得する。innerText は属性/マークアップ/生成 id を
      // 含まず、dod が govern する「可視コピー」そのものへスコープされる（§3.1 の走査方式）。
      // タブレットは入力専用最小 UI ゆえ innerText 全体が dod_tablet_contestant_copy_only の対象。
      const visibleText = await page.locator("body").innerText();

      // dod_tablet_contestant_copy_only: 司会者向け操作語が可視文言に一切現れない。いずれかが
      // 漏れると当該 not.toContain が RED になり、入力専用面へ司会者面の文言が混入したことを
      // 捕捉する（「入力専用に限られる」の上界を可視コピー側で押さえる）。
      for (const word of HOST_OPERATIONAL_WORDS) {
        expect(visibleText).not.toContain(word);
      }

      // 内部ロール識別子（host/contestant/audience）の非露出（VB-79/VB-80 をタブレット面で補強）。
      expect(scanForbiddenCopy(visibleText, { categories: ["internal_role_identifier"] })).toHaveLength(0);

      // 点化文言（point/pt/点）の非露出（円建て固定・現金感を薄めない・VB-35 をタブレット面で補強）。
      expect(scanForbiddenCopy(visibleText, { categories: ["currency_token"] })).toHaveLength(0);

      // 内部イベント名の非露出（状態表示は運用語＝受付中/締切 で表す）。
      for (const eventName of INTERNAL_EVENT_NAMES) {
        expect(visibleText).not.toContain(eventName);
      }

      // 設定キー名の非露出（接続数会計・アクセス制御方式の内部名を出さない）。
      for (const configKey of CONFIG_KEY_NAMES) {
        expect(visibleText).not.toContain(configKey);
      }

      // デモ/テスト/サンプル表記の非露出（本番用可視コピーのみ）。
      for (const demoLabel of DEMO_TEST_LABELS) {
        expect(visibleText).not.toContain(demoLabel);
      }
    } finally {
      await page.close();
    }
  }, 60_000);

  // codd: covers vb=VB-44
  it("他者の氏名・解答・残額・得点、出題本文・メディア、全体一覧が表示されない", async () => {
    const page = await context.newPage();
    try {
      const res = await page.goto(TABLET_URL, { waitUntil: "domcontentloaded" });
      expect(res).not.toBeNull();
      assertServerHealthy(res!);

      // dod_tablet_no_others_info: 全体一覧・d の 6 列精算表・e の全問通算表はいずれも表
      // （table）であり、自分中心の入力専用最小 UI であるタブレットには存在しない。他者情報の
      // 集約表示が漏れれば table が現れて RED になる。
      expect(await page.locator("table").count()).toBe(0);

      // 出題本文・出題メディアは TV(a) の役割で、タブレット向け読みモデルは出題内容を一切
      // 含めない（§2.8）。出題動画がタブレットへ埋め込まれれば video が現れて RED になる。
      expect(await page.locator("video").count()).toBe(0);

      // 参加者一覧（roster）・全員・一覧 は司会者面/TV(e) の語であり、タブレットに露出しない。
      // タブレットの可視コピーへスコープして、他者情報の集約提示語の不在を確かめる。
      const visibleText = await page.locator("body").innerText();
      for (const rosterWord of ROSTER_COPY) {
        expect(visibleText).not.toContain(rosterWord);
      }
    } finally {
      await page.close();
    }
  }, 60_000);

  // codd: covers vb=VB-24
  it("締切・開示・正解発表・精算・モード切替・取消の操作要素が /tablet に存在しない", async () => {
    const page = await context.newPage();
    try {
      const res = await page.goto(TABLET_URL, { waitUntil: "domcontentloaded" });
      expect(res).not.toBeNull();
      assertServerHealthy(res!);

      // dod_tablet_no_control_actions: 司会者操作の制御要素（§2.11 で固定された data-op=
      // lock/open/switch）がタブレットに 1 つも存在しない。1 つでもあれば非 host 面へ進行
      // トリガーが漏れており RED。
      expect(await page.locator(HOST_CONTROL_OP_SELECTOR).count()).toBe(0);

      // 締切・開示・正解発表・精算・モード切替・取消の各操作語ボタンが存在しない（data-op を
      // 用いない実装でも、司会者操作語のロール名ボタン走査で操作要素の不在を担保する）。
      let controlButtonCount = 0;
      for (const word of CONTROL_ACTION_WORDS) {
        controlButtonCount += await page.getByRole("button", { name: word }).count();
      }
      expect(controlButtonCount).toBe(0);
    } finally {
      await page.close();
    }
  }, 60_000);
});
