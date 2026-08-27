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
 * TV b モード ── 解答オープンの描画（`module:tv_display`・surface_copy_obligations §2.4b /
 * op_render_tv_surface / dod_tv_hide_before_disclosure / VB-19 / VB-20）。
 *
 * 開示（b 配信）が確定するまで他者の解答を一切含めない（`disclosed=false` のとき `entries`
 * は空）。開示後は全員の氏名＋解答を一斉提示する。見出しは可視ロールラベル
 * {@link ROLE_LABELS} が表す解答者ロールで表し、内部識別子を露出させない。
 */

import { ROLE_LABELS } from "../game_state/role_labels.js";
import type { DisclosureEntry, DisclosureViewModel } from "./tv_surface_view.js";

/** 1 名分の氏名と解答（0〜100 整数）。入力側の解答フィールド名は `answerValue`。 */
export interface DisclosureAnswer {
  readonly name: string;
  readonly answerValue: number;
}

/** b モード描画の入力（開示済みか否かと、開示対象の氏名＋解答）。 */
export interface DisclosureInput {
  readonly disclosed: boolean;
  readonly answers: readonly DisclosureAnswer[];
}

/**
 * 解答オープンを描画する。開示前は他者の解答を伏せ（空）、開示後にのみ全員の氏名＋解答を
 * 提示する（dod_tv_hide_before_disclosure）。
 */
export function renderTvModeB(input: DisclosureInput): DisclosureViewModel {
  const heading = `${ROLE_LABELS.answerer}の解答`;
  if (!input.disclosed) {
    return { mode: "b", heading, disclosed: false, rows: [] };
  }
  const rows: DisclosureEntry[] = input.answers.map((answer) => ({
    name: answer.name,
    answer: String(answer.answerValue),
  }));
  return { mode: "b", heading, disclosed: true, rows };
}

/** 記述的別名（`renderTvModeB` と同一）。 */
export const renderDisclosure = renderTvModeB;
