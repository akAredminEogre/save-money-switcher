/**
 * 永続バックエンド選択（`config/store_backend.ts`・cmd_2553 B案 S5）。
 *
 * 固定する契約: `pg` の明示だけが PG を選び、未設定・空・未知値は既定 `json` へ収束する
 * （誤設定で落とさず、実績ある JSON 永続＝ロールバック先で立ち上がる）。
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_STORE_BACKEND,
  resolveStoreBackend,
} from "../../src/config/store_backend.js";

describe("config/store_backend バックエンド選択の受入", () => {
  it("未設定・空・空白のみは既定 json", () => {
    expect(resolveStoreBackend({ env: {} })).toBe("json");
    expect(resolveStoreBackend({ env: { STORE_BACKEND: "" } })).toBe("json");
    expect(resolveStoreBackend({ env: { STORE_BACKEND: "   " } })).toBe("json");
    expect(DEFAULT_STORE_BACKEND).toBe("json");
  });

  it("pg の明示（大文字・前後空白は許容）だけが PG を選ぶ", () => {
    expect(resolveStoreBackend({ env: { STORE_BACKEND: "pg" } })).toBe("pg");
    expect(resolveStoreBackend({ env: { STORE_BACKEND: " PG " } })).toBe("pg");
  });

  it("未知値は既定 json へ収束する（例外を投げない）", () => {
    expect(resolveStoreBackend({ env: { STORE_BACKEND: "sqlite" } })).toBe("json");
    expect(resolveStoreBackend({ env: { STORE_BACKEND: "postgres?" } })).toBe("json");
  });
});
