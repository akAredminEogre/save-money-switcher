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
 * 制御盤（`/control-panel`）の司会者向け操作トリガー定義（surface_copy_obligations §2.2 /
 * §2.7 / op_render_control_panel_surface・SCO-1・N-3・論点7）。
 *
 * 司会者（`role: host`）は当該権限境界の管理者であり、進行制御の各トリガーを運用言語
 * （操作語）で可視化してよい唯一のアクターである。本モジュールは §2.7 が列挙する全トリガー
 * を「内部コマンド識別子（非可視・`data-command` にのみ用いる）」と「司会者向けの可視操作語
 * ラベル」の対で一元定義する。可視ラベルには内部イベント名（`answers_locked` 等）・内部ロール
 * 識別子（host/answerer）・設定キー名・point/pt/点 を一切含めない（dod_cp_visible_host_triggers /
 * dod_cp_no_internal_leak）。解答者用の数値入力送信面（+1/-1/+10/-10 と送信）は本集合に
 * 含めない（dod_cp_no_answerer_input_face）。副司会という別ロール導線も発明しない。
 */

/**
 * 制御盤トリガーの内部コマンド識別子（配信・権限判定に用いる非可視値）。
 * 可視コピーには一切現れず、`data-command` 属性としてのみ用いる。内部イベント名
 * （`answers_locked`／`answers_opened`／`settlement_computed` 等）とは別綴りとし、可視
 * 文言には露出しない。
 */
export type HostCommand =
  | "load_questions"
  | "lock_answers"
  | "open_answers"
  | "reveal_answer"
  | "compute_settlement"
  | "mode_next"
  | "mode_back"
  | "mode_jump"
  | "edit_question"
  | "undo";

/** TV モードの識別文字（個別ジャンプの対象・a〜e）。 */
export type TvModeLetter = "a" | "b" | "c" | "d" | "e";

/** 司会者向けの単一トリガー（内部コマンドと可視操作語ラベルの対）。 */
export interface HostTriggerView {
  /** 非可視の内部コマンド識別子（`data-command` にのみ用いる）。 */
  readonly command: HostCommand;
  /** 司会者向けの可視操作語（運用語）。 */
  readonly label: string;
}

/** 各モードへの個別ジャンプトリガー（対象モードと可視ラベルの対）。 */
export interface ModeJumpTriggerView {
  /** 個別ジャンプは単一コマンドで、対象は `mode` で指定する。 */
  readonly command: "mode_jump";
  /** ジャンプ先の TV モード（a〜e）。 */
  readonly mode: TvModeLetter;
  /** 司会者向けの可視ラベル（当該モードの運用語）。 */
  readonly label: string;
}

/**
 * §2.7 が列挙する制御盤の全司会者トリガー（個別ジャンプを除く）。
 * ラベルは司会者の運用言語で表し、内部イベント名・設定キー名・内部ロール識別子・
 * point/pt/点 を含めない。順序は §2.7 の掲示順に従う。
 */
export const HOST_TRIGGERS: readonly HostTriggerView[] = Object.freeze([
  { command: "load_questions", label: "問題を読み込む" },
  { command: "lock_answers", label: "そこまで" },
  { command: "open_answers", label: "解答オープン！" },
  { command: "reveal_answer", label: "正解発表" },
  { command: "compute_settlement", label: "精算" },
  { command: "mode_next", label: "次へ" },
  { command: "mode_back", label: "戻る" },
  { command: "edit_question", label: "問題・正解を編集" },
  { command: "undo", label: "取消" },
]);

/**
 * 各モード（a〜e）への個別ジャンプトリガー。ラベルは当該モードの観客/運用向け語で表し、
 * 生の TV モード内部語や内部イベント名を露出しない。
 */
export const MODE_JUMP_TRIGGERS: readonly ModeJumpTriggerView[] = Object.freeze([
  { command: "mode_jump", mode: "a", label: "出題" },
  { command: "mode_jump", mode: "b", label: "解答オープン" },
  { command: "mode_jump", mode: "c", label: "正解発表" },
  { command: "mode_jump", mode: "d", label: "精算" },
  { command: "mode_jump", mode: "e", label: "総合一覧" },
]);
