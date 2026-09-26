// @generated-by: codd implement
// @generated-from: docs/design/surface_copy_obligations.md (design:surface-copy-obligations)
// @design-node: docs/design/surface_copy_obligations.md
// @output-paths: src, tests
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @generated-from: docs/design/operational_behavior_model.md (design:operational-behavior-model)
// @generated-from: docs/design/participation_connection_design.md (design:participation-connection-design)
// @generated-from: docs/design/question_media_intake_design.md (design:question-media-intake-design)
// @generated-from: docs/design/realtime_sync_design.md (design:realtime-sync-design)
// @generated-from: docs/design/scoring_engine_design.md (design:scoring-engine-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { describe, it, expect } from "vitest";
import {
  renderTvSurface,
  serializeTvSurface,
  collectVisibleText,
  MissingTvSurfaceDataError,
} from "../../src/tv_display/render_tv_surface.js";
import type { Question } from "../../src/questions/question.js";
import type { SettlementTableEntry } from "../../src/tv_display/render_settlement_table.js";

// 本ユニットは surface_copy_obligations §2.4 の TV 5 モード受動表示ディスパッチ・開示前伏せ・
// 正解値提示・入力/操作要素と司会者操作語の非露出・MVP 最小提示の各義務を検証する。
const question: Question = {
  id: "q1",
  questionNumber: 3,
  text: "問題文",
  imagePath: null,
  videoPath: null,
  correctValue: 47,
};
const settlement: readonly SettlementTableEntry[] = [
  {
    name: "たろう",
    answerValue: 45,
    error: 5,
    deltaYen: -500,
    pitariAwarded: false,
    pitariBonusYen: 0,
    balanceYen: 9_500,
  },
];

const HOST_OPERATION_WORDS = [
  "そこまで",
  "解答オープン",
  "正解発表",
  "精算",
  "次へ",
  "戻る",
  "取消",
  "個別ジャンプ",
  "問題を読み込む",
];

describe("tv_display/render_tv_surface 5 モード受動表示", () => {
  // codd: covers vb=VB-45
  it("a/b/c/d/e の 5 モードをそれぞれ描画し、必要データ欠落は拒否する", () => {
    expect(renderTvSurface({ mode: "a", question }).mode).toBe("a");
    expect(
      renderTvSurface({ mode: "b", disclosure: { disclosed: true, answers: [] } }).mode,
    ).toBe("b");
    expect(renderTvSurface({ mode: "c", correctValue: 47 }).mode).toBe("c");
    expect(renderTvSurface({ mode: "d", settlement }).mode).toBe("d");
    expect(
      renderTvSurface({ mode: "e", totals: { entries: [], finished: false } }).mode,
    ).toBe("e");
    expect(() => renderTvSurface({ mode: "d" })).toThrow(MissingTvSurfaceDataError);
  });

  // codd: covers vb=VB-19
  it("開示(b)未実行の間は他者の解答を表示しない", () => {
    const hidden = renderTvSurface({
      mode: "b",
      disclosure: { disclosed: false, answers: [{ name: "ヒミツさん", answerValue: 42 }] },
    });
    if (hidden.mode !== "b") throw new Error("b モードではありません");
    expect(hidden.rows).toEqual([]);
    const hiddenText = collectVisibleText(hidden).join(" ");
    expect(hiddenText).not.toContain("42");
    expect(hiddenText).not.toContain("ヒミツさん");

    const shown = renderTvSurface({
      mode: "b",
      disclosure: { disclosed: true, answers: [{ name: "ヒミツさん", answerValue: 42 }] },
    });
    if (shown.mode !== "b") throw new Error("b モードではありません");
    expect(shown.rows).toEqual([{ name: "ヒミツさん", answer: "42" }]);
  });

  // codd: covers vb=VB-73
  it("c モードが当該問の正解値を提示する", () => {
    const view = renderTvSurface({ mode: "c", correctValue: 47 });
    if (view.mode !== "c") throw new Error("c モードではありません");
    expect(view.correctValue).toBe(47);
    expect(collectVisibleText(view)).toContain("47");
  });

  // codd: covers vb=VB-84
  it("入力・操作要素を持たず可視文言に司会者操作語・内部識別子を含まない", () => {
    const views = [
      renderTvSurface({ mode: "a", question }),
      renderTvSurface({
        mode: "b",
        disclosure: { disclosed: true, answers: [{ name: "A", answerValue: 10 }] },
      }),
      renderTvSurface({ mode: "c", correctValue: 47 }),
      renderTvSurface({ mode: "d", settlement }),
      renderTvSurface({
        mode: "e",
        totals: { entries: [{ name: "A", balanceYen: 9_500 }], finished: true },
      }),
    ];
    for (const view of views) {
      const html = serializeTvSurface(view);
      for (const tag of [
        "<button",
        "<input",
        "<form",
        "<select",
        "<textarea",
        "contenteditable",
        "onclick",
      ]) {
        expect(html).not.toContain(tag);
      }
      const visible = collectVisibleText(view).join(" ");
      for (const word of HOST_OPERATION_WORDS) {
        expect(visible).not.toContain(word);
      }
      expect(visible).not.toMatch(/\bhost\b|\bcontestant\b|\baudience\b/i);
    }
  });

  // codd: covers vb=VB-55
  it("MVP の正解発表が開示一覧＋正解値＋増減円で成立し演出フィールドを要求しない", () => {
    const disclosure = renderTvSurface({
      mode: "b",
      disclosure: { disclosed: true, answers: [{ name: "たろう", answerValue: 45 }] },
    });
    const correct = renderTvSurface({ mode: "c", correctValue: 50 });
    const table = renderTvSurface({ mode: "d", settlement });
    if (disclosure.mode !== "b" || correct.mode !== "c" || table.mode !== "d") {
      throw new Error("想定モードではありません");
    }
    // 開示一覧（氏名＋解答）
    expect(disclosure.rows).toEqual([{ name: "たろう", answer: "45" }]);
    // 正解値
    expect(correct.correctValue).toBe(50);
    // 得点増減（円）
    expect(table.rows[0].deltaYen).toBe("-500円");
    // 効果音/カウントダウン/アニメ/ランキング等の演出フィールドを持たない。
    for (const view of [disclosure, correct, table]) {
      const keys = Object.keys(view);
      for (const forbidden of ["animation", "sound", "countdown", "ranking", "effect"]) {
        expect(keys).not.toContain(forbidden);
      }
    }
  });
});
