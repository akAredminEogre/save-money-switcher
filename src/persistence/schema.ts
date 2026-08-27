// @generated-by: codd implement
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @design-node: docs/design/data_model_design.md
// @output-paths: src, tests
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

/**
 * 永続スキーマ定義とマイグレーション（data_model_design §2.1〜§2.8 / §2.10 / §2.11 / §3.1）。
 *
 * 8 テーブル（questions / participants / answers / rounds / game_state / settlements /
 * balances / config）の列・主キー・一意・外部キー・CHECK を単一の真実源として宣言し、
 * ここから (a) 選定 DB 向けの `CREATE TABLE` マイグレーション DDL を発行し、(b) 同一の
 * 制約を実行可能な述語として保持する（`schema_store.ts` の防衛エンジンが参照する）。
 *
 * 本モジュールは UI（tablet）とサーバ（validate_answer）に続く「三層目の防衛（DB CHECK /
 * unique / FK / game_state シングルトン）」の宣言点である（§2.4）。具体 DB 方言とファイル名は
 * 実装組み立てフェーズで選定するが、integer 型・0〜100 の範囲 CHECK・
 * unique(question_id, participant_id)・FK・シングルトンは方言非依存の宣言としてここに固定する。
 */

import { STAGES } from "../game_state/progression.js";

/** 論理列型。方言マッピング（TEXT/INTEGER/BOOLEAN 等）は DDL 発行時に解決する。 */
export type ColumnType = "text" | "integer" | "boolean";

/** 8 テーブルの正準名（snake_case）。 */
export type TableName =
  | "questions"
  | "participants"
  | "answers"
  | "rounds"
  | "game_state"
  | "settlements"
  | "balances"
  | "config";

/** 行の汎用表現（列名 → 値）。 */
export type Row = Record<string, unknown>;

export interface ColumnSchema {
  readonly name: string;
  readonly type: ColumnType;
  /** NULL 許容か。false のとき NOT NULL を強制する。 */
  readonly nullable: boolean;
}

export interface CheckConstraintSchema {
  readonly name: string;
  readonly columns: readonly string[];
  /** 発行 DDL に埋め込む CHECK 述語（方言横断で成立する範囲/列挙式）。 */
  readonly sql: string;
  /** 実行時に同一制約を強制する述語（DB CHECK と等価な三層目防衛）。 */
  readonly predicate: (row: Row) => boolean;
}

export interface UniqueConstraintSchema {
  readonly name: string;
  readonly columns: readonly string[];
}

export interface ForeignKeySchema {
  readonly name: string;
  readonly columns: readonly string[];
  readonly referencesTable: TableName;
  readonly referencesColumns: readonly string[];
}

export interface TableSchema {
  readonly name: TableName;
  readonly columns: readonly ColumnSchema[];
  readonly primaryKey: readonly string[];
  readonly uniques: readonly UniqueConstraintSchema[];
  readonly foreignKeys: readonly ForeignKeySchema[];
  readonly checks: readonly CheckConstraintSchema[];
}

/** 回答・正解値・誤差の下限/上限（0〜100 整数・二重防衛の三層目・§2.4）。 */
export const ANSWER_VALUE_MIN = 0;
export const ANSWER_VALUE_MAX = 100;

/** 1 ゲームの問題数（10 問）に対応する問題番号の範囲。 */
export const QUESTION_NUMBER_MIN = 1;
export const QUESTION_NUMBER_MAX = 10;

/** game_state の固定シングルトンキー（1 行のみ許す・§2.5）。 */
export const GAME_STATE_SINGLETON_ID = "game_state";

/** TV モード列挙（a〜e）。 */
export const TV_MODES = ["a", "b", "c", "d", "e"] as const;

/** セッションフェーズ列挙。 */
export const GAME_PHASES = ["lobby", "in_progress", "finished"] as const;

