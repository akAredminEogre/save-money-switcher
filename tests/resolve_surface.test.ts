// @generated-by: codd implement
// @generated-from: docs/design/system_design.md (design:system-design)
// @design-node: docs/design/system_design.md
// @output-paths: src, tests
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { describe, it, expect } from "vitest";
import {
  resolveQuestionSurface,
  type QuestionSurface,
} from "../src/questions/resolve_surface.js";

describe("resolveQuestionSurface — TV a モードの出題面フォールバック（動画 → 画像 → テキスト）", () => {
  // codd: covers vb=VB-48
  it("動画パス有の問は画像有無に関わらず動画を出題面に解決する（動画優先）", () => {
    // 動画・画像の双方が宣言された問 → 動画を優先し、結果に画像面は載らない。
    const withImageToo = resolveQuestionSurface({
      text: "日本の都道府県のうち海に面していないのは何県？（0-100）",
      videoPath: "q01.mp4",
      imagePath: "q01.png",
    });
    expect(withImageToo.kind).toBe("video");
    if (withImageToo.kind === "video") {
      expect(withImageToo.videoPath).toBe("q01.mp4");
    }
    // 画像が併存しても動画結果に画像面が混ざらない（画像有無に関わらず動画優先）。
    expect(withImageToo).toEqual({ kind: "video", videoPath: "q01.mp4" });

    // 画像が無い問でも動画パス有なら動画面。
    const videoOnly = resolveQuestionSurface({
      text: "円周率の小数第1位は？（0-100）",
      videoPath: "q02.mp4",
    });
    expect(videoOnly).toEqual({ kind: "video", videoPath: "q02.mp4" });
  });

  // codd: covers vb=VB-49
  it("動画無・画像有は画像へ、動画も画像も無ければテキストへフォールバックする", () => {
    // 動画無・画像有 → 画像面。
    const imageFallback = resolveQuestionSurface({
      text: "この写真の犬は何匹？（0-100）",
      imagePath: "q03.png",
    });
    expect(imageFallback.kind).toBe("image");
    if (imageFallback.kind === "image") {
      expect(imageFallback.imagePath).toBe("q03.png");
    }
    expect(imageFallback).toEqual({ kind: "image", imagePath: "q03.png" });

    // 双方無 → テキスト面（終端フォールバック）。
    const textFallback = resolveQuestionSurface({
      text: "エベレストは世界の高い山で第何位？（0-100）",
    });
    expect(textFallback).toEqual({
      kind: "text",
      text: "エベレストは世界の高い山で第何位？（0-100）",
    });

    // 空白のみの動画パスは「無」として次段（画像）へフォールバックする。
    const whitespaceVideo: QuestionSurface = resolveQuestionSurface({
      text: "この果物は何個？（0-100）",
      videoPath: "   ",
      imagePath: "q04.png",
    });
    expect(whitespaceVideo).toEqual({ kind: "image", imagePath: "q04.png" });

    // 動画は null・画像は空文字 → 双方「無」としてテキスト面。
    const emptyBoth = resolveQuestionSurface({
      text: "テキスト出題面",
      videoPath: null,
      imagePath: "",
    });
    expect(emptyBoth).toEqual({ kind: "text", text: "テキスト出題面" });
  });
});
