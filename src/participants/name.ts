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
 * 参加者氏名のバリデーション（`module:participants`・自己入力氏名の受理境界）。
 *
 * participation_connection_design §2.4 / §2.4.2 / system_design §2.10 が定める確定制約を具体化する:
 *   - 氏名は解答者が自己入力する（事前氏名台帳・端末番号割当を用いない）。
 *   - 空・空白のみ・上限長超過の氏名は UI とサーバの双方で拒否し、`participants` に入れない。
 *
 * 本モジュールはサーバ側の最終防衛としての氏名検証を担う純関数群であり、UI 側（tablet）の
 * 事前検証と対をなす（二重防衛）。UI（`/join`）とサーバ（`registration` / `admission`）は同一の
 * {@link isValidDisplayName} と {@link MAX_DISPLAY_NAME_LENGTH} を共有し、受理境界を単一化する。
 */

/**
 * 自己入力氏名の表示長上限（コードポイント基準・設計選択値）。
 *
 * participation_connection_design §2.4.2 / §3.1 の確定値。TV 表示の安定のための上限であり、UI と
 * サーバが共有する {@link isValidDisplayName} の受理境界となる。
 */
export const MAX_DISPLAY_NAME_LENGTH = 20;

/**
 * 自己入力氏名が受理可能かを判定する（UI とサーバが共有する単一バリデータ）。
 *
 * 前後空白を除去したうえで、非空かつコードポイント長が {@link MAX_DISPLAY_NAME_LENGTH} 以下である
 * ときだけ `true` を返す。空・空白のみ・上限長超過はいずれも `false`。長さはサロゲートペアを 1 文字と
 * 数えるコードポイント基準で測る。副作用の無い純関数であり、例外を投げない。
 *
 * @param raw 解答者が /join で自己入力した生の氏名。
 * @returns 受理可能なら `true`、拒否するなら `false`。
 */
export function isValidDisplayName(raw: string): boolean {
  const trimmed = raw.trim();
  const length = [...trimmed].length; // コードポイント単位で数える
  return length >= 1 && length <= MAX_DISPLAY_NAME_LENGTH;
}

/** 氏名が空（空文字・空白のみ）である。 */
export class EmptyNameError extends Error {
  constructor() {
    super("氏名を入力してください。");
    this.name = "EmptyNameError";
  }
}

/** 氏名が上限長を超過している。 */
export class NameTooLongError extends Error {
  readonly maxLength: number;
  constructor(maxLength: number) {
    super(`氏名は ${maxLength} 文字以内で入力してください。`);
    this.name = "NameTooLongError";
    this.maxLength = maxLength;
  }
}

/**
 * 自己入力氏名をサーバ側で検証し、正規化した氏名（前後空白除去）を返す。空・空白のみ・上限長超過は
 * 例外で拒否する。判別結果（真偽）のみが必要な場合は {@link isValidDisplayName} を用いる。
 *
 * @throws {EmptyNameError} 空文字・空白のみの氏名。
 * @throws {NameTooLongError} 上限長（{@link MAX_DISPLAY_NAME_LENGTH}）を超過する氏名。
 */
export function validateName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new EmptyNameError();
  }
  if ([...trimmed].length > MAX_DISPLAY_NAME_LENGTH) {
    throw new NameTooLongError(MAX_DISPLAY_NAME_LENGTH);
  }
  return trimmed;
}
