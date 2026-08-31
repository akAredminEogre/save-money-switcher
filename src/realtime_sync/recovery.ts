// @generated-by: codd implement
// @generated-from: docs/design/realtime_sync_design.md (design:realtime-sync-design)
// @design-node: docs/design/realtime_sync_design.md
// @output-paths: src, tests
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

/**
 * 再接続復帰スナップショット構築（`module:realtime_sync` のサーバ権威 state_snapshot ビルダ）。
 *
 * realtime_sync 設計 §2.7「切断・再接続と状態整合」を具体化する純関数モジュール。回線断後に
 * 再接続した端末を、**サーバ権威**の `game_state`（現在問題番号／進行段階／TV モード）・`balances`・
 * `answers` から**ロール投影済み `state_snapshot`** へ復帰させる。端末側の保存値には一切依存せず、
 * 復帰値の唯一の出典はサーバ権威である（RS-INV-3・`dod_reconnect_server_authority`）。
 *
 * ロール投影を本モジュール自身が適用し、可視境界を構造的に強制する:
 *   - 司会者（host）は全量（全員の残額・送信済み）へ復帰する。
 *   - 解答者（contestant）は進行状態と**自分の残額・自分の送信済み**のみへ復帰し、他者の残額・
 *     送信済み・全体一覧は復帰対象に含めない（`dod_reconnect_own_balance`・他者情報の構造的除外）。
 *   - 観客（audience）は進行状態のみへ復帰する（表示内容は TV モードと以後の live 配信が駆動）。
 *
 * 本モジュールは protocol.ts の進行段階／TV モード／ロール型のみに依存するリーフである。
 */

import type { GameStage, Role, TvMode } from "./protocol.js";

/**
 * 復帰の権威となるサーバ側 `game_state` の射影。全ロール共通の進行状態出典。
 */
export interface GameStateAuthority {
  readonly currentQuestionNumber: number;
  readonly stage: GameStage;
  readonly tvMode: TvMode;
}

/**
 * 復帰スナップショット構築の判定文脈。接続確立時に確定したロールを単一判定点として参照する。
 * `participantId` は解答者の自分宛復帰（自分の残額・送信済み）に用いる不透明識別子。
 * `disclosed` は当該問の開示到達を表し、投影文脈を配信側（fanout）と揃えるために保持する。
 */
export interface RecoveryContext {
  readonly role: Role;
  readonly participantId?: string;
  readonly disclosed: boolean;
}

/**
 * 復帰値の出典となるサーバ権威データ。`balances` は participantId → 残額（円・整数）、
 * `submitted` は participantId → 受付中に送信済みかを表す（`answers` の一意行から導く）。
 */
export interface RecoveryAuthorityData {
  readonly balances: Readonly<Record<string, number>>;
  readonly submitted: Readonly<Record<string, boolean>>;
}

/**
 * ロール投影済みの復帰スナップショット（`state_snapshot` のペイロード）。進行状態は全ロール共通で
 * 担い、残額・送信済みはロール投影に応じて設定される（未設定＝当該ロールの可視範囲外）。
 *
 * - `ownBalance`/`ownSubmitted`: 解答者投影でのみ設定（自分 1 件のみ・他者は構造的に非搭載）。
 * - `balances`/`submitted`: 司会者投影でのみ設定（全員分）。解答者・観客投影では未設定。
 */
export interface StateSnapshot {
  readonly currentQuestionNumber: number;
  readonly stage: GameStage;
  readonly tvMode: TvMode;
  readonly ownBalance?: number | null;
  readonly ownSubmitted?: boolean;
  readonly balances?: Readonly<Record<string, number>>;
  readonly submitted?: Readonly<Record<string, boolean>>;
}

/**
 * サーバ権威から再接続端末のロール投影済み `state_snapshot` を再構成する。
 *
 * 復帰値はすべて引数のサーバ権威（`gameState`/`data`）から供給し、端末側保存値には依存しない。
 * 解答者へは自分の残額・送信済みのみを載せ、他者の残額・送信済み・全体一覧は構造的に除外する。
 */
export function buildSnapshot(
  gameState: GameStateAuthority,
  ctx: RecoveryContext,
  data: RecoveryAuthorityData,
): StateSnapshot {
  const progression = {
    currentQuestionNumber: gameState.currentQuestionNumber,
    stage: gameState.stage,
    tvMode: gameState.tvMode,
  };

  switch (ctx.role) {
    case "host":
      // 司会者は全進行状態・全員分の残額/送信済みへ復帰する（投影による除去なし）。
      return {
        ...progression,
        balances: { ...data.balances },
        submitted: { ...data.submitted },
      };
    case "contestant":
      // 解答者は進行状態と自分の残額・送信済みのみへ復帰する。全員分のマップは載せない。
      return {
        ...progression,
        ownBalance: ownBalanceOf(data.balances, ctx.participantId),
        ownSubmitted: ownSubmittedOf(data.submitted, ctx.participantId),
      };
    case "audience":
      // 観客は進行状態のみへ復帰する（残額・送信済み・全体一覧は搭載しない）。
      return { ...progression };
    default:
      return assertNeverRole(ctx.role);
  }
}

/**
 * サーバ権威の残額から当該参加者自身の残額のみを取り出す。識別子が無い／権威に未登録の場合は
 * `null`（0 円は不在と区別して数値 0 を保持する）。他者の残額は参照しない。
 */
function ownBalanceOf(
  balances: Readonly<Record<string, number>>,
  participantId: string | undefined,
): number | null {
  if (participantId === undefined) return null;
  const value = balances[participantId];
  return typeof value === "number" ? value : null;
}

/**
 * サーバ権威の送信済みから当該参加者自身の送信済み状態のみを取り出す。未登録は未送信（false）。
 */
function ownSubmittedOf(
  submitted: Readonly<Record<string, boolean>>,
  participantId: string | undefined,
): boolean {
  if (participantId === undefined) return false;
  return submitted[participantId] === true;
}

function assertNeverRole(role: never): never {
  throw new TypeError(
    `未知のロールはスナップショットへ投影できません: ${String(role)}`,
  );
}
