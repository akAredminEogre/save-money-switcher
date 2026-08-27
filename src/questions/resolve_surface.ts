// @generated-by: codd implement
// @generated-from: docs/design/system_design.md (design:system-design)
// @design-node: docs/design/system_design.md
// @output-paths: src, tests
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

/**
 * TV「a モード（出題）」の出題面フォールバック解決（`module:questions`）。
 *
 * system_design §2.8 / §2.9 と decision_records ADR-N-2 で確定した
 * release-blocking の 3 段フォールバックを、他モジュールが再実装しない**単一の
 * 判定点**として実装する:
 *
 *   1. 動画   — `videoPath` が有効なら動画面（画像の有無に関わらず動画を優先）
 *   2. 画像   — 動画が無く `imagePath` が有効なら画像面
 *   3. テキスト — 動画・画像の双方が無ければテキスト面（終端フォールバック）
 *
 * 入力は問題データの `text` / `imagePath` / `videoPath`（いずれも `questions`
 * テーブル由来）のみで、当日その場入力に依存しない（ADR-N-2）。判定は現在の
 * フィールド値のみを参照するため、動画/画像パスをライブ編集した後の次回解決は、
 * 編集後の値で規定順（動画 → 画像 → テキスト）に従う。
 *
 * 戻り値は描画に必要な最小データを載せた**判別可能ユニオン**であり、生のパス文字列や
 * 「フォールバック」等の内部語を含む可視文言は持たない。観客向けの TV a 面は本結果を
 * 消費して描画し、生パス・内部語を露出させない責務を負う（surface copy 義務）。
 *
 * 本モジュールは他の実装単位へ依存しないリーフに保つ（NodeNext ゆえ相対 import は
 * `.js` 拡張子を明示するが、本モジュールは相対 import を持たない）。
 */

/**
 * 出題面の種別。**宣言順が優先順**（動画 → 画像 → テキスト）であり、
 * {@link SurfaceKind} と {@link resolveQuestionSurface} の分岐順の唯一の出典。
 */
export const SURFACE_PRIORITY = ["video", "image", "text"] as const;

/** 出題面の種別（`a` モードで解決されうる 3 面）。 */
export type SurfaceKind = (typeof SURFACE_PRIORITY)[number];

/**
 * フォールバック解決の入力。`questions` の 1 問から、面解決に要するフィールドのみを
 * 取り出した最小ビュー。`Question` エンティティ（camelCase）はこの形へ構造的に適合する。
 */
export interface QuestionSurfaceSource {
  /** 出題テキスト（終端フォールバック面。常に保持される）。 */
  readonly text: string;
  /** 画像出題パス（任意。未指定は `null` / `undefined` / 空文字）。 */
  readonly imagePath?: string | null;
  /** 動画出題パス（任意。未指定は `null` / `undefined` / 空文字）。 */
  readonly videoPath?: string | null;
}

/**
 * 出題面の解決結果（判別可能ユニオン）。`kind` で面種別を判別し、各面が描画に要する値
 * （解決済みパス／テキスト）のみを搬送する。動画結果に画像面は載らない（動画優先の帰結）。
 */
export type QuestionSurface =
  | { readonly kind: "video"; readonly videoPath: string }
  | { readonly kind: "image"; readonly imagePath: string }
  | { readonly kind: "text"; readonly text: string };

/**
 * 宣言済みメディアパスを「有効な出題面パス」へ正規化する。
 * `null` / `undefined` / 空文字 / 空白のみは「未指定（無）」として `null` を返し、
 * フォールバックの次段へ委ねる。前後空白は除去して返す。
 */
function normalizeMediaPath(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * a モードの出題面を **動画 → 画像 → テキスト** の規定順で解決する。
 *
 * - `videoPath` が有効（非空）なら、`imagePath` の有無に関わらず動画面を返す。
 * - 動画が無効で `imagePath` が有効なら画像面を返す。
 * - 双方が無効ならテキスト面を返す（終端フォールバック）。
 *
 * 空文字・空白のみのパスは「無」として次段へフォールバックする。
 */
export function resolveQuestionSurface(source: QuestionSurfaceSource): QuestionSurface {
  const videoPath = normalizeMediaPath(source.videoPath);
  if (videoPath !== null) {
    return { kind: "video", videoPath };
  }

  const imagePath = normalizeMediaPath(source.imagePath);
  if (imagePath !== null) {
    return { kind: "image", imagePath };
  }

  return { kind: "text", text: source.text };
}
