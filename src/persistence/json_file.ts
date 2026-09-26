/**
 * JSON ファイルの原子的な読み書き（`module:persistence`・設計 D7）。
 *
 * 設計 D7 が決した zero-dependency 永続層の物理 I/O を担う。書込は **一時ファイルへ書いてから
 * rename** する（同一ディレクトリ内の rename は POSIX で原子的）。ゆえに書込途中のプロセス停止で
 * 半端な JSON が残らず、次回起動が壊れたファイルを読むことがない。
 *
 * 読出はファイル不在（`ENOENT`）だけを「まだ何も無い」として扱い（`undefined` を返す）、例外に
 * しない。壊れた JSON も `undefined` へ収束させる（呼出側が空集合として扱えるようにし、起動を
 * 5xx にしない）。壊れていた実体は上書きで失わせぬよう、退避名（`.corrupt-<n>`）へ改名して残す。
 *
 * 一方、権限不足（`EACCES`）・パス不正（`ENOTDIR` 等）・一時的な I/O 障害といった **ENOENT 以外の
 * 読取失敗は握り潰さず呼出側へ送出する**。読めない永続データを「データ無し」と誤認すると、次の
 * 書込が既存データを空で上書きし、原因も特定できぬまま実体を失う。不在と不通は別物として扱う。
 */

import { mkdir, readFile, rename, writeFile, access } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * JSON ファイルを読む。ファイルが無い（`ENOENT`）、または内容が JSON として解釈できない場合は
 * `undefined`。解釈できなかった実体は退避名へ改名して保全する（黙って失わせない）。
 *
 * `ENOENT` 以外の読取失敗（権限・パス不正・I/O 障害）は `undefined` に収束させず送出する。
 */
export async function readJsonFile(path: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if (isErrnoCode(err, "ENOENT")) return undefined; // まだ何も無い（初回起動）。
    throw err; // 読めないのか無いのかを取り違えない。
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    await quarantine(path);
    return undefined;
  }
}

/**
 * JSON ファイルを原子的に書く。親ディレクトリが無ければ作成し、同一ディレクトリの一時ファイルへ
 * 書いてから rename する。
 */
export async function writeJsonFileAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmpPath, path);
}

/**
 * 例外が Node の `errno` 付きシステムエラーで、かつ指定の `code` かを判定する。
 * `readFile` は `NodeJS.ErrnoException` を投げるが型は `unknown` ゆえ、ここで絞り込む。
 */
function isErrnoCode(err: unknown, code: string): boolean {
  return (
    typeof err === "object" && err !== null && (err as { code?: unknown }).code === code
  );
}

/** 壊れた JSON の実体を退避名へ改名する（既存の退避を上書きしない）。失敗しても黙って諦める。 */
async function quarantine(path: string): Promise<void> {
  for (let i = 1; i <= 100; i++) {
    const target = `${path}.corrupt-${i}`;
    try {
      await access(target);
      continue; // 既に在る退避名は使わない
    } catch {
      try {
        await rename(path, target);
      } catch {
        /* 退避に失敗しても読出は undefined で継続する（起動を止めない）。 */
      }
      return;
    }
  }
}
