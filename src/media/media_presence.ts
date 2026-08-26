// @generated-by: codd implement
// @generated-from: docs/design/question_media_intake_design.md (design:question-media-intake-design)
// @design-node: docs/design/question_media_intake_design.md
// @output-paths: src, tests
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { MediaPresence } from "../questions/intake_validator.js";
import type { ConfigSource } from "../config/connection_limit.js";
import { resolveQuestionMediaRoot } from "../config/media_root.js";

/**
 * ファイルシステム実体で {@link MediaPresence} を満たす本番アダプタ
 * （`module:media`・question_media_intake_design §2.2 / §2.4 / §2.9 / §3.1）。
 *
 * 入稿検証（`validateIntake`）は宣言された（非 null の）`image_path` / `video_path` が
 * 所定フォルダ（QUESTION_MEDIA_ROOT）配下に実体を持つかを {@link MediaPresence} 抽象へ
 * 委ね、a モードのフォールバックが「パスの有無」で分岐する前に未配置メディアを本番前へ
 * 排除する（dod_load_media_prevalidated）。設計は単体検証のため {@link MediaPresence} を
 * 抽象に保つ（テスト差替可）が、本番では実体をファイルシステムで確認する具体アダプタが
 * 要る。本クラスがそれであり、{@link resolveQuestionMediaRoot} が単一解決するメディア
 * ルートを基準に、与えられた相対パスの実体存在を Node fs で同期確認する。ランタイムの
 * 出題面解決（動画→画像→テキスト）はこの present/absent 判定に依存しつつ、当日その場
 * 入力の UI/API には依存しない（所定フォルダへの事前配置のみで解決する）。
 *
 * データ境界の防衛: `exists` は解決先が**メディアルート配下**に留まる相対パスの実体だけを
 * `true` と報告する。絶対パス・`..` によるルート外への遡り・ルート自身は、たとえ実体が
 * 存在しても `false` とする（「所定フォルダ配下に存在すれば true」の意味を厳守し、宣言
 * パスがルート外のファイルへ解決されるのを防ぐ）。ディレクトリ・特殊ファイルは実体ファイル
 * でないため `false`。同期 API（`statSync`）で判定し、`ENOENT` 等の I/O エラーは「未配置」
 * とみなして `false` を返す。
 */
export class FsMediaPresence implements MediaPresence {
  /** 解決済みのメディアルート（絶対パスへ正規化して保持する）。 */
  private readonly root: string;

  /**
   * @param mediaRoot メディアルート（{@link resolveQuestionMediaRoot} の解決値、または
   *   単体検証で与える一時ディレクトリ）。相対・絶対いずれでも絶対パスへ正規化して保持する。
   */
  constructor(mediaRoot: string) {
    this.root = resolve(mediaRoot);
  }

  /**
   * 与えた相対パスの実体（実ファイル）が所定フォルダ（メディアルート）配下に存在すれば
   * `true` を返す。存在しない・ディレクトリである・ルート外へ抜ける・絶対パスである・空
   * 文字列である場合は `false`。判定中の I/O エラー（`ENOENT` 等）は「未配置」とみなし
   * `false` を返す。
   */
  exists(relativePath: string): boolean {
    if (typeof relativePath !== "string" || relativePath.trim() === "") {
      return false;
    }
    // メディアパスはルート配下の相対パスに限る。絶対パスは規約外ゆえ未配置扱い。
    if (isAbsolute(relativePath)) {
      return false;
    }
    const candidate = resolve(this.root, relativePath);
    // ルート配下に留まることを保証する（.. 遡り・ドライブ跨ぎでのルート外脱出を拒否）。
    const rel = relative(this.root, candidate);
    if (rel === "" || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
      return false;
    }
    try {
      // 実ファイルのみ present とする（ディレクトリ・特殊ファイルは false）。
      return statSync(candidate).isFile();
    } catch {
      // ENOENT 等は「所定フォルダに未配置」を意味する。
      return false;
    }
  }
}

/**
 * {@link ConfigSource} から {@link resolveQuestionMediaRoot} でメディアルートを単一解決し、
 * それを基準にした fs アダプタ（{@link FsMediaPresence}）を生成する本番配線用ファクトリ。
 *
 * これにより入稿検証（`validateIntake` / `loadQuestions`）が消費する {@link MediaPresence}
 * ポートへ、config 由来のメディアルート（環境変数 `QUESTION_MEDIA_ROOT`・既定
 * `./question-media`）を束ねる。ルート文字列をアダプタへハードコードせず、config の単一
 * 解決点を経由させる（設定外出し規約と整合）。
 */
export function createFsMediaPresence(source: ConfigSource): MediaPresence {
  return new FsMediaPresence(resolveQuestionMediaRoot(source));
}
