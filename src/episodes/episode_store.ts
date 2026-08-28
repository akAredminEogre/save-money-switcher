/**
 * エピソード系 4 表の永続化境界と行 ⇄ ドメイン型の写像（`module:episodes`・設計 D3 / D7）。
 *
 * `accounts/account_store.ts` と同じ作法で「境界（{@link EpisodeStore}）と実装の分離」を採る。
 * 物理永続（現行は zero-dependency の JSON ファイル）は差し替え可能であり、将来 SQLite へ移す
 * 際も影響は Store 実装だけに閉じる。本モジュールが所有するのは行 ⇄ ドメイン型の写像と、
 * 一意性（招待の 2 列 PK・参加者の (episode_id, account_id)・問題の (episode_id, question_number)）
 * を境界の契約として宣言することであり、業務判断（招待の有無で参加を拒む等）は
 * `episode_service` が持つ。
 *
 * DB カラムは snake_case、ドメイン型のフィールドは camelCase で対応する。
 */

import {
  isEpisodeStatus,
  type Episode,
  type EpisodeInvitation,
  type EpisodeParticipant,
  type EpisodeQuestion,
  type EpisodeStatus,
} from "./episode.js";
import { isAnswerScore } from "../scoring/answer_score.js";

/** `episodes` テーブルの 1 行。 */
export interface EpisodeRow {
  readonly id: string;
  readonly title: string;
  readonly status: EpisodeStatus;
  readonly created_by: string;
  readonly created_at: string;
  readonly updated_at: string;
}

/** `episode_invitations` テーブルの 1 行。 */
export interface EpisodeInvitationRow {
  readonly episode_id: string;
  readonly account_id: string;
  readonly invited_at: string;
}

/** `episode_participants` テーブルの 1 行。 */
export interface EpisodeParticipantRow {
  readonly id: string;
  readonly episode_id: string;
  readonly account_id: string;
  readonly joined_at: string;
}

/** `episode_questions` テーブルの 1 行。 */
export interface EpisodeQuestionRow {
  readonly id: string;
  readonly episode_id: string;
  readonly question_number: number;
  readonly text: string;
  readonly correct_value: number;
  readonly image_path: string | null;
  readonly video_path: string | null;
}

/**
 * エピソード系の外部永続化境界。生の行 I/O のみを持ち、業務判断は上位の `episode_service` が
 * 所有する。一意性を要する挿入は事前照会と挿入の競合（TOCTOU）を避けるため、境界側で
 * **原子的な insert-if-absent** として実装する。
 */
export interface EpisodeStore {
  /** エピソードを 1 行挿入する（`id` は採番済み・重複しない前提）。 */
  insertEpisode(row: EpisodeRow): Promise<void>;
  /** `id` でエピソードを引く（無ければ `undefined`）。 */
  findEpisodeById(id: string): Promise<EpisodeRow | undefined>;
  /** 全エピソードを `created_at` 昇順で返す。 */
  listEpisodesOrderedByCreatedAt(): Promise<readonly EpisodeRow[]>;
  /** `id` が既に在る場合に限り 1 行を置換する。置換できたら `true`。 */
  updateEpisodeIfPresent(row: EpisodeRow): Promise<boolean>;

  /** 招待を挿入する。同一 (episode_id, account_id) が既に在れば挿入せず `false`。 */
  insertInvitationIfAbsent(row: EpisodeInvitationRow): Promise<boolean>;
  /** 当該エピソードの招待を `invited_at` 昇順で返す。 */
  listInvitationsByEpisode(episodeId: string): Promise<readonly EpisodeInvitationRow[]>;
  /** 当該アカウントが招待されている招待を `invited_at` 昇順で返す。 */
  listInvitationsByAccount(accountId: string): Promise<readonly EpisodeInvitationRow[]>;

  /**
   * 参加者を挿入する。同一 (episode_id, account_id) が既に在れば挿入せず **既存行を返す**
   * （参加は冪等・二度押しで `participantId` が増えない）。
   */
  insertParticipantIfAbsent(row: EpisodeParticipantRow): Promise<EpisodeParticipantRow>;
  /** 当該エピソードの参加者を `joined_at` 昇順で返す。 */
  listParticipantsByEpisode(episodeId: string): Promise<readonly EpisodeParticipantRow[]>;
  /** (episode_id, account_id) で参加者を引く（無ければ `undefined`）。 */
  findParticipant(episodeId: string, accountId: string): Promise<EpisodeParticipantRow | undefined>;

