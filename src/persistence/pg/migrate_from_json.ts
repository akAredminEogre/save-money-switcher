/**
 * JSON → PostgreSQL の一括データ移送と整合検証（`module:persistence`・cmd_2553 B案 移行設計 S4）。
 *
 * 非破壊原則: JSON ファイル（`data/accounts.json` / `data/episodes.json`）は移送後も削除・改変
 * しない（ロールバック元として温存・設計 deliverable3）。移送は追記型（`ON CONFLICT` ベースの
 * insert-if-absent）で冪等ゆえ、再実行しても既存 PG 行を壊さない。
 *
 * 整合検証（設計 deliverable4 (a)）: 移送後に (a) 行数一致 (b) 主キー集合一致 (c) 全カラム値一致
 * を機械検証する。ログへは件数と一致/不一致の真偽のみを載せ、機密値（password_hash / salt 等）は
 * 出さない。
 */

import { readJsonFile } from "../json_file.js";
import { isAccountRow, type AccountRow, type AccountStore } from "../../accounts/account_store.js";
import {
  isEpisodeInvitationRow,
  isEpisodeParticipantRow,
  isEpisodeQuestionRow,
  isEpisodeRow,
  type EpisodeStore,
} from "../../episodes/episode_store.js";

/** 1 ドメイン分の移送結果（件数と検証真偽のみ・機密値を含まない）。 */
export interface MigrationDomainResult {
  /** JSON 側の正当行数。 */
  readonly sourceRows: number;
  /** 今回の実行で新たに挿入した行数（既存はスキップ＝冪等）。 */
  readonly inserted: number;
  /** 移送後の検証: 行数一致・PK 集合一致・全カラム値一致のすべてが成立したか。 */
  readonly verified: boolean;
  /** 検証で見つけた不一致の説明（機密値は含まない・一致時は空）。 */
  readonly mismatches: readonly string[];
}

export interface MigrationResult {
  readonly accounts: MigrationDomainResult;
  readonly episodes: MigrationDomainResult;
}

/** 整合検証の失敗（bootstrap が捕捉して非 0 終了する契約・壊れた移送のまま受付を始めない）。 */
export class MigrationVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationVerificationError";
  }
}

/** 行の全カラム一致を突合する（値そのものはメッセージへ載せず、列名だけを報告する）。 */
function diffColumns(expected: Record<string, unknown>, actual: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  const mismatched: string[] = [];
  for (const key of keys) {
    if (expected[key] !== actual[key]) mismatched.push(key);
  }
  return mismatched;
}

/**
 * `data/accounts.json` の全行を PG `accounts` へ移送し整合検証する。
 * JSON 不在（初回）は 0 件の空移送として成立する。
 */
export async function migrateAccounts(
  accountsJsonPath: string,
  pgStore: AccountStore,
): Promise<MigrationDomainResult> {
  const parsed = await readJsonFile(accountsJsonPath);
  const sourceRows: AccountRow[] = [];
  if (Array.isArray(parsed)) {
    for (const candidate of parsed) {
      if (isAccountRow(candidate)) sourceRows.push(candidate);
    }
  }

  let inserted = 0;
  for (const row of sourceRows) {
    if (await pgStore.insertIfLoginIdAbsent(row)) inserted += 1;
  }

  // 検証: JSON の各行が PG に存在し、全カラムが一致すること。行数は「JSON ⊆ PG」を最低線に、
  // 初回移送（空 PG への投入）では完全一致になる。
  const mismatches: string[] = [];
  const pgRows = await pgStore.listAccountsOrderedByCreatedAt();
  const pgById = new Map(pgRows.map((row) => [row.id, row]));
  if (pgRows.length < sourceRows.length) {
    mismatches.push(`行数不足: JSON=${sourceRows.length} PG=${pgRows.length}`);
  }
  for (const row of sourceRows) {
    const stored = pgById.get(row.id);
    if (stored === undefined) {
      mismatches.push(`PK欠落: accounts id=${row.id}`);
      continue;
    }
    const diff = diffColumns(
      row as unknown as Record<string, unknown>,
      stored as unknown as Record<string, unknown>,
    );
    if (diff.length > 0) mismatches.push(`カラム不一致: accounts id=${row.id} 列=${diff.join(",")}`);
  }
  return { sourceRows: sourceRows.length, inserted, verified: mismatches.length === 0, mismatches };
}

/** episodes.json の 4 配列ドキュメント（`json_episode_store.ts` と同じ寛容な読み方）。 */
function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * `data/episodes.json` の 4 表を FK 依存順（episodes → invitations / participants / questions）で
 * PG へ移送し整合検証する。ファイル不在（現状 0 件）は空移送として成立する（スキーマ作成のみ）。
 */
