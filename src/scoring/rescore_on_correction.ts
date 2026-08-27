// @generated-by: codd implement
// @generated-from: docs/design/system_design.md (design:system-design)
// @design-node: docs/design/system_design.md
// @output-paths: src, tests
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

/**
 * 正解訂正に伴う差分再採点（`module:scoring` × `module:game_state`・E-3残 / INV-6・INV-7）。
 *
 * decision_records ADR-E-3残 / system_design §2.6・op_auto_rescore で確定した
 * release-blocking 挙動を、純粋な計算として具体化する:
 *   「c 正解発表（`answer_revealed`）を実行した**開示済み以降**の問題で正解をライブ編集
 *    すると、各解答の誤差・増減円を編集後 `correct_value` から**再計算**し、直前に適用済み
 *    だった得点との**差分（balance difference）を残額へ適用**する。b（`answers_opened`）
 *    までしか進んでいない **c 未到達の問題は再採点の対象外**（境界外）。」
 *
 * 再採点範囲の下限判定は本モジュールでは再実装せず、`module:game_state` の
 * {@link isDisclosed}（開示済み = c 以降）を唯一の前提とする。得点式（誤差 = |解答−正解|・
 * 増減円 = 誤差 × −100・ピタリ賞 +1,000 円・円建て）も再実装せず、`module:scoring` の
 * 確定実装 {@link applyQuestionScore} を再利用する。差分は「編集後正解での得点寄与」から
 * 「編集前正解での得点寄与」を引いた値であり、これを各人の現在残額へ足し込む（差分適用）。
 *
 * さらに `game_state.stage` が d（`settlement_computed`）到達済みかを {@link isSettled} で
 * 判別し、d 到達問の訂正は残額の差分再計算を伴う旨（TV の d 精算・e 全員一覧を同時更新する
 * 消費側連鎖の根拠データ）を結果へ載せる。本モジュールは残額を「差分計算」するのみで、
 * `balances` への永続化・イベント配信・TV 描画は上位の再採点コーディネータ／消費面の責務。
 * `src/scoring/` をリーフに保つため他の実装単位（DB・realtime_sync）へ依存しない。
 */

import type { Stage } from "../game_state/progression.js";
import { isDisclosed, isSettled } from "../game_state/progression.js";
import { applyQuestionScore, SCORE_CURRENCY } from "./apply_question_score.js";
import { assertIntegerAnswer } from "./validate_answer.js";

/** 1 解答（`answers` の 1 行に対応）。差分再採点は問題内の全解答を対象とする。 */
export interface RescoredAnswer {
  /** 解答者の識別子（`answers.participant_id` に対応）。 */
  readonly participantId: number;
  /** 当該解答者の解答（0〜100 の整数）。 */
  readonly answer: number;
}

/**
 * 差分適用前の 1 プレイヤーの現在残額（`balances` の 1 行に対応）。差分は既にこの残額へ
 * 反映済みの「編集前正解による得点寄与」を含む前提で、その寄与を差し替える形で適用する。
 */
export interface RescoreBalanceState {
  /** 対象プレイヤーの識別子（`balances.participant_id` に対応）。 */
  readonly participantId: number;
  /** 差分適用前の現在残額（円・整数）。 */
  readonly amount: number;
}

/** 差分再採点の入力。編集前後の正解値・当該問の全解答・各人の現在残額を対にして与える。 */
export interface RescoreOnCorrectionInput {
  /** 当該問の進行段階（`rounds.stage`）。再採点範囲の下限判定に用いる唯一の前提。 */
  readonly stage: Stage;
  /** ライブ編集の**直前**に適用されていた正解値（0〜100 の整数）。差分の基準。 */
  readonly previousCorrect: number;
  /** ライブ編集で確定した**新しい**正解値（0〜100 の整数）。再計算の基準。 */
  readonly editedCorrect: number;
  /** 当該問の全解答（`answers`）。開示済みのとき全件が再計算対象となる。 */
  readonly answers: readonly RescoredAnswer[];
  /** 差分適用前の各人の現在残額。各解答者の残額は必ず含めること。 */
  readonly balances: readonly RescoreBalanceState[];
}

/** 1 プレイヤー分の差分再採点結果（TV d の 6 列表と TV e の残額の双方を供給する）。 */
export interface ParticipantRescore {
  /** 対象プレイヤーの識別子。 */
  readonly participantId: number;
  /** 編集後正解での誤差 = |解答 − 編集後正解|（0〜100 の整数）。TV(d) 誤差列。 */
  readonly error: number;
  /** 編集後正解での増減円 = 誤差 × −100（円・整数・0 以下）。TV(d) 増減円列。 */
  readonly delta: number;
  /** 編集後正解でのピタリ賞（誤差 0 で +1,000 円、それ以外 0）。TV(d) ピタリ賞列。 */
  readonly pitariBonus: number;
  /** 編集前正解での得点寄与（増減円 + ピタリ賞）。差分の基準値。 */
  readonly previousContribution: number;
  /** 編集後正解での得点寄与（増減円 + ピタリ賞）。 */
  readonly newContribution: number;
  /** 残額へ適用する差分 = 編集後寄与 − 編集前寄与（円・整数）。 */
  readonly balanceDifference: number;
  /** 差分適用後の残額 = 現在残額 + 差分（円・整数）。TV(d) 残額列・TV(e) 通算残額。 */
  readonly amount: number;
  /** 円建て固定の通貨表記（常に「円」）。 */
  readonly currency: typeof SCORE_CURRENCY;
}

