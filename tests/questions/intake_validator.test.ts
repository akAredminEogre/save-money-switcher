// @generated-by: codd implement
// @generated-from: docs/design/question_media_intake_design.md (design:question-media-intake-design)
// @design-node: docs/design/question_media_intake_design.md
// @output-paths: src, tests
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { describe, it, expect } from "vitest";
import {
  validateIntake,
  type IntakeIssue,
  type MediaPresence,
} from "../../src/questions/intake_validator.js";
import type { QuestionIntakeRecord } from "../../src/questions/intake_record.js";

// 所定フォルダ配下の実体有無を差し替え可能にする MediaPresence テストダブル群。
// 与えた相対パス集合のみ「配置済み」とみなし、その他は未配置（exists=false）を返す。
function mediaWith(present: readonly string[]): MediaPresence {
  const placed = new Set(present);
  return { exists: (relativePath: string): boolean => placed.has(relativePath) };
}
const allPresent: MediaPresence = { exists: (): boolean => true };
const nonePresent: MediaPresence = { exists: (): boolean => false };

// 妥当な 1 問（メディアなし・text 非空・correctValue 0〜100 整数・問題番号 1〜10）。
// 各テストは検証したい 1 要素だけを上書きして与え、他要素の巻き添え issue を避ける。
function validRecord(
  overrides: Partial<QuestionIntakeRecord> = {},
): QuestionIntakeRecord {
  return {
    questionNumber: 1,
    text: "日本の都道府県の数は？",
    correctValue: 47,
    ...overrides,
  };
}

// 特定 field の issue を取り出す（問題番号タグ・field 名の検証に用いる）。
// 生成側の IntakeIssue 型を通した typed access で field 判定し、形をコンパイラに証明させる。
function issueFor(
  issues: readonly IntakeIssue[],
  field: IntakeIssue["field"],
): IntakeIssue | undefined {
  return issues.find((i) => i.field === field);
}

