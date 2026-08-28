/**
 * アプリケーションサーバのエントリポイント（bootstrap / 合成層・glue）。
 *
 * system_design §2.11 / runbook が定める「単一 Node プロセスが唯一の HTTP/WS 権威であり
 * `/healthz` が健全性ベースライン(< 500)を返す」を満たす起点。本モジュールはドメインロジックを
 * 持たず、既に実装・QC 済みの既存モジュール（`realtime_sync` / `config` / `participants` /
 * `accounts` / `auth`）の公開 API を import して配線するだけの薄い bootstrap である。
 *
 * 認証（2026-08-28 殿裁可 案A）:
 *   身元はサーバ側セッション ＋ HttpOnly Cookie が唯一の権威である（`auth/session_registry.ts` /
 *   `auth/cookie.ts`）。クライアントが持つ値（クエリの participantId・localStorage）を身元として
 *   信用しない。ロール認可は既存の単一決定点 `participants/authorize.ts` をそのまま用い、
 *   保護面（`/control-panel`・`/admin/*`）とホスト操作コマンドはそこを通す。
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
import { resolveDataDir } from "./config/data_dir.js";
import { renderJoinQrSvg } from "./participants/qr.js";
import { buildControlPanelView } from "./control_panel/control_panel_view.js";
import { renderControlPanelHtml } from "./control_panel/render_control_panel.js";
import { INITIAL_STAGE } from "./game_state/progression.js";
import { ROLE_LABELS } from "./game_state/role_labels.js";
import { renderTvSurface, serializeTvSurface } from "./tv_display/render_tv_surface.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Role } from "./realtime_sync/protocol.js";
import { applyHostCommand, applyAnswer } from "./server/orchestrator.js";
import {
  addConnection,
  removeConnection,
  broadcast,
  setHostContextProvider,
} from "./server/sse.js";
import { accountsFilePath, createJsonAccountStore } from "./accounts/json_account_store.js";
import {
  authenticate,
  changeDisplayName,
  changePassword,
  findAccountById,
  InvalidAccountDisplayNameError,
  WeakPasswordError,
} from "./accounts/account_service.js";
import { seedInitialAdminFromEnv } from "./accounts/seed_admin.js";
import { toPublicAccount, toSessionRole, type Account } from "./accounts/account.js";
import { renderAccountSettings } from "./accounts/account_surface.js";
import { createSessionRegistry, type AuthSession } from "./auth/session_registry.js";
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  isSecureOrigin,
  readSessionId,
} from "./auth/cookie.js";
import { guardAdminSurface, isSafeRedirectTarget } from "./auth/access_guard.js";
import { authorizeLiveSurface, toLiveSurface } from "./auth/surface_access.js";
import { buildLoginUrl, LOGIN_PATH } from "./auth/login_link.js";
import { renderLoginSurface, type LoginSurfaceViewModel } from "./auth/login_surface.js";
import { createJsonEpisodeStore, episodesFilePath } from "./episodes/json_episode_store.js";
import {
  createEpisode,
  findEpisode,
  findParticipation,
  inviteAccount,
  joinEpisode,
  listEpisodeQuestions,
  listEpisodes,
  listInvitations,
  listInvitedEpisodes,
  listParticipants,
  registerQuestion,
  updateEpisode,
  EpisodeNotFoundError,
  InvalidCorrectValueError,
  InvalidEpisodeTitleError,
  InvalidQuestionNumberError,
  InvalidQuestionTextError,
  NotInvitedError,
} from "./episodes/episode_service.js";
import { isEpisodeStatus } from "./episodes/episode.js";
import {
  renderAdminEpisodeDetail,
  renderAdminEpisodeList,
  renderInvitedEpisodeList,
  type AdminEpisodeDetailView,
  type AdminEpisodeListView,
  type InvitedEpisodeListView,
} from "./episodes/episode_surface.js";
import {
  EpisodeBusyError,
  resolveSessionParticipantId,
  syncEpisodeIntoSession,
  type EpisodeSessionDeps,
} from "./server/episode_session.js";
import {
  createAccount,
  listAccounts,
  DuplicateLoginIdError,
  InvalidLoginIdError,
} from "./accounts/account_service.js";
import { buildTabletFragment } from "./server/view_builders.js";
import { connectedTabletCount } from "./server/sse.js";
import { currentStage, session as playSession } from "./server/session.js";

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

/** 要求本文を文字列として読む（上限 1MB・超過は接続を落とす）。 */
function readRawBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) req.destroy();
    });
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(null));
  });
}

/** POST body（JSON）を読み取る。壊れた JSON は `null` を返す（呼出側が 400 に写す）。 */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const raw = await readRawBody(req);
  if (raw === null) return null;
  if (raw === "") return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/**
 * POST body を JSON でも form-urlencoded でも読み取る（ログイン・設定変更は素の HTML フォームでも
 * 成立させ、JavaScript 無効でも認証できるようにする）。壊れた JSON は `null`。
 */
async function readFormOrJsonBody(req: IncomingMessage): Promise<Record<string, string> | null> {
  const contentType = (req.headers["content-type"] ?? "").toLowerCase();
  const raw = await readRawBody(req);
  if (raw === null) return null;
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(raw);
    const fields: Record<string, string> = {};
    for (const [key, value] of params) fields[key] = value;
    return fields;
  }
  if (raw === "") return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object") return null;
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") fields[key] = value;
    }
    return fields;
  } catch {
    return null;
  }
}

/** JSON 応答を返す（API エンドポイント用）。 */
function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

/** 同一オリジンの絶対パスへリダイレクトする（`Set-Cookie` を伴う場合はここで併せて載せる）。 */
function sendRedirect(res: ServerResponse, location: string, setCookie?: string): void {
  const headers: Record<string, string> = { Location: location };
  if (setCookie !== undefined) headers["Set-Cookie"] = setCookie;
  res.writeHead(302, headers);
  res.end();
}

// ── 認証の配線（アカウント永続層・セッション台帳・Cookie 属性） ──

/** アカウント永続層（設計 D7・JSON ファイル。境界の裏ゆえ将来 SQLite へ差し替え可能）。 */
const accountStore = createJsonAccountStore(accountsFilePath(resolveDataDir()));

/** エピソード永続層（設計 D3 / D7・アカウントと同じ作法で境界の裏に置く）。 */
const episodeStore = createJsonEpisodeStore(episodesFilePath(resolveDataDir()));

