// @generated-by: codd implement
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @design-node: docs/design/data_model_design.md
// @output-paths: src, tests
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

/**
 * 永続スキーマ制約違反を表す型付きエラー階層（data_model_design §2.4 / §2.11）。
 *
 * 三層目の防衛（DB CHECK / unique / FK / game_state シングルトン）が拒否した理由を
 * 型として表面化し、上位層（リポジトリ・サービス）が拒否を判別・監査できるようにする。
 * すべて {@link SchemaConstraintError} を基底とし、range/型のような「値が受理されない」拒否は
 * 基底型で束ね、一意・外部キー・シングルトンのように挙動が異なる拒否は個別型で判別可能にする。
 */

function describeValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  if (value === undefined) {
    return "undefined";
  }
  return Object.prototype.toString.call(value);
}

/** 永続スキーマ制約違反の基底。値が制約により拒否されたことを表す。 */
export class SchemaConstraintError extends Error {
  readonly table: string;

  constructor(table: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.table = table;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** NOT NULL 列に NULL/未指定が与えられた。 */
export class NotNullConstraintError extends SchemaConstraintError {
  readonly column: string;

  constructor(table: string, column: string) {
    super(table, `列 ${table}.${column} は NULL を許容しません。`);
    this.column = column;
  }
}

/** 列の宣言型（text/integer/boolean）に反する値（例: integer 列へ 50.5・非数値）。 */
export class ColumnTypeError extends SchemaConstraintError {
  readonly column: string;
  readonly value: unknown;

  constructor(table: string, column: string, value: unknown) {
    super(table, `列 ${table}.${column} の型に反する値です: ${describeValue(value)}`);
    this.column = column;
    this.value = value;
  }
}

/** CHECK 述語（0〜100 範囲・列挙・シングルトンキー等）に反する値。 */
export class CheckConstraintError extends SchemaConstraintError {
  readonly constraint: string;

  constructor(table: string, constraint: string) {
    super(table, `CHECK 制約 ${constraint} に違反しました（${table}）。`);
    this.constraint = constraint;
  }
}

/** 一意制約または主キーの重複。 */
export class UniqueConstraintError extends SchemaConstraintError {
  readonly constraint: string;
  readonly columns: readonly string[];

  constructor(table: string, constraint: string, columns: readonly string[]) {
    super(
      table,
      `一意制約 ${constraint} に違反しました（${table}(${columns.join(", ")}) が重複）。`,
    );
    this.constraint = constraint;
    this.columns = columns;
  }
}

/** 外部キー先の親行が存在しない。 */
export class ForeignKeyConstraintError extends SchemaConstraintError {
  readonly constraint: string;

  constructor(table: string, constraint: string) {
    super(table, `外部キー制約 ${constraint} に違反しました（親行が存在しません・${table}）。`);
    this.constraint = constraint;
  }
}

/** game_state のシングルトン（1 行のみ）に反する 2 行目の挿入。 */
export class SingletonConstraintError extends SchemaConstraintError {
  constructor(table: string) {
    super(table, `${table} はシングルトン行のみを許容します（2 行目は挿入できません）。`);
  }
}
