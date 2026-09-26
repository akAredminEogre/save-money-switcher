/**
 * エピソードの作成・編集・招待・参加・問題登録（`module:episodes`・案A P2 の業務層）。
 *
 * issue #2 の R3〜R6 と受入基準 AC-A3〜AC-A6 を満たす業務判断の単一の置き場である。
 * 認可（誰が admin か）は上位の `auth/access_guard.ts` が、身元は `auth/session_registry.ts` が
 * 既に持つゆえ、本モジュールは**認可を再実装しない**。ここが所有するのは次の業務規則だけである:
 *
 *   - 受理境界: 回名（非空・上限長）・問題番号（1〜10）・問題文（非空）・正解値（0〜100 整数）。
 *   - 招待されていないアカウントはエピソードへ参加できない（AC-A5 の裏返し）。
 *   - 参加は冪等である（同じ回へ二度参加しても `participantId` は増えない）。
 *   - 問題は (episode_id, question_number) で一意であり、同じ番号への再登録は上書き編集になる。
 *
 * 採番・時刻は `accounts/account_service.ts` と同じ作法で注入可能にし、検証を決定的に保つ。
 */

import { randomUUID } from "node:crypto";
import {
  isValidCorrectValue,
  isValidEpisodeTitle,
  isValidQuestionNumber,
  isValidQuestionText,
  toQuestion,
  type Episode,
  type EpisodeInvitation,
  type EpisodeParticipant,
  type EpisodeQuestion,
  type EpisodeStatus,
} from "./episode.js";
import {
  toEpisode,
  toEpisodeInvitation,
  toEpisodeParticipant,
  toEpisodeQuestion,
  toEpisodeRow,
  type EpisodeStore,
} from "./episode_store.js";
import type { Question } from "../questions/question.js";
import { MAX_EPISODE_TITLE_LENGTH } from "./episode.js";
import { QUESTION_NUMBER_MAX, QUESTION_NUMBER_MIN } from "../persistence/schema.js";
import { ANSWER_MAX, ANSWER_MIN } from "../scoring/answer_score.js";

/** 回名が受理境界を満たさない。 */
export class InvalidEpisodeTitleError extends Error {
  constructor() {
    super(`回の名前は ${MAX_EPISODE_TITLE_LENGTH} 文字以内で入力してください。`);
    this.name = "InvalidEpisodeTitleError";
  }
}

/** 対象のエピソードが存在しない。 */
export class EpisodeNotFoundError extends Error {
  constructor() {
    super("その回は存在しません。");
    this.name = "EpisodeNotFoundError";
  }
}

/** 問題番号が受理境界（1〜10）を満たさない。 */
export class InvalidQuestionNumberError extends Error {
  constructor() {
    super(`問題番号は ${QUESTION_NUMBER_MIN}〜${QUESTION_NUMBER_MAX} で指定してください。`);
    this.name = "InvalidQuestionNumberError";
  }
}

/** 問題文が空である。 */
export class InvalidQuestionTextError extends Error {
  constructor() {
    super("問題文を入力してください。");
    this.name = "InvalidQuestionTextError";
  }
}

/** 正解値が 0〜100 の整数でない。 */
export class InvalidCorrectValueError extends Error {
  constructor() {
    super(`正解は ${ANSWER_MIN}〜${ANSWER_MAX} の整数で入力してください。`);
    this.name = "InvalidCorrectValueError";
  }
}

/** 招待されていない者が参加しようとした。 */
export class NotInvitedError extends Error {
  constructor() {
    super("この回へは招待されていません。");
    this.name = "NotInvitedError";
  }
}

/** 採番・時刻の注入口（検証が決定的に固定できるようにする）。 */
export interface EpisodeServiceDeps {
  readonly newId?: () => string;
  readonly now?: () => string;
}

function resolveDeps(deps: EpisodeServiceDeps): { newId: () => string; now: () => string } {
  return {
    newId: deps.newId ?? ((): string => randomUUID()),
    now: deps.now ?? ((): string => new Date().toISOString()),
  };
}

