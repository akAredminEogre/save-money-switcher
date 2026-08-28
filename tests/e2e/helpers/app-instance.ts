/**
 * 共有 E2E ハーネス: **自前のアプリ実体**を隔離環境で起動する（案A の認証を要する面のため）。
 *
 * 案A（2026-08-28 殿裁可）で `/control-panel` と `/admin/*` は admin セッション必須になった。
 * ゆえにこれらの面を検証するスペックは「ログイン済みのブラウザ」を要する。周囲で動いている
 * 常駐サーバの資格情報を当てにすると検証が環境依存になるため、本ハーネスは
 *
 *   - 専用の一時ディレクトリへビルドし（他スペックの `dist/` と衝突させない）、
 *   - 空きポートで起動し（常駐サーバを止めない・他スペックと衝突しない）、
 *   - 実行ごとに採番した**使い捨ての資格情報**で初期管理者を投入する
 *     （`ADMIN_LOGIN_ID` / `ADMIN_INITIAL_PASSWORD`・`seed_admin.ts` の env 経路）
 *
 * という形で、リポジトリにも証跡にも実資格情報を残さずに認証済みの検証を成立させる。
 * 永続データは一時ディレクトリ（`DATA_DIR`）に閉じ、停止時に消す。
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { waitForServerHealthy } from "./server-health.js";
import { ADMIN_INITIAL_PASSWORD_ENV, ADMIN_LOGIN_ID_ENV, ADMIN_DISPLAY_NAME_ENV } from "../../../src/accounts/seed_admin.js";
import { DATA_DIR_ENV } from "../../../src/config/data_dir.js";
import { PUBLIC_BASE_URL_ENV } from "../../../src/config/public_base_url.js";
import { JOIN_ACCESS_MODE_ENV, JOIN_ACCESS_TOKEN_ENV } from "../../../src/config/access_control_config.js";
import { MAX_TABLET_CONNECTIONS_ENV } from "../../../src/config/connection_limit.js";
import { LOGIN_PATH } from "../../../src/auth/login_link.js";
import type { Browser, BrowserContext } from "playwright";

/**
 * リポジトリのルート（`public/` の静的資産解決に用いる作業ディレクトリ）。vitest はリポジトリ
 * ルートから起動する契約ゆえ（README / `npm test`）、実行時 CWD をそのまま用いる。
 */
const REPO_ROOT = process.cwd();

/** 起動したアプリ実体のハンドル。 */
export interface AppInstance {
  /** 実体のベース URL（`http://127.0.0.1:<port>`）。 */
  readonly baseUrl: string;
  /** 投入済み初期管理者のログイン ID（実行ごとの使い捨て）。 */
  readonly adminLoginId: string;
  /** 投入済み初期管理者のパスワード（実行ごとの使い捨て）。 */
  readonly adminPassword: string;
  /** プロセスを停止し一時ディレクトリを片付ける。 */
  stop(): Promise<void>;
}

/** 空きポートを 1 つ確保する（OS に選ばせてから解放する）。 */
function reserveFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close(() => reject(new Error("空きポートを取得できませんでした。")));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

/** 子プロセスの終了を待つ（終了コードが 0 でなければ拒否する）。 */
function waitForExit(child: ChildProcess, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${what} が異常終了しました（exit=${String(code)}）。`));
    });
  });
}

/**
 * 初期管理者の投入は起動直後の非同期処理ゆえ、`/healthz` が通っても間に合っていないことがある。
 * 実際にログインが通るまで（最大 30 秒）ポーリングして「認証できる状態」を待つ。
 */
async function waitForAdminSeeded(baseUrl: string, loginId: string, password: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    const res = await fetch(`${baseUrl}${LOGIN_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ login_id: loginId, password }).toString(),
      redirect: "manual",
    });
    lastStatus = res.status;
    if (res.status === 302) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`初期管理者の投入を待てませんでした（最後の応答 ${lastStatus}）。`);
}