describe("questions/intake_validator 入稿検証（QM-1・0〜100 整数の一層目）", () => {
  it("全項目が妥当なら issue を1件も返さない（all-clear）", () => {
    const records: QuestionIntakeRecord[] = [
      validRecord({ questionNumber: 1, correctValue: 47 }),
      validRecord({ questionNumber: 2, correctValue: 80, videoPath: "q02.mp4" }),
      validRecord({ questionNumber: 3, correctValue: 12, imagePath: "q03.png" }),
    ];
    const issues = validateIntake(records, mediaWith(["q02.mp4", "q03.png"]));
    // 空配列は「全項目妥当」を意味する（消費側 loadQuestions が全問登録する前提）。
    expect(issues).toEqual([]);
  });

  it("問題番号が 1 未満は question_number の issue を問題番号付きで返す", () => {
    const issues = validateIntake([validRecord({ questionNumber: 0 })], allPresent);
    const issue = issueFor(issues, "question_number");
    expect(issue).toBeDefined();
    expect(issue?.questionNumber).toBe(0);
  });

  it("問題番号が 10 超は question_number の issue を返す", () => {
    const issues = validateIntake([validRecord({ questionNumber: 11 })], allPresent);
    const issue = issueFor(issues, "question_number");
    expect(issue).toBeDefined();
    expect(issue?.questionNumber).toBe(11);
  });

  it("問題番号が非整数（小数）は question_number の issue を返す", () => {
    const issues = validateIntake([validRecord({ questionNumber: 3.5 })], allPresent);
    expect(issueFor(issues, "question_number")).toBeDefined();
  });

  it("境界の 1 と 10 は問題番号として受理される（question_number の issue なし）", () => {
    const one = validateIntake([validRecord({ questionNumber: 1 })], allPresent);
    const ten = validateIntake([validRecord({ questionNumber: 10 })], allPresent);
    expect(issueFor(one, "question_number")).toBeUndefined();
    expect(issueFor(ten, "question_number")).toBeUndefined();
  });

  it("問題番号の重複は重複した番号を添えて question_number の issue を返す", () => {
    const issues = validateIntake(
      [validRecord({ questionNumber: 5 }), validRecord({ questionNumber: 5 })],
      allPresent,
    );
    // 5 は範囲内ゆえ範囲 issue は出ず、2 件目が重複として 1 件だけ検出される。
    const dupes = issues.filter((i) => i.field === "question_number");
    expect(dupes).toHaveLength(1);
    expect(dupes[0]?.questionNumber).toBe(5);
  });

  it("空文字の問題文は text の issue を返す", () => {
    const issues = validateIntake([validRecord({ text: "" })], allPresent);
    expect(issueFor(issues, "text")).toBeDefined();
  });

  it("空白のみの問題文は text の issue を返す（trim 後空を拒否）", () => {
    const issues = validateIntake([validRecord({ text: "   " })], allPresent);
    expect(issueFor(issues, "text")).toBeDefined();
  });

  it("範囲外・小数の correctValue は correct_value の issue を返す（isAnswerScore と一致）", () => {
    // -1（下限未満）/ 101（上限超）/ 50.5（小数）はいずれも入稿検証層で拒否される。
    for (const bad of [-1, 101, 50.5]) {
      const issues = validateIntake([validRecord({ correctValue: bad })], allPresent);
      expect(issueFor(issues, "correct_value")).toBeDefined();
    }
  });

  it("境界の 0 と 100 は correctValue として受理される（correct_value の issue なし）", () => {
    const zero = validateIntake([validRecord({ correctValue: 0 })], allPresent);
    const hundred = validateIntake([validRecord({ correctValue: 100 })], allPresent);
    expect(issueFor(zero, "correct_value")).toBeUndefined();
    expect(issueFor(hundred, "correct_value")).toBeUndefined();
  });

  // codd: covers vb=VB-64
  it("宣言された動画パスの実体が所定フォルダに無ければ問題番号を添えて video_path を拒否する", () => {
    const issues = validateIntake(
      [validRecord({ questionNumber: 3, videoPath: "q03-missing.mp4" })],
      nonePresent,
    );
    const issue = issueFor(issues, "video_path");
    // 未配置メディアは field=video_path かつ当該問題番号(3)を添えて拒否される。
    expect(issue).toBeDefined();
    expect(issue?.questionNumber).toBe(3);
  });

  it("宣言された画像パスの実体が所定フォルダに無ければ問題番号を添えて image_path を拒否する", () => {
    const issues = validateIntake(
      [validRecord({ questionNumber: 4, imagePath: "q04-missing.png" })],
      nonePresent,
    );
    const issue = issueFor(issues, "image_path");
    expect(issue).toBeDefined();
    expect(issue?.questionNumber).toBe(4);
  });

  it("メディアパス未指定（省略・null）の問題はメディア実体を確認せず issue を出さない", () => {
    // 省略した問と明示 null の問のいずれも、nonePresent 下でもメディア issue を出さない。
    const omitted = validateIntake([validRecord({ questionNumber: 6 })], nonePresent);
    const explicitNull = validateIntake(
      [validRecord({ questionNumber: 7, imagePath: null, videoPath: null })],
      nonePresent,
    );
    expect(issueFor(omitted, "image_path")).toBeUndefined();
    expect(issueFor(omitted, "video_path")).toBeUndefined();
    expect(issueFor(explicitNull, "image_path")).toBeUndefined();
    expect(issueFor(explicitNull, "video_path")).toBeUndefined();
  });

  it("配置済みの宣言メディア（動画・画像とも実体あり）はメディア issue を出さない", () => {
    const issues = validateIntake(
      [validRecord({ questionNumber: 2, videoPath: "q02.mp4", imagePath: "q02.png" })],
      mediaWith(["q02.mp4", "q02.png"]),
    );
    expect(issueFor(issues, "video_path")).toBeUndefined();
    expect(issueFor(issues, "image_path")).toBeUndefined();
  });

  it("複数の違反は各 field の issue を同時に列挙する（一括検証）", () => {
    const issues = validateIntake(
      [validRecord({ questionNumber: 99, text: "", correctValue: 200, videoPath: "x.mp4" })],
      nonePresent,
    );
    // 問題番号範囲・空 text・正解値範囲・未配置動画がそれぞれ検出される。
    expect(issueFor(issues, "question_number")).toBeDefined();
    expect(issueFor(issues, "text")).toBeDefined();
    expect(issueFor(issues, "correct_value")).toBeDefined();
    expect(issueFor(issues, "video_path")).toBeDefined();
  });
});
