// @generated-by: codd implement
// @generated-from: docs/design/scoring_engine_design.md (design:scoring-engine-design)
// @design-node: docs/design/scoring_engine_design.md
// @output-paths: src, tests
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

/**
 * 採点エンジンの公開バレル（`module:scoring` の唯一の公開面・scoring_engine_design §2.12）。
 *
 * 本モジュールは新しい型・値・挙動を一切定義せず、採点エンジンの各実装単位が既に単一所有
 * する公開シンボルを再エクスポートするだけの入口である。消費側（`src/game_state/` の進行
 * トリガ・`src/control_panel/` のロール判定を通した後の呼出し・`src/realtime_sync/` の配信・
 * TV d/e 供給読みモデル）は、個々のファイルパスに依存せず本バレルから採点の公開面を
 * import する。バレル自体は挙動を持たず（re-export のみで新規型を定義しない）、正しさは各
 * 再輸出先のユニット（`tests/scoring/*.test.ts`）と、消費側のコンパイル時型検査で担保される。
 *
 * 公開面（§2.12 に一致・改変時は §2.12 と同期する）:
 *   - 純関数: {@link applyQuestionScore}（1 人 1 問精算）・{@link settleQuestion}（問単位の
 *     拠出台帳生成）・{@link aggregateBalance}（残額の全再計算＝監査基準）・
 *     {@link rescoreQuestion}（正解訂正時の差分再採点）・{@link determineWinners}（残額最多の
 *     勝者判定・同点は共同首位）・{@link validateSubmittedAnswer}（0〜100 整数のサーバ側最終検証）。
 *   - ドメイン型: {@link QuestionSettlement}（問×人の拠出行）・{@link Balance}（集計残額の
 *     読みモデル）・{@link AnswerScore}（0〜100 整数）・{@link Yen}（整数円）。
 *
 * モジュール解決は NodeNext/Node16（§1.3）。すべての再エクスポート指定子は出力される `.js`
 * ファイル名を明示し（`"./x"`・`"./x.ts"` は不可）、型のみの再輸出は `export type` を用いて
 * 値の再輸出と分離する（TS2835 回避・`verbatimModuleSyntax` 下でも安全）。
 */

export { applyQuestionScore } from "./apply_question_score.js";
export { settleQuestion } from "./settle_question.js";
export { aggregateBalance } from "./aggregate_balance.js";
export { rescoreQuestion } from "./rescore_question.js";
export { determineWinners } from "./determine_winner.js";
export { validateSubmittedAnswer } from "./validate_answer.js";
export type { QuestionSettlement } from "./settlement.js";
export type { Balance } from "./balance.js";
export type { AnswerScore } from "./answer_score.js";
export type { Yen } from "./yen.js";
