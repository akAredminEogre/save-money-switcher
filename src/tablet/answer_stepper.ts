// @generated-by: codd implement
// @generated-from: docs/design/system_design.md (design:system-design)
// @design-node: docs/design/system_design.md
// @output-paths: src, tests
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

/**
 * タブレット解答入力の 4 ボタンステッパ（`module:tablet`）。
 *
 * 解答者タブレットの数値入力は **+1 / −1 / +10 / −10 の 4 ボタン方式**で 0〜100 の整数を
 * 増減する（テンキー直接入力ではない・ADR-N-1 / system_design §2.9）。本モジュールはその
 * 値合成と**境界クランプ**（0 未満・100 超へ振り切れない）の単一所有者であり、INV-6
 * 「0〜100 整数のみ受理する二重防衛」の **UI 側（クライアント側ガード）**を担う。対となる
 * サーバ側の最終防衛は `src/scoring/validate_answer.ts`（`assertIntegerAnswer`）で、両者は
 * 機構として独立しつつ同じ 0〜100 整数の境界を共有する。
 *
 * 合成値は常に 0〜100 の整数に保たれる: 初期値は整数へ丸めてから範囲へクランプし、各ボタン
 * は整数デルタ（±1 / ±10）を加えたうえで {@link clampToAnswerRange} を必ず通す。したがって
 * どのボタンをどの順序・回数で押しても、値が負・100 超・非整数へ振り切れることはなく、UI を
 * 迂回した不正な初期値も不正状態を作れない。値は不変で、各操作は既存のステッパを変更せず
 * 新しい {@link AnswerStepper} を返す。本モジュールは他の実装単位へ依存しないリーフに保つ。
 */

/** 受理する解答値の下限（サーバ側 validate_answer と一致する二重防衛の境界）。 */
export const ANSWER_MIN_VALUE = 0;

/** 受理する解答値の上限（サーバ側 validate_answer と一致する二重防衛の境界）。 */
export const ANSWER_MAX_VALUE = 100;

/** 新規問題でステッパが置かれる初期値（受付開始時は下限 0 から合成を始める）。 */
export const INITIAL_ANSWER_VALUE = ANSWER_MIN_VALUE;

/**
 * 4 ボタンとその増減量の対応。UI の 4 ボタン（+1 / −1 / +10 / −10）はこの写像を唯一の
 * 出典とし、増減量を他所で再定義しない。
 */
export const STEP_DELTAS = {
  plusOne: 1,
  minusOne: -1,
  plusTen: 10,
  minusTen: -10,
} as const;

/** ステッパのボタン識別子（`STEP_DELTAS` のキー）。 */
export type StepButton = keyof typeof STEP_DELTAS;

/** ボタン 1 回分の増減量（+1 / −1 / +10 / −10 のいずれか）。 */
export type StepDelta = (typeof STEP_DELTAS)[StepButton];

/**
 * 4 ボタンで合成中の解答値。常に 0〜100 の整数を保持する不変値。操作は既存値を変更せず、
 * 新しい {@link AnswerStepper} を返す。
 */
export interface AnswerStepper {
  /** 現在の合成値（常に 0〜100 の整数）。 */
  readonly value: number;
}

/**
 * 任意の数値を 0〜100 の整数の解答値へ正規化する。整数へ丸めたうえで下限 0・上限 100 へ
 * クランプし、`NaN` は下限へ倒す（`+Infinity` は上限 100、`-Infinity`・負値は下限 0）。
 * これが「0 未満・100 超へ振り切れない」境界固定の核であり、ステッパの生成・各ボタン操作は
 * すべて本関数を経由して不変条件（0〜100 の整数）を保つ。
 */
export function clampToAnswerRange(value: number): number {
  if (Number.isNaN(value)) {
    return ANSWER_MIN_VALUE;
  }
  const asInteger = Math.round(value);
  if (asInteger <= ANSWER_MIN_VALUE) {
    return ANSWER_MIN_VALUE;
  }
  if (asInteger >= ANSWER_MAX_VALUE) {
    return ANSWER_MAX_VALUE;
  }
  return asInteger;
}

/**
 * 初期値を与えてステッパを生成する。初期値は {@link clampToAnswerRange} で 0〜100 の整数へ
 * 正規化されるため、範囲外・非整数を渡しても不変条件は破れない。既定は
 * {@link INITIAL_ANSWER_VALUE}（0）。再接続復帰などで送信済み値から再開する場合はその値を渡す。
 */
export function createAnswerStepper(
  initialValue: number = INITIAL_ANSWER_VALUE,
): AnswerStepper {
  return { value: clampToAnswerRange(initialValue) };
}

/**
 * ステッパへ増減量を 1 回加え、新しいステッパを返す。加算後は必ず
 * {@link clampToAnswerRange} を通すため、下限 0 で更に −1/−10 を押しても 0 のまま、上限 100 で
 * 更に +1/+10 を押しても 100 のままで、範囲外・非整数へ振り切れない。
 */
export function stepAnswer(stepper: AnswerStepper, delta: StepDelta): AnswerStepper {
  return { value: clampToAnswerRange(stepper.value + delta) };
}

/** +1 ボタン。現在値へ 1 を加え 0〜100 でクランプする。 */
export function plusOne(stepper: AnswerStepper): AnswerStepper {
  return stepAnswer(stepper, STEP_DELTAS.plusOne);
}

/** −1 ボタン。現在値から 1 を引き 0〜100 でクランプする。 */
export function minusOne(stepper: AnswerStepper): AnswerStepper {
  return stepAnswer(stepper, STEP_DELTAS.minusOne);
}

/** +10 ボタン。現在値へ 10 を加え 0〜100 でクランプする。 */
export function plusTen(stepper: AnswerStepper): AnswerStepper {
  return stepAnswer(stepper, STEP_DELTAS.plusTen);
}

/** −10 ボタン。現在値から 10 を引き 0〜100 でクランプする。 */
export function minusTen(stepper: AnswerStepper): AnswerStepper {
  return stepAnswer(stepper, STEP_DELTAS.minusTen);
}
