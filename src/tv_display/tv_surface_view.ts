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
 * TV（観客向け受動表示）サーフェスの描画可能ビューモデル型
 * （`module:tv_display`・surface_copy_obligations §2.4 / op_render_tv_surface）。
 *
 * TV は 5 モード（a 出題面／b 解答オープン／c 正解値／d 6 列精算表／e 全問通算一覧）を
 * 受動提示する面であり、いかなる入力・操作要素も持たない（dod_tv_audience_copy_no_control）。
 * そのため本ビューモデルは表示専用の値のみ（文字列・真偽・配列）で構成し、コールバック・
 * ハンドラ・入力欄・操作トリガー等の相互作用フィールドを一切持たない。金額はすべて円建て
 * 整形済み文字列（`formatYen` 経由）で保持し、内部識別子・生ファイルパス・内部イベント名・
 * `fallback` 等の内部語を可視値に含めない（dod_tv_no_path_or_internal_leak）。
 */

/** TV の 5 表示モードの判別子（観客向け提示の切替対象）。 */
export type TvSurfaceMode = "a" | "b" | "c" | "d" | "e";

/**
 * a モード（出題面）のビューモデル。動画・画像は配信 URL を、テキストは問題文を持ち、
 * いずれも生ファイルパス文字列を可視値として持たない（`resolveQuestionFace` 解決済み値）。
 */
export interface QuestionFaceViewModel {
  readonly mode: "a";
  /** 観客向けの見出し（例「第3問」）。 */
  readonly heading: string;
  readonly media:
    | { readonly kind: "video"; readonly mediaUrl: string }
    | { readonly kind: "image"; readonly mediaUrl: string }
    | { readonly kind: "text"; readonly text: string };
}

/** b モード（解答オープン）の 1 名分の氏名＋解答。 */
export interface DisclosureEntry {
  readonly name: string;
  /** 解答値（0〜100 整数）の文字列表現。 */
  readonly answer: string;
}

/**
 * b モード（解答オープン）のビューモデル。開示前（`disclosed=false`）は他者の解答を
 * 一切含めない（`rows` は空）＝ dod_tv_hide_before_disclosure。行データ識別子は d/e と統一し
 * `rows` とする（surface_copy_obligations §2.4「6列表」＋ ViewModel 内一貫性）。
 */
export interface DisclosureViewModel {
  readonly mode: "b";
  readonly heading: string;
  readonly disclosed: boolean;
  readonly rows: readonly DisclosureEntry[];
}

/** c モード（正解値）のビューモデル。 */
export interface CorrectValueViewModel {
  readonly mode: "c";
  readonly heading: string;
  /** 当該問の正解値（0〜100 整数）。型は number で保持し、String 化は表示層のみで行う。 */
  readonly correctValue: number;
}

/** d モード 6 列精算表の 1 行（氏名/解答/誤差/増減円/ピタリ賞/残額）。金額列は円建て整形済み。 */
export interface SettlementRowViewModel {
  readonly name: string;
  readonly answer: string;
  readonly error: string;
  /** 増減円（円建て整形済み・例「-500円」）。 */
  readonly deltaYen: string;
  /** ピタリ賞（該当時は加算額を円建て整形、非該当は不在マーカー）。 */
  readonly pitari: string;
  /** 当該問精算後の残額（円建て整形済み）。 */
  readonly balance: string;
}

/** d モード（当該問 6 列精算表）のビューモデル。 */
export interface SettlementTableViewModel {
  readonly mode: "d";
  readonly caption: string;
  readonly headers: readonly [string, string, string, string, string, string];
  readonly rows: readonly SettlementRowViewModel[];
}

/** e モード通算一覧の 1 行。勝者（残額最多）は `winner` で判別可能。 */
export interface TotalsRowViewModel {
  readonly name: string;
  /** 全問通算残額（円建て整形済み）。 */
  readonly balance: string;
  /** 残額最多（共同首位含む）なら真。 */
  readonly winner: boolean;
  /** 勝者に付す観客向けラベル（非勝者は null）。 */
  readonly winnerLabel: string | null;
}

/** e モード（全問通算一覧）のビューモデル。 */
export interface TotalsViewModel {
  readonly mode: "e";
  readonly heading: string;
  readonly rows: readonly TotalsRowViewModel[];
}

/** TV サーフェスの描画可能ビューモデル（5 モードの判別可能ユニオン）。 */
export type TvSurfaceViewModel =
  | QuestionFaceViewModel
  | DisclosureViewModel
  | CorrectValueViewModel
  | SettlementTableViewModel
  | TotalsViewModel;