/** エピソードを 1 件作成する（作成直後は下書き）。 */
export async function createEpisode(
  store: EpisodeStore,
  input: { readonly title: string; readonly createdBy: string },
  deps: EpisodeServiceDeps = {},
): Promise<Episode> {
  if (!isValidEpisodeTitle(input.title)) throw new InvalidEpisodeTitleError();
  const { newId, now } = resolveDeps(deps);
  const timestamp = now();
  const episode: Episode = {
    id: newId(),
    title: input.title.trim(),
    status: "draft",
    createdBy: input.createdBy,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await store.insertEpisode(toEpisodeRow(episode));
  return episode;
}

/** 全エピソードを作成順で返す（管理面の一覧が消費する）。 */
export async function listEpisodes(store: EpisodeStore): Promise<readonly Episode[]> {
  return (await store.listEpisodesOrderedByCreatedAt()).map(toEpisode);
}

/** `id` でエピソードを引く（無ければ `undefined`）。 */
export async function findEpisode(store: EpisodeStore, id: string): Promise<Episode | undefined> {
  const row = await store.findEpisodeById(id);
  return row === undefined ? undefined : toEpisode(row);
}

/** `id` でエピソードを引く（無ければ例外）。 */
async function requireEpisode(store: EpisodeStore, id: string): Promise<Episode> {
  const episode = await findEpisode(store, id);
  if (episode === undefined) throw new EpisodeNotFoundError();
  return episode;
}

/**
 * エピソードの名前・状態を編集する。与えたフィールドだけを更新する（部分更新）。
 *
 * @throws {EpisodeNotFoundError} 対象が存在しない。
 * @throws {InvalidEpisodeTitleError} 回名が受理境界を満たさない。
 */
export async function updateEpisode(
  store: EpisodeStore,
  id: string,
  patch: { readonly title?: string; readonly status?: EpisodeStatus },
  deps: EpisodeServiceDeps = {},
): Promise<Episode> {
  const existing = await requireEpisode(store, id);
  if (patch.title !== undefined && !isValidEpisodeTitle(patch.title)) {
    throw new InvalidEpisodeTitleError();
  }
  const { now } = resolveDeps(deps);
  const updated: Episode = {
    ...existing,
    ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    updatedAt: now(),
  };
  await store.updateEpisodeIfPresent(toEpisodeRow(updated));
  return updated;
}

/**
 * アカウントをエピソードへ招待する（冪等・既に招待済みなら何もしない）。
 * 招待してよいのが admin だけであることは呼出側の門番が担保する。
 *
 * @throws {EpisodeNotFoundError} 対象のエピソードが存在しない。
 */
export async function inviteAccount(
  store: EpisodeStore,
  episodeId: string,
  accountId: string,
  deps: EpisodeServiceDeps = {},
): Promise<EpisodeInvitation> {
  await requireEpisode(store, episodeId);
  const { now } = resolveDeps(deps);
  const invitation: EpisodeInvitation = { episodeId, accountId, invitedAt: now() };
  await store.insertInvitationIfAbsent({
    episode_id: invitation.episodeId,
    account_id: invitation.accountId,
    invited_at: invitation.invitedAt,
  });
  return invitation;
}

/** 当該エピソードの招待一覧（招待順）。 */
export async function listInvitations(
  store: EpisodeStore,
  episodeId: string,
): Promise<readonly EpisodeInvitation[]> {
  return (await store.listInvitationsByEpisode(episodeId)).map(toEpisodeInvitation);
}

/** 当該アカウントが招待されているエピソード一覧（AC-A5・招待されていない回は含まない）。 */
export async function listInvitedEpisodes(
  store: EpisodeStore,
  accountId: string,
): Promise<readonly Episode[]> {
  const invitations = await store.listInvitationsByAccount(accountId);
  const episodes: Episode[] = [];
  for (const invitation of invitations) {
    const row = await store.findEpisodeById(invitation.episode_id);
    if (row !== undefined) episodes.push(toEpisode(row));
  }
  return episodes;
}

/** 当該アカウントが当該エピソードへ招待されているか。 */
export async function isInvited(
  store: EpisodeStore,
  episodeId: string,
  accountId: string,
): Promise<boolean> {
  const invitations = await store.listInvitationsByEpisode(episodeId);
  return invitations.some((invitation) => invitation.account_id === accountId);
}

/**
 * エピソードへ参加する（AC-A6）。招待されている者だけが参加でき、参加は冪等である。
 * 返る {@link EpisodeParticipant} の `id` が、既存ドメインへ渡す `participantId` になる（設計 D3）。
 *
 * @throws {EpisodeNotFoundError} 対象のエピソードが存在しない。
 * @throws {NotInvitedError} 招待されていない。
 */
export async function joinEpisode(
  store: EpisodeStore,
  episodeId: string,
  accountId: string,
  deps: EpisodeServiceDeps = {},
): Promise<EpisodeParticipant> {
  await requireEpisode(store, episodeId);
  if (!(await isInvited(store, episodeId, accountId))) throw new NotInvitedError();
  const { newId, now } = resolveDeps(deps);
  const row = await store.insertParticipantIfAbsent({
    id: newId(),
    episode_id: episodeId,
    account_id: accountId,
    joined_at: now(),
  });
  return toEpisodeParticipant(row);
}

/** 当該エピソードの参加者一覧（参加順）。 */
export async function listParticipants(
  store: EpisodeStore,
  episodeId: string,
): Promise<readonly EpisodeParticipant[]> {
  return (await store.listParticipantsByEpisode(episodeId)).map(toEpisodeParticipant);
}

/** 当該アカウントの当該エピソードでの参加者レコード（未参加なら `undefined`）。 */
export async function findParticipation(
  store: EpisodeStore,
  episodeId: string,
  accountId: string,
): Promise<EpisodeParticipant | undefined> {
  const row = await store.findParticipant(episodeId, accountId);
  return row === undefined ? undefined : toEpisodeParticipant(row);
}

/** 問題登録の入力（メディアは任意・未指定は `null`）。 */
export interface RegisterQuestionInput {
  readonly questionNumber: number;
  readonly text: string;
  readonly correctValue: number;
  readonly imagePath?: string | null;
  readonly videoPath?: string | null;
}

/**
 * 回の問題・正解を登録する（AC-A3）。同じ問題番号への再登録は上書き編集になる。
 *
 * @throws {EpisodeNotFoundError} 対象のエピソードが存在しない。
 * @throws {InvalidQuestionNumberError} 問題番号が 1〜10 でない。
 * @throws {InvalidQuestionTextError} 問題文が空である。
 * @throws {InvalidCorrectValueError} 正解値が 0〜100 の整数でない。
 */
export async function registerQuestion(
  store: EpisodeStore,
  episodeId: string,
  input: RegisterQuestionInput,
  deps: EpisodeServiceDeps = {},
): Promise<EpisodeQuestion> {
  await requireEpisode(store, episodeId);
  if (!isValidQuestionNumber(input.questionNumber)) throw new InvalidQuestionNumberError();
  if (!isValidQuestionText(input.text)) throw new InvalidQuestionTextError();
  if (!isValidCorrectValue(input.correctValue)) throw new InvalidCorrectValueError();
  const { newId } = resolveDeps(deps);
  const stored = await store.upsertQuestion({
    id: newId(),
    episode_id: episodeId,
    question_number: input.questionNumber,
    text: input.text.trim(),
    correct_value: input.correctValue,
    image_path: input.imagePath ?? null,
    video_path: input.videoPath ?? null,
  });
  return toEpisodeQuestion(stored);
}

/** 当該エピソードの問題一覧（問題番号順）。 */
export async function listEpisodeQuestions(
  store: EpisodeStore,
  episodeId: string,
): Promise<readonly EpisodeQuestion[]> {
  return (await store.listQuestionsByEpisode(episodeId)).map(toEpisodeQuestion);
}

/**
 * 当該エピソードの問題を既存ドメイン型 {@link Question} の列として返す（問題番号順）。
 * 進行セッションへ載せる出題集合はこれを用いる（写像点は `episode.toQuestion` 一点）。
 */
export async function listQuestionsForPlay(
  store: EpisodeStore,
  episodeId: string,
): Promise<readonly Question[]> {
  return (await listEpisodeQuestions(store, episodeId)).map(toQuestion);
}
