// @generated-by: codd implement
// @generated-from: docs/detailed_design/state_machines.md (detailed_design:state-machines)
// @design-node: docs/detailed_design/state_machines.md
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
  planRescore,
  type LiveEditPatch,
  type RescorePlan,
} from "../../src/game_state/rescore_trigger.js";
import type { Stage } from "../../src/game_state/progression.js";

// 自動再採点の起動分界（src/game_state/rescore_trigger.ts の planRescore）の単体検証
// （SM-2・detailed_design:state-machines §2.3 / §4.3 / §4.5）。planRescore は「どの進行段階で・
// どの編集内容なら再採点が走るか」という起動可否のみを所有する純関数で、実計算（settlements 再計算・
// balances 差分更新）は module:scoring、TV d/e の同時更新配信は module:realtime_sync が担う。
// 本テストはその起動分界を in-process で駆動し、
//   ・c 到達（answer_revealed）の correctValue 編集 → 再採点起動・TV d/e 同期なし
//   ・d 到達（settlement_computed）の correctValue 編集 → 再採点起動・TV d/e 同期あり
//   ・c 未到達（accepting / answers_locked / answers_opened）の correctValue 編集 → 再採点しない（境界外）
//   ・text / 画像・動画パスのみの編集 → 再採点しない（correctValue 不変）
// を固定する。期待計画は planRescore の出力とは独立に RescorePlan 型付き定数として書き、実出力と
// 突き合わせる（型注釈により RescorePlan の形＝rescore / syncTvDE の束縛をコンパイラが保証する）。

describe("game_state/rescore_trigger planRescore の起動分界（SM-2・§4.3 / §4.5）", () => {
  // codd: covers vb=VB-37
  it("c 到達（answer_revealed）の correctValue 編集は自動再採点を起動する（d 未到達ゆえ TV d/e 同期は伴わない）", () => {
    // c（answer_revealed）到達＝開示済み。以後の正解ライブ編集が自動再採点の対象になる。
    // 期待計画は SUT 出力とは独立に、RescorePlan 型付き定数として固定する。
    const expected: RescorePlan = { rescore: true, syncTvDE: false };
    const plan = planRescore("answer_revealed", { correctValue: 40 });
    expect(plan).toEqual(expected);
    // 起動フラグ rescore が真＝呼出し側が module:scoring の再採点（各人の残額へ反映）を起こす契機。
    // 偽へ退行すると c 到達問の正解訂正が残額へ反映されなくなる。
    expect(plan.rescore).toBe(true);

    // 正解値 0（falsy）でも「correctValue を含む」ゆえ再採点が起動する（真偽ではなく
    // `!== undefined` で存在を見る契約の境界。`if (patch.correctValue)` 実装ならここで FAIL）。
    expect(planRescore("answer_revealed", { correctValue: 0 })).toEqual(expected);
  });

  // codd: covers vb=VB-40
  it("d 到達（settlement_computed）の correctValue 編集は再採点＋TV d/e 同時更新（syncTvDE）を指示し、c 到達のみでは同期しない", () => {
    const expectedAtSettled: RescorePlan = { rescore: true, syncTvDE: true };
    const settledPlan = planRescore("settlement_computed", { correctValue: 40 });
    expect(settledPlan).toEqual(expectedAtSettled);

    // 判別可能ユニオンを絞り込み、syncTvDE への型付きアクセスで TV(d)/TV(e) 同時更新の指示を確認する。
    if (!settledPlan.rescore) {
      throw new Error("d 到達問の correctValue 編集は再採点計画を返すべき");
    }
    expect(settledPlan.syncTvDE).toBe(true);

    // 同時更新の指示は d 到達に固有：c 到達（未精算）では再採点は起動しても syncTvDE は偽。
    const revealedPlan = planRescore("answer_revealed", { correctValue: 40 });
    if (!revealedPlan.rescore) {
      throw new Error("c 到達問の correctValue 編集は再採点計画を返すべき");
    }
    expect(revealedPlan.syncTvDE).toBe(false);
  });

  it("c 未到達（accepting / answers_locked / answers_opened）の correctValue 編集は再採点しない（境界外）", () => {
    // 開示（answers_opened=b）までしか進んでいない問は未開示ゆえ、正解値を編集しても再採点は走らず
    // settlements / balances は不変。起動分界の下側境界を全 c 未到達段階で固定する。
    const noRescore: RescorePlan = { rescore: false };
    const preDisclosureStages: Stage[] = ["accepting", "answers_locked", "answers_opened"];
    for (const stage of preDisclosureStages) {
      expect(planRescore(stage, { correctValue: 40 })).toEqual(noRescore);
    }
  });

  // codd: covers vb=VB-69
  it("問題文・画像/動画パスのみの編集は correctValue 不変ゆえ、開示済み・精算済み段階でも再採点しない", () => {
    // correctValue を含まない patch は d 到達（settlement_computed）でも c 到達（answer_revealed）でも
    // 再採点を誘発せず balances は不変（a モードの出題面解決のみが変わる）。
    const noRescore: RescorePlan = { rescore: false };
    const contentOnlyPatches: LiveEditPatch[] = [
      { text: "改題後の問題文" },
      { imagePath: "q1.png" },
      { videoPath: "q1.mp4" },
      { videoPath: null },
      { text: "改題", imagePath: "q1.png", videoPath: "q1.mp4" },
    ];
    for (const patch of contentOnlyPatches) {
      expect(planRescore("settlement_computed", patch)).toEqual(noRescore);
      expect(planRescore("answer_revealed", patch)).toEqual(noRescore);
    }
  });
});
