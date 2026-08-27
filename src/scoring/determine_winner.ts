// @generated-by: codd implement
// @generated-from: docs/design/system_design.md (design:system-design)
// @design-node: docs/design/system_design.md
// @output-paths: src, tests
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

/**
 * 勝者判定（`module:scoring`）── 全問通算の残額（`balances`）から、残額最多の
 * プレイヤーを e モードの勝者として選ぶ純関数群。
 *
 * decision_records B/C（先渡し 10,000 円・1 ゲーム 10 問・残額最多勝ち）と
 * scoring_engine_design §2.10（op_determine_winner）・system_design §2.6 で確定した
 * release-blocking ルール「全 10 問終了時、残額最多のプレイヤーが勝ち」（SC-1 の残額
 * 最多勝ち）を具体化する。判定材料は全問通算の `balances.amount`（円・整数）だけで
 * あり、これ以外の優先順位（参加順・氏名順・問題別成績・端末番号など）を**発明しない**
 * （F-06：同点タイブレークは確定要件に無く発明しない）。残額が同点なら該当する全員を
 * 共同首位（co-leader）として返す（VB-76）。
 *
 * 本モジュールは残額を「比較」するのみで、残額の算出（aggregate_balance / balances）や
 * 金額の書式化（currency）は行わない。TV(e) はここが返す勝者集合を**読み取り専用**で
 * 用い、勝者を判別可能に提示する（表示側で最多残額を再計算しない）。`src/scoring/` を
 * リーフに保つため他モジュールへ依存しない。
 */

/**
 * 1 プレイヤーの全問通算残額（勝者判定の入力）。DB `balances` の 1 行
 * （`participant_id` / `amount`）に対応する不変値。
 */
export interface ParticipantBalance {
  /**
   * 対象プレイヤーの識別子（`balances.participant_id` に対応）。勝者判定は `amount` のみを
   * 比較するため識別子の実型には依存せず、供給元に応じ文字列（`participants.id`）・数値の
   * どちらも受ける（`determineWinners` は総称型で各呼び出し元の具体型を保つ）。
   */
  readonly participantId: string | number;
  /**
   * 全問通算の現在残額（円・整数。初期 10,000 円）。確定要件に残額の下限・脱落は
   * 無い（F-01）ため、負値もそのまま比較対象とする。
   */
  readonly amount: number;
}

/**
 * 残額最多のプレイヤー（勝者）を返す。
 *
 * `amount` が最大の要素をすべて返す。最大が単独なら 1 要素、同点の共同首位が複数なら
 * 該当全員を**入力順のまま**返す（同点の優先順位を発明しない・VB-76 / F-06）。入力が
 * 空なら勝者は存在せず空配列を返す。入力配列は変更せず、要素の参照はそのまま保つ。
 *
 * 入力要素の追加フィールド（氏名など）は返り値へそのまま保たれる（`amount` のみ参照）。
 */
export function determineWinners<TBalance extends ParticipantBalance>(
  balances: readonly TBalance[],
): TBalance[] {
  // 空入力では最大値が -Infinity のままとなり、どの残額とも一致しないため空配列を返す。
  const topAmount = balances.reduce(
    (max, balance) => (balance.amount > max ? balance.amount : max),
    Number.NEGATIVE_INFINITY,
  );
  return balances.filter((balance) => balance.amount === topAmount);
}

/**
 * 指定プレイヤーが当該残額集合の勝者（残額最多）に含まれるかを返す。
 *
 * TV(e) が各行を勝者として判別可能に描画する際の単一判定点であり、表示側が最多残額を
 * 再計算しないための入口。該当プレイヤーの残額が入力に無い場合は `false`。
 */
export function isWinningParticipant(
  participantId: ParticipantBalance["participantId"],
  balances: readonly ParticipantBalance[],
): boolean {
  return determineWinners(balances).some(
    (winner) => winner.participantId === participantId,
  );
}
