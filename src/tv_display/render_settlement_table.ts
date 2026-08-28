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
 * TV d モード ── 当該問の 6 列全員精算表の描画
 * （`module:tv_display`・surface_copy_obligations §2.4d・§2.5 / op_render_tv_surface /
 * dod_tv_five_modes / dod_currency_yen_all_surfaces / VB-50）。
 *
 * 6 列（氏名/解答/誤差/増減円/ピタリ賞/残額）を `settlements` ＋ `participants` ＋ `balances`
 * から結合して当該問フォーカスで提示する。氏名は `participants.name`（自己入力）、増減円・
 * 残額・ピタリ賞加算額は単一の整形点 {@link formatYen} を経由して **円建て固定**で表す
 * （点数化・ポイント化しない）。ロール可視ラベルは単一供給点 {@link ROLE_LABELS} から取り、
 * 内部識別子（host/contestant）を露出させない。氏名・残額の突合が取れない不整合な行は
 * 描画対象から外し、内部識別子（participant_id 等）を可視値に出さない。
 */

import { formatYen } from "../scoring/currency.js";
import { ROLE_LABELS } from "../game_state/role_labels.js";
import type {
  SettlementRowViewModel,
  SettlementTableViewModel,
} from "./tv_surface_view.js";

export { renderTvModeE } from "./render_totals.js";

/** d モード 6 列表の規定見出し（順序込み・氏名/解答/誤差/増減円/ピタリ賞/残額）。 */
export const SETTLEMENT_TABLE_HEADERS: readonly [
  string,
  string,
  string,
  string,
  string,
  string,
] = ["氏名", "解答", "誤差", "増減円", "ピタリ賞", "残額"];

/** ピタリ賞非該当セルの観客向け不在マーカー（内部語・点化文言を含まない）。 */
const PITARI_ABSENT = "—";

/**
 * d モード 6 列表の 1 行分の事前計算済み精算エントリ（§2.4 6 列を直接鏡写）。
 *
 * 氏名・参加者・残額の突合（join）は本表示層の責務外とし、呼出側（採点・集計）が済ませた
 * entry 配列を受け取る。金額は整数円（`deltaYen` / `pitariBonusYen` / `balanceYen`）で保持し、
 * 表示層が {@link formatYen} で円建て文字列へ整形する。
 */
export interface SettlementTableEntry {
  readonly name: string;
  /** 解答値（0〜100 整数）。 */
  readonly answerValue: number;
  /** 誤差 = |解答 − 正解|（0〜100 整数）。 */
  readonly error: number;
  /** 増減円（整数円・0 以下）。 */
  readonly deltaYen: number;
  /** ピタリ賞該当か。 */
  readonly pitariAwarded: boolean;
  /** ピタリ賞加算額（整数円・非該当は 0）。 */
  readonly pitariBonusYen: number;
  /** 当該問精算後の残額（整数円）。 */
  readonly balanceYen: number;
}

/**
 * 当該問の 6 列精算表を描画する。増減円・残額・ピタリ賞加算額は {@link formatYen} で
 * 円建て固定し、氏名は事前計算済み entry の自己入力名で提示する。join は呼出側責務ゆえ
 * 本関数は entry 配列を表示 row へ写すのみ（§2.4 6 列を直接鏡写）。
 */
export function renderTvModeD(
  entries: readonly SettlementTableEntry[],
): SettlementTableViewModel {
  const rows: SettlementRowViewModel[] = entries.map((entry) => ({
    name: entry.name,
    answer: String(entry.answerValue),
    error: String(entry.error),
    deltaYen: formatYen(entry.deltaYen),
    pitari: entry.pitariAwarded ? formatYen(entry.pitariBonusYen) : PITARI_ABSENT,
    balance: formatYen(entry.balanceYen),
  }));

  return {
    mode: "d",
    caption: `${ROLE_LABELS.contestant}の結果`,
    headers: SETTLEMENT_TABLE_HEADERS,
    rows,
  };
}

/** 記述的別名（`renderTvModeD` と同一）。 */
export const renderSettlementTable = renderTvModeD;