function isIntegerInRange(v: unknown, min: number, max: number): boolean {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

function isMemberOf(v: unknown, allowed: readonly string[]): boolean {
  return typeof v === "string" && allowed.includes(v);
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
    predicate: (row) => isIntegerInRange(row[column], min, max),
  };
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
    predicate: (row) => isMemberOf(row[column], allowed),
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

function nonPositiveIntegerCheck(table: string, column: string): CheckConstraintSchema {
  return {
    name: `${table}_${column}_non_positive`,
    columns: [column],
    sql: `${column} <= 0`,
    predicate: (row) =>
      typeof row[column] === "number" &&
      Number.isInteger(row[column]) &&
      (row[column] as number) <= 0,
  };
}

function singletonKeyCheck(): CheckConstraintSchema {
  return {
    name: "game_state_singleton",
    columns: ["id"],
    sql: `id = '${GAME_STATE_SINGLETON_ID}'`,
    predicate: (row) => row["id"] === GAME_STATE_SINGLETON_ID,
  };
}

const questionsTable: TableSchema = {
  name: "questions",
  columns: [
    { name: "id", type: "text", nullable: false },
    { name: "question_number", type: "integer", nullable: false },
    { name: "text", type: "text", nullable: false },
    { name: "image_path", type: "text", nullable: true },
    { name: "video_path", type: "text", nullable: true },
    { name: "correct_value", type: "integer", nullable: false },
  ],
  primaryKey: ["id"],
  uniques: [{ name: "questions_question_number_unique", columns: ["question_number"] }],
  foreignKeys: [],
  checks: [
    integerRangeCheck("questions", "question_number", QUESTION_NUMBER_MIN, QUESTION_NUMBER_MAX),
    integerRangeCheck("questions", "correct_value", ANSWER_VALUE_MIN, ANSWER_VALUE_MAX),
  ],
};

const participantsTable: TableSchema = {
  name: "participants",
  columns: [
    { name: "id", type: "text", nullable: false },
    { name: "name", type: "text", nullable: false },
    { name: "joined_at", type: "text", nullable: false },
    { name: "connection_id", type: "text", nullable: false },
  ],
  primaryKey: ["id"],
  uniques: [{ name: "participants_connection_id_unique", columns: ["connection_id"] }],
  foreignKeys: [],
  checks: [nonEmptyTextCheck("participants", "name")],
};

const answersTable: TableSchema = {
  name: "answers",
  columns: [
    { name: "id", type: "text", nullable: false },
    { name: "question_id", type: "text", nullable: false },
    { name: "participant_id", type: "text", nullable: false },
    { name: "value", type: "integer", nullable: false },
    { name: "submitted_at", type: "text", nullable: false },
  ],
  primaryKey: ["id"],
  uniques: [
    {
      name: "answers_question_participant_unique",
      columns: ["question_id", "participant_id"],
    },
  ],
  foreignKeys: [
    {
      name: "answers_question_fk",
      columns: ["question_id"],
      referencesTable: "questions",
      referencesColumns: ["id"],
    },
    {
      name: "answers_participant_fk",
      columns: ["participant_id"],
      referencesTable: "participants",
      referencesColumns: ["id"],
    },
  ],
  checks: [integerRangeCheck("answers", "value", ANSWER_VALUE_MIN, ANSWER_VALUE_MAX)],
};

const roundsTable: TableSchema = {
  name: "rounds",
  columns: [
    { name: "question_id", type: "text", nullable: false },
    { name: "question_number", type: "integer", nullable: false },
    { name: "stage", type: "text", nullable: false },
  ],
  primaryKey: ["question_id"],
  uniques: [],
  foreignKeys: [
    {
      name: "rounds_question_fk",
      columns: ["question_id"],
      referencesTable: "questions",
      referencesColumns: ["id"],
    },
  ],
  checks: [
    integerRangeCheck("rounds", "question_number", QUESTION_NUMBER_MIN, QUESTION_NUMBER_MAX),
    enumCheck("rounds", "stage", STAGES),
  ],
};

const settlementsTable: TableSchema = {
  name: "settlements",
  columns: [
    { name: "question_id", type: "text", nullable: false },
    { name: "participant_id", type: "text", nullable: false },
    { name: "answer_value", type: "integer", nullable: false },
    { name: "error", type: "integer", nullable: false },
    { name: "delta_yen", type: "integer", nullable: false },
    { name: "pitari_awarded", type: "boolean", nullable: false },
    { name: "pitari_bonus_yen", type: "integer", nullable: false },
  ],
  primaryKey: ["question_id", "participant_id"],
  uniques: [
    {
      name: "settlements_question_participant_unique",
      columns: ["question_id", "participant_id"],
    },
  ],
  foreignKeys: [
    {
      name: "settlements_question_fk",
      columns: ["question_id"],
      referencesTable: "questions",
      referencesColumns: ["id"],
    },
    {
      name: "settlements_participant_fk",
      columns: ["participant_id"],
      referencesTable: "participants",
      referencesColumns: ["id"],
    },
  ],
  checks: [
    integerRangeCheck("settlements", "answer_value", ANSWER_VALUE_MIN, ANSWER_VALUE_MAX),
    integerRangeCheck("settlements", "error", ANSWER_VALUE_MIN, ANSWER_VALUE_MAX),
    // 増減円 = 誤差 × −100 ゆえ常に 0 以下（§2.6）。加算側 pitari_bonus_yen は
    // 拠出配分（F-02 未確定）で将来負値も採り得るため範囲を課さず integer のみに留める。
    nonPositiveIntegerCheck("settlements", "delta_yen"),
  ],
};

const balancesTable: TableSchema = {
  name: "balances",
  columns: [
    { name: "participant_id", type: "text", nullable: false },
    { name: "amount", type: "integer", nullable: false },
  ],
  primaryKey: ["participant_id"],
  uniques: [],
  foreignKeys: [
    {
      name: "balances_participant_fk",
      columns: ["participant_id"],
      referencesTable: "participants",
      referencesColumns: ["id"],
    },
  ],
  // amount は整数円のみ（列型で強制）。0 下限・脱落は確定要件に無いため下限 CHECK を課さない（F-01）。
  checks: [],
};

const gameStateTable: TableSchema = {
  name: "game_state",
  columns: [
    { name: "id", type: "text", nullable: false },
    { name: "current_question_number", type: "integer", nullable: false },
    { name: "tv_mode", type: "text", nullable: false },
    { name: "phase", type: "text", nullable: false },
  ],
  primaryKey: ["id"],
  uniques: [],
  foreignKeys: [],
  checks: [
    singletonKeyCheck(),
    integerRangeCheck(
      "game_state",
      "current_question_number",
      QUESTION_NUMBER_MIN,
      QUESTION_NUMBER_MAX,
    ),
    enumCheck("game_state", "tv_mode", TV_MODES),
    enumCheck("game_state", "phase", GAME_PHASES),
  ],
};

const configTable: TableSchema = {
  name: "config",
  columns: [
    { name: "key", type: "text", nullable: false },
    { name: "value", type: "text", nullable: false },
    { name: "updated_at", type: "text", nullable: false },
  ],
  primaryKey: ["key"],
  uniques: [],
  foreignKeys: [],
  checks: [],
};

/**
 * 全テーブル定義。親（questions / participants）を先頭に、FK を持つ子（answers / rounds /
 * settlements / balances）を後段に置き、マイグレーション適用順が FK 依存を満たす。
 */
export const SCHEMA: readonly TableSchema[] = [
  questionsTable,
  participantsTable,
  answersTable,
  roundsTable,
  settlementsTable,
  balancesTable,
  gameStateTable,
  configTable,
];

const SCHEMA_BY_NAME: ReadonlyMap<TableName, TableSchema> = new Map(
  SCHEMA.map((t) => [t.name, t] as const),
);

/** テーブル名から定義を取得する（未知テーブルは実装エラー）。 */
export function getTableSchema(name: TableName): TableSchema {
  const table = SCHEMA_BY_NAME.get(name);
  if (table === undefined) {
    throw new Error(`未知のテーブルです: ${name}`);
  }
  return table;
}

function sqlType(type: ColumnType): string {
  switch (type) {
    case "text":
      return "TEXT";
    case "integer":
      return "INTEGER";
    case "boolean":
      return "BOOLEAN";
  }
}

/** 単一テーブルの `CREATE TABLE` DDL を発行する（integer 型・CHECK・UNIQUE・FK を宣言）。 */
export function emitCreateTableSql(table: TableSchema): string {
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
  return `CREATE TABLE ${table.name} (\n${lines.join(",\n")}\n);`;
}

/** 全 8 テーブルのマイグレーション DDL を依存順に連結して発行する。 */
export function emitSchemaSql(schema: readonly TableSchema[] = SCHEMA): string {
  return schema.map(emitCreateTableSql).join("\n\n");
}

export interface Migration {
  readonly id: string;
  readonly table: TableName;
  readonly up: string;
}

/** テーブルごとの前方マイグレーション（適用順＝FK 依存順）。 */
export const MIGRATIONS: readonly Migration[] = SCHEMA.map((table, index) => ({
  id: `${String(index + 1).padStart(4, "0")}_create_${table.name}`,
  table: table.name,
  up: emitCreateTableSql(table),
}));
