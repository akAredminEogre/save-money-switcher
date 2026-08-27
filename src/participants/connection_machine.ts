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

import { resolveMaxTabletConnections } from "../config/connection_limit.js";

/**
 * 接続ライフサイクル機械（Connection Lifecycle Machine・`module:participants`・
 * detailed_design:state-machines §2.5 / §3.3 / §4.4・SM-3）。
 *
 * タブレット（解答者）接続のライフサイクル状態集合（{@link ConnectionState}）と、
 * 同時接続上限（設定値）到達時に新規接続を拒否する受入判定（{@link admitTablet}）の
 * 単一所有者である（SM-3・リリースブロッキング不変条件3）。上限値そのものは
 * `module:config`（`src/config/connection_limit.ts` の
 * {@link resolveMaxTabletConnections}）が単一解決点として所有し、本モジュールはその
 * 解決値だけを参照して受入可否を決める。判定コードに数値リテラル 8 を置かず、既定 8 は
 * config 側の単一定数でのみ宣言される（dod_limit_no_hardcode）。`MAX_TABLET_CONNECTIONS`
 * を 16／32 へ設定変更するとコード改修なしに追随する（dod_limit_config_follows）。
 *
 * 本モジュールが所有するのは純粋・副作用なしの受入「決定」のみである。over_limit を
 * 受けた `connection_rejected` ＋ WS close(4001) の通知、既存接続・participants・
 * answers・balances の不変性、切断時のスロット解放は `module:realtime_sync`
 * （`src/realtime_sync/`）が担う（§2.5・§3.3 の責務境界）。上限は answerer 接続のみに
 * 課し、host/audience はタブレット上限に数えない別チャネルとして扱う。
 *
 * 上限解決点への参照は `connection_limit.ts` の {@link resolveMaxTabletConnections} を
 * `.js` 指定子で import し、env（環境変数ソース）を設定ソースとして渡す
 * （`resolveMaxTabletConnections({ env })`）。既定 8 の定義とリテラルは config 側にのみ
 * 存在するため、本判定コードには数値リテラル 8 が現れない。
 */

/**
 * タブレット接続のライフサイクル状態（接続レジストリの状態集合・§2.5）。
 *
 * `rounds.stage`（問題進行）や `balances`（残額）とは独立に、1 接続のライフサイクルを
 * 表す:
 * - `handshaking`: 端末が公開 URL をブラウザで開き WS 接続してロールを申告した直後。
 * - `admitted`: {@link admitTablet} が `ok` を返し受入が確定した（参加確定の直前）。
 * - `connected`: 参加確定（participants 生成＋balances 初期化）後、live 配信へ合流した状態。
 * - `disconnected`: heartbeat 失敗で切断が確定しスロットが解放された状態（resume 待ち）。
 * - `rejected`: 上限到達で受入が拒否された終端状態（connection_rejected＋WS close(4001)）。
 */
export type ConnectionState =
  | "handshaking"
  | "admitted"
  | "connected"
  | "disconnected"
  | "rejected";

/**
 * タブレット受入判定の結果。`kind` を判別タグとする判別可能ユニオン。
 *
 * - `{ kind: "ok" }`: 現在の answerer 接続数が解決上限「未満」で受入可（`handshaking → admitted`）。
 * - `{ kind: "over_limit" }`: 解決上限「以上」で受入不可（`handshaking → rejected`）。
 */
export type AdmitResult =
  | { readonly kind: "ok" }
  | { readonly kind: "over_limit" };

/**
 * 新規タブレット（解答者）接続の受入可否を判定する純関数（SM-3・§4.4）。
 *
 * 現在の answerer 接続数 `connectedAnswerers` が {@link resolveMaxTabletConnections} の
 * 解決した上限「未満」なら `{ kind: "ok" }`、「以上」なら `{ kind: "over_limit" }` を返す。
 * 境界は 既定 8: 7→ok・8→over_limit（8 台目許可・9 台目拒否）／設定 16: 15→ok・
 * 16→over_limit／設定 32: 31→ok・32→over_limit。切断でスロットが解放されれば同数まで
 * 再受入可となる（接続数会計は呼出し側の `connectedAnswerers` に反映される）。
 *
 * 判定は解決値のみを参照して比較し、数値リテラル 8 を持たない（dod_limit_no_hardcode）。
 * 既定 8 は config 側の単一定数にのみ存在するため、`MAX_TABLET_CONNECTIONS` を 16／32 へ
 * 設定変更すると本判定はコード改修なしで追随する（dod_limit_config_follows）。外部 I/O・
 * 可変状態を持たず、同一入力には常に同一結果を返す。over_limit 時の通知
 * （connection_rejected／WS close(4001)）と既存データ（participants/answers/balances/
 * 進行状態）の不変性は呼出し側（`src/realtime_sync/`）が担う。
 *
 * @param connectedAnswerers 現在受け入れ済みの answerer（タブレット）接続数。
 * @param env 上限解決に用いる環境変数ソース（既定は実行環境の `process.env`）。
 */
export function admitTablet(
  connectedAnswerers: number,
  env: NodeJS.ProcessEnv = process.env,
): AdmitResult {
  const max = resolveMaxTabletConnections({ env });
  return connectedAnswerers < max ? { kind: "ok" } : { kind: "over_limit" };
}
