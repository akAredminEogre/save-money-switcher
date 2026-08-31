// @generated-by: codd implement
// @generated-from: docs/design/system_design.md (design:system-design)
// @design-node: docs/design/system_design.md
// @output-paths: src, tests
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

/**
 * ホスト限定トリガー認可 ── ロール判定の**単一の決定点**（`module:participants` / INV-5）。
 *
 * system_design §2.5 / §2.10（不変条件 INV-5）と decision_records 論点7 で確定した
 * release-blocking な権限境界を具体化する:
 *   締切（lock）・開示（open）・正解発表（reveal）・得点精算（settle）・取消（undo）——
 *   ならびに問題読込（load）・ライブ編集（edit）・TV モード切替（switch）—— の各コマンドは
 *   **`role: host` セッションのみ**が発動でき、`role: contestant`（解答者タブレット）・
 *   `role: audience`（観客）・副司会など非 host からの発動はサーバ側で拒否する
 *   （認証済みだが権限のないロール = **403**、セッション未確立・不正ロール = **401**）。
 *
 * 「ロール判定はセッションのロール属性を単一の判定点とする」（§2.5）に従い、本モジュールが
 * その唯一の判定点となる。各コマンドハンドラはロールチェックを再実装せず {@link requireHost}
 * を経由し、返る {@link HostSession} を以降の処理の前提とする。UI（非 host サーフェス）は
 * {@link isHostOnlyTrigger} を参照して該当操作要素の露出可否を決める。
 *
 * ネットワーク越しに偽装されうるセッション値を信頼しないため、入力を `unknown` として厳格に
 * 検査する（サーバ側最終防衛）。`src/participants/` の認可判定をリーフに保つため他モジュールへ
 * 依存しない。可視ラベルは「司会者」を用い、内部ロール識別子（host/contestant/audience）は
 * エラーメッセージへ露出させない（監査用途で {@link ForbiddenRoleError.role} にのみ保持）。
 */

/** ロールの宣言集合（内部識別子）。可視ラベルへの写像は本モジュールの責務外。 */
export const ROLES = ["host", "contestant", "audience"] as const;

/** アクセス・ルーティング判断に用いるロール。`participants` 等のセッション属性と一致する。 */
export type Role = (typeof ROLES)[number];

/** 司会者（制御盤）ロールの内部識別子。認可の唯一の許可対象。 */
export const HOST_ROLE: Role = "host";

/** 認可判定の入力となるセッション。判定材料は {@link Session.role} のみ。 */
export interface Session {
  /** セッションのロール（単一の判定点）。 */
  readonly role: Role;
  /** 参加者識別子（解答者のみ持つ。監査・突合用の任意フィールド）。 */
  readonly participantId?: number;
  /** WebSocket 接続識別子（任意フィールド）。 */
  readonly connectionId?: string;
}

/** 認可を通過した司会者セッション（`role` が "host" に絞られた {@link Session}）。 */
export type HostSession = Session & { readonly role: "host" };

/**
 * ホスト限定トリガーの登録簿。operation_flow の `forbidden_actors: [contestant]` および
 * host アクター指定（VB-22/23・VB-67・VB-72・VB-74・VB-75）に一致する。非 host UI は本集合に
 * 属する操作要素を置かず、サーバはこれらを {@link requireHost} で門番する。
 */
export const HOST_ONLY_TRIGGERS = [
  "lock",
  "open",
  "reveal",
  "settle",
  "undo",
  "load",
  "edit",
  "switch",
] as const;

/** ホスト限定トリガーの識別子。 */
export type HostOnlyTrigger = (typeof HOST_ONLY_TRIGGERS)[number];

/** 認可拒否時の HTTP ステータス。未認証=401 / 権限不足=403 の二値のみ。 */
export type AuthorizationStatus = 401 | 403;

/** セッション未確立・不正ロールに割り当てるステータス（未認証）。 */
export const HTTP_UNAUTHENTICATED = 401 as const;

/** 認証済みだが host でないロールに割り当てるステータス（権限不足）。 */
export const HTTP_FORBIDDEN = 403 as const;

/**
 * 認可拒否を表すエラーの基底。ハンドラは {@link AuthorizationError.status} を応答ステータスへ
 * 写像する（401/403 を業務ステータスとして返し、5xx にしない）。
 */
export class AuthorizationError extends Error {
  /** ハンドラが応答へ写像するステータス（401 または 403）。 */
  readonly status: AuthorizationStatus;

