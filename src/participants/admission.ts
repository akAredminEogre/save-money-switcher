// @generated-by: codd implement
// @generated-from: docs/design/participation_connection_design.md (design:participation-connection-design)
// @design-node: docs/design/participation_connection_design.md
// @output-paths: src, tests
// @generated-from: docs/design/realtime_sync_design.md (design:realtime-sync-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

/**
 * タブレット受付判定 — 氏名検証と同時接続上限の純関数ゲート（`module:participants`・PC-INV-2）。
 *
 * participation_connection_design §2.5 / OBM `op_enforce_connection_limit` が確定した
 * release-blocking 制約を具体化する。`admitTablet({ limit, connected }, { name })` は自己入力氏名の
 * 妥当性と、「現在の解答者接続数 `connected`」対「呼び出し側が注入した実効上限 `limit`」の比較だけから
 * 受入可否を返す純関数である。
 *
 * 契約（判定順は氏名 → 上限）:
 *   - 氏名が無効（空・空白のみ・上限長超過） → `{ ok: false, reason: "invalid_name" }`
 *   - `connected >= limit`（上限到達） → `{ ok: false, reason: "over_limit" }`
 *   - いずれも満たさない → `{ ok: true }`
 *
 * 上限判定は **注入された `limit`（＝設定解決値）だけ** を参照し、数値リテラルの既定値（8 等）を一切
 * 持たない。上限の単一解決点は `src/config/connection_limit.ts`（`resolveMaxTabletConnections()`）で
 * あり、本モジュールはその resolver を import しない（サーバ層が接続受理のたびに解決した実効上限を
 * `limit` として渡す）。ゆえに `MAX_TABLET_CONNECTIONS` を 8→16→32 と設定変更すると受入可否が
 * コード改修なしに追随する（dod_limit_no_hardcode / dod_limit_config_follows）。
 *
 * 氏名検証は UI とサーバで共有する単一バリデータ {@link isValidDisplayName}
 * （`src/participants/name.ts`）を参照し、サーバ側最終防衛として不正氏名を受け付けない
 * （dod_join_name_validation）。
 *
 * 本関数は入力から結果を導くだけの副作用の無い決定であり、DB・既存接続・
 * `participants` / `answers` / `balances` を一切変更しない。上限超過拒否時に保持データが不変で
 * あること（dod_limit_existing_unaffected）は、この副作用の無さに拠る。上限超過の決定を
 * `connection_rejected` ＋ WS `close(4001)` として端末へ伝える通知機構は `src/realtime_sync/` の
 * 消費者側責務であり、本モジュールは受入可否の純粋な判定に閉じる。
 */

import { isValidDisplayName } from "./name.js";

/**
 * 受入判定に用いる接続会計。上限判定はこの 2 値のみに依存する。
 */
export interface AdmissionInput {
  /**
   * 実効上限。`src/config/connection_limit.ts` の `resolveMaxTabletConnections()` が解決した値を
   * 呼び出し側が注入する。本ゲートはこの値だけを参照し、既定値リテラルを持たない。
   */
  readonly limit: number;
  /** この新規参加を数える前に既に確立している解答者タブレット接続数。 */
  readonly connected: number;
}

/** 新規タブレットの参加要求（自己入力氏名）。 */
export interface JoinRequest {
  /** 参加者が自己入力した氏名。妥当性は {@link isValidDisplayName} で検証する。 */
  readonly name: string;
}

/**
 * 受入判定の結果。`ok` が可否を表し、不可のとき `reason` が理由（判別子）を示す。
 * 受入成立時は `reason` を持たない。
 */
export interface AdmissionResult {
  /** 受入が成立するなら `true`、拒否するなら `false`。 */
  readonly ok: boolean;
  /** 拒否理由（氏名不正 or 上限到達）。受入成立時は付与しない。 */
  readonly reason?: "over_limit" | "invalid_name";
}

/**
 * 新規タブレット接続を受け付けるか判定する純関数。
 *
 * 判定順は「氏名 → 上限」。まず自己入力氏名を {@link isValidDisplayName} で検証し、無効なら
 * `{ ok: false, reason: "invalid_name" }` を返す。氏名が有効でも現接続数が注入された実効上限に
 * 達していれば `{ ok: false, reason: "over_limit" }` を返す。いずれも満たさなければ `{ ok: true }` を
 * 返す。入力を一切変更せず、`limit`・`connected`・`name` から結果を導くだけの副作用の無い決定である。
 *
 * @param state 実効上限（設定解決値）と現接続数。
 * @param req 参加要求（自己入力氏名）。
 * @returns 受入可否の判別結果。
 */
export function admitTablet(state: AdmissionInput, req: JoinRequest): AdmissionResult {
  if (!isValidDisplayName(req.name)) {
    return { ok: false, reason: "invalid_name" };
  }
  if (state.connected >= state.limit) {
    return { ok: false, reason: "over_limit" };
  }
  return { ok: true };
}
