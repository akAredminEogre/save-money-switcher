/**
 * コマンド合成中枢（`module:server`・cmd_2159 Phase1）。
 *
 * クライアント→サーバのコマンド（ホスト操作・タブレット解答・参加）を受け、既存 QC 済み
 * ドメインの離散遷移関数（`round_machine` / `tv_machine` / `progression` / `stageToTvMode` /
 * `scoring.settleQuestion` / `scoring.validateSubmittedAnswer`）を **import 合成のみ**で適用し、
 * {@link session} を前進させて {@link ServerEvent} 列（`protocol.stampServerEvent` で封筒化）を
 * 返す。中央 reducer は既存に無いため、本モジュールが「コマンド → 状態遷移 → ServerEvent」の
 * 唯一の合成点になる（設計 P2b・要確認B）。ドメインモジュールは一切改変しない。
 *
 * 進行の権威づけ:
 *   - 各問の段階遷移（lock/open/reveal/settle）は `round_machine.nextStage`（不正遷移は RangeError）。
 *   - TV 表示モードは段階遷移では `stageToTvMode`、自由往来（次へ/戻る/個別ジャンプ）では `tv_machine`。
 *   - 精算は `scoring.settleQuestion`（残額は `aggregateBalance` が台帳から導出・session 側）。
 *   - 解答受理は `scoring.validateSubmittedAnswer`（0〜100 整数のサーバ側最終防衛）。
 */

import { nextStage } from "../game_state/round_machine.js";
import { nextMode, backMode, jumpMode } from "../game_state/tv_machine.js";
import { stageToTvMode } from "../game_state/tv_mode.js";
import { acceptsSubmissions, INITIAL_STAGE, type Stage } from "../game_state/progression.js";
import { settleQuestion, type AnswerRow } from "../scoring/settle_question.js";
import { validateSubmittedAnswer, InvalidAnswerError } from "../scoring/validate_answer.js";
import {
  stampServerEvent,
  isTvMode,
  type ServerEvent,
  type ServerEventDraft,
  type TvMode,
} from "../realtime_sync/protocol.js";
import type { Participant } from "../participants/participant.js";
import { isValidDisplayName, MAX_DISPLAY_NAME_LENGTH } from "../participants/name.js";
import {
  session,
  currentStage,
  currentQuestion,
  answersForQuestion,
  QUESTIONS_PER_GAME,
  type Session,
} from "./session.js";

/** コマンド適用の結果。`ok=false` のときは `status`/`error` を添えて呼出側が HTTP へ写す。 */
export interface CommandResult {
  readonly ok: boolean;
  readonly status?: number;
  readonly error?: string;
  readonly events: readonly ServerEvent[];
  /** 参加確定コマンド（join）のときのみ、生成された参加者を返す。 */
  readonly participant?: Participant;
}

/** 制御盤が `data-command` として送るホスト操作の識別子（`control_panel/host_triggers` と一致）。 */
export type HostCommandName =
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

const HOST_COMMAND_NAMES: readonly HostCommandName[] = [
  "load_questions",
  "lock_answers",
  "open_answers",
  "reveal_answer",
  "compute_settlement",
  "mode_next",
  "mode_back",
  "mode_jump",
  "edit_question",
  "undo",
];

function isHostCommandName(value: unknown): value is HostCommandName {
  return typeof value === "string" && (HOST_COMMAND_NAMES as readonly string[]).includes(value);
}

/** 一意な識別子を採番する（ローカル試遊の揮発 id・衝突回避に連番＋時刻を用いる）。 */
let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

/** ServerEvent を現在段階・問番号・TV モードの文脈付きで封筒化する。 */
function stamp<T>(draft: Omit<ServerEventDraft<T>, "stage" | "questionNumber" | "tvMode"> & {
  stage?: Stage;
  questionNumber?: number;
  tvMode?: TvMode;
}, s: Session = session): ServerEvent<T> {
  return stampServerEvent(s.seq, {
    ...draft,
    stage: draft.stage ?? currentStage(s),
    questionNumber: draft.questionNumber ?? s.game.currentQuestionNumber,
    tvMode: draft.tvMode ?? s.game.tvMode,
  });
}

/**
 * ホスト操作コマンドを適用する。段階遷移は `round_machine`、モード往来は `tv_machine` を
 * 単一判定点として用い、精算時のみ `scoring.settleQuestion` を呼ぶ。不正遷移
 * （例: 未開示での精算・二重ロック）は `round_machine` が RangeError を投げるため、それを
 * 409（業務的な拒否）として写す（サーバは 5xx にしない）。
 */
