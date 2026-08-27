// @generated-by: codd implement
// @generated-from: docs/design/surface_copy_obligations.md (design:surface-copy-obligations)
// @design-node: docs/design/surface_copy_obligations.md
// @output-paths: src, tests
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
 * 共有 E2E ハーネス: Playwright ブラウザの起動（surface_copy_obligations §2.10 /
 * acceptance_criteria §4.9）。ブラウザ操作は Playwright を「ライブラリ import」して駆動し、
 * 宣言・検証は Vitest（`describe`/`it`/`expect`）で行う契約に従う。
 *
 * CI ヘッドレスを既定とし、起動・ページ・コンテキストの後始末をラップして各サーフェス
 * スペックの重複を排除する。realtime / cross-actor 検証で制御盤・タブレット・TV の複数
 * `page` を同時に開くケースにも供する。
 */

import { chromium } from "playwright";
import type { Browser, BrowserContext, LaunchOptions, Page } from "playwright";

/** 既定の起動オプション（CI ヘッドレス）。 */
export const DEFAULT_LAUNCH_OPTIONS: LaunchOptions = { headless: true };

/** Playwright（Chromium）ブラウザを起動する。 */
export async function launchBrowser(options: LaunchOptions = {}): Promise<Browser> {
  return chromium.launch({ ...DEFAULT_LAUNCH_OPTIONS, ...options });
}

/** ブラウザを起動して処理を実行し、必ず `close` する。 */
export async function withBrowser<T>(
  fn: (browser: Browser) => Promise<T>,
  options: LaunchOptions = {},
): Promise<T> {
  const browser = await launchBrowser(options);
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

/** ページを開いて処理を実行し、必ず `close` する。 */
export async function withPage<T>(browser: Browser, fn: (page: Page) => Promise<T>): Promise<T> {
  const page = await browser.newPage();
  try {
    return await fn(page);
  } finally {
    await page.close();
  }
}

/** 新規ブラウザコンテキストを開く（クライアント種別ごとにセッションを分離する用途）。 */
export async function openContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext();
}
