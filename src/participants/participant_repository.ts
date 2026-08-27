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
 * 参加者レコードの永続化と参加者一覧の読み戻し（`module:participants` / `participants` テーブル）。
 *
 * participation_connection_design §2.2 / §2.3 が本モジュールへ委ねた責務を具体化する:
 *   - {@link insertParticipant}: 参加確定で生成された参加者レコードを `participants` テーブルへ
 *     永続化する（op_join_game の durable_state）。
 *   - {@link listParticipants}: 制御盤の参加者一覧と TV(e) 全問通算一覧が消費する参加者一覧を
 *     参加順（`joined_at` 昇順）で読み戻す（op_join_game の readback）。
 *
 * **物理 DB 設計は design:data-model-design に委ねられる**（§2.3 冒頭）。ゆえに本モジュールは具体的な
 * DB ドライバへ直接依存せず、外部永続化層が実装する {@link ParticipantStore} 境界へバインドする。
 * 本モジュールが所有するのは「行 ⇄ ドメイン型の写像」「1 人 = 1 台を担保する `connection_id`
 * 一意性の受入判定」「参加順の一覧読み戻し」であり、生の行 I/O（INSERT / SELECT）は
 * {@link ParticipantStore} の実装（data-model-design のアダプタ）が担う。
 *
 * release-blocking 制約（PC-INV-1 / 論点9改）:
 *   - **1 人 = 1 台**（dod_join_one_device）: 参加確定 1 回につき `participants` へ 1 レコードのみを
 *     生成し、`connection_id` により 1 台へ紐付ける。同一 `connection_id` での二重登録は
 *     {@link DuplicateConnectionError} で拒否する。氏名は一意キーではないため、同名の別人は
 *     `connection_id` が異なれば別レコードとして共に登録される（§2.3・§2.4.2）。
 *   - **端末番号の固定割当・事前氏名台帳を持たない**（dod_join_no_seat_fixed）: 永続する列は
 *     `id` / `name` / `joined_at` / `connection_id` の 4 列のみ（{@link ParticipantRow}）であり、
 *     座席番号・端末番号・事前登録台帳を表す列を一切設けない。この列構成そのものが PC-INV-1 の
 *     構造的担保である。
 *
 * DB カラムは snake_case（`joined_at` / `connection_id`）、ドメイン型 {@link Participant} の
 * フィールドは camelCase（`joinedAt` / `connectionId`）で対応し、本モジュールが両者を写像する。
 */

import type { Participant } from "./participant.js";

export type { Participant } from "./participant.js";

/**
 * `participants` テーブルの 1 行（DB カラムは snake_case）。外部永続化層
 * （design:data-model-design のアダプタ）との受け渡し表現であり、`id` / `name` / `joined_at` /
 * `connection_id` の 4 列だけを持つ。端末番号・座席番号・事前氏名台帳の列を型として持たないことが
 * PC-INV-1（端末番号固定割当・事前氏名台帳の不採用）の構造的担保である。
 */
export interface ParticipantRow {
  /** 参加者の安定識別子（`participants.id`・主キー）。 */
  readonly id: string;
  /** 参加者が自己入力した氏名（`participants.name`）。氏名は一意キーではない。 */
  readonly name: string;
  /** 参加確定時刻（`participants.joined_at`・ISO-8601 文字列）。 */
  readonly joined_at: string;
  /** 1 人 = 1 台の現行紐付け（`participants.connection_id`・一意）。 */
  readonly connection_id: string;
}

/**
 * 参加者行の外部永続化境界。design:data-model-design の物理 DB アダプタが実装し、本リポジトリは
 * これへバインドする（§2.3・物理設計の委譲）。境界は生の行 I/O のみを持ち、行 ⇄ ドメイン型の写像・
 * 一意判定・並び順といった業務ロジックは本リポジトリ側が所有する。
 */
export interface ParticipantStore {
  /**
   * `connection_id` がまだ存在しない場合に限り 1 行を **原子的に** 挿入する。挿入できたら `true`、
   * 同一 `connection_id` の行が既に存在し挿入しなかった場合は `false` を返す（1 人 = 1 台の一意制約・
   * dod_join_one_device）。事前照会と挿入の競合（TOCTOU）を避けるため、原子的な insert-if-absent
   * （例: `INSERT ... ON CONFLICT (connection_id) DO NOTHING` の affected-row 判定）として実装する。
   * `id`（主キー）の一意性は本境界の実装（DB 制約）が担う。
   */
  insertIfConnectionAbsent(row: ParticipantRow): Promise<boolean>;

  /**
   * 全参加者行を `joined_at` 昇順（参加順）で返す。制御盤の参加者一覧と TV(e) 全問通算一覧が消費する
   * 読み出しモデルの供給源。
   */
  listParticipantsOrderedByJoinedAt(): Promise<readonly ParticipantRow[]>;
}

/**
 * 同一 `connection_id` への二重の参加者登録を拒否したことを表すエラー（dod_join_one_device）。
 *
 * 1 人 = 1 台の紐付けを破る 2 レコード目の挿入を防ぐ。呼び出し側（登録フロー）はこの拒否を
 * 業務的に扱い、健全性ベースライン（全 HTTP 応答 < 500）を保ったまま参加不成立へ写像する。
 */
export class DuplicateConnectionError extends Error {
  /** 二重登録を拒否した接続識別子。 */
  readonly connectionId: string;

  constructor(connectionId: string) {
    super(
      `connection_id ${JSON.stringify(connectionId)} には既に参加者が紐付いているため、` +
        `新たな参加者レコードを登録できません（1 人 = 1 台）。`,
    );
    this.name = "DuplicateConnectionError";
    this.connectionId = connectionId;
  }
}

