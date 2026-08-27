// @generated-by: codd implement
// @generated-from: docs/design/system_design.md (design:system-design)
// @design-node: docs/design/system_design.md
// @output-paths: src, tests
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { describe, it, expect } from "vitest";
import {
  STAGES,
  INITIAL_STAGE,
  TERMINAL_STAGE,
  DISCLOSURE_STAGE,
  type Stage,
  type QuestionProgress,
  startQuestion,
  stageRank,
  isStage,
  isDisclosed,
  isSettled,
  acceptsSubmissions,
  successorOf,
  canTransition,
  transitionTo,
  advance,
  IllegalStageTransitionError,
} from "../src/game_state/progression.js";

describe("progression stage model", () => {
  it("declares the five stages in progression order with correct endpoints", () => {
    expect(STAGES).toEqual([
      "accepting",
      "answers_locked",
      "answers_opened",
      "answer_revealed",
      "settlement_computed",
    ]);
    expect(INITIAL_STAGE).toBe("accepting");
    expect(TERMINAL_STAGE).toBe("settlement_computed");
    expect(startQuestion(1).stage).toBe("accepting");
  });

  it("orders stages by declaration and validates stage strings", () => {
    expect(stageRank("accepting")).toBeLessThan(stageRank("answers_locked"));
    expect(stageRank("answers_opened")).toBeLessThan(stageRank("answer_revealed"));
    expect(stageRank("answer_revealed")).toBeLessThan(stageRank("settlement_computed"));

    expect(isStage("answers_opened")).toBe(true);
    expect(isStage("opened")).toBe(false);
    expect(isStage(2)).toBe(false);
    expect(isStage(undefined)).toBe(false);
  });
});

describe("legal stage transitions", () => {
  it("advances accepting → answers_locked → answers_opened → answer_revealed → settlement_computed", () => {
    let progress: QuestionProgress = startQuestion(7);
    expect(progress.stage).toBe("accepting");

    progress = advance(progress); // 司会者「そこまで」
    expect(progress.stage).toBe("answers_locked");

    progress = advance(progress); // 司会者「解答オープン！」
    expect(progress.stage).toBe("answers_opened");

    progress = advance(progress); // 正解発表
    expect(progress.stage).toBe("answer_revealed");

    progress = advance(progress); // 得点精算
    expect(progress.stage).toBe("settlement_computed");

    expect(progress.questionId).toBe(7); // 識別子は遷移を跨いで保持される
  });

  it("exposes the single legal successor of each stage and null at the terminal", () => {
    expect(successorOf("accepting")).toBe("answers_locked");
    expect(successorOf("answers_locked")).toBe("answers_opened");
    expect(successorOf("answers_opened")).toBe("answer_revealed");
    expect(successorOf("answer_revealed")).toBe("settlement_computed");
    expect(successorOf("settlement_computed")).toBeNull();
  });

  it("accepts each explicit single-step transition", () => {
    expect(transitionTo({ questionId: 3, stage: "accepting" }, "answers_locked").stage).toBe(
      "answers_locked",
    );
    expect(transitionTo({ questionId: 3, stage: "answers_opened" }, "answer_revealed").stage).toBe(
      "answer_revealed",
    );
    expect(canTransition("answer_revealed", "settlement_computed")).toBe(true);
  });
});

