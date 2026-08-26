// @generated-by: codd implement
// @generated-from: docs/design/question_media_intake_design.md (design:question-media-intake-design)
// @design-node: docs/design/question_media_intake_design.md
// @output-paths: src, tests
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

/**
 * 出題メディア（動画・画像）の所定フォルダ（メディアルート）を解決する単一解決点
 * （`module:media` / `module:config`・question_media_intake_design §2.4 / §3.1）。
 *
 * `questions.image_path` / `questions.video_path` はこのメディアルート配下の相対パスとして
 * DB へ保持され、入稿検証（所定フォルダ配下の実体存在確認）・メディア配信（HTTP `/media`）・
 * TV a モードの出題面解決が同一のルート定義を共有する。ルートは環境変数
 * {@link QUESTION_MEDIA_ROOT_ENV}（`QUESTION_MEDIA_ROOT`）から与え、未設定・空欄時は
 * {@link DEFAULT_QUESTION_MEDIA_ROOT}（`./question-media`）へ単一定義でフォールバックする。
 *
 * 設定外出し規約: ルートのパスをアプリ各所へハードコードせず、本モジュールを唯一の解決点と
 * する。設定機構は上位設計（data_model_design §2.8）の {@link ConfigSource}（環境変数 or
 * `config` テーブルを抽象化）をそのまま共有し、接続上限の `resolveMaxTabletConnections` と
 * 同じ注入経路で差し替え可能にする。読取りキーの綴りは本ファイルに集約し、参照側に散らさない。
 */

import type { ConfigSource } from "./connection_limit.js";

/**
 * メディアルートを与える設定キー（SCREAMING_SNAKE_CASE）。
 * {@link ConfigSource} はこのキーで環境変数または `config` テーブルの値を解決する。
 */
export const QUESTION_MEDIA_ROOT_ENV = "QUESTION_MEDIA_ROOT";

/**
 * メディアルートの既定値の単一定義（`./question-media`）。
 *
 * `QUESTION_MEDIA_ROOT` 未設定・空欄時のフォールバックとしてのみ用いる。この既定パス文字列は
 * ここ一箇所にのみ定義し、解決経路（{@link resolveQuestionMediaRoot}）以外へは埋め込まない。
 */
export const DEFAULT_QUESTION_MEDIA_ROOT = "./question-media";

/**
 * メディアルートを設定から解決する。
 *
 * {@link ConfigSource} から {@link QUESTION_MEDIA_ROOT_ENV} を読み、値が与えられていれば
 * それを返し、未設定（`undefined`）・空文字・空白のみ（`trim` 後に空）であれば
 * {@link DEFAULT_QUESTION_MEDIA_ROOT} を返す。空白のみの設定値は「未設定」と同義に扱い、
 * 空のルートを採用してメディア配信・入稿検証が破綻することを防ぐ。
 */
export function resolveQuestionMediaRoot(source: ConfigSource): string {
  const raw = source.read(QUESTION_MEDIA_ROOT_ENV);
  return raw !== undefined && raw.trim() !== ""
    ? raw
    : DEFAULT_QUESTION_MEDIA_ROOT;
}
