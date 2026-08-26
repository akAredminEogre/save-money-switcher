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
 * 共有 E2E ハーネス: 健全性ベースライン（`status < 500`）の判定と、起動直後のアプリを
 * その基準へ達するまでポーリングする待受ユーティリティ（surface_copy_obligations §2.10 /
 * system_design §2.11 / acceptance_criteria §4.1・§4.9）。
 *
 * 検証環境の起動シーケンス（`npm ci` → `npm run build` → `npm run start`）後、ベース URL
 * または `/healthz` が `< 500` を返すまで最大 60 秒ポーリングしてから試験を開始する契約を
 * 満たす。全ブラウザ／API スペックはここを唯一の健全性判定点として import する。
 *
 * 5xx（未処理例外・DB 断）は業務ステータス（401/403/満席平易文等）と区別し、`< 500` を
 * 満たさない応答をハード失敗として扱う。ポーリングは `fetchImpl`/`sleep`/`now` を注入可能に
 * し、稼働サーバなしでも決定的にユニット検証できる。
 */

/** 健全性ベースラインの上限（この値以上は 5xx とみなしハード失敗扱い）。 */
export const SERVER_ERROR_THRESHOLD = 500;

/** 起動待受のポーリング総時間（既定 60 秒・§2.9 起動シーケンス）。 */
export const HEALTH_POLL_TIMEOUT_MS = 60_000;

/** 起動待受のポーリング間隔（既定 500ms）。 */
export const HEALTH_POLL_INTERVAL_MS = 500;

/**
 * ステータスを取り出せる HTTP 応答の抽象。Playwright の `Response`（`status(): number`）と
 * `fetch` の `Response`（`status: number`）、および素の数値を受け付ける。
 */
export type HttpStatusLike = number | { status: number } | { status: () => number };

/** 応答から数値ステータスを解決する（メソッド形・プロパティ形・数値のいずれも許容）。 */
export function resolveStatus(response: HttpStatusLike): number {
  if (typeof response === "number") return response;
  const raw: unknown = (response as { status: unknown }).status;
  const value = typeof raw === "function" ? (raw as () => number).call(response) : raw;
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new TypeError("HTTP レスポンスから数値ステータスを解決できません");
  }
  return value;
}

/** 応答が健全性ベースライン（`< 500`）を満たすか。 */
export function isServerHealthy(response: HttpStatusLike): boolean {
  return resolveStatus(response) < SERVER_ERROR_THRESHOLD;
}

/**
 * 応答の健全性ベースライン（`< 500`）を保証する。満たせば数値ステータスを返し、5xx なら
 * 例外を送出する。全 HTTP アサーションはまず本ガードを通し、その後で業務ステータスを検証する。
 */
export function assertServerHealthy(response: HttpStatusLike): number {
  const status = resolveStatus(response);
  if (status >= SERVER_ERROR_THRESHOLD) {
    throw new Error(
      `サーバ応答が健全性ベースライン(< ${SERVER_ERROR_THRESHOLD})を満たしません: status=${status}`,
    );
  }
  return status;
}

/** ポーリングに用いる最小の fetch 応答（`status` のみ参照する）。 */
export interface MinimalFetchResponse {
  status: number;
}

/** ポーリングに用いる最小の fetch 実装（URL を受け取り応答を返す）。 */
export type MinimalFetch = (url: string) => Promise<MinimalFetchResponse>;

export interface WaitForServerHealthyOptions {
  /** ポーリング対象パス（既定 `/healthz`）。 */
  path?: string;
  /** ポーリング総時間（既定 {@link HEALTH_POLL_TIMEOUT_MS}）。 */
  timeoutMs?: number;
  /** ポーリング間隔（既定 {@link HEALTH_POLL_INTERVAL_MS}）。 */
  intervalMs?: number;
  /** fetch 実装の注入（既定はグローバル `fetch`）。 */
  fetchImpl?: MinimalFetch;
  /** 待機実装の注入（既定は `setTimeout`）。テストで即時化する。 */
  sleep?: (ms: number) => Promise<void>;
  /** 時刻ソースの注入（既定は `Date.now`）。テストで仮想時計にする。 */
  now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function joinUrl(baseUrl: string, path: string): string {
  if (path === "") return baseUrl;
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

/**
 * 起動直後のアプリを、ベース URL（既定は `/healthz`）が `< 500` を返すまで最大 60 秒
 * ポーリングし、健全になった時点の数値ステータスを返す。接続拒否等の例外は再試行として
 * 吸収し、期限内に健全化しなければ最終ステータス／最終エラーを添えて例外を送出する。
 */
export async function waitForServerHealthy(
  baseUrl: string,
  options: WaitForServerHealthyOptions = {},
): Promise<number> {
  const {
    path = "/healthz",
    timeoutMs = HEALTH_POLL_TIMEOUT_MS,
    intervalMs = HEALTH_POLL_INTERVAL_MS,
    fetchImpl = (globalThis as { fetch?: MinimalFetch }).fetch,
    sleep = defaultSleep,
    now = () => Date.now(),
  } = options;
  if (typeof fetchImpl !== "function") {
    throw new TypeError("waitForServerHealthy には fetch 実装が必要です（fetchImpl を注入してください）");
  }
  const target = joinUrl(baseUrl, path);
  const deadline = now() + timeoutMs;
  let lastStatus: number | undefined;
  let lastError: unknown;
  for (;;) {
    try {
      const res = await fetchImpl(target);
      lastStatus = res.status;
      if (res.status < SERVER_ERROR_THRESHOLD) return res.status;
    } catch (err) {
      lastError = err;
    }
    if (now() >= deadline) {
      const detail =
        lastStatus !== undefined ? `最終ステータス=${lastStatus}` : `最終エラー=${String(lastError)}`;
      throw new Error(
        `サーバが ${timeoutMs}ms 以内に健全(< ${SERVER_ERROR_THRESHOLD})になりませんでした ` +
          `(${target}, ${detail})`,
      );
    }
    await sleep(intervalMs);
  }
}
