/**
 * JSON 永続の実対象（accounts / episodes 系 4 表）の PG スキーマ宣言
 * （`module:persistence`・cmd_2553 B案 移行設計 deliverable2・schema.ts と併設）。
 *
 * `schema.ts` の 8 テーブル（ゲーム状態）は DDL 宣言のみで実行時未使用（揮発 in-memory が実体）
 * ゆえ本移行のスコープ外。ここでは JSON ファイルに実在する永続ドメイン
 * （`data/accounts.json` / `data/episodes.json`）に対応する 5 表だけを宣言する。
 *
 * 宣言機構は `schema.ts` の TableSchema 系型を再利用する（ColumnSchema / Unique / Check は
 * そのまま import）。ただし `schema.ts` の `TableSchema.name` は 8 テーブルの閉じた union
 * （`TableName`）ゆえ、本モジュールは名前を `string` に開いた {@link AppTableSchema} を併設し、
 * DDL 発行も IF NOT EXISTS 付き（`ensureSchema()` の冪等再実行を安全にする）で行う。
 *
 * 型マッピング: 現行 JSON は ISO 文字列 / 整数ゆえ TEXT / INTEGER をそのまま用いる。
 * `created_at` 等のタイムスタンプは **当面 TEXT**（無変換移送＝損失ゼロ）。TIMESTAMPTZ 化は
 * 移行成功後の別改修候補（設計 deliverable2）。
 */

import type {
  CheckConstraintSchema,
  ColumnSchema,
  UniqueConstraintSchema,
} from "../schema.js";
import {
  ANSWER_VALUE_MAX,
  ANSWER_VALUE_MIN,
  QUESTION_NUMBER_MAX,
  QUESTION_NUMBER_MIN,
} from "../schema.js";
import { EPISODE_STATUSES } from "../../episodes/episode.js";

/** 外部キー（`schema.ts` の ForeignKeySchema と同形だが参照先の名前を `string` に開く）。 */
export interface AppForeignKeySchema {
  readonly name: string;
  readonly columns: readonly string[];
  readonly referencesTable: string;
  readonly referencesColumns: readonly string[];
}

/** テーブル宣言（`schema.ts` の TableSchema と同形だが `name` を `string` に開く）。 */
export interface AppTableSchema {
  readonly name: string;
  readonly columns: readonly ColumnSchema[];
  readonly primaryKey: readonly string[];
  readonly uniques: readonly UniqueConstraintSchema[];
  readonly foreignKeys: readonly AppForeignKeySchema[];
  readonly checks: readonly CheckConstraintSchema[];
}

function enumCheck(
  table: string,
  column: string,
  allowed: readonly string[],
): CheckConstraintSchema {
  return {
    name: `${table}_${column}_enum`,
    columns: [column],
    sql: `${column} IN (${allowed.map((a) => `'${a}'`).join(", ")})`,
    predicate: (row) => typeof row[column] === "string" && allowed.includes(row[column] as string),
  };
}

function nonEmptyTextCheck(table: string, column: string): CheckConstraintSchema {
  return {
    name: `${table}_${column}_non_empty`,
    columns: [column],
    sql: `${column} <> ''`,
    predicate: (row) => typeof row[column] === "string" && (row[column] as string).length > 0,
  };
}

function integerRangeCheck(
  table: string,
  column: string,
  min: number,
  max: number,
): CheckConstraintSchema {
  return {
    name: `${table}_${column}_range`,
    columns: [column],
    sql: `${column} >= ${min} AND ${column} <= ${max}`,
    predicate: (row) =>
      typeof row[column] === "number" &&
      Number.isInteger(row[column]) &&
      (row[column] as number) >= min &&
      (row[column] as number) <= max,
  };
}

/** `accounts`（`accounts/account_store.ts` の AccountRow に対応・schema.ts 8 表に未収載の新規）。 */
const accountsTable: AppTableSchema = {
  name: "accounts",
  columns: [
    { name: "id", type: "text", nullable: false },
    { name: "login_id", type: "text", nullable: false },
    { name: "password_hash", type: "text", nullable: false },
    { name: "password_salt", type: "text", nullable: false },
    { name: "role", type: "text", nullable: false },
    { name: "display_name", type: "text", nullable: false },
    { name: "created_at", type: "text", nullable: false },
    { name: "updated_at", type: "text", nullable: false },
  ],
  primaryKey: ["id"],
  uniques: [{ name: "accounts_login_id_unique", columns: ["login_id"] }],
  foreignKeys: [],
  checks: [
    enumCheck("accounts", "role", ["admin", "contestant"]),
    nonEmptyTextCheck("accounts", "display_name"),
  ],
};

/** `episodes`（`episodes/episode_store.ts` の EpisodeRow に対応）。 */
const episodesTable: AppTableSchema = {
  name: "episodes",
  columns: [
    { name: "id", type: "text", nullable: false },
    { name: "title", type: "text", nullable: false },
    { name: "status", type: "text", nullable: false },
    { name: "created_by", type: "text", nullable: false },
    { name: "created_at", type: "text", nullable: false },
    { name: "updated_at", type: "text", nullable: false },
  ],
  primaryKey: ["id"],
  uniques: [],
  foreignKeys: [],
  // 状態列挙は一次実装 `episodes/episode.ts` の EPISODE_STATUSES を唯一の真実源とする
  // （設計 deliverable2 の記載 draft/ready/in_progress/finished はコード実体と乖離しており不採用）。
  checks: [enumCheck("episodes", "status", EPISODE_STATUSES)],
};

