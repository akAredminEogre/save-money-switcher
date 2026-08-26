// @generated-by: codd implement
// @generated-from: docs/design/question_media_intake_design.md (design:question-media-intake-design)
// @design-node: docs/design/question_media_intake_design.md
// @output-paths: src, tests
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FsMediaPresence,
  createFsMediaPresence,
} from "../../src/media/media_presence.js";
import type { MediaPresence } from "../../src/questions/intake_validator.js";
import type { ConfigSource } from "../../src/config/connection_limit.js";
import { QUESTION_MEDIA_ROOT_ENV } from "../../src/config/media_root.js";

// fs-backed MediaPresence の焦点ユニット。各テストは新しい一時ディレクトリを所定フォルダ
// （メディアルート）として与え、そこへ実体を置く/置かないで present/absent 解決を確かめる。
// 生成側の MediaPresence 型を通した typed access で、返り値（boolean）の形をコンパイラに
// 証明させる。ルート文字列をハードコードせず、実体配置のみで解決が変わることを検証する。
describe("media/media_presence fs-backed MediaPresence（所定フォルダ配下の実体確認）", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "smsw-media-presence-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // codd: covers vb=VB-54
  it("宣言メディアは所定フォルダへの事前配置で present、未配置は absent として解決される（当日その場入力に依存しない）", () => {
    // 問題ファイルにパス記載された動画を所定フォルダへ事前配置する。
    writeFileSync(join(root, "q02-speed.mp4"), "video-bytes");
    const media: MediaPresence = new FsMediaPresence(root);

    // 事前配置された宣言パスは present。配置していない別の宣言パスは absent。
    // 常に true/false を返す退化実装は、この 2 本の独立アサートで赤になる。
    expect(media.exists("q02-speed.mp4")).toBe(true);
    expect(media.exists("q99-not-placed.mp4")).toBe(false);
  });

  it("サブフォルダ配下に事前配置された実体も present、同フォルダの未配置は absent", () => {
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "assets", "q03-crowd.png"), "png-bytes");
    const media = new FsMediaPresence(root);

    expect(media.exists(join("assets", "q03-crowd.png"))).toBe(true);
    expect(media.exists(join("assets", "missing.png"))).toBe(false);
  });

  it("ディレクトリ（実ファイルでない実体）は present と誤認しない", () => {
    // ルート配下にディレクトリを作っても、実体ファイルではないため exists は false。
    mkdirSync(join(root, "not-a-file"));
    const media = new FsMediaPresence(root);

    expect(media.exists("not-a-file")).toBe(false);
  });

  it("空文字・空白のみのパスは absent（未配置扱い）", () => {
    const media = new FsMediaPresence(root);

    expect(media.exists("")).toBe(false);
    expect(media.exists("   ")).toBe(false);
  });

  it("所定フォルダ外の実体は .. 遡りでも present と誤認しない（データ境界の防衛）", () => {
    // メディアルートを root/media に置き、その外（root 直下）へ実体を置く。
    const mediaRoot = join(root, "media");
    mkdirSync(mediaRoot);
    writeFileSync(join(root, "outside-secret.mp4"), "leak");
    const media = new FsMediaPresence(mediaRoot);

    // "../outside-secret.mp4" は実在するが所定フォルダ配下ではないため false。
    expect(media.exists(join("..", "outside-secret.mp4"))).toBe(false);
  });

  it("絶対パスは所定フォルダ配下の実体を指しても規約外として absent", () => {
    writeFileSync(join(root, "q05.mp4"), "video-bytes");
    const media = new FsMediaPresence(root);

    // 同一実体でも、相対パスなら present（対照）だが絶対パスなら false。
    expect(media.exists("q05.mp4")).toBe(true);
    expect(media.exists(join(root, "q05.mp4"))).toBe(false);
  });

  it("createFsMediaPresence は QUESTION_MEDIA_ROOT を解決して MediaPresence ポートへ束ねる", () => {
    writeFileSync(join(root, "q06.png"), "png-bytes");
    // config の QUESTION_MEDIA_ROOT に一時ディレクトリを注入し、他キーは undefined を返す。
    const source: ConfigSource = {
      read: (key: string): string | undefined =>
        key === QUESTION_MEDIA_ROOT_ENV ? root : undefined,
    };
    const media: MediaPresence = createFsMediaPresence(source);

    // 注入したルート配下の実体は present、未配置は absent（ルート束ねが効いている証跡）。
    expect(media.exists("q06.png")).toBe(true);
    expect(media.exists("elsewhere.png")).toBe(false);
  });
});