/**
 * エピソード ⇄ 進行セッションの橋渡しに要する依存。表示名の解決だけをアカウント層へ委ね、
 * `server/episode_session.ts` がアカウント永続層の実装を知らずに済むようにする。
 */
const episodeDeps: EpisodeSessionDeps = {
  store: episodeStore,
  resolveDisplayName: async (accountId: string): Promise<string | undefined> =>
    (await findAccountById(accountStore, accountId))?.displayName,
};

/** サーバ側セッション台帳（プロセス内・再起動で失効してよい・設計 D2）。 */
const sessions = createSessionRegistry();

/** 要求の Cookie から現在のセッションを解決する（未ログインなら `undefined`）。 */
function currentSession(req: IncomingMessage): AuthSession | undefined {
  return sessions.get(readSessionId(req.headers.cookie));
}

/** 現在のセッションが指すアカウントを解決する（失効済み・削除済みなら `undefined`）。 */
async function currentAccount(req: IncomingMessage): Promise<Account | undefined> {
  const session = currentSession(req);
  if (session === undefined) return undefined;
  return findAccountById(accountStore, session.accountId);
}

/** ログイン面をリンク付きで案内する共通のナビ断片（保護面の外にのみ置く）。 */
function loginNav(): string {
  return `<p><a href="${LOGIN_PATH}">ログイン</a></p>`;
}

/** ログイン面（`/login`）を HTML へ整形する。パスワードは値を持たず再表示もしない。 */
function serializeLoginSurface(view: LoginSurfaceViewModel): string {
  const message =
    view.message !== undefined
      ? `<p data-field="message">${escapeHtml(view.message)}</p>`
      : "";
  const redirect =
    view.redirectTo !== undefined
      ? `<input type="hidden" name="redirect" value="${escapeHtml(view.redirectTo)}">`
      : "";
  const inputs = view.fields
    .map(
      (f) =>
        `<label>${escapeHtml(f.label)}` +
        `<input type="${f.control}" name="${escapeHtml(f.purpose)}" ` +
        `autocomplete="${f.purpose === "password" ? "current-password" : "username"}" ` +
        `aria-label="${escapeHtml(f.label)}"></label>`,
    )
    .join("");
  return (
    `<main data-surface="login">` +
    `<h1>${escapeHtml(view.heading)}</h1>` +
    message +
    `<form method="post" action="${LOGIN_PATH}" data-form="login">` +
    redirect +
    inputs +
    `<button type="submit" data-op="login">${escapeHtml(view.submitLabel)}</button>` +
    `</form></main>`
  );
}

/** ログイン面を描画して返す（照合失敗は 401・誘導は 200）。 */
function sendLoginPage(
  res: ServerResponse,
  status: number,
  input: { failed?: boolean; loginRequired?: boolean; redirectTo?: string },
): void {
  const view = renderLoginSurface(input);
  // ログイン面は素の HTML フォームだけで成立する（JS 無効でも認証できる）ゆえ client 資産を読まない。
  sendHtml(res, status, htmlDocument(LOGIN_HEADING_TITLE, serializeLoginSurface(view)));
}

/** ログイン面の文書タイトル。 */
const LOGIN_HEADING_TITLE = "ログイン";

/** アカウント設定面（`/me`）を HTML へ整形する。 */
function serializeAccountSettings(account: Account): string {
  const view = renderAccountSettings(toPublicAccount(account));
  return (
    `<main data-surface="me">` +
    `<h1>${escapeHtml(view.heading)}</h1>` +
    `<p class="me-surface__login-id" data-field="login-id">${escapeHtml(view.loginId)}</p>` +
    `<p class="me-surface__display-name" data-field="display-name">${escapeHtml(view.displayName)}</p>` +
    `<form data-form="rename">` +
    `<input type="text" name="display_name" maxlength="${view.displayNameMaxLength}" ` +
    `aria-label="お名前" value="${escapeHtml(view.displayName)}">` +
    `<button type="submit" data-op="rename">お名前を変更する</button>` +
    `</form>` +
    `<form data-form="password">` +
    `<input type="password" name="password" aria-label="${escapeHtml(view.passwordPrompt)}">` +
    `<button type="submit" data-op="password">パスワードを変更する</button>` +
    `</form>` +
    `<p class="me-surface__message" data-field="message"></p>` +
    `<p><a href="/">ホームへ戻る</a></p>` +
    `</main>`
  );
}

/**
 * ホーム面（`GET /`）を描画する。ログインした者のロールに応じて、その者が使える面への導線だけを
 * 置く受動面である（未ログインは本面へ到達せずログインへ誘導される）。
 */
function renderHomeHtml(account: Account): string {
  const links =
    account.role === "admin"
      ? `<li><a href="/admin">管理</a></li>` +
        `<li><a href="/admin/episodes">エピソード一覧</a></li>` +
        `<li><a href="/control-panel">進行制御盤</a></li>` +
        `<li><a href="/tv">TV表示</a></li>`
      : `<li><a href="/episodes">ご参加いただける回</a></li>` +
        `<li><a href="/tablet">解答画面</a></li>`;
  const forContestant = "";
  return (
    `<main data-surface="home">` +
    `<h1>${escapeHtml(TV_TITLE)}</h1>` +
    `<p data-field="display-name">${escapeHtml(account.displayName)}</p>` +
    `<ul>${links}<li><a href="/me">アカウント設定</a></li></ul>` +
    forContestant +
    `<form method="post" action="/logout" data-form="logout">` +
    `<button type="submit" data-op="logout">ログアウト</button></form>` +
    `</main>`
  );
}

/** 管理面（`GET /admin`）を描画する。admin セッションのみ到達する。 */
function renderAdminHtml(account: Account): string {
  return (
    `<main data-surface="admin">` +
    `<h1>管理</h1>` +
    `<p data-field="display-name">${escapeHtml(account.displayName)}</p>` +
    `<ul>` +
    `<li><a href="/admin/episodes">エピソード一覧</a></li>` +
    `<li><a href="/admin/accounts">解答者アカウント</a></li>` +
    `<li><a href="/control-panel">進行制御盤</a></li>` +
    `<li><a href="/tv">TV表示</a></li>` +
    `<li><a href="/me">アカウント設定</a></li>` +
    `</ul>` +
    `<p><a href="/">ホームへ戻る</a></p>` +
    `</main>`
  );
}

/** TV 受動表示面（観客向け）の文書タイトル。 */
const TV_TITLE = "みんなでためスイッチ";

