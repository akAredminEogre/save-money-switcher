/**
 * PostgreSQL 実装の {@link EpisodeStore}（`module:episodes` / `module:persistence`・
 * cmd_2553 B案 移行設計 S3）。
 *
 * 境界（`episode_store.ts`）の 12 メソッド契約をそのままに、物理永続だけを PG へ差し替える。
 * 生 SQL・ORM 無し。一意性を要する挿入は PG の制約（2 列 PK / UNIQUE）＋ `ON CONFLICT` が
 * 原子的に裁く（JSON 実装の「単一プロセス内の直列化」に依らない TOCTOU 回避）。
 *
 * - 招待: PK (episode_id, account_id) → `ON CONFLICT DO NOTHING`（挿入できたかを rowCount で返す）
 * - 参加: UNIQUE (episode_id, account_id) → 冪等（既存行を返す・participantId が増えない）
 * - 問題: UNIQUE (episode_id, question_number) → 上書き編集（既存行の id を保つ）
 */

import type pg from "pg";
import {
  isEpisodeInvitationRow,
  isEpisodeParticipantRow,
  isEpisodeQuestionRow,
  isEpisodeRow,
  type EpisodeInvitationRow,
  type EpisodeParticipantRow,
  type EpisodeQuestionRow,
  type EpisodeRow,
  type EpisodeStore,
} from "./episode_store.js";

const EPISODE_COLUMNS = "id, title, status, created_by, created_at, updated_at";
const INVITATION_COLUMNS = "episode_id, account_id, invited_at";
const PARTICIPANT_COLUMNS = "id, episode_id, account_id, joined_at";
const QUESTION_COLUMNS =
  "id, episode_id, question_number, text, correct_value, image_path, video_path";

/** 読み戻した行を境界の型ガードへ通す（壊れた行を素通しさせない最終防衛）。 */
function guarded<T>(value: unknown, guard: (v: unknown) => v is T, table: string): T {
  if (!guard(value)) {
    throw new Error(`${table} テーブルから解釈できない行を読み出しました。`);
  }
  return value;
}