  /**
   * 問題を登録する。同一 (episode_id, question_number) が既に在れば **置換する**（上書き編集）。
   * 置換した場合は既存行の `id` を保ち、新規なら与えた行をそのまま挿入する。挿入・置換後の行を返す。
   */
  upsertQuestion(row: EpisodeQuestionRow): Promise<EpisodeQuestionRow>;
  /** 当該エピソードの問題を `question_number` 昇順で返す。 */
  listQuestionsByEpisode(episodeId: string): Promise<readonly EpisodeQuestionRow[]>;
}

// ── 行 ⇄ ドメイン型の写像 ──

export function toEpisode(row: EpisodeRow): Episode {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toEpisodeRow(episode: Episode): EpisodeRow {
  return {
    id: episode.id,
    title: episode.title,
    status: episode.status,
    created_by: episode.createdBy,
    created_at: episode.createdAt,
    updated_at: episode.updatedAt,
  };
}

export function toEpisodeInvitation(row: EpisodeInvitationRow): EpisodeInvitation {
  return { episodeId: row.episode_id, accountId: row.account_id, invitedAt: row.invited_at };
}

export function toEpisodeInvitationRow(invitation: EpisodeInvitation): EpisodeInvitationRow {
  return {
    episode_id: invitation.episodeId,
    account_id: invitation.accountId,
    invited_at: invitation.invitedAt,
  };
}

export function toEpisodeParticipant(row: EpisodeParticipantRow): EpisodeParticipant {
  return {
    id: row.id,
    episodeId: row.episode_id,
    accountId: row.account_id,
    joinedAt: row.joined_at,
  };
}

export function toEpisodeParticipantRow(participant: EpisodeParticipant): EpisodeParticipantRow {
  return {
    id: participant.id,
    episode_id: participant.episodeId,
    account_id: participant.accountId,
    joined_at: participant.joinedAt,
  };
}

export function toEpisodeQuestion(row: EpisodeQuestionRow): EpisodeQuestion {
  return {
    id: row.id,
    episodeId: row.episode_id,
    questionNumber: row.question_number,
    text: row.text,
    correctValue: row.correct_value,
    imagePath: row.image_path,
    videoPath: row.video_path,
  };
}

export function toEpisodeQuestionRow(question: EpisodeQuestion): EpisodeQuestionRow {
  return {
    id: question.id,
    episode_id: question.episodeId,
    question_number: question.questionNumber,
    text: question.text,
    correct_value: question.correctValue,
    image_path: question.imagePath,
    video_path: question.videoPath,
  };
}

// ── 読み戻し時の型ガード（壊れた行を素通しさせない最終防衛） ──

function hasStrings(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return keys.every((key) => typeof row[key] === "string");
}

export function isEpisodeRow(value: unknown): value is EpisodeRow {
  if (!hasStrings(value, ["id", "title", "created_by", "created_at", "updated_at"])) return false;
  return isEpisodeStatus((value as Record<string, unknown>)["status"]);
}

export function isEpisodeInvitationRow(value: unknown): value is EpisodeInvitationRow {
  return hasStrings(value, ["episode_id", "account_id", "invited_at"]);
}

export function isEpisodeParticipantRow(value: unknown): value is EpisodeParticipantRow {
  return hasStrings(value, ["id", "episode_id", "account_id", "joined_at"]);
}

export function isEpisodeQuestionRow(value: unknown): value is EpisodeQuestionRow {
  if (!hasStrings(value, ["id", "episode_id", "text"])) return false;
  const row = value as Record<string, unknown>;
  const media = ["image_path", "video_path"].every(
    (key) => row[key] === null || typeof row[key] === "string",
  );
  return (
    media &&
    typeof row["question_number"] === "number" &&
    Number.isInteger(row["question_number"]) &&
    isAnswerScore(row["correct_value"])
  );
}

/** 永続実装が保持する 4 表の写し（JSON 実装と in-memory 実装が共有する形）。 */
export interface EpisodeTables {
  episodes: Map<string, EpisodeRow>;
  invitations: EpisodeInvitationRow[];
  participants: EpisodeParticipantRow[];
  questions: EpisodeQuestionRow[];
}

/** 空の 4 表を生成する。 */
export function createEmptyTables(): EpisodeTables {
  return {
    episodes: new Map<string, EpisodeRow>(),
    invitations: [],
    participants: [],
    questions: [],
  };
}

/**
 * 4 表の写しに対する共通の読み書き（in-memory 実装と JSON 実装で唯一の実装を共有する）。
 * `persist` は変更後に呼ばれる永続フック（in-memory 実装は何もしない）。
 */
export function createStoreOverTables(
  tables: () => Promise<EpisodeTables>,
  persist: (tables: EpisodeTables) => Promise<void>,
): EpisodeStore {
  return {
    async insertEpisode(row: EpisodeRow): Promise<void> {
      const t = await tables();
      t.episodes.set(row.id, row);
      await persist(t);
    },
    async findEpisodeById(id: string): Promise<EpisodeRow | undefined> {
      return (await tables()).episodes.get(id);
    },
    async listEpisodesOrderedByCreatedAt(): Promise<readonly EpisodeRow[]> {
      const t = await tables();
      return [...t.episodes.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
    },
    async updateEpisodeIfPresent(row: EpisodeRow): Promise<boolean> {
      const t = await tables();
      if (!t.episodes.has(row.id)) return false;
      t.episodes.set(row.id, row);
      await persist(t);
      return true;
    },
    async insertInvitationIfAbsent(row: EpisodeInvitationRow): Promise<boolean> {
      const t = await tables();
      const exists = t.invitations.some(
        (i) => i.episode_id === row.episode_id && i.account_id === row.account_id,
      );
      if (exists) return false;
      t.invitations.push(row);
      await persist(t);
      return true;
    },
    async listInvitationsByEpisode(episodeId: string): Promise<readonly EpisodeInvitationRow[]> {
      const t = await tables();
      return t.invitations
        .filter((i) => i.episode_id === episodeId)
        .sort((a, b) => a.invited_at.localeCompare(b.invited_at));
    },
    async listInvitationsByAccount(accountId: string): Promise<readonly EpisodeInvitationRow[]> {
      const t = await tables();
      return t.invitations
        .filter((i) => i.account_id === accountId)
        .sort((a, b) => a.invited_at.localeCompare(b.invited_at));
    },
    async insertParticipantIfAbsent(row: EpisodeParticipantRow): Promise<EpisodeParticipantRow> {
      const t = await tables();
      const existing = t.participants.find(
        (p) => p.episode_id === row.episode_id && p.account_id === row.account_id,
      );
      if (existing !== undefined) return existing;
      t.participants.push(row);
      await persist(t);
      return row;
    },
    async listParticipantsByEpisode(episodeId: string): Promise<readonly EpisodeParticipantRow[]> {
      const t = await tables();
      return t.participants
        .filter((p) => p.episode_id === episodeId)
        .sort((a, b) => a.joined_at.localeCompare(b.joined_at));
    },
    async findParticipant(
      episodeId: string,
      accountId: string,
    ): Promise<EpisodeParticipantRow | undefined> {
      const t = await tables();
      return t.participants.find((p) => p.episode_id === episodeId && p.account_id === accountId);
    },
    async upsertQuestion(row: EpisodeQuestionRow): Promise<EpisodeQuestionRow> {
      const t = await tables();
      const index = t.questions.findIndex(
        (q) => q.episode_id === row.episode_id && q.question_number === row.question_number,
      );
      // 既存の問を編集する場合は行 id を保つ（同じ問が別 id へ化けない）。
      const stored: EpisodeQuestionRow =
        index >= 0 ? { ...row, id: (t.questions[index] as EpisodeQuestionRow).id } : row;
      if (index >= 0) t.questions[index] = stored;
      else t.questions.push(stored);
      await persist(t);
      return stored;
    },
    async listQuestionsByEpisode(episodeId: string): Promise<readonly EpisodeQuestionRow[]> {
      const t = await tables();
      return t.questions
        .filter((q) => q.episode_id === episodeId)
        .sort((a, b) => a.question_number - b.question_number);
    },
  };
}

/** in-memory な {@link EpisodeStore}（検証とローカル試遊の既定）。プロセスが終われば失われる。 */
export function createInMemoryEpisodeStore(): EpisodeStore {
  const t = createEmptyTables();
  return createStoreOverTables(
    async () => t,
    async () => {
      /* in-memory ゆえ永続しない。 */
    },
  );
}
