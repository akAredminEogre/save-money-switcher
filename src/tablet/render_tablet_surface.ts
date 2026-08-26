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

// @output-paths: src, tests
import {
  buildTabletSurfaceViewModel,
  type TabletSurfaceState,
  type TabletSurfaceViewModel,
} from "./tablet_surface_view_model.js";

/**
 * 解答者タブレット面（/tablet）の描画（`module:tablet`・surface_copy_obligations §2.3 /
 * op_render_tablet_surface）。
 *
 * 入力専用最小 UI を描画する: 受付状態（受付中／締切）・問題番号・−10/−1/+1/+10 の
 * 4 ボタン数値入力・送信／送信済み・自分の残額（円）。司会者操作要素（締切/開示/正解発表/
 * 精算/モード切替/取消）・他者情報・出題本文・全体一覧・権限境界の説明を一切描画しない
 * （dod_tablet_no_control_actions / dod_tablet_no_others_info）。可視文言は
 * {@link TabletSurfaceViewModel} が単一供給し、本モジュールはそれをマークアップへ包む。
 *
 * 操作要素は data-op で識別する（step=数値ステッパ／submit=送信）。司会者操作の data-op を
 * 一切出力しないことで、非 host 面に権限操作が存在しないことを構造的に担保する（VB-24）。
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderFromViewModel(vm: TabletSurfaceViewModel): string {
  const stepper = vm.stepperButtons
    .map(
      (b) =>
        `<button type="button" data-op="step" data-delta="${b.delta}"${b.disabled ? " disabled" : ""}>` +
        `${escapeHtml(b.label)}</button>`,
    )
    .join("");
  const submitted =
    vm.submittedLabel !== null
      ? `<p class="tablet-surface__submitted" data-field="submitted">${escapeHtml(vm.submittedLabel)}</p>`
      : "";
  const submitDisabled = vm.inputLocked;
  return [
    `<main class="tablet-surface" role="main" aria-label="${escapeHtml(vm.roleLabel)}"` +
      ` data-surface="tablet" data-locked="${vm.inputLocked}">`,
    `<p class="tablet-surface__status" data-field="status">${escapeHtml(vm.statusLabel)}</p>`,
    `<p class="tablet-surface__question-number" data-field="question-number">` +
      `${escapeHtml(vm.questionNumberLabel)}</p>`,
    `<div class="tablet-surface__stepper" role="group" aria-label="${escapeHtml(vm.numericInputLabel)}">` +
      `${stepper}` +
      `<output class="tablet-surface__value" data-field="answer-value">${vm.answerValue}</output></div>`,
    `<button type="button" class="tablet-surface__submit" data-op="submit"${submitDisabled ? " disabled" : ""}>` +
      `${escapeHtml(vm.submitLabel)}</button>`,
    submitted,
    `<p class="tablet-surface__balance" data-field="own-balance">${escapeHtml(vm.ownBalanceText)}</p>`,
    `</main>`,
  ].join("");
}

/**
 * 解答者タブレット面（/tablet）を HTML 文字列として描画する。
 *
 * 入力状態を {@link buildTabletSurfaceViewModel} で投影し、入力専用最小 UI のみを出力する。
 */
export function renderTabletSurface(state: TabletSurfaceState): string {
  return renderFromViewModel(buildTabletSurfaceViewModel(state));
}
