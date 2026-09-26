/**
 * PG バックエンドの受入（cmd_2553 B案 移行設計 S2〜S5・`persistence/pg/*` /
 * `accounts/pg_account_store.ts` / `episodes/pg_episode_store.ts`）。
 *
 * 固定する契約:
 *   - `ensureSchema` は冪等（2 回実行してもエラーなし・deliverable4 (b)）。
 *   - `assertReleaseReady` は DATABASE_URL 未設定・DB 不通・テーブル欠落を検知して拒む。
 *   - PgAccountStore / PgEpisodeStore は JSON 実装と同じ境界契約（一意性・冪等参加・
 *     id を保つ問題上書き）を PG の制約で満たす。
 *   - JSON → PG 移送は冪等・非破壊で、行数/PK/全カラムの整合検証が成立する。
 *
 * 実 PostgreSQL を要するため、接続先は `PG_TEST_DATABASE_URL` で注入する（staging コンテナ等）。
 * 受入実行はこの env を設定して行う（設定時は本スイートに skip は生じない）。
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { APP_SCHEMA } from "../../src/persistence/pg/app_schema.js";
import {
  assertReleaseReady,
  ensureSchema,
  ReleaseNotReadyError,
} from "../../src/persistence/pg/ensure_schema.js";
import { createPgPool } from "../../src/persistence/pg/pool.js";
import {
  migrateAccounts,
  migrateEpisodes,
  migrateJsonToPg,
  MigrationVerificationError,
} from "../../src/persistence/pg/migrate_from_json.js";
import { createPgAccountStore } from "../../src/accounts/pg_account_store.js";
import { createPgEpisodeStore } from "../../src/episodes/pg_episode_store.js";
import type { AccountRow } from "../../src/accounts/account_store.js";
import type {
  EpisodeQuestionRow,
  EpisodeRow,
} from "../../src/episodes/episode_store.js";

const TEST_URL = process.env["PG_TEST_DATABASE_URL"];

function accountRow(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: "acc-1",
    login_id: "host-lord",
    password_hash: "ab".repeat(64),
    password_salt: "cd".repeat(16),
    role: "admin",
    display_name: "司会者",
    created_at: "2026-08-28T00:00:00.000Z",
    updated_at: "2026-08-28T00:00:00.000Z",
    ...overrides,
  };
}

function episodeRow(overrides: Partial<EpisodeRow> = {}): EpisodeRow {
  return {
    id: "ep-1",
    title: "第1回",
    status: "draft",
    created_by: "acc-admin",
    created_at: "2026-08-28T00:00:00.000Z",
    updated_at: "2026-08-28T00:00:00.000Z",
    ...overrides,
  };
}

function questionRow(overrides: Partial<EpisodeQuestionRow> = {}): EpisodeQuestionRow {
  return {
    id: "q-1",
    episode_id: "ep-1",
    question_number: 1,
    text: "日本の都道府県はいくつ？",
    correct_value: 47,
    image_path: null,
    video_path: null,
    ...overrides,
  };
}

describe.runIf(TEST_URL !== undefined && TEST_URL !== "")("persistence/pg PG バックエンドの受入", () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: TEST_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // 各テストを白紙の DB から始める（依存順の逆に落とす・CASCADE で FK も畳む）。
    for (const table of [...APP_SCHEMA].reverse()) {
      await pool.query(`DROP TABLE IF EXISTS ${table.name} CASCADE`);
    }
    await ensureSchema(pool);
  });

  it("ensureSchema は冪等（再実行してもエラーにならない）", async () => {
    await ensureSchema(pool);
    await ensureSchema(pool);
    for (const table of APP_SCHEMA) {
      const result = await pool.query("SELECT to_regclass($1) AS oid", [`public.${table.name}`]);
      expect((result.rows[0] as { oid: string | null }).oid).not.toBeNull();
    }
  });

  it("assertReleaseReady はスキーマ成立済みの到達可能な DB を通す", async () => {
    await expect(
      assertReleaseReady(pool, { env: { DATABASE_URL: TEST_URL } }),
    ).resolves.toBeUndefined();
  });

  it("assertReleaseReady は DATABASE_URL 未設定を検知して拒む", async () => {
    await expect(assertReleaseReady(pool, { env: {} })).rejects.toBeInstanceOf(
      ReleaseNotReadyError,
    );
  });

  it("assertReleaseReady は DB 不通を検知して拒む（接続情報はメッセージへ載せない）", async () => {
    const dead = new pg.Pool({
      connectionString: "postgres://nobody:secret-value@127.0.0.1:1/nowhere",
      connectionTimeoutMillis: 2_000,
    });
    try {
      const failure = assertReleaseReady(dead, { env: { DATABASE_URL: "postgres://x" } });
      await expect(failure).rejects.toBeInstanceOf(ReleaseNotReadyError);
      await failure.catch((err: Error) => {
        expect(err.message).not.toContain("secret-value");
      });
    } finally {
      await dead.end();
    }
  });

  it("assertReleaseReady は必要テーブルの欠落を検知して拒む", async () => {
    await pool.query("DROP TABLE accounts CASCADE");
    await expect(
      assertReleaseReady(pool, { env: { DATABASE_URL: TEST_URL } }),
    ).rejects.toThrowError(/accounts/);
  });

  it("createPgPool は DATABASE_URL 未設定を明快なエラーで拒む", () => {
    expect(() => createPgPool({ env: {} })).toThrowError(/DATABASE_URL/);
  });

  describe("PgAccountStore（境界契約の PG 充足）", () => {
    it("同一 login_id の 2 件目は挿入されない（UNIQUE + ON CONFLICT の原子的 insert-if-absent）", async () => {
      const store = createPgAccountStore(pool);
      expect(await store.insertIfLoginIdAbsent(accountRow())).toBe(true);
      expect(await store.insertIfLoginIdAbsent(accountRow({ id: "acc-2" }))).toBe(false);
      expect((await store.listAccountsOrderedByCreatedAt()).length).toBe(1);
    });

    it("findById / findByLoginId は挿入した行を全カラム同値で返す", async () => {
      const store = createPgAccountStore(pool);
      const row = accountRow();
      await store.insertIfLoginIdAbsent(row);
      expect(await store.findById(row.id)).toEqual(row);
      expect(await store.findByLoginId(row.login_id)).toEqual(row);
      expect(await store.findById("missing")).toBeUndefined();
      expect(await store.findByLoginId("missing")).toBeUndefined();
    });

    it("一覧は created_at 昇順で返る", async () => {
      const store = createPgAccountStore(pool);
      await store.insertIfLoginIdAbsent(
        accountRow({ id: "acc-2", login_id: "later", created_at: "2026-08-29T00:00:00.000Z" }),
      );
      await store.insertIfLoginIdAbsent(accountRow());
      const listed = await store.listAccountsOrderedByCreatedAt();
      expect(listed.map((r) => r.id)).toEqual(["acc-1", "acc-2"]);
    });

    it("updateIfPresent は既存行だけを置換し login_id を変えない", async () => {
      const store = createPgAccountStore(pool);
      const row = accountRow();
      await store.insertIfLoginIdAbsent(row);
      expect(
        await store.updateIfPresent({ ...row, display_name: "新司会者" }),
      ).toBe(true);
      expect((await store.findById(row.id))?.display_name).toBe("新司会者");
      expect((await store.findById(row.id))?.login_id).toBe(row.login_id);
      expect(await store.updateIfPresent(accountRow({ id: "missing" }))).toBe(false);
    });
  });

  describe("PgEpisodeStore（境界契約の PG 充足）", () => {
    it("エピソードは挿入・取得・一覧・条件付き置換が JSON 実装と同じ契約で成立する", async () => {
      const store = createPgEpisodeStore(pool);
      await store.insertEpisode(episodeRow());
      await store.insertEpisode(
        episodeRow({ id: "ep-2", created_at: "2026-08-29T00:00:00.000Z" }),
      );
      expect(await store.findEpisodeById("ep-1")).toEqual(episodeRow());
      expect((await store.listEpisodesOrderedByCreatedAt()).map((e) => e.id)).toEqual([
        "ep-1",
        "ep-2",
      ]);
      expect(
        await store.updateEpisodeIfPresent(episodeRow({ status: "live" })),
      ).toBe(true);
      expect((await store.findEpisodeById("ep-1"))?.status).toBe("live");
      expect(
        await store.updateEpisodeIfPresent(episodeRow({ id: "missing" })),
      ).toBe(false);
    });

    it("招待は (episode_id, account_id) で一意（2 件目は false）", async () => {
      const store = createPgEpisodeStore(pool);
      await store.insertEpisode(episodeRow());
      const invitation = {
        episode_id: "ep-1",
        account_id: "acc-1",
        invited_at: "2026-08-28T01:00:00.000Z",
      };
      expect(await store.insertInvitationIfAbsent(invitation)).toBe(true);
      expect(await store.insertInvitationIfAbsent(invitation)).toBe(false);
      expect(await store.listInvitationsByEpisode("ep-1")).toEqual([invitation]);
      expect(await store.listInvitationsByAccount("acc-1")).toEqual([invitation]);
    });

    it("参加は同一 (episode_id, account_id) で冪等（既存行が返り participantId が増えない）", async () => {
      const store = createPgEpisodeStore(pool);
      await store.insertEpisode(episodeRow());
      const first = await store.insertParticipantIfAbsent({
        id: "p-1",
        episode_id: "ep-1",
        account_id: "acc-1",
        joined_at: "2026-08-28T02:00:00.000Z",
      });
      const second = await store.insertParticipantIfAbsent({
        id: "p-2",
        episode_id: "ep-1",
        account_id: "acc-1",
        joined_at: "2026-08-28T03:00:00.000Z",
      });
      expect(first.id).toBe("p-1");
      expect(second.id).toBe("p-1");
      expect((await store.listParticipantsByEpisode("ep-1")).length).toBe(1);
      expect(await store.findParticipant("ep-1", "acc-1")).toEqual(first);
      expect(await store.findParticipant("ep-1", "missing")).toBeUndefined();
    });

    it("問題の再登録は行 id を保った上書きになる（同じ問が別 id へ化けない）", async () => {
      const store = createPgEpisodeStore(pool);
      await store.insertEpisode(episodeRow());
      await store.upsertQuestion(questionRow());
      const replaced = await store.upsertQuestion(
        questionRow({ id: "q-other", text: "書き換え後", correct_value: 50 }),
      );
      expect(replaced.id).toBe("q-1");
      expect(replaced.text).toBe("書き換え後");
      const listed = await store.listQuestionsByEpisode("ep-1");
      expect(listed.length).toBe(1);
      expect(listed[0]?.id).toBe("q-1");
    });

    it("問題一覧は question_number 昇順で返る", async () => {
      const store = createPgEpisodeStore(pool);
      await store.insertEpisode(episodeRow());
      await store.upsertQuestion(questionRow({ id: "q-2", question_number: 2 }));
      await store.upsertQuestion(questionRow());
      expect(
        (await store.listQuestionsByEpisode("ep-1")).map((q) => q.question_number),
      ).toEqual([1, 2]);
    });
  });

  describe("JSON → PG 一括移送（冪等・非破壊・整合検証）", () => {
    let dir: string;
    const createdDirs: string[] = [];

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "pg-migration-"));
      createdDirs.push(dir);
    });

    afterAll(async () => {
      await Promise.all(createdDirs.map((d) => rm(d, { recursive: true, force: true })));
    });

    it("accounts.json の全行が移送され、行数・PK・全カラムの整合検証が成立する", async () => {
      const rows = [accountRow(), accountRow({ id: "acc-2", login_id: "second" })];
      const jsonPath = join(dir, "accounts.json");
      await writeFile(jsonPath, JSON.stringify(rows, null, 2), "utf8");
      const store = createPgAccountStore(pool);

      const result = await migrateAccounts(jsonPath, store);
      expect(result).toMatchObject({ sourceRows: 2, inserted: 2, verified: true });

      // 冪等: 再実行しても挿入 0・検証成立のまま（既存 PG 行を壊さない）。
      const again = await migrateAccounts(jsonPath, store);
      expect(again).toMatchObject({ sourceRows: 2, inserted: 0, verified: true });

      // 非破壊: JSON は読み取りのみで改変されない。
      const { readFile } = await import("node:fs/promises");
      expect(JSON.parse(await readFile(jsonPath, "utf8"))).toEqual(rows);
    });

    it("episodes.json 不在（0 件）は空移送として成立する（スキーマ作成のみ）", async () => {
      const result = await migrateEpisodes(join(dir, "episodes.json"), createPgEpisodeStore(pool));
      expect(result).toMatchObject({ sourceRows: 0, inserted: 0, verified: true });
    });

    it("episodes.json の 4 表が FK 依存順で移送され整合検証が成立する", async () => {
      const doc = {
        episodes: [episodeRow()],
        invitations: [
          { episode_id: "ep-1", account_id: "acc-1", invited_at: "2026-08-28T01:00:00.000Z" },
        ],
        participants: [
          { id: "p-1", episode_id: "ep-1", account_id: "acc-1", joined_at: "2026-08-28T02:00:00.000Z" },
        ],
        questions: [questionRow()],
      };
      const jsonPath = join(dir, "episodes.json");
      await writeFile(jsonPath, JSON.stringify(doc, null, 2), "utf8");
      const store = createPgEpisodeStore(pool);

      const result = await migrateEpisodes(jsonPath, store);
      expect(result).toMatchObject({ sourceRows: 4, inserted: 4, verified: true });

      const again = await migrateEpisodes(jsonPath, store);
      expect(again).toMatchObject({ sourceRows: 4, inserted: 0, verified: true });
    });

    it("migrateJsonToPg は両ドメインを移送し、整合が破れたときだけ例外で拒む", async () => {
      const accountsPath = join(dir, "accounts.json");
      await writeFile(accountsPath, JSON.stringify([accountRow()], null, 2), "utf8");
      const accountStore = createPgAccountStore(pool);
      const episodeStore = createPgEpisodeStore(pool);

      const result = await migrateJsonToPg(
        accountsPath,
        join(dir, "episodes.json"),
        accountStore,
        episodeStore,
      );
      expect(result.accounts.verified).toBe(true);
      expect(result.episodes.verified).toBe(true);

      // 整合破れの検知: 同じ login_id で内容の異なる行は挿入されず（insert-if-absent）、
      // 全カラム一致の検証が破れて例外になる。
      await writeFile(
        accountsPath,
        JSON.stringify([accountRow({ id: "acc-999" })], null, 2),
        "utf8",
      );
      await expect(
        migrateJsonToPg(accountsPath, join(dir, "episodes.json"), accountStore, episodeStore),
      ).rejects.toBeInstanceOf(MigrationVerificationError);
    });
  });
});
