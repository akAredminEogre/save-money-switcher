/**
 * アプリケーションサーバのエントリポイント（bootstrap / 合成層・glue）。
 *
 * system_design §2.11 / runbook が定める「単一 Node プロセスが唯一の HTTP/WS 権威であり
 * `/healthz` が健全性ベースライン(< 500)を返す」を満たす起点。本モジュールはドメインロジックを
 * 持たず、既に実装・QC 済みの既存モジュール（`realtime_sync` / `config` / `participants`）の
 * 公開 API を import して配線するだけの薄い bootstrap である（既存モジュールは一切改変しない）。
 *
 * realtime_sync の配線について（honest note）:
 *   `realtime_sync` は seq 採番（{@link createSequenceGenerator}）・封筒仕上げ
 *   （{@link stampServerEvent}）・ロール投影（{@link projectForRole}）・再接続復帰スナップショット
 *   （{@link buildSnapshot}）という**純粋な projection core** を提供する。本リポジトリには
 *   具体的な socket transport（`ws` 等の実装や hub）が存在しない（node_modules・src 双方に不在）。
 *   したがって live fan-out の socket 昇格・接続管理は transport 導入時に接続する設計とし、ここでは
 *   projection core を組成して起動時に健全性を確認する（存在しない transport を捏造しない）。
 */

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createSequenceGenerator,
  stampServerEvent,
  type SequenceGenerator,
} from "./realtime_sync/protocol.js";
import { projectForRole } from "./realtime_sync/fanout.js";
import { buildSnapshot } from "./realtime_sync/recovery.js";
import { resolvePublicBaseUrl } from "./config/public_base_url.js";
import { resolveMaxTabletConnections } from "./config/connection_limit.js";
import { renderJoinSurface } from "./participants/join_surface.js";
import type { JoinSurfaceViewModel } from "./participants/join_surface.js";
import { buildJoinUrl, JOIN_PATH } from "./participants/join_link.js";
import { renderJoinQrSvg } from "./participants/qr.js";
import { buildControlPanelView } from "./control_panel/control_panel_view.js";
import { renderControlPanelHtml } from "./control_panel/render_control_panel.js";
import { INITIAL_STAGE } from "./game_state/progression.js";
import { renderTvSurface, serializeTvSurface } from "./tv_display/render_tv_surface.js";
import { renderTabletSurface } from "./tablet/render_tablet_surface.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Role } from "./realtime_sync/protocol.js";
import { applyHostCommand, applyAnswer, applyJoin } from "./server/orchestrator.js";
import {
  addConnection,
  removeConnection,
  broadcast,
  setHostContextProvider,
} from "./server/sse.js";

/**
 * 待受ポート。E2E ハーネス（tests/e2e/helpers/env.ts）と runbook のローカル起動権威は
 * `localhost:3000` ゆえ既定 3000（:8080 は deploy 関心事）。`PORT` が数値なら上書きを許す。
 */
const PORT = Number.parseInt(process.env.PORT ?? "", 10) || 3000;

/** realtime_sync の projection core（seq 採番・封筒仕上げ・投影・復帰）を組成した配線ハンドル。 */
interface RealtimeCore {
  readonly sequence: SequenceGenerator;
  /** projection core が健全に動作する（host 投影が封筒を通す）ことを確認した結果。 */
  readonly fanoutReady: boolean;
}

/**
 * realtime_sync の純粋 core を組成し、起動時に「採番 → 封筒仕上げ → ロール投影」の一巡が
 * 通ることを確認する。live transport が導入された時点で本 core（sequence / project）を
 * そのまま fan-out へ接続する。
 */
function createRealtimeCore(): RealtimeCore {
  const sequence = createSequenceGenerator();
  // 起動直後（受付段階・問1・TV モード a）のサーバ権威スナップショットを host 投影で組み立て、
  // 封筒へ仕上げて projection core の健全性を確認する（実接続なしで core の配線を検証）。
  const snapshot = buildSnapshot(
    { currentQuestionNumber: 1, stage: "accepting", tvMode: "a" },
    { role: "host", disclosed: false },
    { balances: {}, submitted: {} },
  );
  const stamped = stampServerEvent(sequence, {
    type: "state_snapshot",
    payload: snapshot,
    stage: "accepting",
    questionNumber: 1,
    tvMode: "a",
  });
  const projected = projectForRole(stamped, { role: "host", disclosed: false });
  return { sequence, fanoutReady: projected !== null };
}

/** HTML 特殊文字を実体参照へ退避する（反射型注入・相互作用要素混入を防ぐ）。 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 最小の HTML ドキュメント外装（passive 表示面の共通ラッパ）。 */
function htmlDocument(title: string, body: string): string {
  return (
    `<!doctype html><html lang="ja"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(title)}</title></head><body>${body}</body></html>`
  );
}

