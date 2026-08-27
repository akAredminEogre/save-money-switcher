/**
 * JSON ファイル実装の {@link AccountStore}（`module:accounts` / `module:persistence`・設計 D7）。
 *
 * 家族利用の規模（アカウント数〜十数）では JSON ＋ アトミック書込で十分であり、native ビルドを
 * 要する DB 依存を初手から抱え込まない（Node v20 ゆえ `node:sqlite` も使えない）。単一 Node
 * プロセスが唯一の書き手であるため、本実装は **全行をメモリに保持し、変更のたびにファイル全体を
 * 原子的に書き戻す**。書込は直列化（前回の書込 Promise に連鎖）して、並行要求で書き順が崩れる
 * ことを防ぐ。
 *
 * 将来 SQLite へ移す場合は本ファイルの差し替えだけで済む（境界は `account_store.ts` が持つ）。
 */

import { join } from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "../persistence/json_file.js";
import { isAccountRow, type AccountRow, type AccountStore } from "./account_store.js";

/** アカウント永続ファイル名（データ置き場直下）。 */
export const ACCOUNTS_FILE_NAME = "accounts.json";

/** データ置き場からアカウント永続ファイルのパスを組み立てる。 */
export function accountsFilePath(dataDir: string): string {
  return join(dataDir, ACCOUNTS_FILE_NAME);
}

/**
 * JSON ファイル実装の {@link AccountStore} を生成する。ファイルは遅延読込（最初のアクセス時に
 * 一度だけ読む）で、以降はメモリ上の写しが権威となる。壊れた行・非配列は読み捨てる。
 */
export function createJsonAccountStore(filePath: string): AccountStore {
  let loaded: Promise<Map<string, AccountRow>> | null = null;
  let writeChain: Promise<void> = Promise.resolve();

  async function load(): Promise<Map<string, AccountRow>> {
    if (loaded === null) {
      loaded = (async () => {
        const parsed = await readJsonFile(filePath);
        const rows = new Map<string, AccountRow>();
        if (Array.isArray(parsed)) {
          for (const candidate of parsed) {
            if (isAccountRow(candidate)) rows.set(candidate.id, candidate);
          }
        }
        return rows;
      })();
    }
    return loaded;
  }

  /** メモリ上の写しをファイルへ書き戻す（書込は直列化する）。 */
  function persist(rows: Map<string, AccountRow>): Promise<void> {
    const snapshot = [...rows.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
    writeChain = writeChain.then(() => writeJsonFileAtomic(filePath, snapshot));
    return writeChain;
  }

  return {
    async insertIfLoginIdAbsent(row: AccountRow): Promise<boolean> {
      const rows = await load();
      for (const existing of rows.values()) {
        if (existing.login_id === row.login_id) return false;
      }
      rows.set(row.id, row);
      await persist(rows);
      return true;
    },
    async findById(id: string): Promise<AccountRow | undefined> {
      return (await load()).get(id);
    },
    async findByLoginId(loginId: string): Promise<AccountRow | undefined> {
      for (const existing of (await load()).values()) {
        if (existing.login_id === loginId) return existing;
      }
      return undefined;
    },
    async listAccountsOrderedByCreatedAt(): Promise<readonly AccountRow[]> {
      const rows = await load();
      return [...rows.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
    },
    async updateIfPresent(row: AccountRow): Promise<boolean> {
      const rows = await load();
      if (!rows.has(row.id)) return false;
      rows.set(row.id, row);
      await persist(rows);
      return true;
    },
  };
}
