// @generated-by: codd implement
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @design-node: docs/design/data_model_design.md
// @output-paths: src, tests
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

/**
 * スキーマ制約を実行時に強制するインメモリ防衛エンジン（data_model_design §2.4 / §2.11 / §3.1）。
 *
 * {@link SCHEMA} を唯一の真実源として、NOT NULL・列型（integer は非整数/非数値を拒否）・
 * 範囲/列挙 CHECK・主キー/一意・外部キー・game_state シングルトンを、選定 DB が発行 DDL で
 * 強制するのと同一に強制する。これは「三層目の防衛」（UI・サーバの後段の DB CHECK/unique/FK）の
 * 実行可能な仕様であり、統合検証が -1/101/50.5 と重複・FK 欠落・シングルトン破りを拒否できることを
 * 実際に走らせて確認するための正準エンジンである（発行 DDL と本エンジンは同じ制約定義から導かれる）。
 */

import {
  SCHEMA,
  type Row,
  type TableName,
  type TableSchema,
  type ColumnType,
} from "./schema.js";
import {
  CheckConstraintError,
  ColumnTypeError,
  ForeignKeyConstraintError,
  NotNullConstraintError,
  SingletonConstraintError,
  UniqueConstraintError,
} from "./constraint_errors.js";

/** スキーマ制約を強制する最小ストア。挿入/更新は違反時に型付きエラーを送出する。 */
export interface SchemaStore {
  /** 制約検証を通過した行のみを永続する。違反時は {@link SchemaConstraintError} 系を送出。 */
  insert(table: TableName, row: Row): Row;
  /** 主キー一致の既存行を patch でマージ再検証して更新する（違反時は既存行を変えない）。 */
  update(table: TableName, key: Row, patch: Row): Row;
  /** 主キー一致の行を取得する（無ければ undefined）。 */
  get(table: TableName, key: Row): Row | undefined;
  /** テーブルの全行のコピーを返す。 */
  all(table: TableName): readonly Row[];
  /** テーブルの行数を返す。 */
  count(table: TableName): number;
}

interface TableData {
  readonly schema: TableSchema;
  readonly rows: Row[];
}

function matchesType(type: ColumnType, value: unknown): boolean {
  switch (type) {
    case "text":
      return typeof value === "string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
  }
}

function projectRow(schema: TableSchema, input: Row): Row {
  const out: Row = {};
  for (const column of schema.columns) {
    const value = input[column.name];
    out[column.name] = value === undefined ? null : value;
  }
  return out;
}

function pkString(schema: TableSchema, obj: Row): string {
  return schema.primaryKey.map((c) => `${c}=${String(obj[c])}`).join("&");
}

function tupleString(columns: readonly string[], obj: Row): string {
  return columns.map((c) => `${c}=${String(obj[c])}`).join("&");
}

class InMemorySchemaStore implements SchemaStore {
  private readonly tables: Map<TableName, TableData>;

  constructor(schema: readonly TableSchema[]) {
    this.tables = new Map(schema.map((s) => [s.name, { schema: s, rows: [] }] as const));
  }

  private table(name: TableName): TableData {
    const data = this.tables.get(name);
    if (data === undefined) {
      throw new Error(`未知のテーブルです: ${name}`);
    }
    return data;
  }

  insert(name: TableName, input: Row): Row {
    const data = this.table(name);
    const row = projectRow(data.schema, input);

    this.validateColumnsAndChecks(data.schema, row);
    if (data.schema.name === "game_state" && data.rows.length > 0) {
      throw new SingletonConstraintError(data.schema.name);
    }
    this.validatePrimaryKey(data, row, null);
    this.validateUniques(data, row, null);
    this.validateForeignKeys(data.schema, row);

    data.rows.push(row);
    return { ...row };
  }

  update(name: TableName, key: Row, patch: Row): Row {
    const data = this.table(name);
    const target = pkString(data.schema, key);
    const index = data.rows.findIndex((r) => pkString(data.schema, r) === target);
    if (index === -1) {
      throw new Error(`更新対象の行が ${name} に見つかりません（key=${target}）。`);
    }

    const merged = projectRow(data.schema, { ...data.rows[index], ...patch });
    this.validateColumnsAndChecks(data.schema, merged);
    this.validatePrimaryKey(data, merged, index);
    this.validateUniques(data, merged, index);
    this.validateForeignKeys(data.schema, merged);

    data.rows[index] = merged;
    return { ...merged };
  }

  get(name: TableName, key: Row): Row | undefined {
    const data = this.table(name);
    const target = pkString(data.schema, key);
    const found = data.rows.find((r) => pkString(data.schema, r) === target);
    return found === undefined ? undefined : { ...found };
  }

  all(name: TableName): readonly Row[] {
    return this.table(name).rows.map((r) => ({ ...r }));
  }

  count(name: TableName): number {
    return this.table(name).rows.length;
  }

  private validateColumnsAndChecks(schema: TableSchema, row: Row): void {
    for (const column of schema.columns) {
      const value = row[column.name];
      if (value === null) {
        if (!column.nullable) {
          throw new NotNullConstraintError(schema.name, column.name);
        }
        continue;
      }
      if (!matchesType(column.type, value)) {
        throw new ColumnTypeError(schema.name, column.name, value);
      }
    }
    for (const check of schema.checks) {
      if (!check.predicate(row)) {
        throw new CheckConstraintError(schema.name, check.name);
      }
    }
  }

  private validatePrimaryKey(data: TableData, row: Row, excludeIndex: number | null): void {
    const key = pkString(data.schema, row);
    const clash = data.rows.some(
      (r, i) => i !== excludeIndex && pkString(data.schema, r) === key,
    );
    if (clash) {
      throw new UniqueConstraintError(
        data.schema.name,
        `${data.schema.name}_pkey`,
        data.schema.primaryKey,
      );
    }
  }

  private validateUniques(data: TableData, row: Row, excludeIndex: number | null): void {
    for (const unique of data.schema.uniques) {
      const key = tupleString(unique.columns, row);
      const clash = data.rows.some(
        (r, i) => i !== excludeIndex && tupleString(unique.columns, r) === key,
      );
      if (clash) {
        throw new UniqueConstraintError(data.schema.name, unique.name, unique.columns);
      }
    }
  }

  private validateForeignKeys(schema: TableSchema, row: Row): void {
    for (const fk of schema.foreignKeys) {
      const values = fk.columns.map((c) => row[c]);
      if (values.some((v) => v === null)) {
        continue;
      }
      const parent = this.tables.get(fk.referencesTable);
      if (parent === undefined) {
        throw new Error(`外部キー先テーブル ${fk.referencesTable} が定義されていません。`);
      }
      const exists = parent.rows.some((parentRow) =>
        fk.referencesColumns.every((rc, i) => parentRow[rc] === values[i]),
      );
      if (!exists) {
        throw new ForeignKeyConstraintError(schema.name, fk.name);
      }
    }
  }
}

/** スキーマ制約を強制するストアを生成する（既定は 8 テーブルの {@link SCHEMA}）。 */
export function createSchemaStore(schema: readonly TableSchema[] = SCHEMA): SchemaStore {
  return new InMemorySchemaStore(schema);
}