/**
 * progressive enhancement のページ外装: 面の初期 chrome を `#app` コンテナで包み、当該面の
 * SSE 購読 client.js を末尾で読む。既存の可視 chrome（innerText・操作要素・data-* ロケータ）は
 * そのまま保ち、追加要素は非可視の `<div id="app">` ラッパと `<script>` に限る（既存 E2E 非破壊）。
 */
function page(title: string, innerFragment: string, clientName: string): string {
  return htmlDocument(
    title,
    `<div id="app">${innerFragment}</div>` +
      `<script src="/client/${clientName}.client.js"></script>`,
  );
}

/** client 資産ディレクトリ（`npm run start`/`dev` は repo ルートから起動する契約・README 参照）。 */
const CLIENT_ASSET_DIR = join(process.cwd(), "public");
/** 供給を許す client 資産名（パストラバーサル遮断のホワイトリスト）。 */
const CLIENT_ASSET_NAME = /^[a-z_]+\.client\.js$/;

/** `public/<name>.client.js` を静的配信する（許可名のみ・存在しなければ 404）。 */
async function serveClientAsset(res: ServerResponse, name: string): Promise<void> {
  if (!CLIENT_ASSET_NAME.test(name)) {
    sendHtml(res, 404, htmlDocument("Not Found", `<main><p>Not Found</p></main>`));
    return;
  }
  try {
    const body = await readFile(join(CLIENT_ASSET_DIR, name), "utf8");
    res.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    res.end(body);
  } catch {
    sendHtml(res, 404, htmlDocument("Not Found", `<main><p>Not Found</p></main>`));
  }
}

/** POST body（JSON）を読み取る。壊れた JSON は `null` を返す（呼出側が 400 に写す）。 */
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      if (data === "") return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

/** JSON 応答を返す（API エンドポイント用）。 */
function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

/**
 * `/join` の参加受付面を HTML へ整形する。`participants` の {@link renderJoinSurface} が返す
 * ビューモデルを描画するのみ（判定ロジックは持ち込まない）。ローカル/検証セッションは開放
 * （アクセス許可・非満席）として氏名入力欄と「参加する」を提示する。
 */
function serializeJoinSurface(view: JoinSurfaceViewModel): string {
  if (view.kind === "form") {
    const inputs = view.fields
      .map(
        (f) =>
          `<input type="text" name="${escapeHtml(f.purpose)}" ` +
          `maxlength="${f.maxLength}" aria-label="${escapeHtml(view.prompt)}">`,
      )
      .join("");
    return (
      `<main data-surface="join">` +
      `<h1>${escapeHtml(view.heading)}</h1>` +
      `<p>${escapeHtml(view.prompt)}</p>` +
      `<form>${inputs}<button type="submit">${escapeHtml(view.submitLabel)}</button></form>` +
      `</main>`
    );
  }
  if (view.kind === "login_required" && view.login !== undefined) {
    return (
      `<main data-surface="join"><p>${escapeHtml(view.message)}</p>` +
      `<a href="${escapeHtml(view.login.path)}">${escapeHtml(view.login.label)}</a></main>`
    );
  }
  // access_denied / full: 平易文のみ（保護ナビ・設定キー名を露出しない）。
  return `<main data-surface="join"><p>${escapeHtml(view.message)}</p></main>`;
}

/** TV 受動表示面（観客向け）の文書タイトル。 */
const TV_TITLE = "みんなでためスイッチ";

/**
 * 参加 QR が符号化するクラウド公開 `/join` URL を解決する。`PUBLIC_BASE_URL` が設定済みなら
 * 単一 producer {@link buildJoinUrl}（分岐 A の秘匿トークン付与を含む）から得る。未設定
 * （ローカル/検証）では、起動時に解決済みの {@link publicBaseUrl}（localhost フォールバック）へ
 * `/join` を付与して QR を符号化可能な http URL を用意する（QR 依存面を起動可能に保つ）。
 */
function resolveJoinUrl(): string {
  try {
    return buildJoinUrl();
  } catch {
    return new URL(JOIN_PATH, publicBaseUrl).toString();
  }
}

/**
 * 制御盤の参加 QR（SVG）は入力非依存の静的グラフィックゆえ、初回要求時に一度だけ符号化して
 * 使い回す（`renderJoinQrSvg` は非同期）。以降の要求は解決済み Promise を共有する。
 */
let joinQrSvgPromise: Promise<string> | null = null;
function getJoinQrSvg(): Promise<string> {
  if (joinQrSvgPromise === null) {
    joinQrSvgPromise = renderJoinQrSvg(resolveJoinUrl());
  }
  return joinQrSvgPromise;
}

