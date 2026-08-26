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
 * 共有 E2E ハーネス: サーフェス共通の可視コピー・アサーション
 * （surface_copy_obligations §2.11 / §2.4 d 6 列表 / §2.5 円建て固定 / §2.8 可視ラベル）。
 *
 * 全ブラウザスペックが import する正準の assertion 面。禁止コピー走査（forbidden-copy）を
 * 再エクスポートしつつ、円建て（`円` を含み `point`/`pt`/`点` を含まない）・d モードの 6 列
 * 見出し（氏名/解答/誤差/増減円/ピタリ賞/残額）・ロール可視ラベル（内部識別子 host/answerer/
 * audience 非露出）の各アサートを供給する。金額単位・可視ラベルは producer（`src/scoring/yen`・
 * `src/game_state/role_labels`）の宣言へ束縛し、二重定義のドリフトを排除する。
 */

import { CURRENCY } from "../../../src/scoring/yen.js";
import { ROLE_LABELS } from "../../../src/game_state/role_labels.js";
import type { Role } from "../../../src/game_state/role_labels.js";
import { scanForbiddenCopy } from "./forbidden-copy.js";

export {
  scanForbiddenCopy,
  assertNoForbiddenCopy,
  FORBIDDEN_COPY_CATEGORIES,
} from "./forbidden-copy.js";
export type {
  ForbiddenCopyCategory,
  ForbiddenCopyViolation,
  ScanOptions,
} from "./forbidden-copy.js";

/** 金額の可視単位（producer `src/scoring/yen.ts` の `CURRENCY` に束縛・常に「円」）。 */
export const CURRENCY_UNIT = CURRENCY;

/** d モード 6 列表の規定見出し（順序込み・VB-50 でピン留めされた表面形）。 */
export const SETTLEMENT_TABLE_HEADERS = ["氏名", "解答", "誤差", "増減円", "ピタリ賞", "残額"] as const;

/**
 * 金額表示が円建てであることを保証する。可視単位「円」を含み、点化文言 `point`/`pt`/`点` を
 * 含まないことを、対象文字列（金額セル等へスコープ済み）に対して検証する。
 */
export function assertYenDenominated(text: string): void {
  if (!text.includes(CURRENCY_UNIT)) {
    throw new Error(`金額表示に円建て単位「${CURRENCY_UNIT}」がありません: ${JSON.stringify(text)}`);
  }
  const pointized = scanForbiddenCopy(text, { categories: ["currency_token"] });
  if (pointized.length > 0) {
    throw new Error(
      `金額表示に点化文言(point/pt/点)が含まれています: ${pointized.map((v) => v.match).join(", ")}`,
    );
  }
}

/**
 * d モードの表見出しが規定の 6 列（氏名/解答/誤差/増減円/ピタリ賞/残額）と順序込みで一致する
 * ことを保証する。前後空白は許容して比較する。
 */
export function assertSettlementTableHeaders(headers: readonly string[]): void {
  const expected = SETTLEMENT_TABLE_HEADERS;
  const normalized = headers.map((h) => h.trim());
  const matches =
    normalized.length === expected.length && expected.every((h, i) => normalized[i] === h);
  if (!matches) {
    throw new Error(
      `d モードの 6 列見出しが規定(${expected.join("/")})と一致しません: ${JSON.stringify(normalized)}`,
    );
  }
}

/** 内部ロール識別子から供給される可視ラベル（司会者/解答者/観客）を返す。 */
export function visibleRoleLabel(role: Role): string {
  return ROLE_LABELS[role];
}

/** 与えた文字列が既知の可視ロールラベルのいずれかであるか。 */
export function isVisibleRoleLabel(label: string): boolean {
  return (Object.values(ROLE_LABELS) as string[]).includes(label);
}

/**
 * 可視文言に内部ロール識別子（host/answerer/audience）が露出していないことを保証する
 * （ロールは司会者/解答者/観客の可視ラベルでのみ表す・VB-80）。
 */
export function assertRoleLabelsBusinessFacing(text: string): void {
  const leaks = scanForbiddenCopy(text, { categories: ["internal_role_identifier"] });
  if (leaks.length > 0) {
    throw new Error(
      `可視文言に内部ロール識別子(host/answerer/audience)が露出しています: ${leaks
        .map((v) => v.match)
        .join(", ")}`,
    );
  }
}