  constructor(message: string, status: AuthorizationStatus) {
    super(message);
    this.name = "AuthorizationError";
    this.status = status;
  }
}

/**
 * セッションが確立していない、またはロールが正当な {@link Role} として解釈できないための拒否
 * （**401**）。UI を迂回した偽装ペイロード（ロール欠落・型不整合・未知ロール）を含む。
 */
export class UnauthenticatedError extends AuthorizationError {
  constructor() {
    super("認証されていないセッションではこの操作を発動できません。", HTTP_UNAUTHENTICATED);
    this.name = "UnauthenticatedError";
  }
}

/**
 * 認証済みだが host でないロール（解答者・観客・副司会）による発動の拒否（**403**）。
 * 拒否したロールの内部識別子を {@link ForbiddenRoleError.role} に保持し監査に供する
 * （メッセージには可視ラベル「司会者」のみを用い内部識別子を露出しない）。
 */
export class ForbiddenRoleError extends AuthorizationError {
  /** 拒否された非 host ロールの内部識別子（監査用。応答本文へは載せない）。 */
  readonly role: Role;

  constructor(role: Role) {
    super("この操作は司会者のみが発動できます。", HTTP_FORBIDDEN);
    this.name = "ForbiddenRoleError";
    this.role = role;
  }
}

/** 任意の値が正当な {@link Role} 文字列かを判定する型ガード（大小文字・型を厳格に扱う）。 */
export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** 任意の値がホスト限定トリガーかを判定する型ガード（非 host UI の露出可否判断に用いる）。 */
export function isHostOnlyTrigger(value: unknown): value is HostOnlyTrigger {
  return (
    typeof value === "string" &&
    (HOST_ONLY_TRIGGERS as readonly string[]).includes(value)
  );
}

/**
 * セッション（`unknown`）から正当なロールのみを取り出す。オブジェクトでない・`role` が欠落
 * ・{@link Role} でない場合は `undefined`（＝認証未確立扱い）。偽装値を素通しさせない。
 */
function extractRole(session: unknown): Role | undefined {
  if (session === null || typeof session !== "object") {
    return undefined;
  }
  const role = (session as { readonly role?: unknown }).role;
  return isRole(role) ? role : undefined;
}

/** セッションが司会者セッションかを判定する型ガード（判定の唯一の基準は {@link extractRole}）。 */
export function isHostSession(session: unknown): session is HostSession {
  return extractRole(session) === HOST_ROLE;
}

/**
 * ロール判定の単一の決定点。host セッションのみ認可して {@link HostSession} を返し、それ以外は
 * 拒否する。締切・開示・正解発表・得点精算・取消（および読込・編集・モード切替）の各ハンドラは
 * ロールチェックを再実装せず本関数を経由する。
 *
 * - セッション未確立（`null`/`undefined`/非オブジェクト）・不正ロール → {@link UnauthenticatedError}（401）
 * - 認証済みだが非 host（contestant/audience 等） → {@link ForbiddenRoleError}（403）
 *
 * @throws {UnauthenticatedError} 認証が確立していない場合（401）。
 * @throws {ForbiddenRoleError} host でないロールが発動しようとした場合（403）。
 */
export function requireHost(session: unknown): HostSession {
  const role = extractRole(session);
  if (role === undefined) {
    throw new UnauthenticatedError();
  }
  if (role !== HOST_ROLE) {
    throw new ForbiddenRoleError(role);
  }
  return session as HostSession;
}

/**
 * 認可の結果。認可されたトリガーと host セッションを対にして返し、ハンドラの監査ログや後続処理へ
 * 引き渡せるようにする。
 */
export interface AuthorizationDecision {
  /** 認可されたホスト限定トリガー。 */
  readonly trigger: HostOnlyTrigger;
  /** 認可を通過した司会者セッション。 */
  readonly session: HostSession;
}

/**
 * ホスト限定トリガーの発動を認可する。認可は {@link requireHost} の単一決定点を経由し、通過すれば
 * 発動対象トリガーと host セッションを含む {@link AuthorizationDecision} を返す。非 host・未認証は
 * {@link requireHost} と同一の 403/401 で拒否する。
 *
 * @throws {UnauthenticatedError} 認証が確立していない場合（401）。
 * @throws {ForbiddenRoleError} host でないロールが発動しようとした場合（403）。
 */
export function authorizeTrigger(
  session: unknown,
  trigger: HostOnlyTrigger,
): AuthorizationDecision {
  const host = requireHost(session);
  return { trigger, session: host };
}