/** PostgreSQL 実装の {@link EpisodeStore} を生成する（Pool は共有・所有しない）。 */
export function createPgEpisodeStore(pool: pg.Pool): EpisodeStore {
  return {
    async insertEpisode(row: EpisodeRow): Promise<void> {
      await pool.query(
        `INSERT INTO episodes (${EPISODE_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6)`,
        [row.id, row.title, row.status, row.created_by, row.created_at, row.updated_at],
      );
    },
    async findEpisodeById(id: string): Promise<EpisodeRow | undefined> {
      const result = await pool.query(`SELECT ${EPISODE_COLUMNS} FROM episodes WHERE id = $1`, [
        id,
      ]);
      const first: unknown = result.rows[0];
      return first === undefined ? undefined : guarded(first, isEpisodeRow, "episodes");
    },
    async listEpisodesOrderedByCreatedAt(): Promise<readonly EpisodeRow[]> {
      const result = await pool.query(
        `SELECT ${EPISODE_COLUMNS} FROM episodes ORDER BY created_at ASC`,
      );
      return result.rows.map((row: unknown) => guarded(row, isEpisodeRow, "episodes"));
    },
    async updateEpisodeIfPresent(row: EpisodeRow): Promise<boolean> {
      const result = await pool.query(
        `UPDATE episodes
         SET title = $2, status = $3, created_by = $4, created_at = $5, updated_at = $6
         WHERE id = $1`,
        [row.id, row.title, row.status, row.created_by, row.created_at, row.updated_at],
      );
      return (result.rowCount ?? 0) > 0;
    },

    async insertInvitationIfAbsent(row: EpisodeInvitationRow): Promise<boolean> {
      // PK (episode_id, account_id) が一意性を原子的に裁く。
      const result = await pool.query(
        `INSERT INTO episode_invitations (${INVITATION_COLUMNS}) VALUES ($1, $2, $3)
         ON CONFLICT (episode_id, account_id) DO NOTHING`,
        [row.episode_id, row.account_id, row.invited_at],
      );
      return (result.rowCount ?? 0) > 0;
    },
    async listInvitationsByEpisode(episodeId: string): Promise<readonly EpisodeInvitationRow[]> {
      const result = await pool.query(
        `SELECT ${INVITATION_COLUMNS} FROM episode_invitations
         WHERE episode_id = $1 ORDER BY invited_at ASC`,
        [episodeId],
      );
      return result.rows.map((row: unknown) =>
        guarded(row, isEpisodeInvitationRow, "episode_invitations"),
      );
    },
    async listInvitationsByAccount(accountId: string): Promise<readonly EpisodeInvitationRow[]> {
      const result = await pool.query(
        `SELECT ${INVITATION_COLUMNS} FROM episode_invitations
         WHERE account_id = $1 ORDER BY invited_at ASC`,
        [accountId],
      );
      return result.rows.map((row: unknown) =>
        guarded(row, isEpisodeInvitationRow, "episode_invitations"),
      );
    },

    async insertParticipantIfAbsent(row: EpisodeParticipantRow): Promise<EpisodeParticipantRow> {
      // UNIQUE (episode_id, account_id) と DO NOTHING で冪等挿入。衝突時は既存行を返す
      // （二度押しで participantId が増えない契約）。
      const inserted = await pool.query(
        `INSERT INTO episode_participants (${PARTICIPANT_COLUMNS}) VALUES ($1, $2, $3, $4)
         ON CONFLICT (episode_id, account_id) DO NOTHING
         RETURNING ${PARTICIPANT_COLUMNS}`,
        [row.id, row.episode_id, row.account_id, row.joined_at],
      );
      const insertedFirst: unknown = inserted.rows[0];
      if (insertedFirst !== undefined) {
        return guarded(insertedFirst, isEpisodeParticipantRow, "episode_participants");
      }
      const existing = await pool.query(
        `SELECT ${PARTICIPANT_COLUMNS} FROM episode_participants
         WHERE episode_id = $1 AND account_id = $2`,
        [row.episode_id, row.account_id],
      );
      return guarded(existing.rows[0] as unknown, isEpisodeParticipantRow, "episode_participants");
    },
    async listParticipantsByEpisode(episodeId: string): Promise<readonly EpisodeParticipantRow[]> {
      const result = await pool.query(
        `SELECT ${PARTICIPANT_COLUMNS} FROM episode_participants
         WHERE episode_id = $1 ORDER BY joined_at ASC`,
        [episodeId],
      );
      return result.rows.map((row: unknown) =>
        guarded(row, isEpisodeParticipantRow, "episode_participants"),
      );
    },
    async findParticipant(
      episodeId: string,
      accountId: string,
    ): Promise<EpisodeParticipantRow | undefined> {
      const result = await pool.query(
        `SELECT ${PARTICIPANT_COLUMNS} FROM episode_participants
         WHERE episode_id = $1 AND account_id = $2`,
        [episodeId, accountId],
      );
      const first: unknown = result.rows[0];
      return first === undefined
        ? undefined
        : guarded(first, isEpisodeParticipantRow, "episode_participants");
    },

    async upsertQuestion(row: EpisodeQuestionRow): Promise<EpisodeQuestionRow> {
      // UNIQUE (episode_id, question_number) 衝突時は既存行の id を保ったまま内容を置換する
      // （同じ問が別 id へ化けない契約・SET に id を含めない）。
      const result = await pool.query(
        `INSERT INTO episode_questions (${QUESTION_COLUMNS})
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (episode_id, question_number) DO UPDATE
         SET text = EXCLUDED.text, correct_value = EXCLUDED.correct_value,
             image_path = EXCLUDED.image_path, video_path = EXCLUDED.video_path
         RETURNING ${QUESTION_COLUMNS}`,
        [
          row.id,
          row.episode_id,
          row.question_number,
          row.text,
          row.correct_value,
          row.image_path,
          row.video_path,
        ],
      );
      return guarded(result.rows[0] as unknown, isEpisodeQuestionRow, "episode_questions");
    },
    async listQuestionsByEpisode(episodeId: string): Promise<readonly EpisodeQuestionRow[]> {
      const result = await pool.query(
        `SELECT ${QUESTION_COLUMNS} FROM episode_questions
         WHERE episode_id = $1 ORDER BY question_number ASC`,
        [episodeId],
      );
      return result.rows.map((row: unknown) =>
        guarded(row, isEpisodeQuestionRow, "episode_questions"),
      );
    },
  };
}
