// @generated-by: codd implement
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @design-node: docs/design/data_model_design.md
// @output-paths: src, tests
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

/**
 * 参加者（`participants` テーブル）のドメイン型。
 *
 * data_model_design §2.3 が定める「当日その場参加」の永続構造を型で固定する。参加者は
 * 制御盤に表示された参加用クラウド URL の QR をタブレットで読み取り、`/join` へ接続して
 * 氏名を自己入力し参加確定する（op_join_game）。恒久的な事前氏名台帳や座席（端末番号）の
 * 固定割当は持たず、参加は `connectionId` の一意性のみで 1 人 = 1 台を担保する
 * （AC-07 / dod_join_no_seat_fixed / dod_join_one_device）。ゆえに本型は端末番号・座席番号・
 * 事前登録台帳を表すフィールドを一切持たない。
 *
 * DB カラムは snake_case（`joined_at` / `connection_id`）、本ドメイン型のフィールドは
 * camelCase（`joinedAt` / `connectionId`）で対応する。
 */
export interface Participant {
  /** 参加者識別子（`participants.id`・主キー）。 */
  id: string;

  /**
   * 参加者が自己入力した氏名（`participants.name`）。
   *
   * 空文字・空白のみは参加確定を許さない（非空）。氏名の妥当性検証（非空・上限長超過の拒否）は
   * 登録フローの氏名バリデータ（`isValidDisplayName`）とサーバ、および DB 制約が担う別責務であり、
   * 本型はその検証を通過した氏名を保持する。「端末 1」「席番号」等の内部割当ラベルへ置換せず、
   * 入力された氏名をそのまま保持・提示する。
   */
  name: string;

  /** 参加確定時刻（`participants.joined_at`）。ISO-8601 文字列で保持する。 */
  joinedAt: string;

  /**
   * 参加者の接続識別子（`participants.connection_id`）。
   *
   * 一意制約により 1 人 = 1 台を担保する（同一 `connectionId` で複数レコードを作らない）。
   * 端末番号の固定割当を用いず、この接続識別子が人と端末の 1:1 紐付けを表す唯一の担保である。
   */
  connectionId: string;
}
