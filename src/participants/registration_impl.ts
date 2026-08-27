// @generated-by: codd implement
// @generated-from: docs/design/participation_connection_design.md (design:participation-connection-design)
// @design-node: docs/design/participation_connection_design.md
// @output-paths: src, tests
// @generated-from: docs/design/realtime_sync_design.md (design:realtime-sync-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

/**
 * 参加確定時の参加者レコード生成（`module:participants`・PC-INV-1 / op_join_game）— 実装本体。
 *
 * participation_connection_design §2.2 / §2.4.2 / §2.8 が本モジュールへ委ねた「受入成立時の参加者
 * レコード生成」を具体化する。家族限定アクセス → 氏名検証 → 上限判定 の順に受入が成立した参加確定
 * 1 回につき、{@link registerParticipant} が `participants` へ **1 人 1 レコード**を生成し `connection_id`
 * へ紐付ける（dod_join_self_name / dod_join_one_device）。公開ファサードは
 * `src/participants/registration.ts` であり、本 impl を re-export する（設計 §2.2 の委譲例に従う）。
 *
 * release-blocking 制約:
 *   - **1 人 = 1 台**（dod_join_one_device）: 参加確定 1 回につき生成する participants レコードは
 *     1 件のみで、`connection_id` により 1 台へ紐付く。同一 `connection_id` への 2 件目は
 *     {@link ParticipantStore} の原子的 insert-if-absent が拒否し {@link insertParticipant} が
 *     `DuplicateConnectionError` を送出する（重複行を作らない）。
 *   - **サーバ側最終防衛**（§2.8 / dod_join_name_validation）: /join UI が氏名検証を通していても、
 *     UI を迂回した不正入力（空・空白のみ・上限長超過）を **サーバ側でも** {@link isValidDisplayName}
 *     で再検証し、insertParticipant へ渡す前に {@link InvalidDisplayNameError} で拒否する。ゆえに
 *     不正氏名は participants へ 1 行も入らない。
 *   - **端末番号の固定割当・事前氏名台帳を持たない**（dod_join_no_seat_fixed）: 生成するレコードは
 *     `id` / `name`（自己入力）/ `joinedAt` / `connectionId` のみで、座席番号・端末番号を表す
 *     フィールドを持たない（型 {@link Participant} が構造的に保証する）。
 *
 * 氏名は一意キーではない（同名の別人を許容・§2.3）。`connection_id` が異なれば同名でも別レコードと
 * して共に永続する。参加者識別子 `id` は再接続（realtime_sync の resume）の再バインド先となる安定
 * identity であり、参加確定ごとに新規採番する。`joinedAt` は ISO-8601 文字列で記録する。
 *
 * 受入判定（アクセス制御・氏名・上限）を順に束ねる /join オーケストレーションは
 * `design:realtime-sync-design` が所有する消費者であり（§1.1 責務境界）、本モジュールは受入成立後の
 * 「永続化の producer」に閉じる。物理 DB へは注入された {@link ParticipantStore}（data-model-design の
 * アダプタ）を通じて到達する。
 */

import { randomUUID } from "node:crypto";
import type { Participant } from "./participant.js";
import { isValidDisplayName } from "./name.js";
import {
  insertParticipant,
  type ParticipantStore,
} from "./participant_repository.js";

/**
 * サーバ側最終防衛で自己入力氏名が無効（空・空白のみ・上限長超過）と判定されたことを表すエラー。
 *
 * /join UI の氏名検証を迂回した不正入力を {@link insertParticipant} へ渡す前に拒否したことを示す。
 * 呼び出し側（/join オーケストレーション）はこの拒否を業務的に扱い、健全性ベースライン（全 HTTP
 * 応答 < 500）を保ったまま参加不成立へ写像する。拒否した生の氏名を {@link rawName} に保持して監査
 * 可能にする（`instanceof Error` / `instanceof InvalidDisplayNameError` のいずれも真となる）。
 */
export class InvalidDisplayNameError extends Error {
  /** 拒否された生の自己入力氏名。 */
  readonly rawName: string;

  constructor(rawName: string) {
    super(
      `自己入力氏名が有効ではありません（空・空白のみ・上限長超過）: ${JSON.stringify(rawName)}`,
    );
    this.name = "InvalidDisplayNameError";
    this.rawName = rawName;
  }
}

/**
 * 参加確定 1 回分の登録入力。受入判定（アクセス制御・氏名・上限）を通過した参加を、自己入力氏名と
 * 紐付ける 1 台の接続識別子で表す。`id` / `joinedAt` は本 producer が採番・記録するため入力に含めない。
 */
export interface RegisterParticipantInput {
  /** 解答者が /join で自己入力した氏名。 */
  readonly name: string;
  /** この参加者を紐付ける 1 台の接続識別子（realtime_sync のセッション由来）。 */
  readonly connectionId: string;
}

/**
 * {@link registerParticipant} の生成器の注入口。既定は Node 標準の `randomUUID` と実時刻であり、
 * テスト・呼び出し側が決定的な id / 時刻を注入して永続結果を固定できる（`src/` を単一実装点に保つ）。
 */
export interface RegisterParticipantDeps {
  /** 参加者識別子（`participants.id`）の採番器（既定は `randomUUID`）。 */
  readonly generateId?: () => string;
  /** 参加確定時刻の時計（既定は `() => new Date()`）。返した Date を ISO-8601 で記録する。 */
  readonly now?: () => Date;
}

/**
 * 受入成立した参加確定を `participants` へ 1 レコードとして永続化する（op_join_game の durable producer）。
 *
 * サーバ側最終防衛として {@link isValidDisplayName} を再適用し、無効な氏名は insertParticipant へ渡す
 * 前に {@link InvalidDisplayNameError} で拒否する（participants に入らない）。有効なら参加者識別子 `id`
 * を採番し、参加確定時刻 `joinedAt` を ISO-8601 で記録し、`connectionId` へ紐付けた **1 レコードのみ**を
 * {@link insertParticipant} で永続化して返す。同一 `connection_id` の 2 件目は insertParticipant が
 * `DuplicateConnectionError` を送出し 1 人 = 1 台を保つ。氏名は一意キーではないため、氏名が同じでも
 * `connectionId` が異なれば別レコードとして受理される。
 *
 * @param store 参加者行の外部永続化境界（data-model-design の物理アダプタ）。
 * @param input 自己入力氏名と紐付ける接続識別子。
 * @param deps id 採番器・時計の注入（省略時は `randomUUID` と実時刻）。
 * @returns 永続化した参加者。
 * @throws {InvalidDisplayNameError} 氏名が空・空白のみ・上限長超過の場合（サーバ側最終防衛）。
 */
export async function registerParticipant(
  store: ParticipantStore,
  input: RegisterParticipantInput,
  deps: RegisterParticipantDeps = {},
): Promise<Participant> {
  // サーバ側最終防衛：UI を迂回した不正氏名を insertParticipant の手前で拒否する。
  if (!isValidDisplayName(input.name)) {
    throw new InvalidDisplayNameError(input.name);
  }

  const generateId = deps.generateId ?? ((): string => randomUUID());
  const now = deps.now ?? ((): Date => new Date());

  const participant: Participant = {
    id: generateId(),
    name: input.name,
    joinedAt: now().toISOString(),
    connectionId: input.connectionId,
  };

  // 参加確定 1 回につき 1 レコードのみを connection_id 紐付きで永続化する（1 人 = 1 台）。
  return insertParticipant(store, participant);
}
