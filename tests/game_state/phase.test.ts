// @generated-by: codd implement
// @generated-from: docs/detailed_design/state_machines.md (detailed_design:state-machines)
// @design-node: docs/detailed_design/state_machines.md
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
  derivePhase,
  QUESTION_COUNT,
  type GamePhase,
} from "../../src/game_state/phase.js";

// ゲーム進行フェーズ（game_state.phase）の集約ビュー導出（src/game_state/phase.ts）の
// 単体検証。全問数と精算済み問数から lobby/in_progress/finished を導く境界
// （10 問到達で finished・出題開始有無・finished の優先）を、期待値を SUT 出力とは独立に
// 固定して突き合わせる（detailed_design:state-machines §2.1 / §4.1）。

describe("game_state/phase ゲーム進行フェーズの導出（§2.1・§4.1）", () => {
  it("1 ゲームの問数は 10 問（全問精算で finished へ導出する閾値）", () => {
    // 閾値は採点エンジンに依存せず game_flow 側で単一宣言する。期待値 10 を独立に固定。
    expect(QUESTION_COUNT).toBe(10);
  });

  it("出題未開始（activated 偽）は精算済み問数に依らず lobby", () => {
    expect(derivePhase(false, 0)).toBe("lobby");
    // 未開始である限り（10 問未満なら）lobby を返す。
    expect(derivePhase(false, 5)).toBe("lobby");
  });

  it("出題開始済みで 10 問未満の精算は in_progress", () => {
    // 導出結果を GamePhase として受け、型経由で戻り値の形を固定する。
    const atStart: GamePhase = derivePhase(true, 0);
    expect(atStart).toBe("in_progress");
    // 第10問精算直前（settledCount 9）はまだ in_progress（finished 境界の直下）。
    expect(derivePhase(true, QUESTION_COUNT - 1)).toBe("in_progress");
  });

  it("全 10 問精算完了（settledCount 10）で finished へ導出する（10 問終了の境界）", () => {
    // 第10問が settlement_computed 到達＝10 問すべて精算完了で finished
    // （op_determine_winner の前提。境界に > を用いる実装ならここで in_progress となり FAIL）。
    expect(derivePhase(true, QUESTION_COUNT)).toBe("finished");
  });

  it("finished は精算済み問数のみで決まり activated の真偽に依らない（10 問到達が最優先）", () => {
    // 精算数が 10 以上なら activated が偽でも finished（== ではなく >= 判定であることも固定）。
    expect(derivePhase(false, QUESTION_COUNT)).toBe("finished");
    expect(derivePhase(true, QUESTION_COUNT + 3)).toBe("finished");
  });
});
