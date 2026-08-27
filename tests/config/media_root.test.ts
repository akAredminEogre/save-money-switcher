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
  resolveQuestionMediaRoot,
  DEFAULT_QUESTION_MEDIA_ROOT,
  QUESTION_MEDIA_ROOT_ENV,
} from "../../src/config/media_root.js";
import type { ConfigSource } from "../../src/config/connection_limit.js";

// QUESTION_MEDIA_ROOT にのみ与えた値を返す ConfigSource（他キーは undefined）。
// これにより「値が使われるか」と「正しいキーを読んでいるか」を同時に検証できる。
function sourceReturning(value: string | undefined): ConfigSource {
  return {
    read: (key: string): string | undefined =>
      key === QUESTION_MEDIA_ROOT_ENV ? value : undefined,
  };
}

describe("config/media_root メディアルート解決（設定外出し・非ハードコード）", () => {
  it("既定値の単一定義が './question-media' である", () => {
    expect(DEFAULT_QUESTION_MEDIA_ROOT).toBe("./question-media");
  });

  it("QUESTION_MEDIA_ROOT に値があればその値を採用する", () => {
    expect(resolveQuestionMediaRoot(sourceReturning("./studio-media"))).toBe(
      "./studio-media",
    );
  });

  it("未設定（undefined）は既定 './question-media' へフォールバックする", () => {
    expect(resolveQuestionMediaRoot(sourceReturning(undefined))).toBe(
      "./question-media",
    );
  });

  it("空文字は既定 './question-media' へフォールバックする", () => {
    expect(resolveQuestionMediaRoot(sourceReturning(""))).toBe(
      "./question-media",
    );
  });

  it("空白のみの値は空欄とみなし既定 './question-media' へフォールバックする（whitespace handling）", () => {
    expect(resolveQuestionMediaRoot(sourceReturning("   "))).toBe(
      "./question-media",
    );
    expect(resolveQuestionMediaRoot(sourceReturning("\t\n "))).toBe(
      "./question-media",
    );
  });

  it("設定値は QUESTION_MEDIA_ROOT キー経由で解決する（別キーの値は無視して既定へ）", () => {
    const otherKeyOnly: ConfigSource = {
      read: (key: string): string | undefined =>
        key === "MAX_TABLET_CONNECTIONS" ? "./ignored-media" : undefined,
    };
    expect(resolveQuestionMediaRoot(otherKeyOnly)).toBe("./question-media");
  });
});
