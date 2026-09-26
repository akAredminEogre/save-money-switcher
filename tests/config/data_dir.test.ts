/**
 * 永続データ置き場の解決（`config/data_dir.ts`・設計 D7 / D8）。
 *
 * 他の `src/config/*` と同型の全域関数であることを固定する（例外を投げず 1 値へ収束する）。
 */

import { describe, it, expect } from "vitest";
import { DATA_DIR_ENV, DEFAULT_DATA_DIR_NAME, resolveDataDir } from "../../src/config/data_dir.js";
import { join } from "node:path";

describe("config/data_dir 永続データ置き場の解決", () => {
  it("未設定・空・空白のみは基点直下の既定ディレクトリへ収束する", () => {
    const cwd = "/srv/app";
    for (const raw of [undefined, "", "   "]) {
      const env = raw === undefined ? {} : { [DATA_DIR_ENV]: raw };
      expect(resolveDataDir({ env, cwd })).toBe(join(cwd, DEFAULT_DATA_DIR_NAME));
    }
  });

  it("絶対パス指定はそのまま用いる（本番はデプロイで消えぬ場所を与える）", () => {
    expect(resolveDataDir({ env: { [DATA_DIR_ENV]: "/var/lib/smsw" }, cwd: "/srv/app" })).toBe(
      "/var/lib/smsw",
    );
  });

  it("相対パス指定は基点からの絶対パスへ解決する", () => {
    expect(resolveDataDir({ env: { [DATA_DIR_ENV]: "var/data" }, cwd: "/srv/app" })).toBe(
      "/srv/app/var/data",
    );
  });

  it("前後空白を落として解決する", () => {
    expect(resolveDataDir({ env: { [DATA_DIR_ENV]: "  /var/lib/smsw  " }, cwd: "/srv/app" })).toBe(
      "/var/lib/smsw",
    );
  });
});
