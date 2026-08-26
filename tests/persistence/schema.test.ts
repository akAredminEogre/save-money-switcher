// @generated-by: codd implement
// @generated-from: docs/design/system_design.md (design:system-design)
// @design-node: docs/design/system_design.md
// @output-paths: src, tests
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { describe, it, expect } from "vitest";
import {
  SCHEMA,
  MIGRATIONS,
  getTableSchema,
  emitCreateTableSql,
  emitSchemaSql,
  ANSWER_VALUE_MIN,
  ANSWER_VALUE_MAX,
  GAME_STATE_SINGLETON_ID,
  type TableName,
} from "../../src/persistence/schema.js";

// 8 テーブルの正準名。getTableSchema は TableName を要求するため、名前列は string ではなく
// TableName として型付けして渡す（string のまま渡すと引数の型が一致しない）。
const TABLE_NAMES: readonly TableName[] = [
  "questions",
  "participants",
  "answers",
  "rounds",
  "game_state",
  "settlements",
  "balances",
  "config",
];

describe("persistence/schema 永続スキーマ定義（8 テーブル・DB CHECK 三層目）", () => {
  it("8 テーブルすべてが定義され、テーブル名から定義を取得できる", () => {
    expect(SCHEMA).toHaveLength(TABLE_NAMES.length);
    for (const name of TABLE_NAMES) {
      const table = getTableSchema(name);
      expect(table.name).toBe(name);
    }
  });

  it("未知のテーブル名を getTableSchema へ渡すとエラーになる", () => {
    const unknownName: string = "does_not_exist";
    expect(() => getTableSchema(unknownName as TableName)).toThrow();
  });

  // codd: covers vb=VB-65
  it("questions.correct_value の DB CHECK が 0〜100 整数のみ受理し範囲外・小数を拒否する", () => {
    const questions = getTableSchema("questions");
    const check = questions.checks.find((c) =>
      c.columns.includes("correct_value"),
    );
    expect(check).toBeDefined();
    // 境界: 0=可 / 100=可 / -1=不可 / 101=不可 / 50.5=不可（入稿検証・サーバ検証と同一レンジ）。
    // 期待値は SUT の算出結果と独立に固定し、CHECK 述語の観測結果と照合する。
    expect(check!.predicate({ correct_value: ANSWER_VALUE_MIN })).toBe(true);
    expect(check!.predicate({ correct_value: ANSWER_VALUE_MAX })).toBe(true);
    expect(check!.predicate({ correct_value: -1 })).toBe(false);
    expect(check!.predicate({ correct_value: 101 })).toBe(false);
    expect(check!.predicate({ correct_value: 50.5 })).toBe(false);
  });

  it("answers.value の DB CHECK も 0〜100 整数のみ受理する（回答レンジ三層目防衛）", () => {
    const answers = getTableSchema("answers");
    const check = answers.checks.find((c) => c.columns.includes("value"));
    expect(check).toBeDefined();
    expect(check!.predicate({ value: 0 })).toBe(true);
    expect(check!.predicate({ value: 100 })).toBe(true);
    expect(check!.predicate({ value: 101 })).toBe(false);
    expect(check!.predicate({ value: 12.5 })).toBe(false);
  });

  it("answers は (question_id, participant_id) の複合一意制約を宣言する", () => {
    const answers = getTableSchema("answers");
    const unique = answers.uniques.find(
      (u) =>
        u.columns.includes("question_id") &&
        u.columns.includes("participant_id"),
    );
    expect(unique).toBeDefined();
    expect(unique!.columns).toHaveLength(2);
  });

  it("game_state は単一行キー（シングルトン）の CHECK を宣言する", () => {
    const gameState = getTableSchema("game_state");
    const singleton = gameState.checks.find((c) => c.columns.includes("id"));
    expect(singleton).toBeDefined();
    expect(singleton!.predicate({ id: GAME_STATE_SINGLETON_ID })).toBe(true);
    expect(singleton!.predicate({ id: "other_row" })).toBe(false);
  });

  it("CREATE TABLE DDL に integer 型・CHECK・UNIQUE・FOREIGN KEY を宣言する", () => {
    const answersSql = emitCreateTableSql(getTableSchema("answers"));
    expect(answersSql).toContain("CREATE TABLE answers");
    expect(answersSql).toContain("INTEGER");
    expect(answersSql).toContain("CHECK");
    expect(answersSql).toContain("UNIQUE");
    expect(answersSql).toContain("FOREIGN KEY");
  });

  it("スキーマ全体の DDL とマイグレーションが 8 テーブルぶん発行される", () => {
    const sql = emitSchemaSql();
    for (const name of TABLE_NAMES) {
      expect(sql).toContain(`CREATE TABLE ${name}`);
    }
    expect(MIGRATIONS).toHaveLength(TABLE_NAMES.length);
    const migratedTables = MIGRATIONS.map((m) => m.table);
    for (const name of TABLE_NAMES) {
      expect(migratedTables).toContain(name);
    }
  });
});
