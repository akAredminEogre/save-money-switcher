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
 * 制御盤サーフェスの可視トリガー・禁止要素・禁止コピー走査（E2E・SCO-1 /
 * surface_copy_obligations §2.2・§2.7 / op_render_control_panel_surface の
 * dod_cp_visible_host_triggers / dod_cp_no_contestant_input_face /
 * dod_cp_shows_join_qr_and_roster / dod_cp_no_internal_leak）。
 *
 * /control-panel を Playwright（ライブラリ import）で実ブラウザ描画し、宣言・検証は
 * Vitest（describe/it/expect）で行う（surface_copy_obligations §1.2・§2.11・§3.1）。
 * 本スペックは司会者操作盤の「見え方の契約」を証跡化する:
 *   - VB-77: 司会者向け操作語のトリガー（問題を読み込む/そこまで/解答オープン！/正解発表/
 *            精算/次へ/戻る/取消/個別ジャンプ）が可視要素として存在する。
 *   - VB-78: 解答者用の数値入力送信面（+1/-1/+10/-10 と送信）が存在しない。
 *   - VB-06: 参加用クラウド URL を符号化した QR が可視グラフィックとして表示される
 *            （参加者一覧の領域を伴う）。
 *   - VB-85: QR 提示面に事前氏名台帳・端末番号割当の入力要素が存在しない。
 *   - VB-79: 可視文言に内部ロール識別子・内部イベント名・設定キー名・point/pt/点・
 *            デモ/テスト/サンプル表記が存在しない。
 * 取消（undo）後の面巻き戻し表示は巻き戻し範囲 F-03 が未確定ゆえ発明せず fixme とする
 * （§3.2）。全 HTTP 応答は健全性ベースライン（status < 500）を満たすことを先に確かめる。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { assertServerHealthy } from "./helpers/server-health.js";
import { scanForbiddenCopy } from "./helpers/assertions.js";
import { startAppInstance, createAdminContext, type AppInstance } from "./helpers/app-instance.js";

/** 司会者向け操作語（surface_copy_obligations §2.2・§2.7 が verbatim に固定した可視トリガー）。 */
const HOST_TRIGGER_LABELS = [
  "問題を読み込む",
  "そこまで",
  "解答オープン",
  "正解発表",
  "精算",
  "次へ",
  "戻る",
  "取消",
] as const;

/** 解答者ステッパのボタン名（+/− の ASCII・全角・数学マイナスの各表記）。制御盤には不在であること。 */
const CONTESTANT_STEPPER_LABELS = Array.from(
  new Set(["+1", "+10", "-1", "-10", "−1", "−10", "＋1", "＋10"]),
);

/** 事前氏名台帳・端末番号割当を示唆する入力ラベル/プレースホルダのパターン（QR 面に不在であること）。 */
const SEAT_LEDGER_PATTERNS = [/端末番号/, /座席/, /席番/, /事前.*氏名/, /氏名台帳/];

/** 運用語で表すべき内部イベント名（可視文言に露出してはならない）。 */
const INTERNAL_EVENT_NAMES = [
  "accepting",
  "answers_locked",
  "answers_opened",
  "answer_revealed",
  "settlement_computed",
  "tv_mode_changed",
];

/** 露出禁止の設定キー名。 */
const CONFIG_KEY_NAMES = [
  "MAX_TABLET_CONNECTIONS",
  "JOIN_ACCESS_TOKEN",
  "JOIN_ACCESS_MODE",
  "PUBLIC_BASE_URL",
  "QUESTION_MEDIA_ROOT",
];

/** 露出禁止のデモ/テスト/サンプル表記。 */
const DEMO_TEST_LABELS = ["デモ", "テスト", "サンプル"];