/**
 * TV a/c モードの受動シェル（データ捏造なし）。a（出題）・c（正解）の実データ（出題メディア・
 * 正解値）は稼働ゲートと live 配信が駆動するため、セッション前はモード識別可能な観客向け見出し
 * のみを描画し、実データを持ち込まない。相互作用要素・司会者操作語・内部語は含めない。
 */
function tvPassiveShell(mode: "a" | "c", heading: string, note: string): string {
  return (
    `<section class="tv-surface tv-mode-${mode}">` +
    `<div class="tv-line">${escapeHtml(heading)}</div>` +
    `<div class="tv-line">${escapeHtml(note)}</div></section>`
  );
}

/**
 * `/tv?mode=<a..e>` の受動表示面を描画する（VB-45 / VB-47）。b/d/e は既存の描画モジュール
 * {@link renderTvSurface} を空データ（開示前・0 行）で通し、面の構造 chrome（見出し/6 列表
 * ヘッダ/一覧見出し）を正直に提示する。a/c はモード識別の受動シェル（実データ捏造なし）。
 */
function renderTvHtml(modeParam: string | null): string {
  switch (modeParam) {
    case "b":
      return serializeTvSurface(
        renderTvSurface({ mode: "b", disclosure: { disclosed: false, answers: [] } }),
      );
    case "d":
      return serializeTvSurface(renderTvSurface({ mode: "d", settlement: [] }));
    case "e":
      return serializeTvSurface(
        renderTvSurface({ mode: "e", totals: { entries: [], finished: false } }),
      );
    case "c":
      return tvPassiveShell("c", "正解", "正解の発表をお待ちください。");
    case "a":
    default:
      return tvPassiveShell("a", "出題", "出題の開始をお待ちください。");
  }
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;

  // 健全性ベースライン（system_design §2.11 / server-health.ts が < 500 を要求）。
  if (path === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ok");
    return;
  }

  // client 資産（progressive enhancement の SSE 購読スクリプト）の静的配信。
  if (path.startsWith("/client/")) {
    await serveClientAsset(res, path.slice("/client/".length));
    return;
  }

  // ── interactive 層（Phase1）: コマンド endpoints・SSE live push ──

  // SSE live 配信: ロール別サーフェスを接続へ保持し、各コマンド後に再描画を push する。
  if (path === "/events" && req.method === "GET") {
    const roleParam = url.searchParams.get("role");
    const role: Role =
      roleParam === "host" || roleParam === "answerer" || roleParam === "audience"
        ? roleParam
        : "audience";
    const participantId = url.searchParams.get("participantId");
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");
    const id = addConnection(res, role, participantId);
    req.on("close", () => removeConnection(id));
    return;
  }

  // ホスト操作コマンド（HOST_ONLY・制御盤トリガー）→ orchestrator → 全接続へ broadcast。
  if (path === "/host/command" && req.method === "POST") {
    const body = (await readJsonBody(req)) as { command?: unknown; mode?: unknown } | null;
    if (body === null) return sendJson(res, 400, { ok: false, error: "不正な JSON です。" });
    const result = applyHostCommand(body.command, body.mode);
    if (result.ok) broadcast();
    return sendJson(res, result.ok ? 200 : result.status ?? 400, { ok: result.ok, error: result.error });
  }

  // タブレット解答（0〜100・受付中のみ）→ orchestrator → broadcast。
  if (path === "/tablet/answer" && req.method === "POST") {
    const body = (await readJsonBody(req)) as { participantId?: unknown; value?: unknown } | null;
    if (body === null) return sendJson(res, 400, { ok: false, error: "不正な JSON です。" });
    const result = applyAnswer(body.participantId, body.value);
    if (result.ok) broadcast();
    return sendJson(res, result.ok ? 200 : result.status ?? 400, { ok: result.ok, error: result.error });
  }

  // 参加確定（氏名自己入力）→ orchestrator → broadcast。participantId をクライアントへ返す。
  if (path === "/join" && req.method === "POST") {
    const body = (await readJsonBody(req)) as { name?: unknown } | null;
    if (body === null) return sendJson(res, 400, { ok: false, error: "不正な JSON です。" });
    const result = applyJoin(body.name);
    if (result.ok) broadcast();
    if (!result.ok || result.participant === undefined) {
      return sendJson(res, result.status ?? 400, { ok: false, error: result.error });
    }
    return sendJson(res, 200, { ok: true, participantId: result.participant.id });
  }

  if (path === "/join") {
    // ローカル/検証セッションは開放（許可・非満席・要ログインなし）として受付面を描画する。
    const view = renderJoinSurface({
      accessGranted: true,
      loginRedirectRequired: false,
      atCapacity: false,
    });
    sendHtml(res, 200, page("参加受付", serializeJoinSurface(view), "join"));
    return;
  }

  // TV（観客向け受動表示）: URL の mode 指定を既存 render モジュールへ配線して面を描画する。
  // ?mode 指定は静的モード表示（E2E 等）ゆえ client は live 購読しない（tv.client.js が判定）。
  if (path === "/tv") {
    sendHtml(res, 200, page(TV_TITLE, renderTvHtml(url.searchParams.get("mode")), "tv"));
    return;
  }

  // 制御盤（司会者向け）: 司会者トリガー（全操作語＋個別ジャンプ）・参加者一覧領域・参加 QR を
  // 既存 ControlPanelView ビルダ＋描画で提示する。参加者一覧はセッション前ゆえ空領域（見出しのみ）。
  if (path === "/control-panel") {
    const joinQrSvg = await getJoinQrSvg();
    const view = buildControlPanelView({
      stage: INITIAL_STAGE,
      participants: [],
      connectedTablets: 0,
      maxTabletConnections,
      joinUrl: resolveJoinUrl(),
      joinQrSvg,
    });
    sendHtml(res, 200, page("進行制御盤", renderControlPanelHtml(view), "control_panel"));
    return;
  }

  // 解答者タブレット（入力専用最小面）: 受付中・第1問・残額0円の passive な最小状態で描画する。
  if (path === "/tablet") {
    const tablet = renderTabletSurface({
      questionNumber: 1,
      answerValue: 0,
      submitted: false,
      ownBalanceYen: 0,
      status: "accepting",
    });
    sendHtml(res, 200, page("解答", tablet, "tablet"));
    return;
  }

  sendHtml(res, 404, htmlDocument("Not Found", `<main><p>Not Found</p></main>`));
}

