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

import type { Stage } from "./progression.js";

/**
 * TV の表示モード（`module:game_state`・detailed_design:state-machines §2.4 / §3.1・
 * operational_behavior_model §2.2 / OBM-3）。
 *
 * TV（観客面 `/tv`）は司会者のモード切替（`op_switch_tv_mode` /
 * `op_propagate_mode_switch`）で 5 つの表示モードを切り替える。各モードの役割:
 *   - `a`: 出題面（動画 → 画像 → テキストの 3 段解決）
 *   - `b`: 解答オープン（全員の氏名＋解答）
 *   - `c`: 正解発表（当該問の正解値）
 *   - `d`: 1 問ごとの得点精算（氏名 / 解答 / 誤差 / 増減円 / ピタリ賞 / 残額の 6 列全員表）
 *   - `e`: 全問通算の全員得点一覧（残額最多の勝者判別）
 *
 * 本型は TvMode の**唯一の宣言点**であり、`game_state.ts`（`game_state.tv_mode`）は
 * 本型を再エクスポートして参照する。TV 表示面（`module:tv_display`）と配信
 * （`module:realtime_sync`）は本モードを読み取って描画・投影し、段階→モード対応を
 * 再導出しない（§2.4・§3.1 の単一所有）。値集合は `game_state.tv_mode`（enum `a`〜`e`）と
 * 一致し、そのまま永続化・復元できる。
 */
export type TvMode = "a" | "b" | "c" | "d" | "e";

/**
 * 進行段階（`rounds.stage`）の既定 TV モードへの純写像（§2.4）。
 *
 * 段階遷移（`op_propagate_deadline` / `op_propagate_disclosure` / `op_reveal_answer` /
 * `op_compute_settlement`）が既定 TV モードを駆動する:
 *   - `accepting` / `answers_locked` → `a`（出題・締切のいずれも出題面を提示）
 *   - `answers_opened`（b 開示） → `b`
 *   - `answer_revealed`（c 正解発表） → `c`
 *   - `settlement_computed`（d 精算） → `d`
 *
 * モード `e`（全問通算一覧）は**段階から生成されない**。e は司会者のモード切替
 * （次へ／戻る／個別ジャンプ）でのみ到達する通算閲覧モードであるため、本写像の
 * 戻り値型から除外する（`Exclude<TvMode, "e">`）。段階を写した結果が `e` になることは
 * 型レベルでも起こり得ない。TV Mode Machine（`tv_machine.ts`）はこの既定モードとは
 * 独立に a〜e を自由往来するが、段階駆動の既定値は本写像が単一所有する（§2.4）。
 *
 * 本関数は {@link Stage} を引数型に取り単一所有権に従うため、段階集合の定義元である
 * `progression.ts` から `Stage` を import する（再宣言しない・§3.1）。外部 I/O・可変状態を
 * 持たない純関数であり、同一段階には常に同一モードを返す。`switch` は {@link Stage} の
 * 5 値をすべて網羅するため、既定分岐なしで全経路がモードを返す。
 */
export function stageToTvMode(stage: Stage): Exclude<TvMode, "e"> {
  switch (stage) {
    case "accepting":
    case "answers_locked":
      return "a";
    case "answers_opened":
      return "b";
    case "answer_revealed":
      return "c";
    case "settlement_computed":
      return "d";
  }
}
