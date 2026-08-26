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
 * 共有 E2E ハーネス: 禁止コピー走査器（surface_copy_obligations §2.10・§2.11 / §3.1）。
 *
 * 全ブラウザスペックが（正準 assertion 面 {@link ./assertions.ts} 経由で）import する、
 * 面ごとの可視コピー（Playwright の innerText）を対象にした禁止コピー走査の単一実装点。
 * §3.1「禁止コピー走査の実装方式」が定める通り、ブラウザ描画テキストを面ごとに正規表現で
 * 走査し、宣言・検証は Vitest が担う。走査対象は §2.8 の禁止コピーパターン（内部ロール識別子・
 * 内部イベント名・設定キー名・生ファイルパス/内部語・デモ/テスト/サンプル表記・point/pt/点）で、
 * 呼び出し側が {@link ScanOptions.categories} で対象カテゴリを限定できる。
 *
 * 本モジュールは純粋な正規表現走査のみを供給し、他モジュールへ依存しない（import を持たない
 * リーフ）。走査は呼び出し毎に新しい `RegExp` を生成して `lastIndex` の状態汚染を避け、同一
 * テキストへの繰り返し走査でも決定的な結果を返す。
 */

/**
 * 禁止コピーのカテゴリ集合（走査対象の内部語グループの単一定義）。
 *
 * {@link scanForbiddenCopy} に対象カテゴリ未指定で呼び出すと、この全カテゴリを走査する。
 */
export const FORBIDDEN_COPY_CATEGORIES = [
  "currency_token",
  "internal_role_identifier",
  "internal_event_name",
  "config_key",
  "internal_word_or_path",
  "demo_test_label",
] as const;

/** 禁止コピーのカテゴリ（{@link FORBIDDEN_COPY_CATEGORIES} の要素）。 */
export type ForbiddenCopyCategory = (typeof FORBIDDEN_COPY_CATEGORIES)[number];

/**
 * カテゴリごとの禁止トークン走査パターン。全パターンは `g` フラグを備え、
 * {@link scanForbiddenCopy} は各走査でこれを複製して独立した `lastIndex` を用いる。
 */
const FORBIDDEN_COPY_PATTERNS: Readonly<Record<ForbiddenCopyCategory, RegExp>> = {
  // point/pt/点 の点化文言（円建て固定・現金感を薄めない・§2.5）。
  currency_token: /point|pt|点/gi,
  // 内部ロール識別子（司会者/解答者/観客の可視ラベルでのみ表す・§2.8）。
  internal_role_identifier: /host|answerer|audience/gi,
  // 内部イベント名（状態表示は運用語で表す・§1.3）。
  internal_event_name:
    /accepting|answers_locked|answers_opened|answer_revealed|settlement_computed|tv_mode_changed/gi,
  // 設定キー名（接続数会計・アクセス制御方式の内部名を出さない・§2.8）。
  config_key: /MAX_TABLET_CONNECTIONS|JOIN_ACCESS_TOKEN|JOIN_ACCESS_MODE|PUBLIC_BASE_URL|QUESTION_MEDIA_ROOT/g,
  // 生ファイルパス・内部語（`fallback`/`video_path`/`image_path` 等の TV a モード非露出・§2.4a・§2.8⑦）。
  internal_word_or_path: /fallback|video_path|image_path/gi,
  // デモ/テスト/サンプル表記（本番用可視コピーのみ・§2.8）。
  demo_test_label: /デモ|テスト|サンプル/g,
};

/** 走査で検出した 1 件の禁止コピー違反。 */
export interface ForbiddenCopyViolation {
  /** 違反が属するカテゴリ。 */
  readonly category: ForbiddenCopyCategory;
  /** 一致した禁止トークンの実文字列。 */
  readonly match: string;
  /** 一致開始位置（対象文字列内のインデックス）。 */
  readonly index: number;
}

/** 走査オプション（対象カテゴリの限定など）。 */
export interface ScanOptions {
  /** 走査するカテゴリ（未指定なら {@link FORBIDDEN_COPY_CATEGORIES} 全件）。 */
  readonly categories?: readonly ForbiddenCopyCategory[];
}

/**
 * 与えたテキストから禁止コピーの一致を全件抽出する。
 *
 * `options.categories` を指定すると当該カテゴリのみを、未指定なら全カテゴリを走査する。
 * 走査は面の可視コピー（Playwright の innerText）を対象に呼ばれることを想定し、
 * 検出結果（カテゴリ・一致文字列・位置）の配列を返す。違反が無ければ空配列を返す。
 */
export function scanForbiddenCopy(
  text: string,
  options: ScanOptions = {},
): ForbiddenCopyViolation[] {
  const categories = options.categories ?? FORBIDDEN_COPY_CATEGORIES;
  const violations: ForbiddenCopyViolation[] = [];
  for (const category of categories) {
    const pattern = FORBIDDEN_COPY_PATTERNS[category];
    // 走査毎に新規 RegExp を生成し lastIndex の状態汚染を避ける（決定的な再走査）。
    const scanner = new RegExp(
      pattern.source,
      pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
    );
    let hit: RegExpExecArray | null;
    while ((hit = scanner.exec(text)) !== null) {
      violations.push({ category, match: hit[0], index: hit.index });
      // 幅ゼロ一致での無限ループを防ぐ（保険）。
      if (hit.index === scanner.lastIndex) {
        scanner.lastIndex += 1;
      }
    }
  }
  return violations;
}

/**
 * 与えたテキストに禁止コピーが 1 件も無いことを保証する。
 * 検出があればカテゴリと一致文字列を添えて例外を送出する。
 */
export function assertNoForbiddenCopy(text: string, options: ScanOptions = {}): void {
  const violations = scanForbiddenCopy(text, options);
  if (violations.length > 0) {
    const detail = violations
      .map((violation) => `${violation.category}:「${violation.match}」`)
      .join(", ");
    throw new Error(`可視文言に禁止コピーが含まれています: ${detail}`);
  }
}