export async function migrateEpisodes(
  episodesJsonPath: string,
  pgStore: EpisodeStore,
): Promise<MigrationDomainResult> {
  const parsed = (await readJsonFile(episodesJsonPath)) as
    | Partial<Record<"episodes" | "invitations" | "participants" | "questions", unknown>>
    | undefined;

  const episodes = asArray(parsed?.episodes).filter(isEpisodeRow);
  const invitations = asArray(parsed?.invitations).filter(isEpisodeInvitationRow);
  const participants = asArray(parsed?.participants).filter(isEpisodeParticipantRow);
  const questions = asArray(parsed?.questions).filter(isEpisodeQuestionRow);
  const sourceCount =
    episodes.length + invitations.length + participants.length + questions.length;

  let inserted = 0;
  const mismatches: string[] = [];

  // 親 episodes（挿入は冪等でないため存在確認してから・移送の再実行を安全にする）。
  for (const row of episodes) {
    if ((await pgStore.findEpisodeById(row.id)) === undefined) {
      await pgStore.insertEpisode(row);
      inserted += 1;
    }
  }
  for (const row of invitations) {
    if (await pgStore.insertInvitationIfAbsent(row)) inserted += 1;
  }
  // episode_id 単位でキャッシュを一度だけ構築し、行ごとの存在確認クエリを省く。
  const participantEpisodeIds = [...new Set(participants.map((p) => p.episode_id))];
  const participantCache = new Map<string, Set<string>>();
  for (const episodeId of participantEpisodeIds) {
    const existing = await pgStore.listParticipantsByEpisode(episodeId);
    participantCache.set(episodeId, new Set(existing.map((p) => p.account_id)));
  }
  for (const row of participants) {
    const already = participantCache.get(row.episode_id)?.has(row.account_id) ?? false;
    await pgStore.insertParticipantIfAbsent(row);
    if (!already) inserted += 1;
  }

  const questionEpisodeIds = [...new Set(questions.map((q) => q.episode_id))];
  const questionCache = new Map<string, Set<number>>();
  for (const episodeId of questionEpisodeIds) {
    const existing = await pgStore.listQuestionsByEpisode(episodeId);
    questionCache.set(episodeId, new Set(existing.map((q) => q.question_number)));
  }
  for (const row of questions) {
    const already = questionCache.get(row.episode_id)?.has(row.question_number) ?? false;
    await pgStore.upsertQuestion(row);
    if (!already) inserted += 1;
  }

  // 検証: 各表で JSON 行が PG に存在し全カラム一致（値は出さず列名のみ）。
  for (const row of episodes) {
    const stored = await pgStore.findEpisodeById(row.id);
    if (stored === undefined) {
      mismatches.push(`PK欠落: episodes id=${row.id}`);
      continue;
    }
    const diff = diffColumns(
      row as unknown as Record<string, unknown>,
      stored as unknown as Record<string, unknown>,
    );
    if (diff.length > 0) mismatches.push(`カラム不一致: episodes id=${row.id} 列=${diff.join(",")}`);
  }
  for (const row of invitations) {
    const stored = (await pgStore.listInvitationsByEpisode(row.episode_id)).find(
      (i) => i.account_id === row.account_id,
    );
    if (stored === undefined || diffColumns({ ...row }, { ...stored }).length > 0) {
      mismatches.push(`招待不一致: episode=${row.episode_id}`);
    }
  }
  for (const row of participants) {
    const stored = await pgStore.findParticipant(row.episode_id, row.account_id);
    if (stored === undefined || diffColumns({ ...row }, { ...stored }).length > 0) {
      mismatches.push(`参加者不一致: episode=${row.episode_id}`);
    }
  }
  for (const row of questions) {
    const stored = (await pgStore.listQuestionsByEpisode(row.episode_id)).find(
      (q) => q.question_number === row.question_number,
    );
    if (stored === undefined || diffColumns({ ...row }, { ...stored }).length > 0) {
      mismatches.push(`問題不一致: episode=${row.episode_id} 問=${row.question_number}`);
    }
  }

  return { sourceRows: sourceCount, inserted, verified: mismatches.length === 0, mismatches };
}

/**
 * 両ドメインの移送を実行し、いずれかの整合検証が破れたら {@link MigrationVerificationError} を
 * 投げる（bootstrap は捕捉して非 0 終了・壊れた移送のまま受付を始めない）。
 */
export async function migrateJsonToPg(
  accountsJsonPath: string,
  episodesJsonPath: string,
  accountStore: AccountStore,
  episodeStore: EpisodeStore,
): Promise<MigrationResult> {
  const accounts = await migrateAccounts(accountsJsonPath, accountStore);
  const episodes = await migrateEpisodes(episodesJsonPath, episodeStore);
  if (!accounts.verified || !episodes.verified) {
    const reasons = [...accounts.mismatches, ...episodes.mismatches].join(" / ");
    throw new MigrationVerificationError(`JSON→PG 移送の整合検証に失敗しました: ${reasons}`);
  }
  return { accounts, episodes };
}