const realtime = createRealtimeCore();
// PUBLIC_BASE_URL は参加用 QR（制御盤）の基底に用いる本番設定。ローカル/検証の boot と /healthz は
// これに依存してはならない（未設定でも起動して健全性を返す契約・system_design §2.11）。未設定時は
// ループバックオリジンへフォールバックする。ホスト表記は `localhost` を避け `127.0.0.1` を用いる:
// 制御盤は参加 URL を可視リンク文字列として描画するため、`localhost` だと内部ロール識別子走査
// （/host/ が「localhost」に部分一致）で誤検出を招く（§2.8・dod_cp_no_internal_leak）。本番は
// PUBLIC_BASE_URL の実ドメインが用いられ本フォールバックは局所用途に留まる。
let publicBaseUrl: string;
try {
  publicBaseUrl = resolvePublicBaseUrl();
} catch {
  publicBaseUrl = `http://127.0.0.1:${PORT}`;
}
const maxTabletConnections = resolveMaxTabletConnections();

// 参加 QR（SVG）は入力非依存の静的グラフィックゆえ起動時に一度だけ符号化してキャッシュし、SSE の
// 制御盤 live 再描画（host 断片）へ同期供給する。実プレイ（`session.loaded`）が始まる頃には解決済み。
let joinQrSvgCache = "";
void getJoinQrSvg()
  .then((svg) => {
    joinQrSvgCache = svg;
  })
  .catch(() => {
    /* QR 符号化失敗は制御盤 QR 面のみの局所影響ゆえ boot は継続する。 */
  });

// SSE の host 断片再構築に要する config/QR コンテキストの供給関数を登録する。
setHostContextProvider((connectedTablets) => ({
  joinUrl: resolveJoinUrl(),
  joinQrSvg: joinQrSvgCache,
  maxTabletConnections,
  connectedTablets,
}));

const server = createServer((req, res) => {
  // 非同期ハンドラの拒否は健全性ベースライン（< 500 契約）を守るため 500 で握り、未処理
  // Promise 拒否でプロセスを落とさない。QR 符号化等の非同期経路の失敗をここで境界化する。
  handleRequest(req, res).catch(() => {
    if (!res.headersSent) {
      sendHtml(res, 500, htmlDocument("Error", `<main><p>Internal Server Error</p></main>`));
    } else {
      res.end();
    }
  });
});
server.listen(PORT, () => {
  // 起動ログ（config / realtime_sync の配線確認）。stdio は起動ハーネスが継承する。
  process.stdout.write(
    `[save-money-switcher] listening on http://localhost:${PORT} ` +
      `(publicBaseUrl=${publicBaseUrl}, maxTabletConnections=${maxTabletConnections}, ` +
      `realtimeFanoutReady=${realtime.fanoutReady})\n`,
  );
});

// 終了シグナルで待受を閉じる（起動ハーネスは SIGTERM で停止する）。
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
