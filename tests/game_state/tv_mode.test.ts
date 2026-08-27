// @generated-by: codd implement
// @generated-from: docs/design/operational_behavior_model.md (design:operational-behavior-model)
// @design-node: docs/design/operational_behavior_model.md
// @output-paths: tests
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @generated-from: docs/design/participation_connection_design.md (design:participation-connection-design)
// @generated-from: docs/design/question_media_intake_design.md (design:question-media-intake-design)
// @generated-from: docs/design/realtime_sync_design.md (design:realtime-sync-design)
// @generated-from: docs/design/scoring_engine_design.md (design:scoring-engine-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { describe, it, expect } from "vitest";
import { stageToTvMode, type TvMode } from "../../src/game_state/tv_mode.js";
import {
  isDisclosed,
  isSettled,
  type Stage,
} from "../../src/game_state/progression.js";

// 進行段階（rounds.stage）と TV モードの単一所有ヘルパ（src/game_state/*）の
// OBM-3 ユニット検証。段階→既定 TV モードの写像（stageToTvMode）と、正解ライブ編集の
// 自動再採点範囲を仕切る述語（isDisclosed/isSettled）の境界を、tv_mode.js と
// progression.js の双方から import して固定する（operational_behavior_model §2.2 / §2.6）。

describe("game_state/tv_mode 進行段階と TV モード対応（OBM-3・§2.2）", () => {
  it("段階→既定 TV モードを 5 通り（a/a/b/c/d）へ写す", () => {
    // 受付中・締切はいずれも出題面（a）、開示は b、正解発表は c、精算は d。
    // 期待モードは stageToTvMode の出力とは独立に、確定した対応表から固定する。
    expect(stageToTvMode("accepting")).toBe("a");
    expect(stageToTvMode("answers_locked")).toBe("a");
    expect(stageToTvMode("answers_opened")).toBe("b");
    expect(stageToTvMode("answer_revealed")).toBe("c");
    expect(stageToTvMode("settlement_computed")).toBe("d");
  });

  it("段階から生成される TV モードに e（全問通算）は現れず a〜d に限られる", () => {
    // e は段階写像ではなくモード切替（次へ/戻る/個別ジャンプ）でのみ到達する通算閲覧モード。
    // 5 段階すべてを写しても e にならないこと（戻り値型 Exclude<TvMode,"e"> の実行時裏付け）。
    const stages: Stage[] = [
      "accepting",
      "answers_locked",
      "answers_opened",
      "answer_revealed",
      "settlement_computed",
    ];
    const produced: TvMode[] = stages.map((stage) => stageToTvMode(stage));
    expect(produced).not.toContain("e");
    // 段階写像が到達しうる値集合は a〜d の 4 値ちょうど。
    expect(new Set(produced)).toEqual(new Set<TvMode>(["a", "b", "c", "d"]));
  });

  // codd: covers vb=VB-38
  it("開示境界：answers_opened は isDisclosed 偽、answer_revealed で真へ反転する", () => {
    // c 直前（b＝answers_opened）は未開示ゆえ正解ライブ編集の自動再採点対象外（境界外）。
    expect(isDisclosed("answers_opened")).toBe(false);
    // c（answer_revealed）到達で開示済み＝以後の correct_value 編集が再採点対象になる。
    expect(isDisclosed("answer_revealed")).toBe(true);
    expect(isDisclosed("settlement_computed")).toBe(true);
  });

  // codd: covers vb=VB-39
  it("精算境界：answer_revealed は isSettled 偽、settlement_computed のみ真", () => {
    // c（answer_revealed）は開示済みだが未精算＝残額の差分再計算（TV d/e 同時更新）の対象外。
    expect(isSettled("answer_revealed")).toBe(false);
    // d（settlement_computed）到達問のみ差分再計算の対象。
    expect(isSettled("settlement_computed")).toBe(true);
  });
});