/**
 * 隔離されたアプリ実体を起動する。`label` は一時ディレクトリ名の識別に用いる
 * （スペックごとに別の実体を持たせ、並行実行しても互いに干渉させない）。
 */
export async function startAppInstance(label: string): Promise<AppInstance> {
  // 作業場はリポジトリ配下の `tmp/`（git 管理外）に置く。OS の一時領域へ置くと、実行される
  // `dist/main.js` から `node_modules`（`qrcode`）へ解決できず起動できないためである。
  const scratchRoot = join(REPO_ROOT, "tmp");
  await mkdir(scratchRoot, { recursive: true });
  const workDir = await mkdtemp(join(scratchRoot, `e2e-${label}-`));
  const outDir = join(workDir, "dist");
  const dataDir = join(workDir, "data");
  const adminLoginId = `e2e-${randomBytes(6).toString("hex")}`;
  const adminPassword = randomBytes(24).toString("hex");

  const cleanup = async (): Promise<void> => {
    await rm(workDir, { recursive: true, force: true });
  };

  try {
    // 専用 outDir へビルドする（常駐サーバや他スペックの dist/ と衝突させない）。
    await waitForExit(
      spawn(join(REPO_ROOT, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.build.json", "--outDir", outDir], {
        cwd: REPO_ROOT,
        stdio: "inherit",
      }),
      "tsc",
    );
  } catch (err) {
    await cleanup();
    throw err;
  }

  const port = await reserveFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    [DATA_DIR_ENV]: dataDir,
    [ADMIN_LOGIN_ID_ENV]: adminLoginId,
    [ADMIN_INITIAL_PASSWORD_ENV]: adminPassword,
    [ADMIN_DISPLAY_NAME_ENV]: "司会者",
  };
  // 周囲の環境設定を持ち込まない（検証を環境依存にしない）。
  for (const key of [PUBLIC_BASE_URL_ENV, JOIN_ACCESS_MODE_ENV, JOIN_ACCESS_TOKEN_ENV, MAX_TABLET_CONNECTIONS_ENV]) {
    delete env[key];
  }

  const child = spawn(process.execPath, [join(outDir, "main.js")], {
    cwd: REPO_ROOT,
    env,
    stdio: "inherit",
  });

  const stop = async (): Promise<void> => {
    if (!(child.killed || child.exitCode !== null || child.signalCode !== null)) {
      await new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        child.once("error", () => resolve());
        child.kill("SIGTERM");
      });
    }
    await cleanup();
  };

  try {
    await waitForServerHealthy(baseUrl, { timeoutMs: 60_000 });
    await waitForAdminSeeded(baseUrl, adminLoginId, adminPassword);
  } catch (err) {
    await stop();
    throw err;
  }

  return { baseUrl, adminLoginId, adminPassword, stop };
}

/**
 * 実ブラウザで与えた資格情報としてログインし、**セッション Cookie を保持した文脈**を返す。
 * 以降 `context.newPage()` で開く面はすべてログイン済みとして描画される。
 *
 * ログインは素の HTML フォーム送信で行う（案A のログイン面は JavaScript を要さない）。
 */
export async function createLoginContext(
  browser: Browser,
  app: AppInstance,
  loginId: string,
  password: string,
): Promise<BrowserContext> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${app.baseUrl}${LOGIN_PATH}`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="login_id"]', loginId);
    await page.fill('input[name="password"]', password);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith(LOGIN_PATH), { timeout: 15_000 }),
      page.click('button[data-op="login"]'),
    ]);
  } finally {
    await page.close();
  }
  return context;
}

/** 実ブラウザで初期管理者としてログインした文脈を返す（{@link createLoginContext} の別名）。 */
export async function createAdminContext(browser: Browser, app: AppInstance): Promise<BrowserContext> {
  return createLoginContext(browser, app, app.adminLoginId, app.adminPassword);
}
