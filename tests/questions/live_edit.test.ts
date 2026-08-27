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
import { applyLiveEdit } from "../../src/questions/live_edit.js";
import type {
  QuestionsRepository,
  QuestionContentPatch,
} from "../../src/questions/questions_repository.js";
import type { Question } from "../../src/questions/question.js";

// 編集対象の基準問題（メディアなし・correct_value=50）。各テストは検証したい 1 フィールド
// だけを patch で与え、他フィールドは基準値のまま読み戻される想定でアサートする。
// 生成側の型（Question / QuestionsRepository / QuestionContentPatch）を import し、
// 返り値・patch の形をコンパイラに証明させる。
const baseQuestion: Question = {
  id: "q1",
  questionNumber: 1,
  text: "元の問題文",
  imagePath: null,
  videoPath: null,
  correctValue: 50,
};

// QuestionsRepository のテストダブル。updateContent は「永続 → 読み戻し」を単一メソッドで
// 模し、与えた patch のフィールドのみを基準へ重ねた編集後 Question を返す（DB 実体・
// CHECK 制約は persistence 実装／E2E の担当）。未指定フィールドは基準値を保持する。
function repository(): QuestionsRepository {
  return {
    bulkInsert: vi.fn(async () => {}),
    getByNumber: vi.fn(async () => baseQuestion),
    listAll: vi.fn(async () => [baseQuestion]),
    updateContent: vi.fn(
      async (_id: string, patch: QuestionContentPatch): Promise<Question> => ({
        id: baseQuestion.id,
        questionNumber: baseQuestion.questionNumber,
        text: patch.text ?? baseQuestion.text,
        imagePath:
          patch.imagePath !== undefined ? patch.imagePath : baseQuestion.imagePath,
        videoPath:
          patch.videoPath !== undefined ? patch.videoPath : baseQuestion.videoPath,
        correctValue: patch.correctValue ?? baseQuestion.correctValue,
      }),
    ),
  };
}

describe("questions/live_edit ライブ編集と再採点ゲート（QM-3・§2.5）", () => {
  // codd: covers vb=VB-36
  it("進行中の編集が updateContent で永続し、編集後の text と correct_value を読み戻せる", async () => {
    const repo = repository();
    const rescore = { rescoreQuestion: vi.fn(async () => {}) };
    const patch: QuestionContentPatch = {
      text: "その場で確定した問題文",
      correctValue: 73,
    };

    const updated = await applyLiveEdit(
      "q1",
      patch,
      repo,
      { isDisclosed: async () => false },
      rescore,
    );

    // 永続: 与えた patch がそのまま updateContent へ渡り、questions 行更新を起こす。
    expect(repo.updateContent).toHaveBeenCalledWith("q1", patch);
    // 読み戻し: 返る Question が編集後の値（基準とは異なる値）を反映する。
    expect(updated.text).toBe("その場で確定した問題文");
    expect(updated.correctValue).toBe(73);
    // 編集していないフィールドは基準値のまま読み戻される（全 readback を返す証跡）。
    expect(updated.questionNumber).toBe(1);
  });

  // codd: covers vb=VB-37
  it("開示済み（c 以降）で correct_value を編集すると自動再採点が起動する", async () => {
    const rescore = { rescoreQuestion: vi.fn(async () => {}) };

    await applyLiveEdit(
      "q1",
      { correctValue: 60 },
      repository(),
      { isDisclosed: async () => true },
      rescore,
    );

    // 2 条件（correct_value を含む × 開示済み）が揃うので当該問の再採点が誘発される。
    expect(rescore.rescoreQuestion).toHaveBeenCalledWith("q1");
    expect(rescore.rescoreQuestion).toHaveBeenCalledTimes(1);
  });

  it("開示済みで correct_value を 0 に編集しても再採点が起動する（falsy 値・0 境界）", async () => {
    const rescore = { rescoreQuestion: vi.fn(async () => {}) };

    await applyLiveEdit(
      "q1",
      { correctValue: 0 },
      repository(),
      { isDisclosed: async () => true },
      rescore,
    );

    // 存在判定は !== undefined ゆえ 0（0〜100 の妥当値だが falsy）でも「編集された」と扱う。
    // 真偽値判定なら 0 を取り零して再採点が漏れる ── その退行をこのテストが赤にする。
    expect(rescore.rescoreQuestion).toHaveBeenCalledWith("q1");
  });

  // codd: covers vb=VB-38
  it("c 未到達（isDisclosed 偽）の correct_value 編集では再採点は走らない（境界外）", async () => {
    const repo = repository();
    const rescore = { rescoreQuestion: vi.fn(async () => {}) };

    await applyLiveEdit(
      "q1",
      { correctValue: 60 },
      repo,
      { isDisclosed: async () => false },
      rescore,
    );

    // 開示前は再採点対象外＝ balances は不変。ただし編集自体は永続する（updateContent は呼ぶ）。
    expect(rescore.rescoreQuestion).not.toHaveBeenCalled();
    expect(repo.updateContent).toHaveBeenCalledWith("q1", { correctValue: 60 });
  });

  // codd: covers vb=VB-69
  it("問題文・メディアパスのみの編集では再採点が走らない（correct_value 不変ゆえ balances 不変）", async () => {
    const repo = repository();
    const rescore = { rescoreQuestion: vi.fn(async () => {}) };

    await applyLiveEdit(
      "q1",
      { videoPath: "q01-recut.mp4" },
      repo,
      { isDisclosed: async () => true },
      rescore,
    );

    // correct_value を含まない編集は、開示済みでも再採点を誘発しない（メディアは永続する）。
    expect(rescore.rescoreQuestion).not.toHaveBeenCalled();
    expect(repo.updateContent).toHaveBeenCalledWith("q1", { videoPath: "q01-recut.mp4" });
  });
});
