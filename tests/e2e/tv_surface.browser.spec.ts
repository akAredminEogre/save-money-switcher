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
 * TV 5モードサーフェスの可視要素・禁止要素・禁止コピー走査（E2E・SCO-3 /
 * surface_copy_obligations §2.4・§2.5・§2.8・§2.11 / op_render_tv_surface の
 * dod_tv_five_modes / dod_tv_hide_before_disclosure / dod_tv_no_path_or_internal_leak /
 * dod_tv_audience_copy_no_control / dod_tv_winner_visible_e）。
 *
 * /tv を Playwright（ライブラリ import）で実ブラウザ描画し、宣言・検証は Vitest
 * （describe/it/expect）で行う（§1.2・§2.11・§3.1）。本スペックは観客向け受動表示面の
 * 「見え方の契約」を、面ごとの走査で証跡化する:
 *   - VB-45: TV が a/b/c/d/e の 5 モードを観客向け面として各々描画できる。
 *   - VB-47: モード切替で TV の表示（URL/可視コンテンツ）が対応値へ切り替わる。
 *   - VB-50: d モードが当該問の 6 列表（氏名/解答/誤差/増減円/ピタリ賞/残額）を円建てで表示する。
 *   - VB-51: e モードが全問通算の全員一覧を表示し、d（当該問フォーカス）と役割が分かれる。
 *   - VB-83: a モードの可視表示に生ファイルパス・fallback 等の内部語・内部イベント名が露出しない。
 *   - VB-84: TV にいかなる入力・操作要素も存在せず、可視文言が観客向けで司会者操作語を含まない。
 *
 * TV は game_state.tv_mode を受動描画する面ゆえ、各モードの提示は URL のモード指定
 * （`/tv?mode=<a..e>`・VB-47 が固定する「URL」側のモード担持）で到達して観測する。
 * 走査は健全性ベースライン（status < 500・§2.10）を先に担保した上で、可視コピー
 * （innerText）と構造要素（入力・操作要素ロケータ）に対して行う。point/pt/点 と内部
 * ロール識別子の走査は正準ヘルパ scanForbiddenCopy を経由する。
 *
 * e モードの勝者判別（VB-31）と同点共同首位（VB-76）は、全 10 問精算まで進んだゲーム
 * 状態・残額同点状態という「サーフェス層の描画契約だけでは作れない進行データ」を要し、
 * 本タスクの共有ヘルパ（server-health / assertions）はゲート進行を編成しない。よって
 * ここでは正直に blocked としてマークする（勝者判定ロジック自体は
 * src/scoring/determine_winner の単体が担い、e モード描画は稼働ゲート＋描画が要る）。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "playwright";
import { assertServerHealthy } from "./helpers/server-health.js";
import { startAppInstance, type AppInstance } from "./helpers/app-instance.js";
import { scanForbiddenCopy, SETTLEMENT_TABLE_HEADERS } from "./helpers/assertions.js";

/** 本スペック専用に起動する実体のベース URL（beforeAll で確定する）。 */
let TV_URL = "";

/** TV の 5 モード（surface_copy_obligations §2.4 が固定した a〜e）。 */
const TV_MODES = ["a", "b", "c", "d", "e"] as const;
type TvMode = (typeof TV_MODES)[number];

/** モード指定付き TV URL（VB-47 が固定する「URL でモードが対応値へ切り替わる」側）。 */
function tvModeUrl(mode: TvMode): string {
  return `${TV_URL}?mode=${mode}`;
}

/**
 * 司会者コンソール固有の操作語（制御盤の可視トリガー）。観客向け TV 可視文言には現れない。
 * b/c/d の各モード名（解答オープン/正解発表/精算）は観客向け見出しと語が重なりうるため
 * 除外し、面の目的から観客表示に現れ得ない「操作専用語」のみを禁止対象に取る。
 */