describe("制御盤サーフェスの可視トリガー・禁止要素・禁止コピー（SCO-1・dod_cp_*）", () => {
  let browser: Browser;
  let app: AppInstance;
  let adminContext: BrowserContext;
  let CONTROL_PANEL_URL: string;

  // 案A（2026-08-28 殿裁可）で制御盤は admin セッション必須になったため、本スペック専用の
  // 隔離実体を起動し、使い捨ての資格情報でログインした文脈から面を開く（AC-A2）。
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    app = await startAppInstance("control-panel");
    CONTROL_PANEL_URL = `${app.baseUrl}/control-panel`;
    adminContext = await createAdminContext(browser, app);
  }, 180_000);

  afterAll(async () => {
    if (adminContext) await adminContext.close();
    if (browser) await browser.close();
    if (app) await app.stop();
  });

  // codd: covers vb=VB-77
  it("司会者向け操作語のトリガー（読込/締切/開示/正解発表/精算/次へ/戻る/取消/個別ジャンプ）が可視要素として存在する", async () => {
    const page = await adminContext.newPage();
    try {
      const res = await page.goto(CONTROL_PANEL_URL, { waitUntil: "domcontentloaded" });
      expect(res).not.toBeNull();
      // 健全性ベースライン: 5xx を業務ステータスと混同せず、まず status < 500 を担保する。
      assertServerHealthy(res!);

      // 可視文言（描画済みテキスト）を取得する。innerText は属性/マークアップ/生成 id を含まず、
      // dod が governする「可視コピー」そのものへスコープされる（§3.1 の走査方式）。
      const visibleText = await page.locator("body").innerText();

      // dod_cp_visible_host_triggers: §2.2・§2.7 が固定した司会者向け操作語が各々存在すること。
      // いずれかのトリガーが欠落/別語へ差し替わると当該 toContain が RED になる。
      for (const label of HOST_TRIGGER_LABELS) {
        expect(visibleText).toContain(label);
      }
      // 各モード個別ジャンプ（a〜e への任意到達）の操作語が存在すること（§2.7 の 3 系統のうち個別ジャンプ）。
      expect(visibleText).toContain("個別ジャンプ");
    } finally {
      await page.close();
    }
  }, 60_000);

  // codd: covers vb=VB-78
  it("解答者用の数値入力送信面（+1/-1/+10/-10 のステッパ）が制御盤に存在しない", async () => {
    const page = await adminContext.newPage();
    try {
      const res = await page.goto(CONTROL_PANEL_URL, { waitUntil: "domcontentloaded" });
      expect(res).not.toBeNull();
      assertServerHealthy(res!);

      // dod_cp_no_contestant_input_face: 解答者タブレット固有の 4 ボタンステッパ（+1/-1/+10/-10）が
      // 制御盤に露出しないこと。ステッパ名を持つボタンが 1 つでもあれば司会者面へ入力送信面が
      // 漏れており RED。各表記（ASCII/全角/数学マイナス）を総当りして総数 0 を確かめる。
      let stepperButtonCount = 0;
      for (const label of CONTESTANT_STEPPER_LABELS) {
        stepperButtonCount += await page.getByRole("button", { name: label, exact: true }).count();
      }
      expect(stepperButtonCount).toBe(0);
    } finally {
      await page.close();
    }
  }, 60_000);

  // codd: covers vb=VB-06
  it("参加用 QR が可視グラフィックとして表示され参加者一覧の領域を伴う", async () => {
    const page = await adminContext.newPage();
    try {
      const res = await page.goto(CONTROL_PANEL_URL, { waitUntil: "domcontentloaded" });
      expect(res).not.toBeNull();
      assertServerHealthy(res!);

      // dod_cp_shows_join_qr_and_roster / dod_qr_encodes_public_join_url:
      // renderJoinQrSvg() 由来の可視 QR グラフィックが提示される。QR 識別子付き要素があれば
      // それを、無ければ描画済みグラフィック要素（QR は SVG）の存在と可視性で提示面を確かめる。
      const qrCandidates = page.locator(
        '[data-join-qr], [data-testid*="qr"], [aria-label*="QR"], [aria-label*="参加"], [alt*="QR"], [alt*="参加"]',
      );
      const qrCandidateCount = await qrCandidates.count();
      if (qrCandidateCount > 0) {
        // 検証は Vitest expect で行う契約（§1.2・§2.11・§3.1）。可視性判定は Playwright
        // Locator.isVisible()（ライブラリ API）で真偽値を得て expect に載せる。
        expect(await qrCandidates.first().isVisible()).toBe(true);
      } else {
        const graphics = page.locator("svg, canvas, img");
        expect(await graphics.count()).toBeGreaterThan(0);
        expect(await graphics.first().isVisible()).toBe(true);
      }

      // 参加者一覧（自己入力氏名）の領域が可視文言として存在する（§2.7「参加者一覧」）。
      const visibleText = await page.locator("body").innerText();
      expect(visibleText).toContain("参加者");
    } finally {
      await page.close();
    }
  }, 60_000);

  // codd: covers vb=VB-85
  it("QR 提示面に事前氏名台帳・端末番号割当の入力要素が存在しない", async () => {
    const page = await adminContext.newPage();
    try {
      const res = await page.goto(CONTROL_PANEL_URL, { waitUntil: "domcontentloaded" });
      expect(res).not.toBeNull();
      assertServerHealthy(res!);

      // dod_qr_no_seat_ledger / VB-85: 参加は QR 読取り＋氏名自己入力のみで成立し、制御盤側に
      // 端末番号固定割当・事前氏名台帳の入力要素を置かない。該当ラベル/プレースホルダを持つ
      // 入力要素が 1 つでもあれば座席台帳 UI が漏れており RED。
      for (const pattern of SEAT_LEDGER_PATTERNS) {
        expect(await page.getByLabel(pattern).count()).toBe(0);
        expect(await page.getByPlaceholder(pattern).count()).toBe(0);
      }
    } finally {
      await page.close();
    }
  }, 60_000);

  // codd: covers vb=VB-79
  it("可視文言に内部ロール識別子・内部イベント名・設定キー名・point/pt/点・デモ/テスト/サンプル表記が存在しない", async () => {
    const page = await adminContext.newPage();
    try {
      const res = await page.goto(CONTROL_PANEL_URL, { waitUntil: "domcontentloaded" });
      expect(res).not.toBeNull();
      assertServerHealthy(res!);

      // 可視コピー（innerText）へスコープした禁止コピー走査（§3.1）。
      const visibleText = await page.locator("body").innerText();

      // dod_cp_no_internal_leak: 内部ロール識別子（host/contestant/audience）の非露出。
      expect(scanForbiddenCopy(visibleText, { categories: ["internal_role_identifier"] })).toHaveLength(0);

      // 点化文言（point/pt/点）の非露出（円建て固定・現金感を薄めない）。
      expect(scanForbiddenCopy(visibleText, { categories: ["currency_token"] })).toHaveLength(0);

      // 内部イベント名の非露出（状態表示は運用語で表す）。
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

  // 取消（undo）後にどの面のどの表示が巻き戻るか（TV を直前モードへ戻すか／タブレットの締切表示を
  // 解除するか／d 到達問の残額差分を巻き戻すか）は巻き戻し範囲 F-03 が未確定ゆえ発明せず、面表示の
  // 巻き戻し検証は保留する（surface_copy_obligations §3.2）。取消ボタンの可視存在は VB-77 の
  // トリガー検証が、host 限定の発動権限は別スペックの権限境界検証が担う。F-03 確定後に、取消発動 →
  // 対象面の表示が確定挙動どおり巻き戻ることをアサートする。
  it.todo("取消後の制御盤/TV/タブレットの面巻き戻し表示（F-03 未確定・§3.2）");
});
