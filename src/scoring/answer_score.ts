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
 * 回答スコア値型（`AnswerScore`）── 0〜100 の整数レンジを型と実行時アサートで固定する。
 *
 * scoring_engine_design §2.2（規約 SC-3）で確定した release-blocking 制約を具体化し、
 * データモデル §2.7 の値型定義を採点エンジンの唯一の基盤型として引き継ぐ: 回答・正解値・
 * 誤差はすべて 0〜100 の整数のみを取り、小数・負値・100 超・非数値を型レベルと実行時
 * アサートの双方で排除する。
 *
 * 本モジュールは 0〜100 整数の防衛層（UI／サーバ側最終検証／DB CHECK・§2.5）のうち、
 * ドメイン型と実行時アサートの層を供給する単一の定義点である。精算コア
 * （`apply_question_score`・§2.3）とサーバ側最終検証（`validate_answer`・§2.5）が
 * 本ガードを共有基盤とし、`Question.correctValue`・`Answer.value`・`settlements` の
 * 解答スナップショット／誤差（§2.4）が同一の値型を共有する。`module:scoring` を
 * リーフに保つため他モジュールへ依存しない。
 */

/** 受理する回答スコアの下限（この値を含む）。 */
export const ANSWER_MIN = 0;

/** 受理する回答スコアの上限（この値を含む）。 */
export const ANSWER_MAX = 100;

/**
 * 0〜100 の整数として妥当な回答スコア。
 *
 * TypeScript の構造的型では `number` の部分集合（0〜100 の整数）を静的に表せないため
 * `number` の別名として定義するが、値が実際に 0〜100 の整数であることは
 * {@link isAnswerScore} / {@link assertAnswerScore} が実行時に保証する。この型で
 * 受け取った値は検証済みであることを呼び出し規約とする。
 */
export type AnswerScore = number;

/**
 * 値が 0〜100 の整数の回答スコアであるかを判定する型ガード。
 *
 * `number` 型でない値・`NaN`・`Infinity`・小数・範囲外はすべて `false`。数値文字列
 * （例 `"50"`）も `number` ではないため受理しない。境界は 0=可 / 100=可 /
 * −1=不可 / 101=不可 / 50.5=不可。
 */
export function isAnswerScore(value: unknown): value is AnswerScore {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= ANSWER_MIN &&
    value <= ANSWER_MAX
  );
}

/**
 * 回答スコアを 0〜100 の整数として検証する。
 *
 * 受理できれば同じ値を {@link AnswerScore} として返し、そうでなければ
 * {@link RangeError} を送出する。負値・小数・100 超・非数値（文字列・`null`・
 * `undefined`・`NaN`・`Infinity` 等）はすべて拒否する。誤差・増減円・残額の算出は
 * 本アサートを通した整数値のみを扱い、途中の小数化・範囲外化を実行時にも排除する。
 *
 * 拒否理由メッセージには範囲を示す数値定数のみを埋め込み、拒否対象の生値は文字列化
 * （`Symbol` / `BigInt` 等で失敗しうる）を避けるため含めない。
 *
 * @throws {RangeError} 値が 0〜100 の整数でない場合。
 */
export function assertAnswerScore(value: unknown): AnswerScore {
  if (!isAnswerScore(value)) {
    throw new RangeError(
      `回答は ${ANSWER_MIN}〜${ANSWER_MAX} の整数のみ受理します`,
    );
  }
  return value;
}
