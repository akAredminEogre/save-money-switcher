// @generated-by: codd implement
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @design-node: docs/design/data_model_design.md
// @output-paths: src, tests
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

/**
 * サーバ側の解答バリデータ ── 0〜100 整数の二重防衛（INV-6）のサーバ半分。
 *
 * decision_records 論点G / system_design §2.6（不変条件 INV-6）で確定した
 * release-blocking 制約: 入力・判定・スコアリングの全経路で 0〜100 の整数のみを
 * 受理し、負値・小数・100 超・非数値は UI とサーバの双方で拒否する。片方でしか
 * 拒否しない実装はリリース不可。
 *
 * 本モジュールはその「サーバ側」最終防衛であり（data_model_design §2.4 の
 * 二重防衛＋DB CHECK 三層目のうちサーバ層、§2.11 の終端状態ガードの直前）、
 * タブレット UI（`src/tablet/` の 4 ボタン・0〜100 クランプ）を迂回して届いた
 * 不正値（−1 / 101 / 50.5 / 非数値）が `answers` へ到達することを防ぐ。ネットワーク
 * 越しに受信した任意の値を信頼せず、`unknown` を厳格に検査する。
 *
 * scoring_engine_design §2.5 が採点エンジンの公開面として要する
 * {@link validateSubmittedAnswer}（得点精算エンジンのサーバ側最終検証）も本モジュール
 * が供給し、UI（`src/tablet/`）と対で 0〜100 整数の二重防衛のサーバ半分を成す。UI を
 * 迂回した不正値を `answers` へ渡さないためのゲートである。
 *
 * 0〜100 のレンジ判定は本モジュールで再エンコードせず、回答レンジ値型の単一定義点
 * `src/scoring/answer_score.ts`（{@link isAnswerScore} / {@link ANSWER_MIN} /
 * {@link ANSWER_MAX}）を唯一の基盤として共有する。これにより UI・サーバ・DB CHECK の
 * 三層防衛のサーバ層が、精算コア（`apply_question_score`）や `Question.correctValue`・
 * `Answer.value` と同一のレンジ規約へ必ず一致し、境界（0=可 / 100=可 / −1=不可 /
 * 101=不可 / 50.5=不可）の二重管理による齟齬を排除する。拒否時は監査可能な
 * {@link InvalidAnswerError}（拒否した生値を保持）を送出し、`src/scoring/` を
 * リーフに保つため他ドメインモジュールへは依存しない。
 */

import {
  ANSWER_MAX,
  ANSWER_MIN,
  isAnswerScore,
  type AnswerScore,
} from "./answer_score.js";

/**
 * 受理する解答値の下限（0）。回答レンジ値型の単一定義点 {@link ANSWER_MIN} を
 * 再輸出し、サーバ側でレンジ数値を再エンコードしない。
 */
export const ANSWER_MIN_VALUE = ANSWER_MIN;

/**
 * 受理する解答値の上限（100）。回答レンジ値型の単一定義点 {@link ANSWER_MAX} を
 * 再輸出し、サーバ側でレンジ数値を再エンコードしない。
 */
export const ANSWER_MAX_VALUE = ANSWER_MAX;

/**
 * 拒否された値を人が読める形へ安全に整形する。
 * `unknown` には `BigInt`（`JSON.stringify` が送出する）など整形が失敗しうる値も
 * 含まれるため、エラー生成そのものは決して失敗させない。
 */
function describeRejectedValue(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) {
      return serialized;
    }
  } catch {
    // JSON 化に失敗（例: BigInt）した場合は String へフォールバックする。
  }
  return String(value);
}

/**
 * 0〜100 の整数として受理できない解答値をサーバ側で拒否したことを表すエラー。
 * 拒否した生の値を {@link rawValue} に保持し、監査・ログで原因を追える。
 */
export class InvalidAnswerError extends Error {
  /** 拒否された生の入力値（UI を迂回した不正ペイロード由来を含む）。 */
  readonly rawValue: unknown;

  constructor(rawValue: unknown) {
    super(
      `解答は ${ANSWER_MIN_VALUE} 以上 ${ANSWER_MAX_VALUE} 以下の整数でなければ` +
        `なりませんが、${describeRejectedValue(rawValue)} が与えられました。`,
    );
    this.name = "InvalidAnswerError";
    this.rawValue = rawValue;
  }
}

/**
 * 値が 0〜100 の整数の解答値であるかを判定する型ガード。
 *
 * レンジ判定は回答レンジ値型の単一定義点 {@link isAnswerScore} へ委譲し、サーバ側で
 * `Number.isInteger` や境界比較を再実装しない。`number` 型でない値・`NaN`・
 * `Infinity`・小数・範囲外はすべて `false`。数値文字列（例: `"50"`）も `number`
 * ではないため受理しない（サーバは JSON の数値のみを解答とみなし、文字列化された値は
 * 不正ペイロードとして扱う）。
 */
export function isIntegerAnswer(value: unknown): value is AnswerScore {
  return isAnswerScore(value);
}

/**
 * サーバ側の最終防衛として解答値を検証する。
 *
 * 受理できれば正規化した 0〜100 の整数を返し、そうでなければ
 * {@link InvalidAnswerError} を送出する。負値・小数・100 超・非数値
 * （文字列・`null`・`undefined`・`NaN`・`Infinity` 等）はすべて拒否する。判定は
 * {@link isIntegerAnswer}（＝ {@link isAnswerScore}）を唯一の基盤とし、レンジを
 * 再エンコードしない。
 *
 * @throws {InvalidAnswerError} 値が 0〜100 の整数でない場合。
 */
export function assertIntegerAnswer(value: unknown): AnswerScore {
  if (!isIntegerAnswer(value)) {
    throw new InvalidAnswerError(value);
  }
  // `-0`（`JSON.parse("-0")` 等で生じうる）を `0` へ正規化する。
  return value === 0 ? 0 : value;
}

/**
 * 得点精算エンジンのサーバ側最終検証（scoring_engine_design §2.5・SC-3 / INV-6）。
 *
 * `module:scoring` が公開する解答受理ゲートで、受信した解答を `answers` へ通す前に
 * 0〜100 の整数であることを保証する。タブレット UI（`src/tablet/` の 4 ボタン・
 * 0〜100 クランプ）を迂回して届いた −1 / 101 / 50.5 / 非数値を拒み、不正値が
 * `answers` へ到達することを防ぐ（UI ＋サーバの二重防衛のサーバ半分。DB `CHECK` が
 * 三層目）。
 *
 * 判定は本モジュール内の {@link assertIntegerAnswer} へ委譲し、レンジ判定を再エンコード
 * しない（唯一の基盤は回答レンジ値型 `answer_score.ts` の {@link isAnswerScore}）。
 * これにより精算コア（`apply_question_score`）や DB CHECK と同一のレンジ規約に一致する。
 * 受理できれば正規化した 0〜100 の整数を返し、そうでなければ監査可能な
 * {@link InvalidAnswerError}（拒否した生値を保持）を送出する。境界（release-blocking）:
 * 0=受理 / 100=受理 / −1=拒否 / 101=拒否 / 50.5=拒否。
 *
 * @throws {InvalidAnswerError} 値が 0〜100 の整数でない場合。
 */
export function validateSubmittedAnswer(raw: unknown): AnswerScore {
  return assertIntegerAnswer(raw);
}
