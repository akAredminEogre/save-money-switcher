// @generated-by: codd implement
// @generated-from: docs/detailed_design/state_machines.md (detailed_design:state-machines)
// @design-node: docs/detailed_design/state_machines.md
// @output-paths: src, tests
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @generated-from: docs/design/operational_behavior_model.md (design:operational-behavior-model)
// @generated-from: docs/design/participation_connection_design.md (design:participation-connection-design)
// @generated-from: docs/design/question_media_intake_design.md (design:question-media-intake-design)
// @generated-from: docs/design/realtime_sync_design.md (design:realtime-sync-design)
// @generated-from: docs/design/scoring_engine_design.md (design:scoring-engine-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

/**
 * ゲーム進行フェーズの状態モデル（`module:game_flow`・detailed_design:state-machines
 * §2.1 / §4.1）。
 *
 * ゲーム全体は
 *   lobby → in_progress → finished
 * の 3 フェーズをこの順序で **一方向**に進む。本モジュールはそのフェーズ
 * （{@link GamePhase}）と、問題別進行機械（Round Stage Machine・`progression.ts`）の
 * **集約ビュー**としてフェーズを導出する関数（{@link derivePhase}）の**単一所有者**
 * である（§3.1）。
 *
 * フェーズは Round Stage Machine を集約したビューであり、消費側（`src/scoring/` の
 * op_determine_winner・`src/realtime_sync/`）はこれを**読取り**に用い、フェーズ判定を
 * 再実装しない（§2.1）。`lobby → in_progress` は「第1問が accepting へ入った（出題開始）」
 * 事実から、`in_progress → finished` は「第10問が settlement_computed に到達（＝10 問すべて
 * 精算済み。op_determine_winner の前提）」から導出される。
 *
 * 本モジュールは他の実装単位へ依存しないリーフに保つ。フェーズ導出が参照する問数は
 * 採点エンジンへ依存させないため {@link QUESTION_COUNT} をここで単一宣言する
 * （game_flow は scoring を import しない・§3.1 の分界）。フェーズの文字列表現は DB の
 * `game_state.phase`（snake_case enum lobby/in_progress/finished）と一致し、そのまま
 * 永続化・復元できる。
 */

/** ゲーム全体の進行フェーズ。`game_state.phase` の値集合と一致する。 */
export type GamePhase = "lobby" | "in_progress" | "finished";

/**
 * 1 ゲームの問数（確定値・改変禁止・§2.1）。
 *
 * この問数すべての得点精算（settlement_computed 到達）が完了した時点で、フェーズは
 * finished へ導出される（op_determine_winner の前提＝10 問すべて settlement_computed）。
 * game_flow を採点エンジンへ依存させないため、本フェーズ導出が参照する問数は本モジュール
 * で単一宣言する（`src/scoring/` 側の同名定数へは依存しない）。
 */
export const QUESTION_COUNT = 10;

/**
 * 出題開始有無と精算済み問数からゲームフェーズを導出する（§2.1 / §4.1）。
 *
 * - `settledCount` が {@link QUESTION_COUNT}（10）以上 → `finished`
 *   （第10問が settlement_computed 到達＝10 問すべて精算完了。op_determine_winner）。
 * - まだ 10 問未満で、出題が開始済み（`activated` 真） → `in_progress`。
 * - 出題未開始（`activated` 偽） → `lobby`（参加受付フェーズ）。
 *
 * finished 判定は精算済み問数のみを軸とし、閾値到達時は `activated` の真偽に依らず
 * finished を返す（10 問到達が最優先）。`activated` は「第1問が accepting へ入った
 * （出題開始）」ことを表す。外部 I/O・可変状態を持たない純関数であり、同一入力には常に
 * 同一フェーズを返す。フェーズ判定はここが単一の出典であり、消費側は本関数を用いて
 * 再実装しない（§2.1・§3.1）。
 *
 * @param activated 出題が開始済み（第1問が accepting へ入った）なら真。
 * @param settledCount settlement_computed へ到達した問数。
 */
export function derivePhase(activated: boolean, settledCount: number): GamePhase {
  if (settledCount >= QUESTION_COUNT) {
    return "finished";
  }
  return activated ? "in_progress" : "lobby";
}
