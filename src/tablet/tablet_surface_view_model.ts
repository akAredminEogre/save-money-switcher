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

// @output-paths: src, tests
import { formatYen } from "../scoring/currency.js";
import { ROLE_LABELS } from "../game_state/role_labels.js";
import type { Role } from "../game_state/role_labels.js";
import { clampToAnswerRange } from "./answer_stepper.js";
import { tabletStatusLabel, isInputLocked, type TabletInputStatus } from "./tablet_status.js";

/**
 * 解答者タブレット面の表示モデル（`module:tablet`・surface_copy_obligations §2.3 /
 * op_render_tablet_surface / dod_tablet_minimal_elements_only /
 * dod_tablet_no_others_info / dod_tablet_contestant_copy_only）。
 *
 * タブレットは **入力専用最小 UI** であり、可視要素は 問題番号・数値入力（−10/−1/+1/+10 の
 * 4 ボタン）・送信／送信済み・自分の残額（円）・受付中／締切 に限られる（N-1・第三要件）。
 * 本モジュールは入力状態から可視文言と操作記述子を投影する単一の変換点であり、金額は
 * {@link formatYen}（円建て固定・点化禁止）、ロール語は {@link ROLE_LABELS}（内部識別子
 * 非露出）、数値の境界クランプは `answer_stepper` の {@link clampToAnswerRange}（0〜100）へ
 * それぞれ束縛して、二重定義のドリフトを排する。
 *
 * プライバシー投影を **型で強制** する: 入力 {@link TabletSurfaceState} は自分の情報
 * （問題番号・自分の数値入力・自分の送信状態・自分の残額・受付状態）のみを持ち、他者の
 * 氏名／解答／残額／得点・出題本文・全体一覧のフィールドを構造的に持たない。ゆえに投影
 * 経路に他者情報・出題本文・全体一覧が混入し得ない（dod_tablet_no_others_info）。
 */

/**
 * 解答者タブレット面の入力状態（自分の情報のみ）。
 *
 * 他者情報・出題本文・全体一覧のフィールドを持たない（プライバシー投影を型で固定）。
 */
export interface TabletSurfaceState {
  /** 現在の問題番号（1〜10）。 */
  questionNumber: number;
  /** 現在ステッパで作成中の解答値（0〜100 に投影時クランプ）。 */
  answerValue: number;
  /** 自分の解答を送信済みか。 */
  submitted: boolean;
  /** 自分の残額（整数円・下限なし）。 */
  ownBalanceYen: number;
  /** 受付中／締切の入力受付状態。 */
  status: TabletInputStatus;
  /**
   * 自分の表示名（任意）。参加者を突合できた接続にのみ供給される自分自身の情報であり、
   * 他者情報ではない（`dod_tablet_no_others_info` を侵さない）。未指定のときは面に一切
   * 描画しない（未参加・匿名接続の見え方を従来どおりに保つ）。
   */
  displayName?: string;
}

/** 数値入力ステッパ 1 ボタンの表示記述子（−10/−1/+1/+10）。 */
export interface TabletStepperButton {
  /** 増減量（-10 / -1 / 1 / 10）。 */
  readonly delta: number;
  /** ボタン可視ラベル（例 −10 / +10）。 */
  readonly label: string;
  /** 締切時に無効化されるか。 */
  readonly disabled: boolean;
}

