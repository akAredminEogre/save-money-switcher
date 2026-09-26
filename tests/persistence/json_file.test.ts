/**
 * JSON ファイルの原子的な読み書き（`persistence/json_file.ts`・設計 D7）。
 *
 * 固定する契約:
 *   - 不在（`ENOENT`）は「まだ何も無い」＝ `undefined`。起動を止めない。
 *   - 壊れた JSON も `undefined` へ収束させ、実体は退避名へ改名して残す（黙って失わせない）。
 *   - **`ENOENT` 以外の読取失敗（権限・パス不正・I/O 障害）は握り潰さず送出する**。読めないものを
 *     「データ無し」と誤認すると、次の書込が既存データを空で上書きし原因も追えぬまま実体を失う。
 *   - 書込は一時ファイル → rename で原子的（半端な JSON を残さない）。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "../../src/persistence/json_file.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "sms-json-file-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("persistence/json_file JSON ファイルの原子的な読み書き", () => {
  it("書いた値をそのまま読み戻せる", async () => {
    const path = join(dir, "nested", "accounts.json");
    await writeJsonFileAtomic(path, { accounts: [{ id: "a1" }] });
    expect(await readJsonFile(path)).toEqual({ accounts: [{ id: "a1" }] });
  });

  it("ファイルが無い（ENOENT）場合は undefined を返し、例外にしない", async () => {
    expect(await readJsonFile(join(dir, "not-yet.json"))).toBeUndefined();
  });

  it("壊れた JSON は undefined へ収束し、実体は退避名へ改名して残る", async () => {
    const path = join(dir, "broken.json");
    await writeFile(path, "{ not json", "utf8");
    expect(await readJsonFile(path)).toBeUndefined();
    const entries = await readdir(dir);
    expect(entries).toContain("broken.json.corrupt-1");
    expect(entries).not.toContain("broken.json");
    // 退避された実体は中身のまま保全されている（上書きで失わせない）。
    expect(await readFile(join(dir, "broken.json.corrupt-1"), "utf8")).toBe("{ not json");
  });

  it("ENOENT 以外の読取失敗（ディレクトリを読む＝EISDIR）は undefined にせず送出する", async () => {
    const path = join(dir, "actually-a-directory");
    await mkdir(path);
    await expect(readJsonFile(path)).rejects.toMatchObject({ code: "EISDIR" });
  });

  it("書込後に一時ファイルが残らない（rename で置換されている）", async () => {
    const path = join(dir, "atomic.json");
    await writeJsonFileAtomic(path, { ok: true });
    const entries = await readdir(dir);
    expect(entries).toEqual(["atomic.json"]);
  });
});
