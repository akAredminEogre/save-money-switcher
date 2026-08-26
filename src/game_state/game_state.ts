// @generated-by: codd implement
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @design-node: docs/design/data_model_design.md
// @output-paths: src, tests
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

/**
 * セッション横断の進行ポインタ（`game_state` シングルトン）のドメイン型。
 *
 * データモデル設計 §2.5 の正規化に従い、ゲーム全体で 1 行だけ存在する
 * セッションポインタ（現在問題番号・TV モード・フェーズ）を表す。各問（ラウンド）
 * ごとの到達段階 `stage`（`accepting`〜`settlement_computed`）は別テーブル `rounds`
 * と `src/game_state/progression.ts` の `Round` が保持する責務であり、本型はそれと
 * 分離した「セッション単位」のポインタのみを担う。
 *
 * 上位設計（system_design §2.3）が `game_state.stage` として概念記述した各問の進行段階は
 * `rounds.stage` へ正規化済みで、本 `GameState` は段階を持たない。両者は矛盾せず、
 * `rounds.stage`（問単位）＋ `GameState`（セッション単位）で進行状態機を表現する。
 *
 * 回線断後の再接続では、端末は本ポインタ（現在問題番号・TV モード）と `balances`
 * （自分の残額）というサーバ権威から復帰する。
 *
 * 本モジュールは純粋なドメイン型のみを定義し、他モジュールへ依存しない（import を持たない）。
 */

/**
 * TV（観客向けメイン表示）の 5 モード。制御盤（`role: host`）の MC 切替対象。
 * - `a`: 出題（動画 → 画像 → テキストの 3 段フォールバック）
 * - `b`: 解答オープン（氏名＋解答の一斉開示）
 * - `c`: 正解発表
 * - `d`: 1 問ごとの得点精算（当該問の全員 6 列表）
 * - `e`: 全問通算の全員得点一覧
 */
export type TvMode = "a" | "b" | "c" | "d" | "e";

/**
 * ゲームセッション全体のライフサイクルフェーズ。
 * - `lobby`: 参加受付中（ゲーム未開始）
 * - `in_progress`: 進行中
 * - `finished`: 全 10 問の精算完了（残額最多勝ちの確定・e モード提示）
 */
export type Phase = "lobby" | "in_progress" | "finished";

/**
 * `game_state` シングルトン（セッション全体で 1 行）のセッションポインタ。
 *
 * 現在問題番号・TV モード・フェーズのみを保持し、各問の到達段階（b/c/d）は
 * `rounds` が持つ（§2.5）。この分離により、再採点範囲判定（問単位の `rounds.stage`）と
 * セッション進行（本ポインタ）が互いに独立して更新できる。
 */
export interface GameState {
  /** 現在の問題番号（1〜10）。 */
  currentQuestionNumber: number;
  /** 現在 TV に提示している 5 モードのいずれか（host の MC 切替で遷移する）。 */
  tvMode: TvMode;
  /** セッションのライフサイクルフェーズ。10 問すべての精算完了で `finished` へ遷移する。 */
  phase: Phase;
}
