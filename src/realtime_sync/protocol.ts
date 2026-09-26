// @generated-by: codd implement
// @generated-from: docs/design/realtime_sync_design.md (design:realtime-sync-design)
// @design-node: docs/design/realtime_sync_design.md
// @output-paths: src, tests
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

/**
 * リアルタイム同期メッセージプロトコル（`module:realtime_sync` のリーフ型/定数モジュール）。
 *
 * realtime_sync 設計 §2.3 が確定した、サーバ⇄クライアント間 JSON 封筒の唯一の語彙・型面を
 * 定義する。すべての producer（`hub`/`fanout`/`recovery`/`server`）と consumer（各サーフェス）が
 * 本モジュールの型・定数だけを参照して同一の封筒契約に合意する。
 *
 * 本モジュールは兄弟ユニットからのランタイム import を一切持たないリーフである（型・定数のみ）。
 * ここで固定する release-blocking 事項:
 *   - ロール（host/contestant/audience）・進行段階・TV モード・ドメインイベント種別の語彙（設計 §2.3）。
 *   - `ServerEvent<T>` 封筒は**セッション単位で単調増加する `seq`** を必ず担い、金額を伴う
 *     イベントは `currency: "円"` を固定付与する（RS-INV-6・現金感を薄めない＝ `point`/`pt`/`点` 禁止）。
 *   - 上限超過での接続拒否クローズコード `CLOSE_OVER_LIMIT = 4001`（設計 §2.6・§2.11）。
 *   - クライアント→サーバ コマンド語彙と許可ロール表。締切・開示・正解発表・精算・取消・モード切替・
 *     ライブ編集は **role host のみ**（RS-INV-4）。本表は配信投影・権限判定の共有語彙であり、
 *     実際の 401/403 拒否挙動は上位（server/authorize）の責務。
 *
 * 各語彙は `as const` タプルを単一の真実源とし、対応する型はそこから導出する（型と実行時語彙の
 * ドリフトをコンパイル時に排除する）。
 */

// ---- ロール・進行段階・TV モードの語彙（設計 §2.3） ----

/** セッションに確定するロール。配信投影と権限判定の単一判定点が参照する。 */
export const ROLES = ["host", "contestant", "audience"] as const;
export type Role = (typeof ROLES)[number];

/** 各問の進行段階（サーバ権威 `game_state.stage`）。 */
export const GAME_STAGES = [
  "accepting",
  "answers_locked",
  "answers_opened",
  "answer_revealed",
  "settlement_computed",
] as const;
export type GameStage = (typeof GAME_STAGES)[number];

/** TV の 5 モード（a 出題／b 開示／c 正解／d 精算／e 全員一覧）。 */
export const TV_MODES = ["a", "b", "c", "d", "e"] as const;
export type TvMode = (typeof TV_MODES)[number];

// ---- ドメインイベント種別と配信封筒種別（設計 §2.3/§2.4） ----

/** 状態遷移として全端末へ配信されるドメインイベント種別。 */
export const DOMAIN_EVENT_TYPES = [
  "answers_locked",
  "answers_opened",
  "answer_revealed",
  "settlement_computed",
  "trigger_undone",
  "tv_mode_changed",
  "participant_joined",
  "participant_renamed",
  "balance_updated",
] as const;
export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

/** ドメインイベント以外の制御用サーバイベント（unicast 主体）。 */
export const CONTROL_EVENT_TYPES = [
  "state_snapshot",
  "connection_rejected",
  "command_denied",
  "submit_ack",
] as const;
export type ControlEventType = (typeof CONTROL_EVENT_TYPES)[number];

/** サーバ→クライアント封筒がとり得る全 `type`（ドメイン ∪ 制御）。 */
export const SERVER_EVENT_TYPES = [
  ...DOMAIN_EVENT_TYPES,
  ...CONTROL_EVENT_TYPES,
] as const;
export type ServerEventType = (typeof SERVER_EVENT_TYPES)[number];

// ---- 通貨マーカー（RS-INV-6・円建て固定・置換禁止） ----

/** 金額の唯一の通貨表現。`point`/`pt`/`点` への置換を禁じる（現金感を薄めない）。 */
export const CURRENCY = "円" as const;
export type Currency = typeof CURRENCY;

/** 残額を運ぶ＝封筒に通貨マーカーを固定付与するイベント種別。 */
export const MONEY_BEARING_EVENT_TYPES = [
  "settlement_computed",
  "balance_updated",
] as const;
export type MoneyBearingEventType = (typeof MONEY_BEARING_EVENT_TYPES)[number];

/** 当該イベント種別が金額（残額）を運ぶかを判定する。 */
export function isMoneyBearingEvent(type: ServerEventType): boolean {
  return (MONEY_BEARING_EVENT_TYPES as readonly ServerEventType[]).includes(type);
}

// ---- ServerEvent<T> 封筒 ----

/**
 * サーバ→クライアント配信の JSON 封筒。`seq` はセッション単位で単調増加し、順序保証・重複検知・
 * 再接続整合に用いる。金額を伴うイベントは `currency: "円"` を担う（RS-INV-6）。
 */
export interface ServerEvent<T = unknown> {
  type: ServerEventType;
  /** セッション単位で単調増加する連番。 */
  seq: number;
  stage?: GameStage;
  questionNumber?: number;
  tvMode?: TvMode;
  /** 金額を含むイベントのみ付与される通貨マーカー（円建て固定）。 */
  currency?: Currency;
  payload: T;
  /** サーバ時刻(ms)。 */
  ts: number;
}

