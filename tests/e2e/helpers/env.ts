// @generated-by: codd implement
// @generated-from: docs/design/surface_copy_obligations.md (design:surface-copy-obligations)
// @design-node: docs/design/surface_copy_obligations.md
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

/**
 * 共有 E2E ハーネス: 検証環境値（`E2E_BASE_URL` / `PUBLIC_BASE_URL` /
 * `MAX_TABLET_CONNECTIONS` / 家族限定アクセス制御）の注入と復元
 * （surface_copy_obligations §2.10 / acceptance_criteria §4.9 / participation_connection §2.9）。
 *
 * 上限・公開 URL・アクセス制御の設定キー名は各サーフェス実装が解決に用いる単一の環境変数名を
 * そのまま束縛する（`../../../src/config/*` の producer 定義から import し、二重定義による
 * 綴りのドリフトを排除する）。`E2E_BASE_URL` は検証専用の接続先で、ソース定数ではないため
 * ここで名称を確定する。注入は原状復帰関数を返し、スペック間で環境を汚さない。
 */

import { MAX_TABLET_CONNECTIONS_ENV } from "../../../src/config/connection_limit.js";
import { PUBLIC_BASE_URL_ENV } from "../../../src/config/public_base_url.js";
import {
  JOIN_ACCESS_MODE_ENV,
  JOIN_ACCESS_TOKEN_ENV,
} from "../../../src/config/access_control_config.js";

/** 検証環境のベース URL（WS 昇格可能オリジン）を注入する環境変数名。 */
export const E2E_BASE_URL_ENV = "E2E_BASE_URL";

/** `E2E_BASE_URL` 未設定時のフォールバック接続先。 */
export const DEFAULT_E2E_BASE_URL = "http://localhost:3000";

/** 読み書き可能な環境変数マップ（`process.env` と差替え可能なテスト用フェイクの双方）。 */
export type MutableEnv = Record<string, string | undefined>;

/** ブラウザ／API スペックが接続するベース URL を解決する（既定は localhost:3000）。 */
export function resolveBaseUrl(env: MutableEnv = process.env): string {
  const raw = env[E2E_BASE_URL_ENV];
  return raw !== undefined && raw.trim() !== "" ? raw : DEFAULT_E2E_BASE_URL;
}

/** 注入する検証環境値。未指定のキーは環境へ書き込まない。 */
export interface VerificationEnvValues {
  /** クラウド公開のベース URL（`E2E_BASE_URL`）。 */
  baseUrl?: string;
  /** QR/参加リンク組立の基底となる公開 URL（`PUBLIC_BASE_URL`）。 */
  publicBaseUrl?: string;
  /** 同時接続タブレット上限（`MAX_TABLET_CONNECTIONS`）。数値でも文字列でも受ける。 */
  maxTabletConnections?: number | string;
  /** 家族限定アクセス制御方式（`JOIN_ACCESS_MODE`）。 */
  joinAccessMode?: string;
  /** 分岐 A の秘匿トークン（`JOIN_ACCESS_TOKEN`）。 */
  joinAccessToken?: string;
}

/**
 * 検証環境値を注入し、原状復帰関数を返す。指定されたキーのみを上書きし、注入前の値
 * （存在しなかったキーは不在）へ確実に戻せる。設定注入で受入可否・アクセス分岐が変わる
 * ケースの検証で用いる。
 */
export function applyVerificationEnv(
  values: VerificationEnvValues,
  env: MutableEnv = process.env,
): () => void {
  const assignments: [string, string][] = [];
  if (values.baseUrl !== undefined) assignments.push([E2E_BASE_URL_ENV, values.baseUrl]);
  if (values.publicBaseUrl !== undefined) assignments.push([PUBLIC_BASE_URL_ENV, values.publicBaseUrl]);
  if (values.maxTabletConnections !== undefined) {
    assignments.push([MAX_TABLET_CONNECTIONS_ENV, String(values.maxTabletConnections)]);
  }
  if (values.joinAccessMode !== undefined) assignments.push([JOIN_ACCESS_MODE_ENV, values.joinAccessMode]);
  if (values.joinAccessToken !== undefined) assignments.push([JOIN_ACCESS_TOKEN_ENV, values.joinAccessToken]);

  const restorers = assignments.map(([key, value]) => {
    const had = Object.prototype.hasOwnProperty.call(env, key);
    const prior = env[key];
    env[key] = value;
    return (): void => {
      if (had) env[key] = prior;
      else delete env[key];
    };
  });

  return (): void => {
    for (let i = restorers.length - 1; i >= 0; i--) restorers[i]();
  };
}