/**
 * 参加 QR が符号化するクラウド公開のログイン URL を解決する（設計 D6・QR の意味の付け替え）。
 * `PUBLIC_BASE_URL` が設定済みなら単一 producer {@link buildLoginUrl} から得る。未設定
 * （ローカル/検証）では、起動時に解決済みの {@link publicBaseUrl}（ループバック fallback）へ
 * `/login` を付与して QR を符号化可能な http URL を用意する（QR 依存面を起動可能に保つ）。
 */
function resolveEntryUrl(): string {
  try {
    return buildLoginUrl();
  } catch {
    return new URL(LOGIN_PATH, publicBaseUrl).toString();
  }
}

/**
 * 制御盤の参加 QR（SVG）は入力非依存の静的グラフィックゆえ、初回要求時に一度だけ符号化して
 * 使い回す（`renderJoinQrSvg` は非同期）。以降の要求は解決済み Promise を共有する。
 */
let joinQrSvgPromise: Promise<string> | null = null;
function getJoinQrSvg(): Promise<string> {
  if (joinQrSvgPromise === null) {
    joinQrSvgPromise = renderJoinQrSvg(resolveEntryUrl());
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

/**
 * admin 専用サーフェスの門番を適用する。未認証は HTML 面ゆえログインへ 302 で誘導し（AC-A1）、
 * 認証済みだが admin でないなら 403 の平易文を返す（AC-A2）。通過したら `undefined` を返す。
 */
function guardAdminHtml(
  req: IncomingMessage,
  res: ServerResponse,
  requestedPath: string,
): "denied" | "granted" {
  const outcome = guardAdminSurface(currentSession(req));
  if (outcome.kind === "granted") return "granted";
  if (outcome.kind === "unauthenticated") {
    const target = `${outcome.loginPath}?required=1&redirect=${encodeURIComponent(requestedPath)}`;
    sendRedirect(res, target);
    return "denied";
  }
  sendHtml(
    res,
    outcome.status,
    htmlDocument(
      "権限がありません",
      `<main data-surface="forbidden"><p>この画面は${escapeHtml(ROLE_LABELS.host)}のみが開けます。</p>` +
        `<p><a href="/">ホームへ戻る</a></p></main>`,
    ),
  );
  return "denied";
}

// ── エピソード面（案A P2・issue #2 R3〜R6 / AC-A3〜AC-A6） ──

/**
 * 面へ出す通知・エラーの可視文言。要求クエリの値は**この表の鍵としてのみ**用い、文字列を面へ
 * 反射させない（未知の鍵は文言なし）。反射型注入の経路を作らないための固定表である。
 */
const NOTICE_MESSAGES: Readonly<Record<string, string>> = {
  episode_created: "新しい回を作りました。",
  episode_saved: "この回の設定を保存しました。",
  question_saved: "問題を登録しました。",
  member_invited: "解答者を招待しました。",
  member_created: "解答者を作って招待しました。",
  account_saved: "アカウントを更新しました。",
};

/** 失敗の可視文言（同上・固定表）。 */
const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  episode_title: "回の名前を確かめてくだされ。",
  question_number: "問題番号を確かめてくだされ。",
  question_text: "問題文を入力してくだされ。",
  correct_value: "正解は0〜100の整数で入力してくだされ。",
  login_id: "ログインIDを確かめてくだされ。",
  duplicate_login_id: "そのログインIDは既に使われています。",
  weak_password: "パスワードが短すぎます。",
  display_name: "お名前を確かめてくだされ。",
  not_invited: "この回へは招待されていません。",
  episode_busy: "別の回が進行中です。進行中の回を終えてからお試しくだされ。",
  not_found: "その回は見つかりませんでした。",
  invalid_request: "入力を確かめてくだされ。",
};

/** 通知・エラーのクエリを可視文言の断片へ写す（未知の鍵は空断片）。 */
function messageFragment(url: URL): string {
  const notice = NOTICE_MESSAGES[url.searchParams.get("notice") ?? ""];
  const failure = ERROR_MESSAGES[url.searchParams.get("error") ?? ""];
  const text = failure ?? notice;
  if (text === undefined) return "";
  return `<p data-field="message">${escapeHtml(text)}</p>`;
}

/** `/admin/episodes/<id>[/<rest>]` を解析する（一致しなければ `null`）。 */
function parseEpisodeAdminPath(path: string): { id: string; rest: string } | null {
  const prefix = "/admin/episodes/";
  if (!path.startsWith(prefix)) return null;
  const remainder = path.slice(prefix.length);
  if (remainder === "") return null;
  const slash = remainder.indexOf("/");
  if (slash < 0) return { id: decodeURIComponent(remainder), rest: "" };
  return {
    id: decodeURIComponent(remainder.slice(0, slash)),
    rest: remainder.slice(slash + 1),
  };
}

/** `/episodes/<id>/join` を解析する（一致しなければ `null`）。 */
function parseEpisodeJoinPath(path: string): string | null {
  const match = /^\/episodes\/([^/]+)\/join$/.exec(path);
  return match === null ? null : decodeURIComponent(match[1] as string);
}

/** 管理者のエピソード一覧面を HTML へ整形する。 */
function serializeAdminEpisodeList(view: AdminEpisodeListView, message: string): string {
  const rows = view.episodes
    .map(
      (episode) =>
        `<li data-field="episode">` +
        `<a href="/admin/episodes/${encodeURIComponent(episode.id)}">${escapeHtml(episode.title)}</a>` +
        `<span data-field="episode-status">${escapeHtml(episode.statusLabel)}</span></li>`,
    )
    .join("");
  const list =
    view.episodes.length > 0
      ? `<ul data-field="episode-list">${rows}</ul>`
      : `<p data-field="empty">${escapeHtml(view.emptyMessage)}</p>`;
  return (
    `<main data-surface="admin-episodes">` +
    `<h1>${escapeHtml(view.heading)}</h1>` +
    message +
    list +
    `<form method="post" action="/admin/episodes" data-form="episode-create">` +
    `<label>${escapeHtml(view.titleLabel)}` +
    `<input type="text" name="title" maxlength="${view.titleMaxLength}" ` +
    `aria-label="${escapeHtml(view.titleLabel)}"></label>` +
    `<button type="submit" data-op="create-episode">${escapeHtml(view.createSubmitLabel)}</button>` +
    `</form>` +
    `<p><a href="/admin">管理へ戻る</a></p>` +
    `</main>`
  );
}

/** 管理者のエピソード詳細面を HTML へ整形する（進行制御盤を当該回の文脈で埋め込む）。 */
function serializeAdminEpisodeDetail(
  view: AdminEpisodeDetailView,
  controlPanelHtml: string,
  message: string,
): string {
  const base = `/admin/episodes/${encodeURIComponent(view.episodeId)}`;
  const statusOptions = view.statusOptions
    .map(
      (option) =>
        `<option value="${escapeHtml(option.value)}"` +
        `${option.value === view.status ? " selected" : ""}>${escapeHtml(option.label)}</option>`,
    )
    .join("");
  const questionRows = view.questions
    .map(
      (question) =>
        `<li data-field="question">` +
        `<span data-field="question-number">第${question.questionNumber}問</span>` +
        `<span data-field="question-text">${escapeHtml(question.text)}</span>` +
        `<span data-field="question-correct">正解 ${question.correctValue}</span></li>`,
    )
    .join("");
  const memberRows = view.members
    .map(
      (member) =>
        `<li data-field="member">` +
        `<span data-field="member-name">${escapeHtml(member.displayName)}</span>` +
        `<span data-field="member-state">${escapeHtml(member.stateLabel)}</span></li>`,
    )
    .join("");
  const invitable = view.invitableAccounts
    .map(
      (account) =>
        `<option value="${escapeHtml(account.accountId)}">${escapeHtml(account.displayName)}</option>`,
    )
    .join("");
  const inviteForm =
    view.invitableAccounts.length > 0
      ? `<form method="post" action="${base}/invitations" data-form="member-invite">` +
        `<select name="account_id" aria-label="解答者">${invitable}</select>` +
        `<button type="submit" data-op="invite-member">${escapeHtml(view.memberInviteSubmitLabel)}</button>` +
        `</form>`
      : "";
  return (
    `<main data-surface="admin-episode">` +
    `<h1 data-field="episode-title">${escapeHtml(view.title)}</h1>` +
    `<p data-field="episode-status">${escapeHtml(view.statusLabel)}</p>` +
    message +
    `<form method="post" action="${base}" data-form="episode-update">` +
    `<label>${escapeHtml(view.titleLabel)}` +
    `<input type="text" name="title" maxlength="${view.titleMaxLength}" ` +
    `value="${escapeHtml(view.title)}" aria-label="${escapeHtml(view.titleLabel)}"></label>` +
    `<select name="status" aria-label="この回の状態">${statusOptions}</select>` +
    `<button type="submit" data-op="update-episode">${escapeHtml(view.updateSubmitLabel)}</button>` +
    `</form>` +
    `<section data-field="questions">` +
    `<h2>${escapeHtml(view.questionSectionHeading)}</h2>` +
    (view.questions.length > 0 ? `<ol data-field="question-list">${questionRows}</ol>` : "") +
    `<form method="post" action="${base}/questions" data-form="question-create">` +
    `<label>問題番号<input type="number" name="question_number" ` +
    `min="${view.questionNumberMin}" max="${view.questionNumberMax}" aria-label="問題番号"></label>` +
    `<label>問題文<input type="text" name="text" aria-label="問題文"></label>` +
    `<label>正解<input type="number" name="correct_value" ` +
    `min="${view.correctValueMin}" max="${view.correctValueMax}" aria-label="正解"></label>` +
    `<button type="submit" data-op="register-question">${escapeHtml(view.questionSubmitLabel)}</button>` +
    `</form></section>` +
    `<section data-field="members">` +
    `<h2>${escapeHtml(view.memberSectionHeading)}</h2>` +
    (view.members.length > 0 ? `<ul data-field="member-list">${memberRows}</ul>` : "") +
    `<form method="post" action="${base}/contestants" data-form="member-create">` +
    `<label>ログインID<input type="text" name="login_id" ` +
    `maxlength="${view.loginIdMaxLength}" aria-label="ログインID"></label>` +
    `<label>はじめのパスワード（${view.minPasswordLength}文字以上）` +
    `<input type="password" name="password" aria-label="はじめのパスワード"></label>` +
    `<label>お名前<input type="text" name="display_name" ` +
    `maxlength="${view.displayNameMaxLength}" aria-label="お名前"></label>` +
    `<button type="submit" data-op="create-member">${escapeHtml(view.memberCreateSubmitLabel)}</button>` +
    `</form>` +
    inviteForm +
    `</section>` +
    `<section data-field="control-panel"><div id="control-panel">${controlPanelHtml}</div></section>` +
    `<p><a href="/admin/episodes">エピソード一覧へ戻る</a></p>` +
    `</main>`
  );
}

/** 解答者の招待エピソード一覧面を HTML へ整形する。 */
function serializeInvitedEpisodeList(view: InvitedEpisodeListView, message: string): string {
  const rows = view.episodes
    .map(
      (episode) =>
        `<li data-field="episode">` +
        `<span data-field="episode-title">${escapeHtml(episode.title)}</span>` +
        `<span data-field="episode-status">${escapeHtml(episode.statusLabel)}</span>` +
        `<form method="post" action="/episodes/${encodeURIComponent(episode.id)}/join" data-form="join">` +
        `<button type="submit" data-op="join">${escapeHtml(episode.actionLabel)}</button>` +
        `</form></li>`,
    )
    .join("");
  const list =
    view.episodes.length > 0
      ? `<ul data-field="episode-list">${rows}</ul>`
      : `<p data-field="empty">${escapeHtml(view.emptyMessage)}</p>`;
  return (
    `<main data-surface="episodes">` +
    `<h1>${escapeHtml(view.heading)}</h1>` +
    message +
    list +
    `<p><a href="/">ホームへ戻る</a></p>` +
    `</main>`
  );
}

/** 管理者のアカウント面（解答者アカウントの作成・編集・AC-A4 / issue #2 R5）を HTML へ整形する。 */
function serializeAdminAccounts(accounts: readonly Account[], message: string): string {
  const rows = accounts
    .filter((account) => account.role === "contestant")
    .map(
      (account) =>
        `<li data-field="account">` +
        `<span data-field="account-name">${escapeHtml(account.displayName)}</span>` +
        `<span data-field="account-login-id">${escapeHtml(account.loginId)}</span>` +
        `<form method="post" action="/admin/accounts/${encodeURIComponent(account.id)}" ` +
        `data-form="account-update">` +
        `<input type="text" name="display_name" value="${escapeHtml(account.displayName)}" ` +
        `maxlength="20" aria-label="お名前">` +
        `<input type="password" name="password" aria-label="新しいパスワード">` +
        `<button type="submit" data-op="update-account">この人を保存する</button>` +
        `</form></li>`,
    )
    .join("");
  return (
    `<main data-surface="admin-accounts">` +
    `<h1>解答者アカウント</h1>` +
    message +
    (rows === "" ? `<p data-field="empty">解答者はまだいません。</p>` : `<ul data-field="account-list">${rows}</ul>`) +
    `<form method="post" action="/admin/accounts" data-form="account-create">` +
    `<label>ログインID<input type="text" name="login_id" aria-label="ログインID"></label>` +
    `<label>はじめのパスワード<input type="password" name="password" aria-label="はじめのパスワード"></label>` +
    `<label>お名前<input type="text" name="display_name" maxlength="20" aria-label="お名前"></label>` +
    `<button type="submit" data-op="create-account">解答者を作る</button>` +
    `</form>` +
    `<p><a href="/admin">管理へ戻る</a></p>` +
    `</main>`
  );
}

/** エピソード詳細へ埋め込む進行制御盤の HTML を、現在の進行セッションから組み立てる。 */
async function buildEmbeddedControlPanel(): Promise<string> {
  const view = buildControlPanelView({
    stage: currentStage(),
    participants: playSession.participants,
    connectedTablets: connectedTabletCount(),
    maxTabletConnections,
    joinUrl: resolveEntryUrl(),
    joinQrSvg: await getJoinQrSvg(),
  });
  return renderControlPanelHtml(view);
}

/** 業務例外を、面へ戻すときの固定エラーコードへ写す（未知の例外は再送出する）。 */
function toErrorCode(err: unknown): string {
  if (err instanceof InvalidEpisodeTitleError) return "episode_title";
  if (err instanceof InvalidQuestionNumberError) return "question_number";
  if (err instanceof InvalidQuestionTextError) return "question_text";
  if (err instanceof InvalidCorrectValueError) return "correct_value";
  if (err instanceof InvalidLoginIdError) return "login_id";
  if (err instanceof DuplicateLoginIdError) return "duplicate_login_id";
  if (err instanceof WeakPasswordError) return "weak_password";
  if (err instanceof InvalidAccountDisplayNameError) return "display_name";
  if (err instanceof NotInvitedError) return "not_invited";
  if (err instanceof EpisodeBusyError) return "episode_busy";
  if (err instanceof EpisodeNotFoundError) return "not_found";
  throw err;
}

/** 数値フィールド（フォームは文字列で届く）を整数へ写す。整数でなければ `NaN` を返す。 */
function toInteger(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return Number.NaN;
  const value = Number(raw);
  return Number.isInteger(value) ? value : Number.NaN;
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

  // ── 認証層（案A）: ログイン面・セッション発行/破棄 ──

  if (path === LOGIN_PATH && req.method === "GET") {
    // 既にログイン済みなら面を出さずホームへ返す（二重ログインの入口を作らない）。
    if (currentSession(req) !== undefined) return sendRedirect(res, "/");
    const redirectParam = url.searchParams.get("redirect");
    sendLoginPage(res, 200, {
      loginRequired: url.searchParams.get("required") === "1",
      ...(isSafeRedirectTarget(redirectParam) ? { redirectTo: redirectParam } : {}),
    });
    return;
  }

  if (path === LOGIN_PATH && req.method === "POST") {
    const body = await readFormOrJsonBody(req);
    if (body === null) return sendJson(res, 400, { ok: false, error: "不正な要求です。" });
    const account = await authenticate(accountStore, body["login_id"], body["password"]);
    if (account === undefined) {
      // 失敗は 401。理由の詳細（ID が無い/パスワード違い）は出さない。
      sendLoginPage(res, 401, {
        failed: true,
        ...(isSafeRedirectTarget(body["redirect"]) ? { redirectTo: body["redirect"] } : {}),
      });
      return;
    }
    const session = sessions.issue(account.id, toSessionRole(account.role));
    const destination = isSafeRedirectTarget(body["redirect"]) ? body["redirect"] : "/";
    sendRedirect(res, destination, buildSessionCookie(session.sid, cookieSecure));
    return;
  }

  if (path === "/logout" && req.method === "POST") {
    sessions.destroy(readSessionId(req.headers.cookie));
    sendRedirect(res, LOGIN_PATH, buildClearedSessionCookie(cookieSecure));
    return;
  }

  // ── interactive 層: コマンド endpoints・SSE live push ──

  // SSE live 配信: クライアントが申告するのは**どの面を開いているか**だけで、その面を開いて
  // よいか・どのロールの投影を流すかはサーバがセッションから決める（申告値で権限が上がらない）。
  if (path === "/events" && req.method === "GET") {
    const surface = toLiveSurface(url.searchParams.get("surface"));
    const session = currentSession(req);
    const subscription = authorizeLiveSurface(surface, session);
    if (subscription.kind === "denied") {
      return sendJson(res, subscription.status, { ok: false, error: "この面を購読する権限がありません。" });
    }
    const role: Role = subscription.role;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");
    // 接続に載せる身元は、解答面なら**進行中の回の参加者識別子**（`episode_participants.id`・
    // `/tablet/answer` が orchestrator へ渡す鍵と同一）。まだ参加していない者・観客面（tv）は
    // 身元を持たない（null）。制御盤は接続数の計上にのみ用いるゆえアカウント ID を載せる。
    const identity =
      session === undefined
        ? null
        : role === "answerer"
          ? ((await resolveSessionParticipantId(episodeDeps, session.accountId)) ?? null)
          : session.accountId;
    const id = addConnection(res, role, identity);
    req.on("close", () => removeConnection(id));
    return;
  }

  // ホスト操作コマンド（HOST_ONLY・制御盤トリガー）→ 認可 → orchestrator → 全接続へ broadcast。
  if (path === "/host/command" && req.method === "POST") {
    const outcome = guardAdminSurface(currentSession(req));
    if (outcome.kind !== "granted") {
      return sendJson(res, outcome.status, {
        ok: false,
        error: "この操作を発動する権限がありません。",
      });
    }
    const body = (await readJsonBody(req)) as { command?: unknown; mode?: unknown } | null;
    if (body === null) return sendJson(res, 400, { ok: false, error: "不正な JSON です。" });
    const result = applyHostCommand(body.command, body.mode);
    if (result.ok) broadcast();
    return sendJson(res, result.ok ? 200 : result.status ?? 400, { ok: result.ok, error: result.error });
  }

  // タブレット解答（0〜100・受付中のみ）。ログイン必須。**どのエピソードの参加者としての解答か**
  // は進行セッションに載っている回と自分のアカウントから解決し（`episode_participants.id`）、
  // それを既存ドメインの `participantId` として orchestrator へ渡す（設計 D3）。
  if (path === "/tablet/answer" && req.method === "POST") {
    const session = currentSession(req);
    if (session === undefined) {
      return sendJson(res, 401, { ok: false, error: "ログインが必要です。" });
    }
    const body = (await readJsonBody(req)) as { value?: unknown } | null;
    if (body === null) return sendJson(res, 400, { ok: false, error: "不正な JSON です。" });
    const participantId = await resolveSessionParticipantId(episodeDeps, session.accountId);
    if (participantId === undefined) {
      return sendJson(res, 409, {
        ok: false,
        error: "参加する回をお選びください。",
      });
    }
    const result = applyAnswer(participantId, body.value);
    if (result.ok) broadcast();
    return sendJson(res, result.ok ? 200 : result.status ?? 400, { ok: result.ok, error: result.error });
  }

  // アカウント設定の更新（表示名・パスワード）。自分のアカウントにのみ作用する。
  if (path === "/me/display-name" && req.method === "POST") {
    const session = currentSession(req);
    if (session === undefined) return sendJson(res, 401, { ok: false, error: "ログインが必要です。" });
    const body = await readFormOrJsonBody(req);
    if (body === null) return sendJson(res, 400, { ok: false, error: "不正な要求です。" });
    try {
      const updated = await changeDisplayName(accountStore, session.accountId, body["display_name"] ?? "");
      broadcast();
      return sendJson(res, 200, { ok: true, displayName: updated.displayName });
    } catch (err) {
      if (err instanceof InvalidAccountDisplayNameError) {
        return sendJson(res, 400, { ok: false, error: err.message });
      }
      throw err;
    }
  }

  if (path === "/me/password" && req.method === "POST") {
    const session = currentSession(req);
    if (session === undefined) return sendJson(res, 401, { ok: false, error: "ログインが必要です。" });
    const body = await readFormOrJsonBody(req);
    if (body === null) return sendJson(res, 400, { ok: false, error: "不正な要求です。" });
    try {
      await changePassword(accountStore, session.accountId, body["password"] ?? "");
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      if (err instanceof WeakPasswordError) {
        return sendJson(res, 400, { ok: false, error: err.message });
      }
      throw err;
    }
  }

  // ── 表示面 ──

  // ── エピソード（案A P2）: 管理者の作成・編集・招待・問題登録／解答者の一覧・参加 ──

  // 管理者のエピソード一覧（issue #2 R3・AC-A3）。
  if (path === "/admin/episodes" && req.method === "GET") {
    if (guardAdminHtml(req, res, path) === "denied") return;
    const view = renderAdminEpisodeList(await listEpisodes(episodeStore));
    sendHtml(
      res,
      200,
      htmlDocument(view.heading, serializeAdminEpisodeList(view, messageFragment(url))),
    );
    return;
  }

  // エピソードの新規作成（作成直後は準備中）。
  if (path === "/admin/episodes" && req.method === "POST") {
    if (guardAdminHtml(req, res, path) === "denied") return;
    const account = await currentAccount(req);
    if (account === undefined) return sendRedirect(res, LOGIN_PATH);
    const body = await readFormOrJsonBody(req);
    if (body === null) return sendRedirect(res, "/admin/episodes?error=invalid_request");
    try {
      const episode = await createEpisode(episodeStore, {
        title: body["title"] ?? "",
        createdBy: account.id,
      });
      return sendRedirect(
        res,
        `/admin/episodes/${encodeURIComponent(episode.id)}?notice=episode_created`,
      );
    } catch (err) {
      return sendRedirect(res, `/admin/episodes?error=${toErrorCode(err)}`);
    }
  }

  // 管理者のエピソード詳細とその配下の操作（R4・AC-A3 / AC-A4）。
  const adminEpisode = parseEpisodeAdminPath(path);
  if (adminEpisode !== null) {
    if (guardAdminHtml(req, res, path) === "denied") return;
    const episode = await findEpisode(episodeStore, adminEpisode.id);
    if (episode === undefined) {
      sendHtml(res, 404, htmlDocument("Not Found", `<main><p>Not Found</p></main>`));
      return;
    }
    const base = `/admin/episodes/${encodeURIComponent(episode.id)}`;

    if (adminEpisode.rest === "" && req.method === "GET") {
      // 当該回を進行セッションへ載せてから制御盤を描く（詳細面の制御盤がその回を映す）。
      let message = messageFragment(url);
      try {
        await syncEpisodeIntoSession(episodeDeps, episode.id);
      } catch (err) {
        if (!(err instanceof EpisodeBusyError)) throw err;
        // 別の回が進行中のときは載せ替えず、その旨だけを面へ伝える（進行中の回を壊さない）。
        message = `<p data-field="message">${escapeHtml(ERROR_MESSAGES["episode_busy"] as string)}</p>`;
      }
      const invitations = await listInvitations(episodeStore, episode.id);
      const participants = await listParticipants(episodeStore, episode.id);
      const accounts = await listAccounts(accountStore);
      const accountById = new Map(accounts.map((account) => [account.id, account]));
      const invitedIds = new Set(invitations.map((invitation) => invitation.accountId));
      const members = invitations.flatMap((invitation) => {
        const account = accountById.get(invitation.accountId);
        if (account === undefined) return [];
        const participation = participants.find((p) => p.accountId === invitation.accountId);
        return [
          {
            accountId: account.id,
            displayName: account.displayName,
            ...(participation !== undefined ? { participantId: participation.id } : {}),
          },
        ];
      });
      const invitableAccounts = accounts
        .filter((account) => account.role === "contestant" && !invitedIds.has(account.id))
        .map((account) => ({ accountId: account.id, displayName: account.displayName }));
      const view = renderAdminEpisodeDetail({
        episode,
        questions: await listEpisodeQuestions(episodeStore, episode.id),
        members,
        invitableAccounts,
      });
      sendHtml(
        res,
        200,
        htmlDocument(
          episode.title,
          serializeAdminEpisodeDetail(view, await buildEmbeddedControlPanel(), message) +
            `<script src="/client/episode_detail.client.js"></script>`,
        ),
      );
      return;
    }

    if (adminEpisode.rest === "" && req.method === "POST") {
      const body = await readFormOrJsonBody(req);
      if (body === null) return sendRedirect(res, `${base}?error=invalid_request`);
      const status = body["status"];
      try {
        await updateEpisode(episodeStore, episode.id, {
          ...(body["title"] !== undefined ? { title: body["title"] } : {}),
          ...(isEpisodeStatus(status) ? { status } : {}),
        });
        return sendRedirect(res, `${base}?notice=episode_saved`);
      } catch (err) {
        return sendRedirect(res, `${base}?error=${toErrorCode(err)}`);
      }
    }

    // 問題・正解の登録（同じ問題番号への再登録は上書き編集）。
    if (adminEpisode.rest === "questions" && req.method === "POST") {
      const body = await readFormOrJsonBody(req);
      if (body === null) return sendRedirect(res, `${base}?error=invalid_request`);
      try {
        await registerQuestion(episodeStore, episode.id, {
          questionNumber: toInteger(body["question_number"]),
          text: body["text"] ?? "",
          correctValue: toInteger(body["correct_value"]),
        });
        // 進行セッションに載っている回なら出題集合を最新へ揃える（進行状態は保つ）。
        if (playSession.episodeId === episode.id) {
          await syncEpisodeIntoSession(episodeDeps, episode.id);
          broadcast();
        }
        return sendRedirect(res, `${base}?notice=question_saved`);
      } catch (err) {
        return sendRedirect(res, `${base}?error=${toErrorCode(err)}`);
      }
    }

    // 既存の解答者アカウントを当該回へ招待する。
    if (adminEpisode.rest === "invitations" && req.method === "POST") {
      const body = await readFormOrJsonBody(req);
      if (body === null) return sendRedirect(res, `${base}?error=invalid_request`);
      const accountId = body["account_id"] ?? "";
      const invitee = await findAccountById(accountStore, accountId);
      if (invitee === undefined || invitee.role !== "contestant") {
        return sendRedirect(res, `${base}?error=invalid_request`);
      }
      try {
        await inviteAccount(episodeStore, episode.id, invitee.id);
        return sendRedirect(res, `${base}?notice=member_invited`);
      } catch (err) {
        return sendRedirect(res, `${base}?error=${toErrorCode(err)}`);
      }
    }

    // 解答者アカウントを新規発行し、当該回へ招待する（AC-A4）。
    if (adminEpisode.rest === "contestants" && req.method === "POST") {
      const body = await readFormOrJsonBody(req);
      if (body === null) return sendRedirect(res, `${base}?error=invalid_request`);
      try {
        const contestant = await createAccount(accountStore, {
          loginId: body["login_id"] ?? "",
          password: body["password"] ?? "",
          role: "contestant",
          displayName: body["display_name"] ?? "",
        });
        await inviteAccount(episodeStore, episode.id, contestant.id);
        return sendRedirect(res, `${base}?notice=member_created`);
      } catch (err) {
        return sendRedirect(res, `${base}?error=${toErrorCode(err)}`);
      }
    }

    sendHtml(res, 404, htmlDocument("Not Found", `<main><p>Not Found</p></main>`));
    return;
  }

  // 管理者のアカウント面（解答者アカウントの作成・編集・issue #2 R5）。
  if (path === "/admin/accounts" && req.method === "GET") {
    if (guardAdminHtml(req, res, path) === "denied") return;
    const accounts = await listAccounts(accountStore);
    sendHtml(
      res,
      200,
      htmlDocument("解答者アカウント", serializeAdminAccounts(accounts, messageFragment(url))),
    );
    return;
  }

  if (path === "/admin/accounts" && req.method === "POST") {
    if (guardAdminHtml(req, res, path) === "denied") return;
    const body = await readFormOrJsonBody(req);
    if (body === null) return sendRedirect(res, "/admin/accounts?error=invalid_request");
    try {
      await createAccount(accountStore, {
        loginId: body["login_id"] ?? "",
        password: body["password"] ?? "",
        role: "contestant",
        displayName: body["display_name"] ?? "",
      });
      return sendRedirect(res, "/admin/accounts?notice=member_created");
    } catch (err) {
      return sendRedirect(res, `/admin/accounts?error=${toErrorCode(err)}`);
    }
  }

  // 解答者アカウントの編集（表示名の変更・パスワードの再発行）。
  if (path.startsWith("/admin/accounts/") && req.method === "POST") {
    if (guardAdminHtml(req, res, path) === "denied") return;
    const accountId = decodeURIComponent(path.slice("/admin/accounts/".length));
    const target = await findAccountById(accountStore, accountId);
    if (target === undefined || target.role !== "contestant") {
      return sendRedirect(res, "/admin/accounts?error=invalid_request");
    }
    const body = await readFormOrJsonBody(req);
    if (body === null) return sendRedirect(res, "/admin/accounts?error=invalid_request");
    try {
      const displayName = body["display_name"];
      if (displayName !== undefined && displayName.trim() !== "") {
        await changeDisplayName(accountStore, target.id, displayName);
      }
      const password = body["password"];
      if (password !== undefined && password !== "") {
        await changePassword(accountStore, target.id, password);
      }
      // 表示名は制御盤の参加者一覧へも出るゆえ、進行セッションへ即時反映する（AC-A7）。
      if (playSession.episodeId !== null) {
        await syncEpisodeIntoSession(episodeDeps, playSession.episodeId);
        broadcast();
      }
      return sendRedirect(res, "/admin/accounts?notice=account_saved");
    } catch (err) {
      return sendRedirect(res, `/admin/accounts?error=${toErrorCode(err)}`);
    }
  }

  // 解答者の招待エピソード一覧（R6・AC-A5）。招待されていない回は出さない。
  if (path === "/episodes" && req.method === "GET") {
    const account = await currentAccount(req);
    if (account === undefined) {
      return sendRedirect(res, `${LOGIN_PATH}?required=1&redirect=${encodeURIComponent("/episodes")}`);
    }
    if (account.role === "admin") return sendRedirect(res, "/admin/episodes");
    const episodes = await listInvitedEpisodes(episodeStore, account.id);
    const joined: string[] = [];
    for (const episode of episodes) {
      const participation = await findParticipation(episodeStore, episode.id, account.id);
      if (participation !== undefined) joined.push(episode.id);
    }
    const view = renderInvitedEpisodeList(episodes, joined);
    sendHtml(
      res,
      200,
      htmlDocument(view.heading, serializeInvitedEpisodeList(view, messageFragment(url))),
    );
    return;
  }

  // エピソードへの参加（AC-A6）。招待されている者だけが参加でき、二度押しでも増えない。
  const joinTargetEpisodeId = parseEpisodeJoinPath(path);
  if (joinTargetEpisodeId !== null && req.method === "POST") {
    const account = await currentAccount(req);
    if (account === undefined) {
      return sendRedirect(res, `${LOGIN_PATH}?required=1&redirect=${encodeURIComponent("/episodes")}`);
    }
    try {
      await joinEpisode(episodeStore, joinTargetEpisodeId, account.id);
      await syncEpisodeIntoSession(episodeDeps, joinTargetEpisodeId);
      // 参加者一覧（制御盤）と解答面へ即時反映する。
      broadcast();
      return sendRedirect(res, "/tablet");
    } catch (err) {
      return sendRedirect(res, `/episodes?error=${toErrorCode(err)}`);
    }
  }

  // ホーム（アプリの入口）。未ログインはログインへ誘導する（素通りさせない）。
  if (path === "/") {
    const account = await currentAccount(req);
    if (account === undefined) return sendRedirect(res, LOGIN_PATH);
    sendHtml(res, 200, htmlDocument(TV_TITLE, renderHomeHtml(account)));
    return;
  }

  // アカウント設定（自分の表示名・パスワードの変更）。ログイン必須。
  if (path === "/me") {
    const account = await currentAccount(req);
    if (account === undefined) {
      return sendRedirect(res, `${LOGIN_PATH}?required=1&redirect=${encodeURIComponent("/me")}`);
    }
    sendHtml(res, 200, page("アカウント設定", serializeAccountSettings(account), "me"));
    return;
  }

  // TV（観客向け受動表示）: URL の mode 指定を既存 render モジュールへ配線して面を描画する。
  // 観客席は誰でも見られる受動面ゆえログインを要さない（操作要素を持たない）。
  if (path === "/tv") {
    sendHtml(res, 200, page(TV_TITLE, renderTvHtml(url.searchParams.get("mode")), "tv"));
    return;
  }

  // 管理面（admin 専用）。`/admin` 配下は未認証を素通りさせず、非 admin は 403 で拒む。
  if (path === "/admin" || path.startsWith("/admin/")) {
    if (guardAdminHtml(req, res, path) === "denied") return;
    if (path !== "/admin") {
      // `/admin/episodes` / `/admin/accounts` は上流で処理済み。それ以外の `/admin/*` は
      // 実体が無いゆえ、まだ無い面を捏造せず 404 を返す。
      sendHtml(res, 404, htmlDocument("Not Found", `<main><p>Not Found</p></main>`));
      return;
    }
    const account = await currentAccount(req);
    if (account === undefined) return sendRedirect(res, LOGIN_PATH);
    sendHtml(res, 200, htmlDocument("管理", renderAdminHtml(account)));
    return;
  }

  // 制御盤（司会者向け・admin 専用）: 司会者トリガー（全操作語＋個別ジャンプ）・参加者一覧領域・
  // 参加 QR を既存 ControlPanelView ビルダ＋描画で提示する。
  if (path === "/control-panel") {
    if (guardAdminHtml(req, res, path) === "denied") return;
    const joinQrSvg = await getJoinQrSvg();
    const view = buildControlPanelView({
      stage: INITIAL_STAGE,
      participants: [],
      connectedTablets: 0,
      maxTabletConnections,
      joinUrl: resolveEntryUrl(),
      joinQrSvg,
    });
    sendHtml(res, 200, page("進行制御盤", renderControlPanelHtml(view), "control_panel"));
    return;
  }

  // 解答者タブレット（入力専用最小面）。身元は Cookie セッションが持つゆえ、未ログインは
  // ログインへ誘導する。進行中の回へ参加済みなら自分の表示名・残額・受付状況を映し（AC-A6）、
  // まだ参加していない者には従来どおり受動的な最小状態（他者情報を持たない）を描く。
  if (path === "/tablet") {
    const session = currentSession(req);
    if (session === undefined) {
      return sendRedirect(res, `${LOGIN_PATH}?required=1&redirect=${encodeURIComponent("/tablet")}`);
    }
    const participantId = await resolveSessionParticipantId(episodeDeps, session.accountId);
    sendHtml(res, 200, page("解答", buildTabletFragment(participantId ?? null), "tablet"));
    return;
  }

  sendHtml(res, 404, htmlDocument("Not Found", `<main><p>Not Found</p></main>` + loginNav()));
}

const realtime = createRealtimeCore();
// PUBLIC_BASE_URL は QR（制御盤）の基底に用いる本番設定。ローカル/検証の boot と /healthz は
// これに依存してはならない（未設定でも起動して健全性を返す契約・system_design §2.11）。未設定時は
// ループバックオリジンへフォールバックする。ホスト表記は `localhost` を避け `127.0.0.1` を用いる:
// 制御盤は URL を可視リンク文字列として描画するため、`localhost` だと内部ロール識別子走査
// （/host/ が「localhost」に部分一致）で誤検出を招く（§2.8・dod_cp_no_internal_leak）。本番は
// PUBLIC_BASE_URL の実ドメインが用いられ本フォールバックは局所用途に留まる。
let publicBaseUrl: string;
try {
  publicBaseUrl = resolvePublicBaseUrl();
} catch {
  publicBaseUrl = `http://127.0.0.1:${PORT}`;
}
const maxTabletConnections = resolveMaxTabletConnections();
/** Cookie の `Secure` 属性は https 配信時のみ付ける（http のローカル試遊で Cookie を落とさない）。 */
const cookieSecure = isSecureOrigin(publicBaseUrl);

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
  joinUrl: resolveEntryUrl(),
  joinQrSvg: joinQrSvgCache,
  maxTabletConnections,
  connectedTablets,
}));

// 初期管理者の投入（殿裁可 案i・env 由来・冪等）。資格情報は env からのみ入り、平文は保存も
// 記録もされない。未構成なら何もせず起動を続ける（初期投入前でも /healthz は 200 を返す）。
void seedInitialAdminFromEnv(accountStore)
  .then((outcome) => {
    process.stdout.write(`[save-money-switcher] initial admin seed: ${outcome.status}\n`);
  })
  .catch((err: unknown) => {
    // 設定誤り（弱いパスワード等）は起動を止めず、理由だけを記録する（平文は載せない）。
    const name = err instanceof Error ? err.name : "UnknownError";
    process.stdout.write(`[save-money-switcher] initial admin seed failed: ${name}\n`);
  });

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
