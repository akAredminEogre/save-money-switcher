/**
 * エピソードのドメイン型（`module:episodes`・案A P2 / 設計 D3）。
 *
 * エピソードは「1 回の収録・開催」を表す恒久エンティティである。誰が参加してよいか（招待）・
 * 実際に参加した解答者（参加者）・その回の問題と正解を束ね、issue #2 の
 * 「MC がエピソードを作成し、解答者を招待し、招待された解答者がログインして参加する」動線の
 * データ基盤になる。
 *
 * 既存 QC 済みドメイン（scoring / game_state / realtime_sync / render_*）との接続規約（設計 D3）:
 *   既存ドメインは `participantId: string` を鍵に動く。エピソード参加者
 *   （{@link EpisodeParticipant}）の `id` を **そのまま `participantId` として渡す**。ゆえに
 *   ドメイン側は「その ID が何に由来するか」を知らずに済み、無改変のまま案A へ載る。
 *
 * 問題・正解は既存 {@link Question} と同じ意味を持つ（0〜100 の整数正解値・問題番号 1〜10）。
 * 二重定義を避けるため、範囲の判定は既存の単一定義点（`scoring/answer_score.ts` の
 * {@link isAnswerScore}、`persistence/schema.ts` の問題番号レンジ）を再利用し、
 * {@link toQuestion} が既存ドメイン型への唯一の写像点になる。
 */

import { isAnswerScore, type AnswerScore } from "../scoring/answer_score.js";
import { QUESTION_NUMBER_MAX, QUESTION_NUMBER_MIN } from "../persistence/schema.js";
import type { Question } from "../questions/question.js";

/** エピソードの状態の宣言集合（下書き / 開催中 / 終了）。 */
export const EPISODE_STATUSES = ["draft", "live", "finished"] as const;

/** エピソードの状態。 */
export type EpisodeStatus = (typeof EPISODE_STATUSES)[number];

/** 値が正当な {@link EpisodeStatus} かを判定する型ガード（永続層からの読み戻しの検査に用いる）。 */
export function isEpisodeStatus(value: unknown): value is EpisodeStatus {
  return typeof value === "string" && (EPISODE_STATUSES as readonly string[]).includes(value);
}

/** エピソード名の長さ上限（コードポイント基準）。 */
export const MAX_EPISODE_TITLE_LENGTH = 60;

/** エピソード名が受理境界を満たすか（前後空白を除いて非空・上限長以内）。 */
export function isValidEpisodeTitle(raw: string): boolean {
  const length = [...raw.trim()].length;
  return length >= 1 && length <= MAX_EPISODE_TITLE_LENGTH;
}

/** 問題番号が受理境界（1〜10 の整数）を満たすか。範囲の定義点は `persistence/schema.ts` と共有する。 */
export function isValidQuestionNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= QUESTION_NUMBER_MIN &&
    value <= QUESTION_NUMBER_MAX
  );
}

/** 問題文が受理境界を満たすか（前後空白を除いて非空）。 */
export function isValidQuestionText(raw: string): boolean {
  return raw.trim() !== "";
}

/** エピソード（`episodes` テーブル）。 */
export interface Episode {
  /** 内部識別子（`episodes.id`・主キー）。 */
  readonly id: string;
  /** 回の名前（`episodes.title`・画面に出る）。 */
  readonly title: string;
  /** 状態（`episodes.status`）。 */
  readonly status: EpisodeStatus;
  /** 作成した管理者のアカウント ID（`episodes.created_by`）。 */
  readonly createdBy: string;
  /** 作成時刻（ISO-8601）。 */
  readonly createdAt: string;
  /** 更新時刻（ISO-8601）。 */
  readonly updatedAt: string;
}

/** 招待（`episode_invitations` テーブル・PK は (episode_id, account_id)）。 */
export interface EpisodeInvitation {
  readonly episodeId: string;
  readonly accountId: string;
  readonly invitedAt: string;
}

/**
 * 参加者（`episode_participants` テーブル・`unique(episode_id, account_id)`）。
 * `id` が既存ドメインの `participantId` として渡る唯一の値である（設計 D3）。
 */
export interface EpisodeParticipant {
  readonly id: string;
  readonly episodeId: string;
  readonly accountId: string;
  readonly joinedAt: string;
}

/** 回ごとの問題・正解（`episode_questions` テーブル・`unique(episode_id, question_number)`）。 */
export interface EpisodeQuestion {
  readonly id: string;
  readonly episodeId: string;
  /** 問題番号（1〜10）。 */
  readonly questionNumber: number;
  readonly text: string;
  /** 正解値（0〜100 の整数）。 */
  readonly correctValue: AnswerScore;
  readonly imagePath: string | null;
  readonly videoPath: string | null;
}

/**
 * エピソードの問題を既存ドメイン型 {@link Question} へ写す唯一の変換点。
 * 既存の出題面・採点は本型を受け取るため、エピソード固有の列（`episodeId`）はここで落とす。
 */
export function toQuestion(question: EpisodeQuestion): Question {
  return {
    id: question.id,
    questionNumber: question.questionNumber,
    text: question.text,
    imagePath: question.imagePath,
    videoPath: question.videoPath,
    correctValue: question.correctValue,
  };
}

/** 未検査の値が 0〜100 の整数の正解値かを判定する（既存の単一定義点へ委ねる）。 */
export function isValidCorrectValue(value: unknown): value is AnswerScore {
  return isAnswerScore(value);
}
