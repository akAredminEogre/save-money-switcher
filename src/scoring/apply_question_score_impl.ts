// @generated-by: codd implement
// @generated-from: docs/design/system_design.md (design:system-design)
// @design-node: docs/design/system_design.md
// @output-paths: src, tests
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { assertIntegerAnswer } from "./validate_answer.js";

/**
 * 1 問の得点精算（`module:scoring`）の実体。1 人 1 問について、確定した SAVE MONEY 方式の
 * ルール（decision_records B / G・system_design §2.6・不変条件 INV-6/INV-7）で
 * 誤差・増減円・ピタリ賞・精算後残額を**円建て整数**で算出する純関数を提供する。
 *
 * 公開面 `apply_question_score.ts` が本モジュールの {@link applyQuestionScore} を再エクスポート
 * し、消費側（得点精算・TV d/e 表示・差分再採点）はそこから参照する。
 *
 * 確定値（改変禁止・違反時リリース不可）:
 *   - 先渡し {@link INITIAL_GRANT_YEN} = 10,000 円
 *   - 増減円 = 誤差 × {@link YEN_PER_ERROR}（誤差 1 につき −100 円）
 *   - ピタリ賞（誤差 0）= 当該プレイヤーへ {@link PITARI_BONUS_YEN} = +1,000 円
 *   - 金額は円建て固定（{@link SCORE_CURRENCY} = 「円」）。point/pt/点 への置換は禁止。
 *
 * ピタリ賞は本関数では**加算側（+1,000 円）のみ**を算出する。拠出元（他プレイヤーからの
 * 差引・横取り配分）は確定要件に無く（F-02）本関数の責務外とし、ここでは実装しない。
 *
 * 解答・正解は {@link assertIntegerAnswer} で 0〜100 の整数のみ受理する（INV-6 のサーバ側
 * 二重防衛）。UI を迂回した負値・小数・100 超・非数値は `InvalidAnswerError` として拒否する。
 * `src/scoring/` をリーフに保つため他モジュールへは依存しない。
 */

/** ゲーム開始時に各プレイヤーへ先渡しする賞金（円・整数）。確定値・改変禁止。 */
export const INITIAL_GRANT_YEN = 10_000;

/** 誤差 1 あたりの増減円（確定値・負係数）。増減円 = 誤差 × 本係数。 */
export const YEN_PER_ERROR = -100;

/** ピタリ賞（誤差 0）で当該プレイヤーへ加算する確定額（円・整数）。 */
export const PITARI_BONUS_YEN = 1_000;

/** 金額の通貨表記。円建て固定であり point/pt/点 への置換を禁止する（INV-7）。 */
export const SCORE_CURRENCY = "円" as const;

/** {@link applyQuestionScore} の入力。金額は円・整数、解答/正解は 0〜100 の整数。 */
export interface QuestionScoreInput {
  /** 精算前の当該プレイヤーの残額（円・整数。初期は {@link INITIAL_GRANT_YEN}）。 */
  readonly balance: number;
  /** 当該プレイヤーの解答（0〜100 の整数）。 */
  readonly answer: number;
  /** 当該問の正解値（0〜100 の整数）。 */
  readonly correct: number;
}

/**
 * 1 問 1 人分の得点精算結果（円建て・整数）。TV の d モード 6 列表
 * （氏名 / 解答 / 誤差 / 増減円 / ピタリ賞 / 残額）と §scoring の算出はこの値に一致する。
 */
export interface QuestionScore {
  /** 誤差 = |解答 − 正解|（0〜100 の整数）。 */
  readonly error: number;
  /** 増減円 = 誤差 × −100（円・整数・0 以下）。ピタリ賞は含まない。 */
  readonly delta: number;
  /** ピタリ賞（誤差 0 で +1,000 円、それ以外 0）。加算側のみ（F-02）。 */
  readonly pitariBonus: number;
  /** 当該問精算後の残額 = 精算前残額 + 増減円 + ピタリ賞（円・整数）。 */
  readonly balance: number;
  /** 先渡し額（円・整数）。確定値 {@link INITIAL_GRANT_YEN} を参照用に保持する。 */
  readonly initialGrant: number;
  /** 円建て固定の通貨表記（常に「円」）。 */
  readonly currency: typeof SCORE_CURRENCY;
}

/**
 * 1 問 1 人分の得点を精算する。
 *
 * 誤差 = |解答 − 正解|、増減円 = 誤差 × −100、ピタリ賞（誤差 0）= +1,000 円 を算出し、
 * 精算後残額 = 精算前残額 + 増減円 + ピタリ賞 を返す。金額はすべて円建て整数で、
 * `currency` は常に「円」（point/pt/点 への置換なし）。
 *
 * 解答・正解は {@link assertIntegerAnswer} で 0〜100 の整数のみ受理し、範囲外・小数・
 * 非数値は `InvalidAnswerError` を送出して拒否する（サーバ側最終防衛・INV-6）。
 *
 * @throws {InvalidAnswerError} 解答または正解が 0〜100 の整数でない場合。
 */
export function applyQuestionScore(input: QuestionScoreInput): QuestionScore {
  const answer = assertIntegerAnswer(input.answer);
  const correct = assertIntegerAnswer(input.correct);

  const error = Math.abs(answer - correct);
  // 誤差 0 では増減円は 0。`0 * -100` は JS で -0 を生むため、正の 0 に正規化する
  // （残額計算には無影響だが、確定値 delta を Object.is で ±0 判定する契約に合わせる）。
  const delta = error === 0 ? 0 : error * YEN_PER_ERROR;
  const pitariBonus = error === 0 ? PITARI_BONUS_YEN : 0;
  const balance = input.balance + delta + pitariBonus;

  return {
    error,
    delta,
    pitariBonus,
    balance,
    initialGrant: INITIAL_GRANT_YEN,
    currency: SCORE_CURRENCY,
  };
}