/** {@link stampServerEvent} が封筒へ仕上げる前のイベント素案。 */
export interface ServerEventDraft<T> {
  readonly type: ServerEventType;
  readonly payload: T;
  readonly stage?: GameStage;
  readonly questionNumber?: number;
  readonly tvMode?: TvMode;
  readonly ts?: number;
}

/** セッション単位の単調増加連番の発番器。 */
export interface SequenceGenerator {
  next(): number;
}

/**
 * セッション単位の `seq` 発番器を作る。`next()` は呼ぶたびに厳密に増加する連番を返す。
 *
 * @throws {RangeError} 開始値が 0 以上の安全な整数でない場合。
 */
export function createSequenceGenerator(start = 0): SequenceGenerator {
  if (!Number.isSafeInteger(start) || start < 0) {
    throw new RangeError(
      `seq の開始値は 0 以上の安全な整数でなければなりませんが、${String(start)} が与えられました。`,
    );
  }
  let current = start;
  return {
    next(): number {
      current += 1;
      return current;
    },
  };
}

/**
 * イベント素案を配信封筒へ仕上げる。`seq` を発番器から採番して単調増加を担保し、金額を伴う
 * イベント種別には `currency: "円"` を導出付与する（RS-INV-6）。金額を伴わない種別へは通貨
 * マーカーを付さない。
 */
export function stampServerEvent<T>(
  sequence: SequenceGenerator,
  draft: ServerEventDraft<T>,
  now: () => number = Date.now,
): ServerEvent<T> {
  const event: ServerEvent<T> = {
    type: draft.type,
    seq: sequence.next(),
    payload: draft.payload,
    ts: draft.ts ?? now(),
  };
  if (draft.stage !== undefined) event.stage = draft.stage;
  if (draft.questionNumber !== undefined) event.questionNumber = draft.questionNumber;
  if (draft.tvMode !== undefined) event.tvMode = draft.tvMode;
  if (isMoneyBearingEvent(draft.type)) {
    event.currency = CURRENCY;
  }
  return event;
}

// ---- クローズコード ----

/** 同時接続タブレット上限超過での接続拒否に用いるアプリ定義クローズコード（設計 §2.6/§2.11）。 */
export const CLOSE_OVER_LIMIT = 4001;

// ---- クライアント→サーバ コマンド語彙と許可ロール（設計 §2.3 表） ----

/** クライアントが送出し得るコマンド種別。 */
export const COMMAND_KINDS = [
  "join",
  "resume",
  "submit_answer",
  "lock",
  "open",
  "reveal",
  "settle",
  "undo",
  "switch_mode",
  "live_edit",
] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];

/** role host のみ発動できるコマンド（RS-INV-4・締切/開示/正解/精算/取消/モード切替/ライブ編集）。 */
export const HOST_ONLY_COMMANDS = [
  "lock",
  "open",
  "reveal",
  "settle",
  "undo",
  "switch_mode",
  "live_edit",
] as const;
export type HostOnlyCommand = (typeof HOST_ONLY_COMMANDS)[number];

/** 各コマンドが許可されるロール集合（設計 §2.3 の許可ロール表を単一語彙に固定）。 */
export const COMMAND_ALLOWED_ROLES: Readonly<Record<CommandKind, readonly Role[]>> = {
  join: ["contestant"],
  resume: ["host", "contestant", "audience"],
  submit_answer: ["contestant"],
  lock: ["host"],
  open: ["host"],
  reveal: ["host"],
  settle: ["host"],
  undo: ["host"],
  switch_mode: ["host"],
  live_edit: ["host"],
};

/** クライアント→サーバ コマンドの封筒。`resumeToken` は resume コマンドのみが提示する。 */
export interface ClientCommand<T = unknown> {
  kind: CommandKind;
  payload?: T;
  resumeToken?: string;
}

/** 当該コマンドが role host のみ発動できるかを判定する。 */
export function isHostOnlyCommand(kind: CommandKind): kind is HostOnlyCommand {
  return (HOST_ONLY_COMMANDS as readonly CommandKind[]).includes(kind);
}

/** 当該コマンドが許可されるロール集合を返す。 */
export function allowedRolesForCommand(kind: CommandKind): readonly Role[] {
  return COMMAND_ALLOWED_ROLES[kind];
}

/** 当該コマンドを当該ロールが発動できるかを判定する。 */
export function isCommandAllowedForRole(kind: CommandKind, role: Role): boolean {
  return COMMAND_ALLOWED_ROLES[kind].includes(role);
}

// ---- 型ガード（受信メッセージの語彙検証） ----

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
export function isGameStage(value: unknown): value is GameStage {
  return typeof value === "string" && (GAME_STAGES as readonly string[]).includes(value);
}
export function isTvMode(value: unknown): value is TvMode {
  return typeof value === "string" && (TV_MODES as readonly string[]).includes(value);
}
export function isDomainEventType(value: unknown): value is DomainEventType {
  return (
    typeof value === "string" && (DOMAIN_EVENT_TYPES as readonly string[]).includes(value)
  );
}
export function isServerEventType(value: unknown): value is ServerEventType {
  return (
    typeof value === "string" && (SERVER_EVENT_TYPES as readonly string[]).includes(value)
  );
}
export function isCommandKind(value: unknown): value is CommandKind {
  return typeof value === "string" && (COMMAND_KINDS as readonly string[]).includes(value);
}
