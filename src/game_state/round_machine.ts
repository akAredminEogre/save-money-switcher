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

import type { Stage } from "./progression.js";

/**
 * 問題別進行機械（Round Stage Machine, b/c/d）の遷移トポロジ（`module:game_flow`・
 * detailed_design:state-machines §2.2 / §4.2）。
 *
 * 各問（ラウンド）は
 *   accepting → answers_locked → answers_opened(b) → answer_revealed(c) → settlement_computed(d)
 * を司会者コマンド lock/open/reveal/settle で **1 段ずつ**前進する。本モジュールはその
 * **前進辺（{@link nextStage}）と逆辺候補（{@link previousStage}）の唯一の所有者**であり、
 * 遷移の合法性（どの段階からどのコマンドが発火できるか）を単一判定点として機械化する
 * （SM-1）。段階集合と再採点範囲の述語（`Stage` / `isDisclosed` / `isSettled`）は
 * `progression.ts` が単一所有し、本モジュールはそれを import して再宣言しない（§3.1）。
 *
 * 本モジュールは **純粋・副作用なし** である。接続確立時に確定した `role: host` の権限判定
 * （非 host コマンドの command_denied 403 / 未認証 401）と、遷移に伴う durable な副作用
 * （`rounds.stage` の永続化・締切配信・採点・取消の巻き戻し）は呼出し側
 * （`src/realtime_sync/`・`src/control_panel/`・`src/scoring/`）が所有する。取消
 * （{@link previousStage}）が返すのは巻き戻し先の **topology のみ** であり、
 * `settlements` / `balances` の差分巻き戻し範囲は F-03 未確定ゆえここでは発明しない
 * （§2.2・§5.2）。
 */

/**
 * 段階を 1 段前進させる司会者コマンド（`role: host` のみが発火可・SM-1）。
 * - `lock`   「そこまで」    : accepting → answers_locked
 * - `open`   「解答オープン！」: answers_locked → answers_opened（b）
 * - `reveal` 「正解発表」     : answers_opened → answer_revealed（c）
 * - `settle` 「精算」         : answer_revealed → settlement_computed（d）
 */
export type RoundCommand = "lock" | "open" | "reveal" | "settle";

/**
 * 各段階の唯一の合法な前進先。終端（settlement_computed）は前進先を持たない（null）。
 */
const FORWARD: Readonly<Record<Stage, Stage | null>> = {
  accepting: "answers_locked",
  answers_locked: "answers_opened",
  answers_opened: "answer_revealed",
  answer_revealed: "settlement_computed",
  settlement_computed: null,
};

/**
 * 各コマンドを発火できる **唯一の from 段階**。不正遷移拒否の根拠であり、これ以外の段階から
 * 当該コマンドを送ると {@link nextStage} が {@link RangeError} を送出する。
 */
const COMMAND_FROM: Readonly<Record<RoundCommand, Stage>> = {
  lock: "accepting",
  open: "answers_locked",
  reveal: "answers_opened",
  settle: "answer_revealed",
};

/**
 * `current` 段階に `command` を適用した前進先段階を返す（純関数・SM-1）。
 *
 * `command` の唯一の from 段階（{@link COMMAND_FROM}）が `current` と一致しないときは
 * **不正遷移**として {@link RangeError} を送出する。例: `answers_opened` 未到達での
 * `reveal`（開示を飛ばした正解発表）、`accepting` からの `settle`（正解発表を飛ばした精算）
 * はいずれも拒否される。終端（settlement_computed）はどのコマンドの from 段階でもないため、
 * 常に発火前の一致検査で拒否される（前進先 null への到達は起こらない）。
 *
 * @throws {RangeError} `command` を `current` から発火できない不正遷移のとき。
 */
export function nextStage(current: Stage, command: RoundCommand): Stage {
  if (COMMAND_FROM[command] !== current) {
    throw new RangeError(
      `不正遷移: 段階 ${current} で ${command} は実行できません（${command} は ${COMMAND_FROM[command]} からのみ発火可）。`,
    );
  }
  const to = FORWARD[current];
  if (to === null) {
    throw new RangeError(`終端段階 ${current} から前進はできません。`);
  }
  return to;
}

/**
 * 各段階の 1 段手前（前進辺に対する逆辺）。受付中（accepting）は巻き戻し先を持たない。
 */
const BACKWARD: Readonly<Record<Stage, Stage | null>> = {
  accepting: null,
  answers_locked: "accepting",
  answers_opened: "answers_locked",
  answer_revealed: "answers_opened",
  settlement_computed: "answer_revealed",
};

/**
 * `current` の 1 段手前（取消の巻き戻し先候補）を返す純関数。初期段階（accepting）は `null`。
 *
 * これは取消（undo）の **巻き戻し先 topology のみ** を与える。取消を確定させるか、その際に
 * `settlements` / `balances` をどこまで巻き戻すか（durable な副作用）は F-03 未確定であり、
 * 本モジュールは判断・発明しない（§2.2・§5.2）。
 */
export function previousStage(current: Stage): Stage | null {
  return BACKWARD[current];
}
