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

import { isDisclosed, isSettled, type Stage } from "./progression.js";

/**
 * 自動再採点の起動分界（`module:game_flow`・detailed_design:state-machines §2.3 / §4.3・SM-2）。
 *
 * 司会者の正解ライブ編集（op_live_edit_correct）を受けたとき、その編集が採点エンジンの
 * 自動再採点（op_auto_rescore）を **誘発するか否か** だけを決める起動可否の単一判定点である。
 * 本モジュールが所有するのは「どの進行段階で・どの編集内容なら再採点が走るか」という
 * トリガー判定のみで、当該問の全 settlements 再計算・balances 差分更新という **実計算は
 * `module:scoring`（`src/scoring/rescore_question.ts`）が所有** し、TV d/e への同時更新配信は
 * `module:realtime_sync` が所有する（§2.3 の分界）。呼出し側は本判定が真のときにのみ下位層の
 * 再計算を起動する規約とし、下位層を直接叩いて本ゲートを迂回してはならない。
 *
 * 再採点範囲を仕切る述語 {@link isDisclosed}（c 以降か）/ {@link isSettled}（d 到達か）と
 * 段階集合 {@link Stage} は `progression.ts` が単一所有し、本モジュールはそれを import して
 * 再宣言しない（§3.1）。判定は外部 I/O・可変状態を持たない純関数であり、同一入力には常に
 * 同一の {@link RescorePlan} を返す。`progression.ts` 以外へは依存せずリーフに保つ。
 */

/**
 * 進行中の正解ライブ編集（op_live_edit_correct）が更新しうるフィールドの差分。
 * 制御盤のインライン編集で触れた項目だけを任意項目として持つ。
 *
 * 再採点の誘発判定で意味を持つのは {@link correctValue} を **含むか否か** のみである
 * （§4.3 の 2 条件論理積の第 1 条件）。`text` / `imagePath` / `videoPath` だけの編集は
 * correct_value 不変ゆえ再採点を誘発しない。正解値の数値レンジ（0〜100 整数）の検証は本判定の
 * 責務ではなく、サーバ側最終検証（`src/scoring/validate_answer.ts`）と DB CHECK が担う。ここでは
 * `correctValue` の **存在** のみを見るため型は素の `number` とする。
 */
export interface LiveEditPatch {
  /** 問題文の編集後値（更新しないときは省略）。 */
  readonly text?: string;
  /** 画像パスの編集後値（NULL 化を含む。更新しないときは省略）。 */
  readonly imagePath?: string | null;
  /** 動画パスの編集後値（NULL 化を含む。更新しないときは省略）。 */
  readonly videoPath?: string | null;
  /** 正解値の編集後値（0〜100 整数）。存在すると再採点の第 1 条件を満たす。更新しないときは省略。 */
  readonly correctValue?: number;
}

/**
 * 再採点の起動計画。`rescore` を判別タグとする判別可能ユニオン。
 *
 * - `{ rescore: false }`: 再採点は走らない（settlements / balances は不変）。
 * - `{ rescore: true; syncTvDE }`: 当該問の再採点を起動する。`syncTvDE` が真のとき
 *   （＝当該問が精算済み d 到達）は残額差分再計算に伴い TV の d（当該問精算表）と
 *   e（全員通算）を同時更新する。偽のとき（c 到達・d 未到達）は settlements の更新のみで、
 *   残額差分は d 未到達ゆえ生じない。
 */
export type RescorePlan =
  | { readonly rescore: false }
  | { readonly rescore: true; readonly syncTvDE: boolean };

/**
 * 正解ライブ編集が自動再採点を誘発するかを判定する（純関数・SM-2 / §2.3 / §4.3）。
 *
 * **再採点が走る ⇔（patch が correctValue を含む）∧（isDisclosed(stage) 真＝正解発表 c 以降）**。
 * どちらか一方でも満たさなければ `{ rescore: false }` を返す（境界外）。
 *
 * - c 未到達（`accepting` / `answers_locked` / `answers_opened`）での correct_value 編集
 *   → `isDisclosed` 偽ゆえ `{ rescore: false }`（balances 不変・`dod_rescore_no_before_c`）。
 * - `text` / `imagePath` / `videoPath` のみの編集（correctValue 省略）
 *   → `{ rescore: false }`（a モード解決のみ変化・balances 不変・`dod_rescore_only_on_correct_value`）。
 * - c 到達（`answer_revealed`）で correct_value を編集
 *   → `{ rescore: true, syncTvDE: false }`（settlements 更新のみ・残額差分は d 未到達ゆえ無し）。
 * - d 到達（`settlement_computed`）で correct_value を編集
 *   → `{ rescore: true, syncTvDE: true }`（残額差分再計算＋TV d/e 同時更新・`dod_rescore_d_sync`）。
 *
 * 真を返した場合にのみ、呼出し側は `module:scoring` の `rescoreQuestion`（当該問の全 settlements
 * 再計算・balances 差分更新）を起動し、`syncTvDE` が真なら TV d/e を同時更新する。差分更新後の
 * balances は answers ＋編集後 correct_value からの全再計算と一致する（監査不変式
 * `dod_rescore_matches_full_recompute`。一致の保証は `module:scoring` の責務）。
 */
export function planRescore(stage: Stage, patch: LiveEditPatch): RescorePlan {
  const touchesCorrectValue = patch.correctValue !== undefined;
  if (!touchesCorrectValue || !isDisclosed(stage)) {
    return { rescore: false };
  }
  return { rescore: true, syncTvDE: isSettled(stage) };
}