export function applyHostCommand(
  command: unknown,
  mode?: unknown,
  s: Session = session,
): CommandResult {
  if (!isHostCommandName(command)) {
    return { ok: false, status: 400, error: `未知のホストコマンドです: ${String(command)}`, events: [] };
  }

  try {
    switch (command) {
      case "load_questions":
        return loadOrAdvance(s);
      case "lock_answers":
        return advanceStage("lock", "answers_locked", s);
      case "open_answers":
        return advanceStage("open", "answers_opened", s);
      case "reveal_answer":
        return advanceStage("reveal", "answer_revealed", s);
      case "compute_settlement":
        return computeSettlement(s);
      case "mode_next":
        return switchMode(nextMode(s.game.tvMode), s);
      case "mode_back":
        return switchMode(backMode(s.game.tvMode), s);
      case "mode_jump": {
        if (!isTvMode(mode)) {
          return { ok: false, status: 400, error: "個別ジャンプには mode(a〜e) が必要です。", events: [] };
        }
        return switchMode(jumpMode(mode), s);
      }
      case "edit_question":
        // 問題・正解のライブ編集 UI は Phase2（設計 phase2_deferred）。Phase1 は無操作。
        return { ok: true, events: [] };
      case "undo":
        // 取消の巻き戻し範囲（settlements/balances）は F-03 未確定ゆえ発明しない（Phase1 は無操作）。
        return { ok: true, events: [] };
    }
  } catch (err) {
    if (err instanceof RangeError) {
      return { ok: false, status: 409, error: err.message, events: [] };
    }
    throw err;
  }
}

/**
 * 「問題を読み込む」= 出題開始／次問への前進。lobby では第1問を出題開始し、当該問が精算済み
 * （settlement_computed）なら次問へ前進する。最終問（10問目）精算済みなら finished（通算一覧）へ。
 * 進行中の問で押された場合は無操作（再読込で状態を壊さない）。
 */
function loadOrAdvance(s: Session): CommandResult {
  if (!s.loaded) {
    s.loaded = true;
    s.game.phase = "in_progress";
    s.stages.set(s.game.currentQuestionNumber, INITIAL_STAGE);
    s.game.tvMode = stageToTvMode(INITIAL_STAGE);
    return { ok: true, events: [stamp({ type: "tv_mode_changed", payload: { mode: s.game.tvMode } }, s)] };
  }
  const stage = currentStage(s);
  if (stage !== "settlement_computed") {
    // 進行中の問での再読込は無操作（出題面を壊さない）。
    return { ok: true, events: [] };
  }
  if (s.game.currentQuestionNumber < QUESTIONS_PER_GAME) {
    s.game.currentQuestionNumber += 1;
    s.stages.set(s.game.currentQuestionNumber, INITIAL_STAGE);
    s.game.phase = "in_progress";
    s.game.tvMode = stageToTvMode(INITIAL_STAGE);
    return { ok: true, events: [stamp({ type: "tv_mode_changed", payload: { mode: s.game.tvMode } }, s)] };
  }
  // 全問精算済み: 通算一覧（e）へ。
  s.game.phase = "finished";
  s.game.tvMode = "e";
  return { ok: true, events: [stamp({ type: "tv_mode_changed", payload: { mode: "e" } }, s)] };
}

/** 段階を 1 段前進させ、既定 TV モードを追従させる（lock/open/reveal）。 */
function advanceStage(
  command: "lock" | "open" | "reveal",
  eventType: "answers_locked" | "answers_opened" | "answer_revealed",
  s: Session,
): CommandResult {
  const qno = s.game.currentQuestionNumber;
  const next = nextStage(currentStage(s), command); // 不正遷移は RangeError
  s.stages.set(qno, next);
  s.game.tvMode = stageToTvMode(next);
  return { ok: true, events: [stamp({ type: eventType, stage: next, tvMode: s.game.tvMode, payload: {} }, s)] };
}

/** 精算（settle）: 当該問の全解答を `settleQuestion` で台帳化し、段階を settlement_computed へ。 */
function computeSettlement(s: Session): CommandResult {
  const qno = s.game.currentQuestionNumber;
  const next = nextStage(currentStage(s), "settle"); // answer_revealed→settlement_computed（不正は RangeError）
  const question = currentQuestion(s);
  const answerMap = answersForQuestion(qno, s);
  const rows: AnswerRow[] = s.participants
    .filter((p) => answerMap.has(p.id))
    .map((p) => ({ participantId: p.id, value: answerMap.get(p.id) as number }));
  const settlements = settleQuestion(String(qno), question.correctValue, rows);
  s.settlements.set(qno, settlements);
  s.stages.set(qno, next);
  s.game.tvMode = stageToTvMode(next);
  const settledEvent = stamp({ type: "settlement_computed", stage: next, tvMode: s.game.tvMode, payload: { questionNumber: qno } }, s);
  const balanceEvent = stamp({ type: "balance_updated", payload: { questionNumber: qno } }, s);
  return { ok: true, events: [settledEvent, balanceEvent] };
}

