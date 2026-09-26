/**
 * JSON ファイル実装の {@link EpisodeStore}（`module:episodes` / `module:persistence`・設計 D7）。
 *
 * `accounts/json_account_store.ts` と同じ作法で、エピソード系 4 表を 1 つの JSON ファイルへ
 * まとめて保持する。単一 Node プロセスが唯一の書き手ゆえ、全行をメモリに持ち、変更のたびに
 * ファイル全体をアトミックに書き戻す（一時ファイルへ書いて rename）。書込は直列化して並行要求で
 * 書き順が崩れることを防ぐ。壊れた行・非配列は読み捨て、起動を止めない。
 *
 * 表の分離（行 I/O と一意性の実装）は `episode_store.ts` の {@link createStoreOverTables} が
 * 唯一の実装を持ち、本モジュールは「読み込み・書き戻し」だけを与える。
 */

import { join } from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "../persistence/json_file.js";
import {
  createEmptyTables,
  createStoreOverTables,
  isEpisodeInvitationRow,
  isEpisodeParticipantRow,
  isEpisodeQuestionRow,
  isEpisodeRow,
  type EpisodeStore,
  type EpisodeTables,
} from "./episode_store.js";

/** エピソード永続ファイル名（データ置き場直下）。 */
export const EPISODES_FILE_NAME = "episodes.json";

/** データ置き場からエピソード永続ファイルのパスを組み立てる。 */
export function episodesFilePath(dataDir: string): string {
  return join(dataDir, EPISODES_FILE_NAME);
}

/** 永続ファイルの中身（4 表を 1 文書へ収める）。 */
interface EpisodesDocument {
  readonly episodes: unknown;
  readonly invitations: unknown;
  readonly participants: unknown;
  readonly questions: unknown;
}

/** 未検査の値から配列部分だけを取り出す（配列でなければ空配列）。 */
function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** JSON ファイル実装の {@link EpisodeStore} を生成する（ファイルは初回アクセス時に一度だけ読む）。 */
export function createJsonEpisodeStore(filePath: string): EpisodeStore {
  let loaded: Promise<EpisodeTables> | null = null;
  let writeChain: Promise<void> = Promise.resolve();

  async function load(): Promise<EpisodeTables> {
    if (loaded === null) {
      loaded = (async () => {
        const parsed = (await readJsonFile(filePath)) as Partial<EpisodesDocument> | undefined;
        const tables = createEmptyTables();
        if (parsed === undefined || parsed === null || typeof parsed !== "object") return tables;
        for (const candidate of asArray(parsed.episodes)) {
          if (isEpisodeRow(candidate)) tables.episodes.set(candidate.id, candidate);
        }
        for (const candidate of asArray(parsed.invitations)) {
          if (isEpisodeInvitationRow(candidate)) tables.invitations.push(candidate);
        }
        for (const candidate of asArray(parsed.participants)) {
          if (isEpisodeParticipantRow(candidate)) tables.participants.push(candidate);
        }
        for (const candidate of asArray(parsed.questions)) {
          if (isEpisodeQuestionRow(candidate)) tables.questions.push(candidate);
        }
        return tables;
      })();
    }
    return loaded;
  }

  function persist(tables: EpisodeTables): Promise<void> {
    const snapshot: EpisodesDocument = {
      episodes: [...tables.episodes.values()].sort((a, b) =>
        a.created_at.localeCompare(b.created_at),
      ),
      invitations: [...tables.invitations],
      participants: [...tables.participants],
      questions: [...tables.questions],
    };
    writeChain = writeChain.then(() => writeJsonFileAtomic(filePath, snapshot));
    return writeChain;
  }

  return createStoreOverTables(load, persist);
}
