// @generated-by: codd implement
// @generated-from: docs/design/surface_copy_obligations.md (design:surface-copy-obligations)
// @design-node: docs/design/surface_copy_obligations.md
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
 * TV e モード ── 全問通算の全員一覧と勝者判別の描画
 * （`module:tv_display`・surface_copy_obligations §2.4e / op_render_tv_surface /
 * dod_tv_winner_visible_e / VB-31 / VB-51 / VB-76）。
 *
 * 全員の全問通算残額（`balances`）を単一整形点 {@link formatYen} で **円建て固定**表示し、
 * 残額最多のプレイヤーを勝者として判別可能に印す。勝者判定は採点エンジンの勝者読みモデル
 * {@link determineWinners}（残額最多）を出典とし、同点は複数の共同首位として提示する
 * （同点優先順位を発明しない・F-06）。d（当該問フォーカス）と役割を分け、e は全問通算の
 * 全員一覧を担う。氏名は自己入力名で提示し、突合が取れない行は描画対象から外して内部
 * 識別子を可視値に出さない。
 */

import { formatYen } from "../scoring/currency.js";
import { determineWinners } from "../scoring/determine_winner.js";
import type { TotalsRowViewModel, TotalsViewModel } from "./tv_surface_view.js";

/** 勝者に付す観客向けラベル（内部識別子・点化文言を含まない）。 */
const WINNER_LABEL = "勝者";

/** e モード 1 名分の全問通算残額（事前集計済み・整数円）。 */
export interface TotalsEntry {
  readonly name: string;
  /** 全問通算残額（整数円）。 */
  readonly balanceYen: number;
}

/**
 * e モード描画の入力（全問通算の集計済み一覧と終局フラグ）。
 *
 * 氏名・残額の突合は本表示層の責務外とし、呼出側（集計）が済ませた entry 配列を受け取る。
 * `finished` はゲーム終局（全問通算確定）を表し、勝者ラベルは終局後のみ付す。
 */
export interface TotalsInput {
  readonly entries: readonly TotalsEntry[];
  readonly finished: boolean;
}

/**
 * 全問通算の全員一覧を描画し、終局後は残額最多を勝者として印す。金額は {@link formatYen} で
 * 円建て固定し、勝者は {@link determineWinners}（残額最多・同点は共同首位）で判別する。
 */
export function renderTvModeE(input: TotalsInput): TotalsViewModel {
  // 勝者読みモデル（残額最多）を採点エンジンへ委譲し、勝者 index 集合を作る（同点は共同首位）。
  const ranked = input.entries.map((entry, index) => ({
    participantId: index,
    amount: entry.balanceYen,
  }));
  const winnerIndexes = new Set(
    determineWinners(ranked).map((winner) => winner.participantId),
  );

  const rows: TotalsRowViewModel[] = input.entries.map((entry, index) => {
    const winner = input.finished && winnerIndexes.has(index);
    return {
      name: entry.name,
      balance: formatYen(entry.balanceYen),
      winner,
      winnerLabel: winner ? WINNER_LABEL : null,
    };
  });

  return { mode: "e", heading: "全員の残額一覧", rows };
}

/** 記述的別名（`renderTvModeE` と同一）。 */
export const renderTotals = renderTvModeE;
