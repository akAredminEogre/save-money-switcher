// @generated-by: codd implement
// @generated-from: docs/design/surface_copy_obligations.md (design:surface-copy-obligations)
// @design-node: docs/design/surface_copy_obligations.md
// @output-paths: tests
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
  resolveQuestionFace,
  MEDIA_ROUTE_BASE,
} from "../../src/questions/resolve_question_face.js";
import type { QuestionFaceView } from "../../src/questions/resolve_question_face.js";
import type { Question } from "../../src/questions/question.js";

// 本ユニットは surface_copy_obligations §2.4a・§2.9 / op_switch_tv_mode の
// dod_tv_a_fallback / dod_tv_no_path_or_internal_leak を、TV a モードの出題面を供給する
// display-ready 純関数 src/questions/resolve_question_face.ts の resolveQuestionFace の単位で
// 機械可検化する。resolveQuestionFace は N-2 確定順（動画→画像→テキスト）で出題面を解決し、
// 動画・画像は配信 URL（MEDIA_ROUTE_BASE = /media 配下）として返して DB 保持の生ファイルパス
// （video_path/image_path の値）そのものを描画値に持たせず、種別タグは観客中立語
// video/image/text のみで fallback 等の内部語を露出しない。ここでは唯一の解決入口を実際に
// import して評価し、次の VB を押さえる:
//   - VB-48: a モードで動画パス有の問は画像有無に関わらず動画優先で解決される。
//   - VB-49: 動画無・画像有は画像、双方無はテキストへフォールバックする。
//   - VB-83: TV a モードの解決値に生ファイルパス値そのものや fallback 等の内部語が露出しない。

/** テスト用の Question を既定 null メディアで生成し、必要フィールドのみ上書きする。 */
function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: "q1",
    questionNumber: 1,
    text: "日本の都道府県の数は？",
    imagePath: null,
    videoPath: null,
    correctValue: 47,
    ...overrides,
  };
}

/** 解決済み出題面から観客へ渡る可視/派生値を取り出す（動画/画像は配信 URL・テキストは問題文）。 */
function resolvedPayload(face: QuestionFaceView): string {
  return face.kind === "text" ? face.text : face.mediaUrl;
}

describe("questions/resolve_question_face 出題面の優先順・非露出（TV a・SCO-3）", () => {
  // codd: covers vb=VB-48
  it("動画パス有の問は画像有無に関わらず動画で解決される（video 優先）", () => {
    // 動画・画像の双方があるとき、規定順 video→image→text で動画が最優先に解決される。
    const withImage = resolveQuestionFace(
      makeQuestion({ videoPath: "q02-speed.mp4", imagePath: "q02-crowd.png" }),
    );
    expect(withImage.kind).toBe("video");
    if (withImage.kind === "video") {
      // 選ばれた配信 URL は動画側であり、画像側 URL ではない（動画優先の証跡）。
      expect(withImage.mediaUrl).toBe(`${MEDIA_ROUTE_BASE}/q02-speed.mp4`);
      expect(withImage.mediaUrl).not.toBe(`${MEDIA_ROUTE_BASE}/q02-crowd.png`);
    }

    // 画像が無い場合も当然動画で解決される。
    const withoutImage = resolveQuestionFace(
      makeQuestion({ videoPath: "q02-speed.mp4", imagePath: null }),
    );
    expect(withoutImage.kind).toBe("video");
  });

  // codd: covers vb=VB-49
  it("動画無・画像有は画像、双方無はテキストへフォールバックする", () => {
    // 動画無・画像有 → 画像で解決（配信 URL）。
    const image = resolveQuestionFace(
      makeQuestion({ videoPath: null, imagePath: "q03-crowd.png" }),
    );
    expect(image.kind).toBe("image");
    if (image.kind === "image") {
      expect(image.mediaUrl).toBe(`${MEDIA_ROUTE_BASE}/q03-crowd.png`);
    }

    // 双方無 → テキスト（問題文を観客向けの可視値として返す）。
    const text = resolveQuestionFace(
      makeQuestion({ videoPath: null, imagePath: null, text: "この写真の人数は？" }),
    );
    expect(text.kind).toBe("text");
    if (text.kind === "text") {
      // 返るテキストは問題文そのもの（生パス・内部語ではない）。
      expect(text.text).toBe("この写真の人数は？");
    }
  });

  // codd: covers vb=VB-83
  it("解決値に生ファイルパス値そのものや fallback 等の内部語が露出しない（dod_tv_no_path_or_internal_leak）", () => {
    const RAW_VIDEO = "secret/q1-answer.mp4";
    const RAW_IMAGE = "secret/q1-answer.png";

    // 動画: 返る値は /media 配下の配信 URL で、生の video_path 値そのものと一致しない。
    const video = resolveQuestionFace(makeQuestion({ videoPath: RAW_VIDEO }));
    expect(video.kind).toBe("video");
    expect(resolvedPayload(video)).not.toBe(RAW_VIDEO);
    expect(resolvedPayload(video).startsWith(`${MEDIA_ROUTE_BASE}/`)).toBe(true);

    // 画像: 同様に配信 URL であり生の image_path 値そのものではない。
    const image = resolveQuestionFace(
      makeQuestion({ videoPath: null, imagePath: RAW_IMAGE }),
    );
    expect(image.kind).toBe("image");
    expect(resolvedPayload(image)).not.toBe(RAW_IMAGE);
    expect(resolvedPayload(image).startsWith(`${MEDIA_ROUTE_BASE}/`)).toBe(true);

    // 種別タグ（判別語）は観客中立の video/image/text のみで、内部語 fallback を用いない。
    const text = resolveQuestionFace(makeQuestion({ videoPath: null, imagePath: null }));
    const kinds = [video.kind, image.kind, text.kind];
    expect(kinds).toEqual(["video", "image", "text"]);
    for (const kind of kinds) {
      expect(kind).not.toBe("fallback");
    }
  });
});
