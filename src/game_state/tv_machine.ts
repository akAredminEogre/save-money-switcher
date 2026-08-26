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

import type { TvMode } from "./tv_mode.js";

/**
 * TV モード機械のナビゲーション関数（TV Mode Machine・`module:game_flow`・
 * detailed_design:state-machines §2.4 / §3.1 / §4.2・SM-1）。
 *
 * TV（観客面 `/tv`）の表示モード `a → b → c → d → e` を、司会者の 3 系統操作
 * （「次へ」＝{@link nextMode} ／「戻る」＝{@link backMode} ／「個別ジャンプ」＝
 * {@link jumpMode}）で往来させる **純粋・副作用なし** の表示ナビゲーション関数群であり、
 * その **単一所有者** である（§3.1）。TvMode の値集合と段階→既定モード写像
 * （`stageToTvMode`）は `tv_mode.ts` が単一所有するため、本モジュールは {@link TvMode} を
 * そこから import して再宣言しない（§3.1・§4.2）。
 *
 * これらは **表示ナビゲーション** であり、問題別進行機械（Round Stage Machine・
 * `round_machine.ts` の `rounds.stage`）とは **独立に自由往来** する。モード切替は
 * `game_state.tv_mode` のみを動かし、`rounds.stage` を前進も巻き戻しもしない（§2.4）。
 * ゆえに e（全問通算一覧）や過去モードへ「戻る／個別ジャンプ」で到達しても進行段階は
 * 不変である。
 *
 * 本モジュールが所有するのは純粋な遷移計算のみである。3 系統いずれの発火も
 * `role: host` セッションに限る権限判定（非 host は `command_denied(403)`）と、切替結果を
 * 接続中の全 TV へ届ける `tv_mode_changed` 配信は呼出し側（`src/control_panel/`・
 * `src/realtime_sync/`）が所有する（SM-1・§4.2）。関数は外部 I/O・可変状態を持たず、
 * 同一入力には常に同一の {@link TvMode} を返す。`tv_mode.ts` 以外へは依存せずリーフに
 * 保つ。
 */

/**
 * TV モードの往来順序（a→b→c→d→e）を与える唯一の順序定義。「次へ／戻る」はこの並びを
 * 前後へ 1 つ移動した結果（末尾↔先頭で環状に折り返す）として導出し、両方向の対応表を
 * 二重定義しない。{@link TvMode} の全 5 値をこの順序で 1 度ずつ列挙する。
 */
const MODE_ORDER: readonly TvMode[] = ["a", "b", "c", "d", "e"];

/**
 * `current` を順序 {@link MODE_ORDER} 上で `offset` だけ環状に移動したモードを返す。
 * `offset` が正なら「次へ」方向、負なら「戻る」方向。剰余で先頭↔末尾を環状に折り返す
 * ため、正規化後の位置は常に 0 以上 {@link MODE_ORDER}.length 未満に収まる。
 */
function shiftMode(current: TvMode, offset: number): TvMode {
  const size = MODE_ORDER.length;
  const currentIndex = MODE_ORDER.indexOf(current);
  const wrappedIndex = (((currentIndex + offset) % size) + size) % size;
  const mode = MODE_ORDER[wrappedIndex];
  if (mode === undefined) {
    // 到達不能: wrappedIndex は環状正規化により常に 0 以上 size 未満。順序定義の破損を検出する防御。
    throw new RangeError(`TV モードの順序位置 ${wrappedIndex} が範囲外です。`);
  }
  return mode;
}

/**
 * 「次へ」: TV モードを 1 つ順送りする（a→b→c→d→e、e の次は環状に折り返して a）。
 *
 * e（全問通算一覧）の次は次問の a（出題面）へ戻る（§2.4 / §4.2）。表示ナビゲーションで
 * あり `rounds.stage` を前進も巻き戻しもしない純関数。
 */
export function nextMode(current: TvMode): TvMode {
  return shiftMode(current, 1);
}

/**
 * 「戻る」: TV モードを 1 つ逆送りする（e→d→c→b→a、a の前は環状に折り返して e）。
 *
 * {@link nextMode} の逆順であり、a から戻ると e（全問通算一覧）へ折り返す（§2.4 / §4.2）。
 * 表示ナビゲーションであり `rounds.stage` を巻き戻さない純関数。
 */
export function backMode(current: TvMode): TvMode {
  return shiftMode(current, -1);
}

/**
 * 「個別ジャンプ」: a〜e の任意モードへ順序を辿らず直接遷移する（§2.4 / §4.2）。
 *
 * 現在モードに依らず全ペアが許容されるため、目標モードをそのまま返す恒等写像。表示
 * ナビゲーションであり `rounds.stage` に影響しない純関数。
 */
export function jumpMode(target: TvMode): TvMode {
  return target;
}
