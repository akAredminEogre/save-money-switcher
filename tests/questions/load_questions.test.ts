// @generated-by: codd implement
// @generated-from: docs/design/question_media_intake_design.md (design:question-media-intake-design)
// @design-node: docs/design/question_media_intake_design.md
// @output-paths: src, tests
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { describe, it, expect, vi } from "vitest";
import { loadQuestions } from "../../src/questions/load_questions.js";
import type { LoadResult } from "../../src/questions/load_questions.js";
import type { QuestionsRepository } from "../../src/questions/questions_repository.js";
import type { Question } from "../../src/questions/question.js";

const repo = (): QuestionsRepository => ({
  bulkInsert: vi.fn(async () => {}),
  getByNumber: vi.fn(async () => null),
  listAll: vi.fn(async () => []),
  updateContent: vi.fn(async () => {
    throw new Error("unused");
  }),
});
const allPresent = { exists: (_p: string) => true };
const nonePresent = { exists: (_p: string) => false };
let seq = 0;
const newId = () => `q-${++seq}`;

describe("questions/load_questions 正解値の入稿検証", () => {
  // codd: covers vb=VB-65
  it("correct_value が 0〜100 整数以外の問題は入稿で拒否され 1 行も登録されない", async () => {
    const r = repo();
    const res = await loadQuestions(
      [
        { questionNumber: 1, text: "ok", correctValue: 50 },
        { questionNumber: 2, text: "ng", correctValue: 101 },
      ],
      allPresent,
      r,
      newId,
    );
    // 全 or 無: 1 件でも範囲外なら 0 問登録・bulkInsert は呼ばれない。
    expect(res.loaded).toBe(0);
    expect(r.bulkInsert).not.toHaveBeenCalled();
    expect(res.issues.some((i) => i.field === "correct_value")).toBe(true);
  });

  it("小数の correct_value も拒否される（整数のみ受理）", async () => {
    const r = repo();
    const res = await loadQuestions(
      [{ questionNumber: 1, text: "ng", correctValue: 50.5 }],
      allPresent,
      r,
      newId,
    );
    expect(res.loaded).toBe(0);
    expect(r.bulkInsert).not.toHaveBeenCalled();
    expect(res.issues.some((i) => i.field === "correct_value")).toBe(true);
  });

  it("0〜100 整数の正常入稿は全問 bulkInsert される（対照）", async () => {
    const r = repo();
    const res = await loadQuestions(
      [{ questionNumber: 1, text: "都道府県の数", correctValue: 47 }],
      allPresent,
      r,
      newId,
    );
    expect(res.loaded).toBe(1);
    expect(r.bulkInsert).toHaveBeenCalledOnce();
  });
});

describe("questions/load_questions 全 or 無の入稿オーケストレーション（§2.2）", () => {
  // codd: covers vb=VB-52
  it("正常入稿で各問が id 付き Question 行へ写像され bulkInsert に渡る（text/メディア/正解値を保持）", async () => {
    const r = repo();
    // 決定的な id を発番し、写像結果を独立に組んだ期待行と照合できるようにする。
    let n = 0;
    const genId = () => `gen-${++n}`;

    const res: LoadResult = await loadQuestions(
      [
        { questionNumber: 1, text: "都道府県の数", correctValue: 47 },
        {
          questionNumber: 2,
          text: "映像の最高速度",
          correctValue: 80,
          imagePath: null,
          videoPath: "q02-speed.mp4",
        },
      ],
      allPresent,
      r,
      genId,
    );

    // 全問妥当ゆえ登録問数=2・issue は空。
    expect(res.loaded).toBe(2);
    expect(res.issues).toEqual([]);

    // 生成側の Question 型で期待行を独立に構築し、bulkInsert へ渡った写像結果を検証する。
    // 未指定メディア（省略・明示 null）は NULL 化され、correct_value は入稿値のまま保持される。
    const expectedRows: Question[] = [
      {
        id: "gen-1",
        questionNumber: 1,
        text: "都道府県の数",
        imagePath: null,
        videoPath: null,
        correctValue: 47,
      },
      {
        id: "gen-2",
        questionNumber: 2,
        text: "映像の最高速度",
        imagePath: null,
        videoPath: "q02-speed.mp4",
        correctValue: 80,
      },
    ];
    expect(r.bulkInsert).toHaveBeenCalledWith(expectedRows);
  });

  // codd: covers vb=VB-63
  it("検証エラーが1件でもあれば有効問も含め1行も登録されない（全 or 無）", async () => {
    const r = repo();
    const res = await loadQuestions(
      [
        { questionNumber: 1, text: "有効な問題", correctValue: 30 },
        { questionNumber: 2, text: "   ", correctValue: 50 },
      ],
      allPresent,
      r,
      newId,
    );
    // 1 問目は妥当だが 2 問目の空白のみ text で検証が失敗 → 部分登録せず 0 問。
    // これにより「エラーが1件でもあれば有効問も登録されない」全 or 無を証明する。
    expect(res.loaded).toBe(0);
    expect(r.bulkInsert).not.toHaveBeenCalled();
    expect(res.issues.length).toBeGreaterThan(0);
  });

  // codd: covers vb=VB-64
  it("宣言メディアが所定フォルダに未配置なら問題番号を添えて拒否され 0 行登録", async () => {
    const r = repo();
    const res = await loadQuestions(
      [
        {
          questionNumber: 3,
          text: "映像問題",
          correctValue: 80,
          videoPath: "missing.mp4",
        },
      ],
      nonePresent,
      r,
      newId,
    );
    // 未配置メディアは入稿を拒否し（0 行登録・bulkInsert 未呼出）、issue に当該問題番号を添える。
    expect(res.loaded).toBe(0);
    expect(r.bulkInsert).not.toHaveBeenCalled();
    const mediaIssue = res.issues.find((issue) => issue.field === "video_path");
    expect(mediaIssue).toBeDefined();
    expect(mediaIssue?.questionNumber).toBe(3);
  });
});
