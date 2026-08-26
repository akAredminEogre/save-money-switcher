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
    const body =
      `<main data-surface="join">` +
      `<h1>${escapeHtml(view.heading)}</h1>` +
      `<p>${escapeHtml(view.prompt)}</p>` +
      `<form>${inputs}<button type="submit">${escapeHtml(view.submitLabel)}</button></form>` +
      `</main>`;
    return htmlDocument("参加受付", body);
  }
  if (view.kind === "login_required" && view.login !== undefined) {
    const body =
      `<main data-surface="join"><p>${escapeHtml(view.message)}</p>` +
      `<a href="${escapeHtml(view.login.path)}">${escapeHtml(view.login.label)}</a></main>`;
    return htmlDocument("参加受付", body);
  }
  // access_denied / full: 平易文のみ（保護ナビ・設定キー名を露出しない）。
  return htmlDocument("参加受付", `<main data-surface="join"><p>${escapeHtml(view.message)}</p></main>`);
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
  const body =
    `<section class="tv-surface tv-mode-${mode}">` +
    `<div class="tv-line">${escapeHtml(heading)}</div>` +
    `<div class="tv-line">${escapeHtml(note)}</div></section>`;
  return htmlDocument(TV_TITLE, body);
}

/**
 * `/tv?mode=<a..e>` の受動表示面を描画する（VB-45 / VB-47）。b/d/e は既存の描画モジュール
 * {@link renderTvSurface} を空データ（開示前・0 行）で通し、面の構造 chrome（見出し/6 列表
 * ヘッダ/一覧見出し）を正直に提示する。a/c はモード識別の受動シェル（実データ捏造なし）。
 */
function renderTvHtml(modeParam: string | null): string {
  switch (modeParam) {
    case "b":
      return htmlDocument(
        TV_TITLE,
        serializeTvSurface(
          renderTvSurface({ mode: "b", disclosure: { disclosed: false, answers: [] } }),
        ),
      );
    case "d":
      return htmlDocument(
        TV_TITLE,
        serializeTvSurface(renderTvSurface({ mode: "d", settlement: [] })),
      );
    case "e":
      return htmlDocument(
        TV_TITLE,
        serializeTvSurface(
          renderTvSurface({ mode: "e", totals: { entries: [], finished: false } }),
        ),
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

  if (path === "/join") {
    // ローカル/検証セッションは開放（許可・非満席・要ログインなし）として受付面を描画する。
    const view = renderJoinSurface({
      accessGranted: true,
      loginRedirectRequired: false,
      atCapacity: false,
    });
    sendHtml(res, 200, serializeJoinSurface(view));
    return;
  }

  // TV（観客向け受動表示）: URL の mode 指定を既存 render モジュールへ配線して面を描画する。
  if (path === "/tv") {
    sendHtml(res, 200, renderTvHtml(url.searchParams.get("mode")));
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
    sendHtml(res, 200, htmlDocument("進行制御盤", renderControlPanelHtml(view)));
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
    sendHtml(res, 200, htmlDocument("解答", tablet));
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
