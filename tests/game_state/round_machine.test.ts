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
  nextStage,
  previousStage,
  type RoundCommand,
} from "../../src/game_state/round_machine.js";
import { isDisclosed, isSettled } from "../../src/game_state/progression.js";

// Round Stage Machine（src/game_state/round_machine.ts）の遷移トポロジ単体検証（SM-1・§4.2 / §4.5）。
// nextStage は lock/open/reveal/settle の前進 4 辺の唯一の合法性所有者であり、不正遷移
// （開示未到達での reveal・受付中からの settle 等）を RangeError で拒否する。previousStage は
// 取消の巻き戻し先候補（逆辺 topology）のみを返し、durable な undo 副作用（settlements/
// balances 巻き戻し）は F-03 未確定ゆえ含まない。開示・精算フラグ（isDisclosed/isSettled）は
// 前進辺で到達した段階を progression.ts の述語へ通し、c/d 境界での反転を確認する。期待遷移先・
// 期待フラグは SUT 出力とは独立に、確定したトポロジから固定して突き合わせる。

describe("game_state/round_machine 前進遷移（合法な 1 段前進・SM-1）", () => {
  it("受付中→締切→開示→正解発表→精算を lock/open/reveal/settle で 1 段ずつ前進する", () => {
    expect(nextStage("accepting", "lock")).toBe("answers_locked");
    expect(nextStage("answers_locked", "open")).toBe("answers_opened");
    expect(nextStage("answers_opened", "reveal")).toBe("answer_revealed");
    expect(nextStage("answer_revealed", "settle")).toBe("settlement_computed");
  });

  // codd: covers vb=VB-73
  it("正解発表(reveal)は開示(answers_opened)到達後のみ当該問を answer_revealed（開示済み c）へ記録し、未到達での reveal は不正遷移として拒否する", () => {
    // reveal は開示(b=answers_opened)到達後のみ合法で、当該問を c（answer_revealed）へ進める。
    const revealed = nextStage("answers_opened", "reveal");
    expect(revealed).toBe("answer_revealed");
    // answer_revealed 到達＝isDisclosed 真＝開示済みとして記録された状態（以後の正解ライブ編集が再採点対象）。
    expect(isDisclosed(revealed)).toBe(true);
    // 開示(answers_opened)未到達（締切段階）での reveal は不正遷移として RangeError で拒否。
    expect(() => nextStage("answers_locked", "reveal")).toThrow(RangeError);
  });
});

describe("game_state/round_machine 開示・精算フラグの c/d 境界（再採点範囲・§4.5）", () => {
  it("前進で到達した c（answer_revealed）で isDisclosed が真へ・d（settlement_computed）到達のみ isSettled が真へ反転する", () => {
    // 前進辺で c（answer_revealed）まで進めた結果を progression の述語へ通し、開示フラグの反転を SUT 出力から確認する。
    const disclosed = nextStage("answers_opened", "reveal");
    expect(isDisclosed(disclosed)).toBe(true);
    // さらに settle で d（settlement_computed）へ進めた結果のみ精算済みフラグが真になる。
    const settled = nextStage(disclosed, "settle");
    expect(isSettled(settled)).toBe(true);
    // c 到達（answer_revealed）は開示済みだが未精算＝残額の差分再計算（TV d/e 同時更新）の対象外。
    expect(isSettled(disclosed)).toBe(false);
  });

  it("c 境界（開示）：answers_opened は偽・answer_revealed で真へ、d 境界（精算）：settlement_computed のみ真", () => {
    // c 直前（b＝answers_opened）は未開示ゆえ正解ライブ編集の自動再採点対象外（境界外）。
    expect(isDisclosed("answers_opened")).toBe(false);
    // c（answer_revealed）到達で開示済み＝以後の correct_value 編集が再採点対象になる。
    expect(isDisclosed("answer_revealed")).toBe(true);
    expect(isDisclosed("settlement_computed")).toBe(true);
    // 精算済みは c（answer_revealed）ではまだ偽で、d（settlement_computed）到達問のみ真＝差分再計算の対象。
    expect(isSettled("answers_opened")).toBe(false);
    expect(isSettled("answer_revealed")).toBe(false);
    expect(isSettled("settlement_computed")).toBe(true);
  });
});

describe("game_state/round_machine 不正遷移拒否（RangeError・SM-1）", () => {
  it("各コマンドは唯一の from 段階以外から発火すると RangeError で拒否される", () => {
    // settle は answer_revealed からのみ。受付中からの settle（正解発表を飛ばした精算）は拒否。
    expect(() => nextStage("accepting", "settle")).toThrow(RangeError);
    // open は answers_locked からのみ。受付中からの open（締切を飛ばした開示）は拒否。
    expect(() => nextStage("accepting", "open")).toThrow(RangeError);
    // lock は accepting からのみ。締切済みからの再 lock は拒否。
    expect(() => nextStage("answers_locked", "lock")).toThrow(RangeError);
    // reveal は answers_opened からのみ。精算済みからの reveal は拒否。
    expect(() => nextStage("settlement_computed", "reveal")).toThrow(RangeError);
  });

  it("終端（settlement_computed）からはどのコマンドでも前進できない", () => {
    const commands: RoundCommand[] = ["lock", "open", "reveal", "settle"];
    for (const command of commands) {
      expect(() => nextStage("settlement_computed", command)).toThrow(RangeError);
    }
  });
});

describe("game_state/round_machine 逆辺 topology（取消の巻き戻し先候補・§4.2）", () => {
  it("各段階の 1 段手前を返し、受付中は巻き戻し先を持たない（null）", () => {
    // 前進の各辺に対する逆辺の topology のみ（durable な settlements/balances 巻き戻しは F-03）。
    expect(previousStage("settlement_computed")).toBe("answer_revealed");
    expect(previousStage("answer_revealed")).toBe("answers_opened");
    expect(previousStage("answers_opened")).toBe("answers_locked");
    expect(previousStage("answers_locked")).toBe("accepting");
    // 初期段階（受付中）より手前は無い。
    expect(previousStage("accepting")).toBe(null);
  });

  it("逆辺は前進辺と整合する（前進後に previousStage で元の from 段階へ戻る）", () => {
    expect(previousStage(nextStage("accepting", "lock"))).toBe("accepting");
    expect(previousStage(nextStage("answers_locked", "open"))).toBe("answers_locked");
    expect(previousStage(nextStage("answers_opened", "reveal"))).toBe("answers_opened");
    expect(previousStage(nextStage("answer_revealed", "settle"))).toBe("answer_revealed");
  });
});