/** 解答者タブレット面の投影済み表示モデル。 */
export interface TabletSurfaceViewModel {
  /** 面のロール可視ラベル（解答者・単一定義 ROLE_LABELS 由来）。 */
  readonly roleLabel: string;
  /** 数値入力領域の可視ラベル。 */
  readonly numericInputLabel: string;
  /** 受付状態の可視ラベル（受付中／締切）。 */
  readonly statusLabel: string;
  /** 問題番号の可視ラベル（例 第3問）。 */
  readonly questionNumberLabel: string;
  /** 0〜100 にクランプ済みの現在解答値。 */
  readonly answerValue: number;
  /** −10/−1/+1/+10 の 4 ステッパボタン。 */
  readonly stepperButtons: readonly TabletStepperButton[];
  /** 締切（入力ロック）状態か。 */
  readonly inputLocked: boolean;
  /** 送信済みか。 */
  readonly submitted: boolean;
  /** 送信ボタンの可視ラベル。 */
  readonly submitLabel: string;
  /** 送信済み確認の可視ラベル（未送信なら null）。 */
  readonly submittedLabel: string | null;
  /** 自分の残額の可視文言（円建て・formatYen 経由）。 */
  readonly ownBalanceText: string;
  /** 自分の表示名（未供給なら undefined・描画しない）。 */
  readonly displayName?: string;
}

const CONTESTANT_ROLE: Role = "contestant";
// 数値入力は −10/−1/+1/+10 の 4 ボタン方式（テンキー直接入力ではない・N-1）。
const STEP_DELTAS = [-10, -1, 1, 10] as const;
const NUMERIC_INPUT_LABEL = "数値入力";
const SUBMIT_LABEL = "送信";
const SUBMITTED_LABEL = "送信済み";

function stepLabel(delta: number): string {
  const sign = delta < 0 ? "−" : "+";
  return `${sign}${Math.abs(delta)}`;
}

/**
 * 入力状態を解答者タブレット面の表示モデルへ投影する。
 *
 * 数値入力値は 0〜100 へクランプし（0 未満・100 超へ振り切れない）、金額は円建てで整形し、
 * ロール語は単一定義から供給する。締切時は数値入力・送信を無効化する。
 */
export function buildTabletSurfaceViewModel(state: TabletSurfaceState): TabletSurfaceViewModel {
  const locked = isInputLocked(state.status);
  const answerValue = clampToAnswerRange(state.answerValue);
  const stepperButtons: TabletStepperButton[] = STEP_DELTAS.map((delta) => ({
    delta,
    label: stepLabel(delta),
    disabled: locked,
  }));
  return {
    roleLabel: ROLE_LABELS[CONTESTANT_ROLE],
    numericInputLabel: NUMERIC_INPUT_LABEL,
    statusLabel: tabletStatusLabel(state.status),
    questionNumberLabel: `第${state.questionNumber}問`,
    answerValue,
    stepperButtons,
    inputLocked: locked,
    submitted: state.submitted,
    submitLabel: SUBMIT_LABEL,
    submittedLabel: state.submitted ? SUBMITTED_LABEL : null,
    ownBalanceText: `あなたの残額 ${formatYen(state.ownBalanceYen)}`,
    displayName: state.displayName,
  };
}

/**
 * 表示モデルの可視文言のみを列挙する（属性名・クラス名等のマークアップ由来語を含めない）。
 *
 * 禁止コピー走査（内部ロール識別子・内部イベント名・設定キー名・デモ/テスト表記・
 * point/pt/点 の不在検証）は、この可視文言集合に対してのみ行う（マークアップの付随語で
 * 偽陽性を出さない）。
 *
 * {@link TabletSurfaceViewModel.displayName}（参加者の自己入力氏名）は**意図的に含めない**。
 * 本集合はサーフェスの文言義務（面が供給するコピー）の走査対象であり、利用者が入力した
 * 氏名を混ぜると、氏名の綴り次第で禁止コピー走査が偽陽性を出す（面のコピー義務は氏名の
 * 内容に依らない）。
 */
export function collectTabletVisibleText(vm: TabletSurfaceViewModel): string[] {
  const texts = [
    vm.roleLabel,
    vm.numericInputLabel,
    vm.statusLabel,
    vm.questionNumberLabel,
    vm.submitLabel,
    vm.ownBalanceText,
    ...vm.stepperButtons.map((b) => b.label),
  ];
  if (vm.submittedLabel !== null) texts.push(vm.submittedLabel);
  return texts;
}
