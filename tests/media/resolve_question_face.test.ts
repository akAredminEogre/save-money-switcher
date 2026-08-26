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
  resolveQuestionFace,
  type QuestionFace,
} from "../../src/media/resolve_question_face.js";
import type { Question } from "../../src/questions/question.js";

// 出題面の解決は questions の 3 フィールドのみで決まる純関数ゆえ、
// 各ケースは差分（videoPath / imagePath / text）だけを base から上書きして与える。
// 生成側の型（Question / QuestionFace）を import し、コンパイラに形を証明させる。
const base: Question = {
  id: "q1",
  questionNumber: 1,
  text: "問題文",
  imagePath: null,
  videoPath: null,
  correctValue: 50,
};

describe("media/resolve_question_face 出題面の3段フォールバック（N-2・順序厳守）", () => {
  // codd: covers vb=VB-48
  it("動画パス有なら動画（画像が有っても動画優先）", () => {
    // 動画・画像が両方あっても、規定順の第1段＝動画が選ばれること（順序入替・段飛ばし禁止）。
    const face: QuestionFace = resolveQuestionFace({
      ...base,
      videoPath: "q01-speed.mp4",
      imagePath: "q01-crowd.png",
    });
    expect(face.kind).toBe("video");
    expect(face.source).toBe("q01-speed.mp4");
  });

  // codd: covers vb=VB-49
  it("動画無・画像有なら画像、双方無ならテキストへフォールバックする", () => {
    // 動画無・画像有 → 第2段の画像で解決し、source は宣言された画像パスになる。
    const imageFace: QuestionFace = resolveQuestionFace({
      ...base,
      videoPath: null,
      imagePath: "q03-crowd.png",
    });
    expect(imageFace.kind).toBe("image");
    expect(imageFace.source).toBe("q03-crowd.png");

    // 動画・画像とも無 → 第3段のテキストで解決し、source は問題文本文になる。
    const textFace: QuestionFace = resolveQuestionFace({
      ...base,
      videoPath: null,
      imagePath: null,
      text: "日本の都道府県の数は？",
    });
    expect(textFace.kind).toBe("text");
    expect(textFace.source).toBe("日本の都道府県の数は？");
  });
});