/** `episode_invitations`（2 列 PK が招待の一意性を担う）。 */
const episodeInvitationsTable: AppTableSchema = {
  name: "episode_invitations",
  columns: [
    { name: "episode_id", type: "text", nullable: false },
    { name: "account_id", type: "text", nullable: false },
    { name: "invited_at", type: "text", nullable: false },
  ],
  primaryKey: ["episode_id", "account_id"],
  uniques: [],
  foreignKeys: [
    {
      name: "episode_invitations_episode_fk",
      columns: ["episode_id"],
      referencesTable: "episodes",
      referencesColumns: ["id"],
    },
  ],
  checks: [],
};

/** `episode_participants`（(episode_id, account_id) 一意＝参加の冪等性を DB 側でも担保）。 */
const episodeParticipantsTable: AppTableSchema = {
  name: "episode_participants",
  columns: [
    { name: "id", type: "text", nullable: false },
    { name: "episode_id", type: "text", nullable: false },
    { name: "account_id", type: "text", nullable: false },
    { name: "joined_at", type: "text", nullable: false },
  ],
  primaryKey: ["id"],
  uniques: [
    {
      name: "episode_participants_episode_account_unique",
      columns: ["episode_id", "account_id"],
    },
  ],
  foreignKeys: [
    {
      name: "episode_participants_episode_fk",
      columns: ["episode_id"],
      referencesTable: "episodes",
      referencesColumns: ["id"],
    },
  ],
  checks: [],
};

/** `episode_questions`（(episode_id, question_number) 一意＝上書き編集の対象決定に用いる）。 */
const episodeQuestionsTable: AppTableSchema = {
  name: "episode_questions",
  columns: [
    { name: "id", type: "text", nullable: false },
    { name: "episode_id", type: "text", nullable: false },
    { name: "question_number", type: "integer", nullable: false },
    { name: "text", type: "text", nullable: false },
    { name: "correct_value", type: "integer", nullable: false },
    { name: "image_path", type: "text", nullable: true },
    { name: "video_path", type: "text", nullable: true },
  ],
  primaryKey: ["id"],
  uniques: [
    {
      name: "episode_questions_episode_number_unique",
      columns: ["episode_id", "question_number"],
    },
  ],
  foreignKeys: [
    {
      name: "episode_questions_episode_fk",
      columns: ["episode_id"],
      referencesTable: "episodes",
      referencesColumns: ["id"],
    },
  ],
  checks: [
    integerRangeCheck(
      "episode_questions",
      "question_number",
      QUESTION_NUMBER_MIN,
      QUESTION_NUMBER_MAX,
    ),
    integerRangeCheck("episode_questions", "correct_value", ANSWER_VALUE_MIN, ANSWER_VALUE_MAX),
  ],
};

/**
 * 本移行が PG に作る全テーブル（FK 依存順: 親 → 子）。`schema.ts` の 8 テーブルは含めない
 * （揮発 in-memory の durable 化は別スコープ・殿判断事項）。
 */
export const APP_SCHEMA: readonly AppTableSchema[] = [
  accountsTable,
  episodesTable,
  episodeInvitationsTable,
  episodeParticipantsTable,
  episodeQuestionsTable,
];

function sqlType(type: ColumnSchema["type"]): string {
  switch (type) {
    case "text":
      return "TEXT";
    case "integer":
      return "INTEGER";
    case "boolean":
      return "BOOLEAN";
  }
}

/**
 * 単一テーブルの `CREATE TABLE IF NOT EXISTS` DDL を発行する。`schema.ts` の
 * `emitCreateTableSql` と同じ発行規約（列 → PK → UNIQUE → FK → CHECK）だが、
 * `ensureSchema()` の再実行を安全にするため IF NOT EXISTS を付す（設計 deliverable2 の冪等 DDL）。
 */
export function emitCreateTableIfNotExistsSql(table: AppTableSchema): string {
  const lines: string[] = [];
  for (const column of table.columns) {
    lines.push(`  ${column.name} ${sqlType(column.type)}${column.nullable ? "" : " NOT NULL"}`);
  }
  lines.push(`  PRIMARY KEY (${table.primaryKey.join(", ")})`);
  for (const unique of table.uniques) {
    lines.push(`  CONSTRAINT ${unique.name} UNIQUE (${unique.columns.join(", ")})`);
  }
  for (const fk of table.foreignKeys) {
    lines.push(
      `  CONSTRAINT ${fk.name} FOREIGN KEY (${fk.columns.join(", ")}) ` +
        `REFERENCES ${fk.referencesTable} (${fk.referencesColumns.join(", ")})`,
    );
  }
  for (const check of table.checks) {
    lines.push(`  CONSTRAINT ${check.name} CHECK (${check.sql})`);
  }
  return `CREATE TABLE IF NOT EXISTS ${table.name} (\n${lines.join(",\n")}\n);`;
}