/** TV 表示モードのみを切り替える（段階は動かさない・`tv_machine` の自由往来）。 */
function switchMode(mode: TvMode, s: Session): CommandResult {
  s.game.tvMode = mode;
  return { ok: true, events: [stamp({ type: "tv_mode_changed", tvMode: mode, payload: { mode } }, s)] };
}

/**
 * タブレット解答を受理する（`scoring.validateSubmittedAnswer` で 0〜100 整数を最終防衛）。
 * 現在問が受付中（accepting）でなければ拒否する（締切後の送信は `acceptsSubmissions` が false）。
 */
export function applyAnswer(participantId: unknown, value: unknown, s: Session = session): CommandResult {
  if (typeof participantId !== "string" || !s.participants.some((p) => p.id === participantId)) {
    return { ok: false, status: 400, error: "未知の参加者です。", events: [] };
  }
  if (!acceptsSubmissions(currentStage(s))) {
    return { ok: false, status: 409, error: "受付は締め切られています。", events: [] };
  }
  let normalized: number;
  try {
    normalized = validateSubmittedAnswer(value);
  } catch (err) {
    if (err instanceof InvalidAnswerError) {
      return { ok: false, status: 400, error: err.message, events: [] };
    }
    throw err;
  }
  answersForQuestion(s.game.currentQuestionNumber, s).set(participantId, normalized);
  return { ok: true, events: [stamp({ type: "submit_ack", payload: { participantId } }, s)] };
}

/**
 * 参加を確定する（氏名自己入力・op_join_game の Phase1 版）。氏名は非空（trim 後）を要件とし、
 * HTML 無害化は描画層（render_control_panel）が担うため本層は最小の非空検証のみ行う。
 */
export function applyJoin(name: unknown, s: Session = session): CommandResult {
  if (typeof name !== "string" || name.trim() === "") {
    return { ok: false, status: 400, error: "お名前を入力してください。", events: [] };
  }
  if (!isValidDisplayName(name)) {
    return { ok: false, status: 400, error: `氏名は ${MAX_DISPLAY_NAME_LENGTH} 文字以内で入力してください。`, events: [] };
  }
  const participant: Participant = {
    id: nextId("p"),
    name: name.trim(),
    joinedAt: new Date().toISOString(),
    connectionId: nextId("c"),
  };
  s.participants.push(participant);
  const event = stamp({ type: "participant_joined", payload: { participantId: participant.id } }, s);
  return { ok: true, events: [event], participant };
}

/**
 * 参加者の氏名のみを更新する（メンバー設定面 `/me` の改名コマンド・cmd_2159 機能追加）。
 *
 * `id` / `connectionId` / `joinedAt` は一切変えない。参加は `connectionId` の一意性のみが
 * 1 人 = 1 台を担保する不変（PC-INV-1）ゆえ、改名で識別子が動けば同一人物の同一性が壊れる。
 * 氏名の受理境界は {@link isValidDisplayName}（UI とサーバが共有する単一バリデータ）だけを
 * 用い、拒否文言は {@link applyJoin} と同一に保つ（同じ入力に別の言い方をしない）。
 */
export function applyRenameParticipant(
  participantId: unknown,
  name: unknown,
  s: Session = session,
): CommandResult {
  if (typeof participantId !== "string") {
    return { ok: false, status: 404, error: "未知の参加者です。", events: [] };
  }
  const participant = s.participants.find((p) => p.id === participantId);
  if (participant === undefined) {
    return { ok: false, status: 404, error: "未知の参加者です。", events: [] };
  }
  if (typeof name !== "string" || name.trim() === "") {
    return { ok: false, status: 400, error: "お名前を入力してください。", events: [] };
  }
  if (!isValidDisplayName(name)) {
    return { ok: false, status: 400, error: `氏名は ${MAX_DISPLAY_NAME_LENGTH} 文字以内で入力してください。`, events: [] };
  }
  participant.name = name.trim();
  const event = stamp({ type: "participant_renamed", payload: { participantId: participant.id } }, s);
  return { ok: true, events: [event], participant };
}