describe("illegal stage transitions", () => {
  it("rejects skipping a stage (reveal before answers are opened)", () => {
    const locked: QuestionProgress = { questionId: 2, stage: "answers_locked" };
    expect(() => transitionTo(locked, "answer_revealed")).toThrow(IllegalStageTransitionError);
    expect(canTransition("answers_locked", "answer_revealed")).toBe(false);
  });

  it("rejects settling before the answer is revealed", () => {
    const opened: QuestionProgress = { questionId: 2, stage: "answers_opened" };
    expect(() => transitionTo(opened, "settlement_computed")).toThrow(IllegalStageTransitionError);
    expect(canTransition("answers_opened", "settlement_computed")).toBe(false);
  });

  it("rejects backward and self transitions", () => {
    expect(() => transitionTo({ questionId: 4, stage: "answers_opened" }, "accepting")).toThrow(
      IllegalStageTransitionError,
    );
    expect(() => transitionTo({ questionId: 4, stage: "answers_opened" }, "answers_opened")).toThrow(
      IllegalStageTransitionError,
    );
  });

  it("refuses to advance past the terminal stage", () => {
    const settled: QuestionProgress = { questionId: 10, stage: "settlement_computed" };
    expect(() => advance(settled)).toThrow(IllegalStageTransitionError);
  });

  it("reports the offending stages on an illegal transition", () => {
    const attempt = () =>
      transitionTo({ questionId: 5, stage: "accepting" }, "answer_revealed");
    expect(attempt).toThrow(IllegalStageTransitionError);

    let captured: unknown;
    try {
      attempt();
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(IllegalStageTransitionError);
    expect((captured as IllegalStageTransitionError).from).toBe("accepting");
    expect((captured as IllegalStageTransitionError).to).toBe("answer_revealed");
  });
});

describe("disclosure predicate (bounds the auto-rescore range)", () => {
  it("is false until the answer is revealed and true from answer_revealed onward", () => {
    expect(isDisclosed("accepting")).toBe(false);
    expect(isDisclosed("answers_locked")).toBe(false);
    expect(isDisclosed("answers_opened")).toBe(false); // b 到達だが開示前（境界外）
    expect(isDisclosed("answer_revealed")).toBe(true); // c 到達（境界）
    expect(isDisclosed("settlement_computed")).toBe(true);
  });

  it("marks disclosure exactly at DISCLOSURE_STAGE, one step past answers_opened", () => {
    expect(DISCLOSURE_STAGE).toBe("answer_revealed");
    const beforeDisclosure = successorOf("answers_locked"); // answers_opened
    expect(beforeDisclosure).toBe("answers_opened");
    expect(isDisclosed(beforeDisclosure!)).toBe(false);
    expect(isDisclosed(DISCLOSURE_STAGE)).toBe(true);
  });

  it("isSettled is true only from settlement_computed (d reached)", () => {
    expect(isSettled("answers_opened")).toBe(false);
    expect(isSettled("answer_revealed")).toBe(false);
    expect(isSettled("settlement_computed")).toBe(true);
  });
});

describe("post-lock submit terminal guard", () => {
  // codd: covers vb=VB-18
  it("accepts submissions only while accepting and rejects them once the deadline lock is applied", () => {
    // 受付中は送信を受理する。
    const accepting = startQuestion(9);
    expect(acceptsSubmissions(accepting.stage)).toBe(true);

    // 司会者「そこまで」で締切 → 以降は送信を受理しない（終端状態ガード）。
    const locked = transitionTo(accepting, "answers_locked");
    expect(acceptsSubmissions(locked.stage)).toBe(false);

    // 締切より後のどの段階でも送信は受理されない。
    expect(acceptsSubmissions("answers_opened")).toBe(false);
    expect(acceptsSubmissions("answer_revealed")).toBe(false);
    expect(acceptsSubmissions("settlement_computed")).toBe(false);
  });

  it("only the accepting stage accepts submissions across the whole stage set", () => {
    const submittableStages: Stage[] = STAGES.filter((stage) => acceptsSubmissions(stage));
    expect(submittableStages).toEqual(["accepting"]);
  });
});

// VB reconciliation — the behaviors below are proven by other tasks' units and E2E
// specs. This progression unit owns only the stage model, the disclosure/settled
// predicates, and the post-lock submit terminal guard (VB-18, above); the remaining
// declared behaviors need modules/surfaces this pure model does not import, so they
// cannot be exercised here.
// codd: blocked vb=VB-01 reason=requires-browser-and-server
// codd: blocked vb=VB-02 reason=requires-ws-broadcast
// codd: blocked vb=VB-03 reason=requires-latency-harness
// codd: blocked vb=VB-04 reason=requires-running-server
// codd: blocked vb=VB-05 reason=requires-reconnect-harness
// codd: blocked vb=VB-60 reason=requires-reconnect-harness
// codd: blocked vb=VB-61 reason=requires-answers-repo
// codd: blocked vb=VB-62 reason=requires-fanout-projection
// codd: blocked vb=VB-06 reason=requires-control-panel-ui
// codd: blocked vb=VB-07 reason=requires-participants-repo
// codd: blocked vb=VB-08 reason=requires-join-fanout
// codd: blocked vb=VB-09 reason=requires-participants-ui
// codd: blocked vb=VB-56 reason=requires-access-control
// codd: blocked vb=VB-57 reason=requires-access-control
// codd: blocked vb=VB-58 reason=requires-auth-flow
// codd: blocked vb=VB-59 reason=requires-name-validation
// codd: blocked vb=VB-81 reason=requires-join-ui
// codd: blocked vb=VB-85 reason=requires-control-panel-ui
// codd: blocked vb=VB-82 reason=requires-join-ui
// codd: blocked vb=VB-10 reason=requires-ws-admission
// codd: blocked vb=VB-11 reason=requires-ws-admission
// codd: blocked vb=VB-12 reason=requires-config-module
// codd: blocked vb=VB-13 reason=requires-ws-admission
// codd: blocked vb=VB-14 reason=requires-ws-admission
// codd: blocked vb=VB-15 reason=requires-ws-admission
// codd: blocked vb=VB-16 reason=requires-answers-repo
// codd: blocked vb=VB-17 reason=requires-ws-broadcast
// codd: blocked vb=VB-19 reason=requires-fanout-projection
// codd: blocked vb=VB-20 reason=requires-tv-ui
// codd: blocked vb=VB-21 reason=requires-rounds-repo
// codd: blocked vb=VB-22 reason=requires-command-handlers
// codd: blocked vb=VB-23 reason=requires-host-guard
// codd: blocked vb=VB-24 reason=requires-non-host-ui
// codd: blocked vb=VB-25 reason=requires-undo-handler
// codd: blocked vb=VB-74 reason=requires-host-guard
// codd: blocked vb=VB-75 reason=requires-host-guard
// codd: blocked vb=VB-77 reason=requires-control-panel-ui
// codd: blocked vb=VB-78 reason=requires-control-panel-ui
// codd: blocked vb=VB-26 reason=requires-balances-repo
// codd: blocked vb=VB-27 reason=requires-scoring-module
// codd: blocked vb=VB-28 reason=requires-scoring-module
// codd: blocked vb=VB-29 reason=requires-scoring-module
// codd: blocked vb=VB-30 reason=requires-scoring-module
// codd: blocked vb=VB-31 reason=requires-winner-module
// codd: blocked vb=VB-32 reason=requires-answer-score-module
// codd: blocked vb=VB-33 reason=requires-tablet-ui
// codd: blocked vb=VB-34 reason=requires-validate-answer-module
// codd: blocked vb=VB-35 reason=requires-currency-module
// codd: blocked vb=VB-76 reason=requires-winner-module
// codd: blocked vb=VB-36 reason=requires-live-edit-handler
// codd: blocked vb=VB-37 reason=requires-rescore-coordinator
// codd: blocked vb=VB-38 reason=requires-rescore-coordinator
// codd: blocked vb=VB-39 reason=requires-rescore-coordinator
// codd: blocked vb=VB-40 reason=requires-tv-de-sync
// codd: blocked vb=VB-68 reason=requires-media-resolution
// codd: blocked vb=VB-69 reason=requires-rescore-coordinator
// codd: blocked vb=VB-70 reason=requires-scoring-module
// codd: blocked vb=VB-71 reason=requires-live-edit-handler
// codd: blocked vb=VB-72 reason=requires-host-guard
// codd: blocked vb=VB-41 reason=requires-tablet-ui
// codd: blocked vb=VB-42 reason=requires-tablet-ui
// codd: blocked vb=VB-43 reason=requires-tablet-ui
// codd: blocked vb=VB-44 reason=requires-tablet-ui
// codd: blocked vb=VB-45 reason=requires-tv-ui
// codd: blocked vb=VB-46 reason=requires-mode-switch-handler
// codd: blocked vb=VB-47 reason=requires-tv-ui
// codd: blocked vb=VB-48 reason=requires-tv-ui
// codd: blocked vb=VB-49 reason=requires-media-resolution
// codd: blocked vb=VB-50 reason=requires-tv-ui
// codd: blocked vb=VB-51 reason=requires-tv-ui
// codd: blocked vb=VB-55 reason=requires-tv-ui
// codd: blocked vb=VB-73 reason=requires-reveal-handler
// codd: blocked vb=VB-83 reason=requires-tv-ui
// codd: blocked vb=VB-84 reason=requires-tv-ui
// codd: blocked vb=VB-52 reason=requires-question-intake
// codd: blocked vb=VB-53 reason=requires-questions-repo
// codd: blocked vb=VB-54 reason=requires-media-resolution
// codd: blocked vb=VB-63 reason=requires-question-intake
// codd: blocked vb=VB-64 reason=requires-question-intake
// codd: blocked vb=VB-65 reason=requires-persistence-check
// codd: blocked vb=VB-66 reason=requires-question-intake
// codd: blocked vb=VB-67 reason=requires-host-guard
// codd: blocked vb=VB-79 reason=requires-surface-ui
// codd: blocked vb=VB-80 reason=requires-role-labels-module
