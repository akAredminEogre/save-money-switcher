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
import { nextMode, backMode, jumpMode } from "../../src/game_state/tv_machine.js";
import type { TvMode } from "../../src/game_state/tv_mode.js";

// TV Mode Machine のナビゲーション関数（src/game_state/tv_machine.ts の nextMode / backMode /
// jumpMode）を in-process で駆動する単体検証（SM-1・detailed_design:state-machines §2.4 / §4.2 / §4.5）。
// これらは制御盤の 3系統操作（「次へ」＝nextMode ／「戻る」＝backMode ／「個別ジャンプ」＝jumpMode）を
// 成す純粋・副作用なしの表示ナビゲーションで、TvMode（a〜e）を環状順序 a→b→c→d→e→a 上で往来させる。
// 表示ナビゲーションゆえ rounds.stage は前進も巻き戻しもしない。本テストは
//   ・「次へ」が a→b→c→d→e→a を 1 つずつ順送りし、e の次は a へ環状に折り返すこと
//   ・「戻る」が e→d→c→b→a→e と逆順に巡回し、a の前は e へ環状に折り返すこと
//   ・「個別ジャンプ」が現在モードに依らず要求モードを直接返す恒等写像であること
// を固定する。3系統の発火に伴う tv_mode_changed 配信と host 権限判定は module:realtime_sync /
// module:control_panel の責務で別スイートが担い、本テストは tv_machine が所有する純粋な遷移計算のみを
// 検証する。期待対応先は各関数の出力とは独立に、確定した環状順序・恒等挙動から固定モードとして書き下す。

describe("game_state/tv_machine TV モードナビゲーション（次へ/戻る/個別ジャンプ・SM-1・§2.4 / §4.2 / §4.5）", () => {
  it("「次へ」は a→b→c→d→e→a を 1 つずつ順送りし、e の次は環状に a へ折り返す", () => {
    // 期待巡回順は nextMode の出力とは独立に、確定した順序（a を起点に b→c→d→e→a）から固定する。
    const forwardFromA: readonly TvMode[] = ["b", "c", "d", "e", "a"];
    const visited: TvMode[] = [];
    let current: TvMode = "a";
    for (let step = 0; step < forwardFromA.length; step += 1) {
      current = nextMode(current);
      visited.push(current);
    }
    expect(visited).toEqual(forwardFromA);
    // e（全問通算一覧）の次は環状に折り返して開始モード a（次問の出題面）へ戻る。
    expect(current).toBe("a");
  });

  it("「戻る」は e→d→c→b→a→e と逆順に巡回し、a の前は環状に e へ折り返す", () => {
    // 期待逆巡回順は backMode の出力とは独立に、確定した逆順（e を起点に d→c→b→a→e）から固定する。
    const backwardFromE: readonly TvMode[] = ["d", "c", "b", "a", "e"];
    const visited: TvMode[] = [];
    let current: TvMode = "e";
    for (let step = 0; step < backwardFromE.length; step += 1) {
      current = backMode(current);
      visited.push(current);
    }
    expect(visited).toEqual(backwardFromE);
    // a（出題面）の前は環状に折り返して e（全問通算一覧）へ戻る。
    expect(current).toBe("e");
  });

  it("「個別ジャンプ」は a〜e の要求モードを順序を辿らず直接返す（恒等写像）", () => {
    // 現在モードに依らず、要求した任意モードをそのまま返す（全ペア許容の直接遷移）。
    // 期待値は各呼出しの引数とは別に、確定した恒等挙動から固定モードとして書き下す。
    expect(jumpMode("a")).toBe("a");
    expect(jumpMode("b")).toBe("b");
    expect(jumpMode("c")).toBe("c");
    expect(jumpMode("d")).toBe("d");
    expect(jumpMode("e")).toBe("e");
  });

  it("「次へ」と「戻る」は互いの逆で、いずれの向きに往復しても起点モードへ戻る", () => {
    const allModes: readonly TvMode[] = ["a", "b", "c", "d", "e"];
    for (const mode of allModes) {
      // 順送り→逆送り／逆送り→順送りのいずれの往復でも、起点の固定モードへ復帰する。
      expect(backMode(nextMode(mode))).toBe(mode);
      expect(nextMode(backMode(mode))).toBe(mode);
    }
  });

  // 制御盤のモード切替は 3系統（次へ/戻る/個別ジャンプ）が唯一の所有者であり、同一の現在モードから
  // 各系統が固有の対応先を返すこと（＝各系統がモード切替を発火すること）を統合的に固定する（SM-1・§2.4）。
  // codd: covers vb=VB-46
  it("次へ/戻る/個別ジャンプの 3系統が同一現在モードから各系統固有の対応先へモード切替を発火する", () => {
    // 現在モード c を共通起点に、3系統がそれぞれ相異なる正しい対応先を返す。
    // 期待対応先は各関数の出力とは独立に、確定した順序・恒等挙動から固定モードとして書き下す。
    expect(nextMode("c")).toBe("d"); // 「次へ」: 1 つ順送り
    expect(backMode("c")).toBe("b"); // 「戻る」: 1 つ逆送り
    expect(jumpMode("e")).toBe("e"); // 「個別ジャンプ」: 任意モードへ直接

    // 各系統が所有する環状の折り返し辺（次へ: e→a ／ 戻る: a→e）も 3系統の発火に含まれる。
    expect(nextMode("e")).toBe("a");
    expect(backMode("a")).toBe("e");
  });
});