/** 差分再採点の結果。開示前（境界外）は `rescored: false` で残額差分を返さない。 */
export interface RescoreOnCorrectionResult {
  /** 再採点が実行されたか。開示済み（c 以降）のとき `true`、c 未到達なら `false`。 */
  readonly rescored: boolean;
  /**
   * d（`settlement_computed`）到達済みの問題で残額の差分再計算を伴うか。`true` のとき
   * 上位は TV の d 精算・e 全員一覧を同時更新する（消費側連鎖の分岐条件）。
   */
  readonly settledDifferential: boolean;
  /** 判定に用いた当該問の進行段階。 */
  readonly stage: Stage;
  /** 再計算の基準とした編集後正解値。 */
  readonly correctValue: number;
  /** 各プレイヤーの差分再採点結果（`rescored: false` のときは空）。 */
  readonly participants: readonly ParticipantRescore[];
}

/** 解答者の現在残額が入力 `balances` に含まれないときのエラー（差分適用先が特定できない）。 */
export class UnknownParticipantBalanceError extends Error {
  /** 残額が見つからなかった解答者の識別子。 */
  readonly participantId: number;

  constructor(participantId: number) {
    super(
      `解答者 ${participantId} の現在残額が balances に含まれないため、差分を適用できません。`,
    );
    this.name = "UnknownParticipantBalanceError";
    this.participantId = participantId;
  }
}

/**
 * 指定正解に対する 1 解答の得点寄与（増減円 + ピタリ賞）と内訳を求める。
 *
 * 得点式は {@link applyQuestionScore} に委譲する（残額 0 起点で呼ぶことで、戻り値の残額が
 * そのまま当該問の得点寄与になる）。解答値の 0〜100 整数検証も委譲先が担う。
 */
function contributionFor(answer: number, correct: number): {
  readonly error: number;
  readonly delta: number;
  readonly pitariBonus: number;
  readonly total: number;
} {
  const score = applyQuestionScore({ balance: 0, answer, correct });
  return {
    error: score.error,
    delta: score.delta,
    pitariBonus: score.pitariBonus,
    total: score.delta + score.pitariBonus,
  };
}

/**
 * 正解訂正に伴う差分再採点を行う。
 *
 * 当該問の段階が**開示済み（c 以降・{@link isDisclosed}）**でなければ再採点しない
 * （`rescored: false`・`participants: []` を返し、残額は不変のまま据え置かれる ── c 未到達の
 * 正解編集は境界外）。開示済みのときは全解答について編集後正解での誤差・増減円・ピタリ賞を
 * 再計算し、編集前正解での得点寄与との**差分**を各人の現在残額へ適用した新残額を返す。
 * d 到達済み（{@link isSettled}）なら `settledDifferential: true` を立て、上位が TV の
 * d/e を同時更新する分岐の根拠とする。
 *
 * @throws {InvalidAnswerError} 編集前後の正解値または解答が 0〜100 の整数でない場合（委譲先が送出）。
 * @throws {UnknownParticipantBalanceError} 解答者の現在残額が `balances` に無い場合。
 */
export function rescoreOnCorrection(
  input: RescoreOnCorrectionInput,
): RescoreOnCorrectionResult {
  const editedCorrect = assertIntegerAnswer(input.editedCorrect);

  // c 未到達（開示前）の問題は再採点対象外 ── 残額を一切変更しない（境界外）。
  if (!isDisclosed(input.stage)) {
    return {
      rescored: false,
      settledDifferential: false,
      stage: input.stage,
      correctValue: editedCorrect,
      participants: [],
    };
  }

  const previousCorrect = assertIntegerAnswer(input.previousCorrect);
  const amountByParticipant = new Map<number, number>();
  for (const balance of input.balances) {
    amountByParticipant.set(balance.participantId, balance.amount);
  }

  const settledDifferential = isSettled(input.stage);

  const participants: ParticipantRescore[] = input.answers.map((entry) => {
    const currentAmount = amountByParticipant.get(entry.participantId);
    if (currentAmount === undefined) {
      throw new UnknownParticipantBalanceError(entry.participantId);
    }

    const previous = contributionFor(entry.answer, previousCorrect);
    const next = contributionFor(entry.answer, editedCorrect);
    const balanceDifference = next.total - previous.total;

    return {
      participantId: entry.participantId,
      error: next.error,
      delta: next.delta,
      pitariBonus: next.pitariBonus,
      previousContribution: previous.total,
      newContribution: next.total,
      balanceDifference,
      amount: currentAmount + balanceDifference,
      currency: SCORE_CURRENCY,
    };
  });

  return {
    rescored: true,
    settledDifferential,
    stage: input.stage,
    correctValue: editedCorrect,
    participants,
  };
}