/**
 * 永続化しようとした参加者レコードの構造キー（`id` / `connectionId`）が空であることを表すエラー。
 *
 * `id` は参加者の安定識別子（identity・再接続の再バインド先）、`connectionId` は 1 人 = 1 台の
 * 紐付けキーであり、いずれも非空でなければ identity と紐付けが成立しない。氏名の妥当性検証
 * （非空・上限長超過の拒否）は登録フローの氏名バリデータ・サーバ・DB 制約が担う別責務であり、本
 * ガードはそれを代替しない（永続化層自身のキー整合の最終防衛）。
 */
export class InvalidParticipantRecordError extends Error {
  /** 空だった構造キーのフィールド名。 */
  readonly field: "id" | "connectionId";

  constructor(field: "id" | "connectionId") {
    super(`参加者レコードの ${field} は非空でなければなりません。`);
    this.name = "InvalidParticipantRecordError";
    this.field = field;
  }
}

/** ドメイン型 {@link Participant}（camelCase）を DB 行 {@link ParticipantRow}（snake_case）へ写像する。 */
function toRow(participant: Participant): ParticipantRow {
  return {
    id: participant.id,
    name: participant.name,
    joined_at: participant.joinedAt,
    connection_id: participant.connectionId,
  };
}

/** DB 行 {@link ParticipantRow}（snake_case）をドメイン型 {@link Participant}（camelCase）へ写像する。 */
function toParticipant(row: ParticipantRow): Participant {
  return {
    id: row.id,
    name: row.name,
    joinedAt: row.joined_at,
    connectionId: row.connection_id,
  };
}

/**
 * 永続化前に構造キー（`id` / `connectionId`）が非空であることを確認する。空の `connectionId` は
 * 1 人 = 1 台の一意判定を破り、空の `id` は identity を破るため、いずれも挿入前に拒否する。
 */
function assertPersistable(participant: Participant): void {
  if (participant.id.trim() === "") {
    throw new InvalidParticipantRecordError("id");
  }
  if (participant.connectionId.trim() === "") {
    throw new InvalidParticipantRecordError("connectionId");
  }
}

/**
 * 参加者レコードを `participants` テーブルへ永続化する（op_join_game の durable_state）。
 *
 * 与えられた {@link Participant} を 1 行だけ挿入し、挿入した参加者をそのまま返す。既に同一
 * `connection_id` を持つ参加者が存在する場合は {@link DuplicateConnectionError} を送出して 2
 * レコード目の生成を拒否する（1 人 = 1 台・dod_join_one_device）。挿入判定は {@link ParticipantStore}
 * の原子的 insert-if-absent へ委ね、事前照会と挿入の競合を避ける。
 *
 * 物理 DB へは注入された `store` を通じて到達する（§2.3・物理設計の委譲）。氏名は一意キーではないため、
 * 氏名が同じでも `connectionId` が異なれば別レコードとして受理される。
 *
 * @param store 参加者行の外部永続化境界（data-model-design のアダプタ）。
 * @param participant 登録する参加者（氏名は登録フローで検証済み・connection_id へ紐付く）。
 * @returns 永続化した参加者。
 * @throws {InvalidParticipantRecordError} `id` または `connectionId` が空の場合。
 * @throws {DuplicateConnectionError} 同一 `connection_id` の参加者が既に存在する場合。
 */
export async function insertParticipant(
  store: ParticipantStore,
  participant: Participant,
): Promise<Participant> {
  assertPersistable(participant);
  const inserted = await store.insertIfConnectionAbsent(toRow(participant));
  if (!inserted) {
    throw new DuplicateConnectionError(participant.connectionId);
  }
  return participant;
}

/**
 * `participants` テーブルの参加者一覧を読み戻す（op_join_game の readback）。
 *
 * 全参加者を参加順（`joined_at` 昇順）で返す。これは制御盤の参加者一覧と TV(e) 全問通算一覧が消費する
 * 読み出しモデルであり、`participant_joined` 配信後の反映先の権威となる。並び順は参加順に固定し、
 * 同時刻（同一 `joined_at`）の並びは {@link ParticipantStore} の返却順に委ねる（同名区別のための連番等の
 * 表示付記は本モジュールで発明しない・F028 の範疇）。
 *
 * @param store 参加者行の外部永続化境界（data-model-design のアダプタ）。
 * @returns 参加順のドメイン参加者一覧。
 */
export async function listParticipants(
  store: ParticipantStore,
): Promise<Participant[]> {
  const rows = await store.listParticipantsOrderedByJoinedAt();
  return rows.map(toParticipant);
}

/**
 * 特定の {@link ParticipantStore} にバインドした参加者リポジトリ。{@link insertParticipant} /
 * {@link listParticipants} を、都度 `store` を渡さずに呼べるファサードとして提供する。
 */
export interface ParticipantRepository {
  /** {@link insertParticipant} をバインド済みの `store` に対して実行する。 */
  insertParticipant(participant: Participant): Promise<Participant>;
  /** {@link listParticipants} をバインド済みの `store` に対して実行する。 */
  listParticipants(): Promise<Participant[]>;
}

/**
 * 与えられた {@link ParticipantStore} にバインドした {@link ParticipantRepository} を組み立てる。
 * アプリ合成点で外部永続化アダプタを 1 度だけ束ね、以後は `store` を意識せず永続化・読み戻しを行える。
 */
export function createParticipantRepository(
  store: ParticipantStore,
): ParticipantRepository {
  return {
    insertParticipant: (participant: Participant): Promise<Participant> =>
      insertParticipant(store, participant),
    listParticipants: (): Promise<Participant[]> => listParticipants(store),
  };
}
