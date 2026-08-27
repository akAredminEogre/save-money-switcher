// @generated-by: codd implement
// @generated-from: docs/design/participation_connection_design.md (design:participation-connection-design)
// @design-node: docs/design/participation_connection_design.md
// @output-paths: src, tests
// @generated-from: docs/design/realtime_sync_design.md (design:realtime-sync-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { describe, it, expect } from "vitest";
import {
  isValidDisplayName,
  MAX_DISPLAY_NAME_LENGTH,
} from "../../src/participants/name.js";

describe("participants/name 自己入力氏名の検証（UI とサーバが共有する単一バリデータ）", () => {
  it("表示長上限を 20 コードポイントとして公開する（設計選択値）", () => {
    // 期待値 20 は system 出力とは独立に記述し、公開定数と突き合わせる。
    expect(MAX_DISPLAY_NAME_LENGTH).toBe(20);
  });

  // codd: covers vb=VB-59
  it("空・空白のみ・上限長超過の氏名を拒否する", () => {
    // 空文字。
    expect(isValidDisplayName("")).toBe(false);
    // 空白のみ（半角スペース／全角スペース／タブ・改行）はいずれも trim 後に空となり拒否。
    expect(isValidDisplayName("   ")).toBe(false);
    expect(isValidDisplayName("　　")).toBe(false);
    expect(isValidDisplayName("\t\n")).toBe(false);
    // 上限長超過（境界の直上＝ MAX+1 コードポイント）は拒否。
    expect(isValidDisplayName("あ".repeat(MAX_DISPLAY_NAME_LENGTH + 1))).toBe(false);
  });

  it("非空かつ上限以下の氏名を受理する（上限ちょうども受理）", () => {
    expect(isValidDisplayName("太郎")).toBe(true);
    // 内部の空白は氏名の一部として保持され、非空とみなされる。
    expect(isValidDisplayName("山田 太郎")).toBe(true);
    // 境界ちょうど＝ MAX コードポイントは受理（不連続点の下側）。
    expect(isValidDisplayName("あ".repeat(MAX_DISPLAY_NAME_LENGTH))).toBe(true);
  });

  it("長さをコードポイント単位で数える（サロゲートペアを 1 文字として扱う）", () => {
    // 各絵文字は UTF-16 では 2 単位・コードポイントでは 1。
    const atLimit = "😀".repeat(MAX_DISPLAY_NAME_LENGTH);
    const overLimit = "😀".repeat(MAX_DISPLAY_NAME_LENGTH + 1);
    // UTF-16 単位（.length）で数えると上限超過に見えるが、コードポイント長では上限ちょうど。
    expect(atLimit.length).toBe(MAX_DISPLAY_NAME_LENGTH * 2);
    expect(isValidDisplayName(atLimit)).toBe(true);
    expect(isValidDisplayName(overLimit)).toBe(false);
  });

  it("前後の空白を数える前に除去する", () => {
    // 前後空白を除いた実体が非空・上限以下なら受理。
    expect(isValidDisplayName("  太郎  ")).toBe(true);
    // 前後空白を除くと上限ちょうど → 受理。
    expect(isValidDisplayName(`  ${"あ".repeat(MAX_DISPLAY_NAME_LENGTH)}  `)).toBe(true);
    // 前後空白を除いても上限超過 → 拒否。
    expect(isValidDisplayName(`  ${"あ".repeat(MAX_DISPLAY_NAME_LENGTH + 1)}  `)).toBe(false);
  });
});