const HOST_CONTROL_ONLY_WORDS = [
  "問題を読み込む",
  "そこまで",
  "次へ",
  "戻る",
  "個別ジャンプ",
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

/** 露出禁止の設定キー名（§2.8）。 */
const CONFIG_KEY_NAMES = [
  "MAX_TABLET_CONNECTIONS",
  "JOIN_ACCESS_TOKEN",
  "JOIN_ACCESS_MODE",
  "PUBLIC_BASE_URL",
  "QUESTION_MEDIA_ROOT",
];

/**
 * 生ファイルパス・内部語の露出を示す禁止トークン（§2.4a・dod_tv_no_path_or_internal_leak）。
 * innerText は属性（src 等）を含まず、これらは「生パス/内部語が可視テキストへ漏れた」場合に
 * のみ現れるため、可視コピーへスコープした走査対象として適する。
 */
const PATH_LEAK_TOKENS = [
  "fallback",
  "video_path",
  "image_path",
  "/media/",
  ".mp4",
  ".webm",
  ".mov",
  ".png",
  ".jpg",
  ".jpeg",
];

/** d モード固有の列見出し（e には現れない・役割分離の指標）。 */
const SETTLEMENT_ONLY_HEADER = "増減円";

/** いかなる入力・操作要素も置かないことを検証するための構造セレクタ（§2.4「受動表示のみ」）。 */
const INTERACTIVE_SELECTOR =
  "input, textarea, select, button, " +
  "[contenteditable='true'], [contenteditable=''], " +
  "[role='button'], [role='textbox'], [role='slider'], " +
  "[role='spinbutton'], [role='switch'], [role='checkbox']";

describe("TV 5モードサーフェスの可視要素・禁止要素・禁止コピー（SCO-3・dod_tv_*）", () => {
  let browser: Browser;
  let app: AppInstance;

  // 常駐サーバの状態に検証を依存させないため、本スペック専用の隔離実体を起動する
  // （TV は観客向け受動面ゆえログインは要さない）。
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    app = await startAppInstance("tv");
    TV_URL = `${app.baseUrl}/tv`;
  }, 180_000);

  afterAll(async () => {
    if (browser) await browser.close();
    if (app) await app.stop();
  });

  // codd: covers vb=VB-45
  it("a/b/c/d/e の 5 モードが各々観客向け面として描画され、禁止コピーが無い", async () => {
    // 5 モードそれぞれの URL を実ブラウザで描画し、SUT の観測結果（応答ステータス・可視
    // テキスト・禁止コピー走査結果）に対してアサートする。各モードが健全に描画され観客向け
    // 可視文言のみを持つことをもって「TV が a〜e の 5 モードを表示できる」を証跡化する。
    for (const mode of TV_MODES) {
      const page = await browser.newPage();
      try {
        const res = await page.goto(tvModeUrl(mode), { waitUntil: "domcontentloaded" });
        expect(res, `mode=${mode} の応答が得られること`).not.toBeNull();
        // 健全性ベースライン: 5xx を業務ステータスと混同せず、まず status < 500 を担保する。
        assertServerHealthy(res!);

        // 各モードが観客向けに可視コンテンツを描画している（空白面でない）。
        const visibleText = await page.locator("body").innerText();
        expect(visibleText.trim().length, `mode=${mode} が可視コンテンツを描画すること`).toBeGreaterThan(0);

        // 点化文言（point/pt/点）・内部ロール識別子（host/answerer/audience）の非露出。
        expect(
          scanForbiddenCopy(visibleText, { categories: ["currency_token"] }),
          `mode=${mode} に点化文言が無いこと`,
        ).toHaveLength(0);
        expect(
          scanForbiddenCopy(visibleText, { categories: ["internal_role_identifier"] }),
          `mode=${mode} に内部ロール識別子が無いこと`,
        ).toHaveLength(0);

        // 内部イベント名・設定キー名の非露出（状態は運用語で表す）。
        for (const eventName of INTERNAL_EVENT_NAMES) {
          expect(visibleText, `mode=${mode} に内部イベント名 ${eventName} が無いこと`).not.toContain(eventName);
        }
        for (const configKey of CONFIG_KEY_NAMES) {
          expect(visibleText, `mode=${mode} に設定キー名 ${configKey} が無いこと`).not.toContain(configKey);
        }
      } finally {
        await page.close();
      }
    }
  }, 120_000);

  // codd: covers vb=VB-47
  it("モード指定で TV の可視コンテンツが対応モードへ切り替わる（a と d が別の面を描画）", async () => {
    // 別モードの URL を描画し、SUT が返す可視テキストがモードに応じて異なることを観測する。
    // d モードは 6 列表固有の見出し（増減円）を持ち、a モード（出題面）は持たない。これにより
    // 「モード切替で TV の表示（URL/可視コンテンツ）が対応値へ切り替わる」を証跡化する。
    const pageA = await browser.newPage();
    const pageD = await browser.newPage();
    try {
      const resA = await pageA.goto(tvModeUrl("a"), { waitUntil: "domcontentloaded" });
      expect(resA).not.toBeNull();
      assertServerHealthy(resA!);
      const textA = await pageA.locator("body").innerText();

      const resD = await pageD.goto(tvModeUrl("d"), { waitUntil: "domcontentloaded" });
      expect(resD).not.toBeNull();
      assertServerHealthy(resD!);
      const textD = await pageD.locator("body").innerText();

      // d モードは 6 列精算表の固有見出しを描画し、a モード（出題面）はそれを描画しない。
      // これが両モードの可視コンテンツが対応値へ切り替わっている観測上の差分。
      expect(textD, "d モードが精算表固有見出しを描画すること").toContain(SETTLEMENT_ONLY_HEADER);
      expect(textA, "a 出題面は精算表固有見出しを描画しないこと").not.toContain(SETTLEMENT_ONLY_HEADER);
      expect(textA, "a と d の可視コンテンツが異なること").not.toBe(textD);
    } finally {
      await pageA.close();
      await pageD.close();
    }
  }, 90_000);

  // codd: covers vb=VB-50
  it("d モードが 6 列表（氏名/解答/誤差/増減円/ピタリ賞/残額）を円建てで表示する", async () => {
    const page = await browser.newPage();
    try {
      const res = await page.goto(tvModeUrl("d"), { waitUntil: "domcontentloaded" });
      expect(res).not.toBeNull();
      assertServerHealthy(res!);

      // dod_tv_five_modes（d 6 列）: §2.4d が verbatim に固定した 6 列見出しが順不同に依らず
      // すべて可視文言として現れることを、SUT の描画テキストに対して確かめる。いずれかの列が
      // 欠落/別語へ差し替わると当該 toContain が RED になる。見出しは
      // src/tv_display/render_settlement_table の SETTLEMENT_TABLE_HEADERS に束縛された固定形。
      const visibleText = await page.locator("body").innerText();
      for (const header of SETTLEMENT_TABLE_HEADERS) {
        expect(visibleText, `d モードに 6 列見出し ${header} が表示されること`).toContain(header);
      }

      // dod_currency_no_point_token（円建て固定・点化禁止）: d の金額列は円建てで表し、
      // point/pt/点 を可視文言へ持たせない（増減円・残額は formatYen 経由の円建て）。
      expect(
        scanForbiddenCopy(visibleText, { categories: ["currency_token"] }),
        "d モードの表示に点化文言(point/pt/点)が無いこと",
      ).toHaveLength(0);
    } finally {
      await page.close();
    }
  }, 60_000);

  // codd: covers vb=VB-51
  it("e モードが全員一覧（通算残額）を表示し、d の当該問固有列を持たず役割が分かれる", async () => {
    const page = await browser.newPage();
    try {
      const res = await page.goto(tvModeUrl("e"), { waitUntil: "domcontentloaded" });
      expect(res).not.toBeNull();
      assertServerHealthy(res!);

      const visibleText = await page.locator("body").innerText();

      // e は全問通算の全員一覧（残額の一覧）を提示する。render_totals の見出し「全員の残額一覧」
      // に含まれる「残額」を全員一覧の指標として、SUT の描画テキストに現れることを確かめる。
      expect(visibleText, "e モードが全員の残額一覧を提示すること").toContain("残額");

      // 役割分離（e は全問通算・d は当該問フォーカス）: e は当該問精算固有の列（誤差/増減円/
      // ピタリ賞）を持たない。これらが e に現れれば d と役割が混線しており RED。
      expect(visibleText, "e モードに当該問固有列『増減円』が無いこと").not.toContain("増減円");
      expect(visibleText, "e モードに当該問固有列『ピタリ賞』が無いこと").not.toContain("ピタリ賞");
      expect(visibleText, "e モードに当該問固有列『誤差』が無いこと").not.toContain("誤差");
    } finally {
      await page.close();
    }
  }, 60_000);

  // codd: covers vb=VB-83
  it("a モードの可視表示に生ファイルパス・fallback 等の内部語・内部イベント名が露出しない", async () => {
    const page = await browser.newPage();
    try {
      const res = await page.goto(tvModeUrl("a"), { waitUntil: "domcontentloaded" });
      expect(res).not.toBeNull();
      assertServerHealthy(res!);

      // 可視コピー（innerText）へスコープした走査（§3.1）。属性（src 等）は含まれないため、
      // 生パス/内部語が innerText に現れるのは「可視テキストへ漏れた」場合に限られる。
      const visibleText = await page.locator("body").innerText();

      // dod_tv_no_path_or_internal_leak: 生ファイルパス（image_path/video_path の値）や
      // fallback 等の内部語が観客の可視表示へ露出しない。露出があれば当該 not.toContain が RED。
      for (const token of PATH_LEAK_TOKENS) {
        expect(visibleText, `a モードの可視表示に内部語/生パス断片 ${token} が無いこと`).not.toContain(token);
      }

      // 内部イベント名の非露出（描画は観客向け出題面のみ）。
      for (const eventName of INTERNAL_EVENT_NAMES) {
        expect(visibleText, `a モードに内部イベント名 ${eventName} が無いこと`).not.toContain(eventName);
      }
    } finally {
      await page.close();
    }
  }, 60_000);

  // codd: covers vb=VB-84
  it("TV にいかなる入力・操作要素も存在せず、可視文言が観客向けで司会者操作語を含まない", async () => {
    // dod_tv_audience_copy_no_control: 5 モードすべてで、入力・操作要素の総数が 0 であり、
    // 可視文言に司会者コンソール固有の操作語が現れないことを、各モードの SUT 描画に対して
    // 確かめる。操作要素が 1 つでもあれば受動表示面へ操作導線が漏れており RED。
    for (const mode of TV_MODES) {
      const page = await browser.newPage();
      try {
        const res = await page.goto(tvModeUrl(mode), { waitUntil: "domcontentloaded" });
        expect(res, `mode=${mode} の応答が得られること`).not.toBeNull();
        assertServerHealthy(res!);

        // 入力・操作要素（input/textarea/select/button/編集可能/操作ロール）の総数が 0。
        const interactiveCount = await page.locator(INTERACTIVE_SELECTOR).count();
        expect(interactiveCount, `mode=${mode} に入力・操作要素が存在しないこと`).toBe(0);

        // 観客向け可視文言に司会者コンソール固有の操作語が現れない。
        const visibleText = await page.locator("body").innerText();
        for (const word of HOST_CONTROL_ONLY_WORDS) {
          expect(visibleText, `mode=${mode} に司会者操作語 ${word} が無いこと`).not.toContain(word);
        }
      } finally {
        await page.close();
      }
    }
  }, 120_000);

  // F-06'（TV a 動画の再生可否表示）: 動画パス存在検証までを義務とし、本番ブラウザで再生
  // 不可なコンテナ/コーデックが混入した場合の a モードのフォールバック表示（動画不可→画像/
  // テキストへ退避するか、静止コマ表示か）は本設計に固定値が無いため発明せず保留する
  // （surface_copy_obligations §3.3・F-06'）。生パス・内部語の非露出（VB-83）は形式に依らず
  // 上で検証済み。再生可否に依存するフォールバック表示は再生可能形式の選定確定後に、a モードの
  // 描画が編集後の video→image→text 規定順に従って再生互換面へ退避することをアサートする。
  it.todo("a モードの動画再生不可時のフォールバック表示（F-06' 未確定・§3.3）");
});

// ── e モード勝者表示のカバレッジ状況 ────────────────────────────────────────
// VB-31（残額最多の勝者を e モードで判別可能に提示）・VB-76（残額同点時に複数の共同首位を
// e モードで提示）は、10 問すべての精算が完了した通算残額データ／残額同点データという
// 「進行ゲート編成を経て初めて生じる game_state・balances」を要する。本タスクの共有ヘルパ
// （server-health / assertions）はホストのコマンド編成やゲート前進を行わず、稼働 TV 面へ
// 勝者/共同首位が現れる状態を決定的に作れない。勝者判定ロジックそのもの（残額最多・同点は
// 複数の共同首位・優先順位を発明しない）は src/scoring/determine_winner の単体が担う。
// ここで純関数の断片や空の e 面だけを見て `covers` を付すと偽のカバレッジ主張となり
// authenticity ゲートに落ちるため、正直に blocked としてマークする（実カバレッジは稼働
// ゲートを進めた e モード描画の E2E が担う）。
//
// codd: blocked vb=VB-31 reason=requires_completed_game_e_mode_winner_state
// codd: blocked vb=VB-76 reason=requires_tie_balance_e_mode_co_leaders_state
