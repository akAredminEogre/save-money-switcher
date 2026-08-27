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
 * TV サーフェスの 5 モード分岐描画（`module:tv_display`・surface_copy_obligations §2.4 /
 * op_render_tv_surface / dod_tv_five_modes / dod_tv_audience_copy_no_control / VB-45 / VB-47）。
 *
 * 現在の表示モード（a〜e）に応じて各モードの純関数描画へ分岐し、描画可能なビューモデルを
 * 返す唯一の入口。TV は受動表示であり、本サーフェスはいかなる入力・操作要素も生成しない
 * （返却ビューモデルは表示専用値のみで構成）。金額は各モードで単一整形点 `formatYen` を経由
 * して円建て固定、ロールは単一供給点 `ROLE_LABELS` を経由し、出題面は `resolveQuestionFace`
 * の解決済み値のみを描画する。
 */

import { renderTvModeA } from "./render_question_face.js";
import { renderTvModeB } from "./render_disclosure.js";
import { renderTvModeC } from "./render_correct_value.js";
import { renderTvModeD } from "./render_settlement_table.js";
import { renderTvModeE } from "./render_totals.js";
import type { Question } from "../questions/question.js";
import type { DisclosureInput } from "./render_disclosure.js";
import type { SettlementTableEntry } from "./render_settlement_table.js";
import type { TotalsInput } from "./render_totals.js";
import type { TvSurfaceViewModel } from "./tv_surface_view.js";

/**
 * 現在の表示モード（TV サーフェスの `mode` 判別子）と、そのモードが必要とするデータの
 * 判別可能ユニオン。出力ビューモデルと判別子を `mode` に統一する（surface_copy_obligations
 * §2.4）。データフィールドは任意（欠落時は {@link MissingTvSurfaceDataError} を送出）とする。
 *
 * ※ここでの `mode` は「TV の表示モード（a〜e）」であり、ゲーム状態の現モードを表す
 * `game_state` / `protocol` / `recovery` の `tvMode` とは別概念（そちらは改名しない）。
 */
export type TvSurfaceRequest =
  | { readonly mode: "a"; readonly question?: Question }
  | { readonly mode: "b"; readonly disclosure?: DisclosureInput }
  | { readonly mode: "c"; readonly correctValue?: number }
  | { readonly mode: "d"; readonly settlement?: readonly SettlementTableEntry[] }
  | { readonly mode: "e"; readonly totals?: TotalsInput };

/** TV サーフェス描画に必要な表示データが欠落しているときに送出する。 */
export class MissingTvSurfaceDataError extends Error {
  constructor(mode: string) {
    super(`TV サーフェス（${mode} モード）に必要な表示データがありません。`);
    this.name = "MissingTvSurfaceDataError";
  }
}

/** 現在の表示モードに応じて対応するモード描画へ分岐し、ビューモデルを返す。 */
export function renderTvSurface(request: TvSurfaceRequest): TvSurfaceViewModel {
  switch (request.mode) {
    case "a":
      if (request.question === undefined) throw new MissingTvSurfaceDataError("a");
      return renderTvModeA(request.question);
    case "b":
      if (request.disclosure === undefined) throw new MissingTvSurfaceDataError("b");
      return renderTvModeB(request.disclosure);
    case "c":
      if (request.correctValue === undefined) throw new MissingTvSurfaceDataError("c");
      return renderTvModeC({ correctValue: request.correctValue });
    case "d":
      if (request.settlement === undefined) throw new MissingTvSurfaceDataError("d");
      return renderTvModeD(request.settlement);
    case "e":
      if (request.totals === undefined) throw new MissingTvSurfaceDataError("e");
      return renderTvModeE(request.totals);
    default: {
      const unreachable: never = request;
      throw new MissingTvSurfaceDataError(String(unreachable));
    }
  }
}

/**
 * ビューモデルから観客可視文言の配列を取り出す（相互作用要素・司会者操作語・内部ロール
 * 識別子 host/answerer/audience を含めない）。correctValue の数値は表示時に String 化するが
 * 型自体は number で保持される。
 */
export function collectVisibleText(view: TvSurfaceViewModel): string[] {
  switch (view.mode) {
    case "a": {
      const media =
        view.media.kind === "text" ? view.media.text : view.media.mediaUrl;
      return [view.heading, media];
    }
    case "b":
      return [view.heading, ...view.rows.flatMap((row) => [row.name, row.answer])];
    case "c":
      return [view.heading, String(view.correctValue)];
    case "d":
      return [
        view.caption,
        ...view.headers,
        ...view.rows.flatMap((row) => [
          row.name,
          row.answer,
          row.error,
          row.deltaYen,
          row.pitari,
          row.balance,
        ]),
      ];
    case "e":
      return [
        view.heading,
        ...view.rows.flatMap((row) =>
          row.winnerLabel === null
            ? [row.name, row.balance]
            : [row.name, row.balance, row.winnerLabel],
        ),
      ];
  }
}

/** HTML 特殊文字を実体参照へ退避する（タグ注入・相互作用要素混入を防ぐ）。 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * ビューモデルを静的な表示専用 HTML 文字列へ整形する。TV は受動表示ゆえ、`<button` /
 * `<input` / `<form` / `<select` / `<textarea` / `contenteditable` / `onclick` 等の
 * 入力・操作・相互作用要素を一切含めない（VB-84）。可視文言は
 * {@link collectVisibleText} 経由ゆえ司会者操作語・内部ロール識別子も含まない。
 */
export function serializeTvSurface(view: TvSurfaceViewModel): string {
  const body = collectVisibleText(view)
    .map((line) => `<div class="tv-line">${escapeHtml(line)}</div>`)
    .join("");
  return `<section class="tv-surface tv-mode-${view.mode}">${body}</section>`;
}
