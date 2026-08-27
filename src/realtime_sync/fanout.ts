// @generated-by: codd implement
// @generated-from: docs/design/realtime_sync_design.md (design:realtime-sync-design)
// @design-node: docs/design/realtime_sync_design.md
// @output-paths: src, tests
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

/**
 * ロール投影フィルタ（`module:realtime_sync` の可視境界エンフォーサ）。
 *
 * realtime_sync 設計 §2.5 の「配信は必ずロール投影を経由し、ロールごとに可視範囲を絞った
 * ペイロードのみを送る」を、トランスポート層で強制する純関数モジュール。hub の fan-out は
 * 各接続へ push する前に必ず {@link projectForRole} を通す。
 *
 * release-blocking 不変条件（設計 RS-INV-4/5/6）:
 *   - 司会者（host）は全量を受け取る（投影なし）。
 *   - 解答者（answerer）は自分に関する情報のみ。他者の解答・残額・得点・全体一覧は一切
 *     投影しない。全員分の残額更新からは自分の 1 件だけを円建てで投影する（VB-62）。
 *   - 観客（audience）は開示（b・answers_opened）未実行の間、他者の解答を露出する
 *     イベントを受け取らない（VB-19・`dod_disclosure_hidden_before`）。開示後は受け取る。
 *
 * 本モジュールは protocol.ts の封筒・ロール語彙のみに依存するリーフである。
 */

import {
  CURRENCY,
  type Currency,
  type Role,
  type ServerEvent,
  type ServerEventType,
} from "./protocol.js";

/**
 * ロール投影の判定文脈。接続確立時に確定したロールを単一判定点として参照する（設計 §2.1）。
 * `participantId` は解答者の自分宛投影（自分の残額）に用いる不透明識別子。
 * `disclosed` は当該問が開示段階（b・answers_opened）へ到達済みかを表す。
 */
export interface ProjectionContext {
  readonly role: Role;
  readonly participantId?: string;
  readonly disclosed: boolean;
}

/** 自分の残額のみを投影した balance_updated のペイロード（円建て固定・RS-INV-6）。 */
export interface OwnBalancePayload {
  readonly balance: number;
  readonly currency: Currency;
}

/**
 * 解答者へは配信しないドメインイベント種別。いずれも他者情報または観客（TV）専用の開示面
 * （他者の解答・正解開示・全員精算表・参加者一覧）を運ぶ。解答者の可視面は自分の残額・
 * 進行段階・自分宛の ack に限る（設計 §2.5・VB-62）。
 */
const ANSWERER_WITHHELD_EVENT_TYPES: readonly ServerEventType[] = [
  "answers_opened",
  "answer_revealed",
  "settlement_computed",
  "participant_joined",
  "participant_renamed",
];

/** 他者の解答を露出するイベント種別（開示前は観客へ配信しない・VB-19）。 */
const ANSWER_DISCLOSING_EVENT_TYPES: readonly ServerEventType[] = [
  "answers_opened",
  "answer_revealed",
];

/**
 * ロール投影の単一エントリ。hub の fan-out は本関数の戻り値のみを対象接続へ push する。
 * `null` を返した接続へは当該イベントを配信しない。
 */
export function projectForRole(
  event: ServerEvent,
  ctx: ProjectionContext,
): ServerEvent | null {
  switch (ctx.role) {
    case "host":
      // 司会者（制御盤）は全進行状態・全員の解答/残額/得点を受け取る（投影なし）。
      return event;
    case "answerer":
      return projectForAnswerer(event, ctx);
    case "audience":
      return projectForAudience(event, ctx);
    default:
      return assertNeverRole(ctx.role);
  }
}

function projectForAnswerer(
  event: ServerEvent,
  ctx: ProjectionContext,
): ServerEvent | null {
  // 解答者は自分に関する情報のみ。他者の解答・残額・得点・全体一覧は常に投影外（VB-62）。
  if (event.type === "balance_updated") {
    // 全員分の残額から自分の残額 1 件のみを投影する。
    return projectOwnBalance(event, ctx.participantId);
  }
  if (ANSWERER_WITHHELD_EVENT_TYPES.includes(event.type)) {
    return null;
  }
  // 進行段階・TV モード・取消・自分宛の制御イベント等、他者情報を含まないものは通す。
  return event;
}

function projectForAudience(
  event: ServerEvent,
  ctx: ProjectionContext,
): ServerEvent | null {
  // 開示（b）未実行の間は他者の解答を露出するイベントを配信しない（VB-19）。
  if (!ctx.disclosed && ANSWER_DISCLOSING_EVENT_TYPES.includes(event.type)) {
    return null;
  }
  // 開示後は当該イベント（氏名＋解答・残額表など）を受け取る。
  return event;
}

/**
 * balance_updated（全員分の残額）から当該解答者自身の残額 1 件だけを投影する。自分の識別子が
 * 無い／当該更新に自分が含まれない場合は配信しない（null）。円建てを保持し、他者の
 * participantId・残額はペイロードにもエンベロープにも残さない（VB-62・RS-INV-6）。
 */
function projectOwnBalance(
  event: ServerEvent,
  participantId: string | undefined,
): ServerEvent<OwnBalancePayload> | null {
  if (participantId === undefined) return null;
  const payload = event.payload;
  if (typeof payload !== "object" || payload === null) return null;
  const balances = (payload as { balances?: unknown }).balances;
  if (typeof balances !== "object" || balances === null) return null;
  const ownBalance = (balances as Record<string, unknown>)[participantId];
  if (typeof ownBalance !== "number") return null;
  const projected: ServerEvent<OwnBalancePayload> = {
    ...event,
    currency: CURRENCY,
    payload: { balance: ownBalance, currency: CURRENCY },
  };
  return projected;
}

function assertNeverRole(role: never): never {
  throw new TypeError(`未知のロールは投影できません: ${String(role)}`);
}
