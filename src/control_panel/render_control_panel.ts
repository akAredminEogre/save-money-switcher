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
 * 制御盤サーフェスの HTML 描画（surface_copy_obligations §2.2 / op_render_control_panel_surface）。
 *
 * {@link ControlPanelView} を受け取り、司会者向けの操作コンソール HTML を生成する。各トリガーは
 * 可視操作語ラベルのボタンとして描画し、内部コマンド識別子は非可視の `data-command` 属性としてのみ
 * 用いる（可視テキストへ出さない）。参加者が自己入力した氏名は信頼できない入力として必ず
 * {@link escapeHtml} で無害化し、反射型 XSS を防ぐ。解答者用の数値入力送信面（+1/-1/+10/-10 と
 * 送信）は一切描画しない（dod_cp_no_answerer_input_face）。参加用 QR は解決済み SVG を提示面へ
 * 埋め込むのみで、生成はしない。
 */

import type { ControlPanelView } from "./control_panel_view.js";

/** HTML へ埋め込む前に、参加者の自己入力氏名等の信頼できない文字列を無害化する。 */
function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 制御盤サーフェスの HTML フラグメントを生成する。各領域を `data-region` で識別可能な
 * `<section>` として並べ、操作要素は司会者トリガーのボタンに限る。参加者氏名・QR の URL は
 * 無害化して埋め込む。
 */
export function renderControlPanelHtml(view: ControlPanelView): string {
  const triggerButtons = view.triggers
    .map(
      (t) => `<button type="button" data-command="${t.command}">${escapeHtml(t.label)}</button>`,
    )
    .join("");
  const modeButtons = view.modeJumpTriggers
    .map(
      (t) =>
        `<button type="button" data-command="${t.command}" data-mode="${t.mode}">` +
        `${escapeHtml(t.label)}</button>`,
    )
    .join("");
  const rosterItems = view.roster
    .map(
      (r) =>
        `<li data-participant-id="${escapeHtml(r.participantId)}">${escapeHtml(r.displayName)}</li>`,
    )
    .join("");
  return (
    `<main data-surface="control-panel">` +
    `<header data-region="identity"><p data-role-label>${escapeHtml(view.roleLabel)}</p>` +
    `<h1>${escapeHtml(view.title)}</h1></header>` +
    `<section data-region="status"><h2>${escapeHtml(view.statusHeading)}</h2>` +
    `<p data-status>${escapeHtml(view.statusLabel)}</p></section>` +
    `<section data-region="triggers">${triggerButtons}</section>` +
    `<section data-region="mode-jump"><h2>${escapeHtml(view.modeJumpHeading)}</h2>` +
    `${modeButtons}</section>` +
    `<section data-region="connection"><h2>${escapeHtml(view.connectionCountHeading)}</h2>` +
    `<p data-connection-count>${escapeHtml(view.connectionCount)}</p></section>` +
    `<section data-region="roster"><h2>${escapeHtml(view.rosterHeading)}</h2>` +
    `<ul>${rosterItems}</ul></section>` +
    `<section data-region="join-qr"><h2>${escapeHtml(view.joinQr.heading)}</h2>` +
    `<div data-qr>${view.joinQr.svg}</div>` +
    `<a data-join-url href="${escapeHtml(view.joinQr.joinUrl)}">${escapeHtml(view.joinQr.joinUrl)}</a>` +
    `<p>${escapeHtml(view.joinQr.caption)}</p></section>` +
    `</main>`
  );
}
