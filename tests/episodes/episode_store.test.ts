/**
 * エピソード系 4 表の永続化境界（`episodes/episode_store.ts` / `episodes/json_episode_store.ts`）。
 *
 * 固定する契約:
 *   - 行 ⇄ ドメイン型の写像は往復して同値（snake_case ⇄ camelCase のドリフトを作らない）。
 *   - 招待は (episode_id, account_id) で一意、参加は同じ組で冪等（既存行が返る）。
 *   - 問題は (episode_id, question_number) で一意であり、再登録は行 id を保った上書きになる。
 *   - JSON 実装は再生成しても内容を失わず、壊れた行・壊れたファイルは読み捨てて起動を止めない。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createInMemoryEpisodeStore,
  isEpisodeQuestionRow,
  isEpisodeRow,
  toEpisode,
  toEpisodeInvitation,
  toEpisodeInvitationRow,
  toEpisodeParticipant,
  toEpisodeParticipantRow,
  toEpisodeQuestion,
  toEpisodeQuestionRow,
  toEpisodeRow,
  type EpisodeQuestionRow,
  type EpisodeRow,
} from "../../src/episodes/episode_store.js";
import {
  createJsonEpisodeStore,
  episodesFilePath,
  EPISODES_FILE_NAME,
} from "../../src/episodes/json_episode_store.js";

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

describe("episodes/episode_store 行 ⇄ ドメイン型の写像と一意性の受入", () => {
  it("4 表いずれも 行 → ドメイン型 → 行 の往復で同値になる", () => {
    const episode = episodeRow();
    expect(toEpisodeRow(toEpisode(episode))).toEqual(episode);
    const invitation = { episode_id: "ep-1", account_id: "acc-1", invited_at: "2026-08-28T01:00:00.000Z" };
    expect(toEpisodeInvitationRow(toEpisodeInvitation(invitation))).toEqual(invitation);
    const participant = { id: "p-1", episode_id: "ep-1", account_id: "acc-1", joined_at: "2026-08-28T02:00:00.000Z" };
    expect(toEpisodeParticipantRow(toEpisodeParticipant(participant))).toEqual(participant);
    const question = questionRow();
    expect(toEpisodeQuestionRow(toEpisodeQuestion(question))).toEqual(question);
  });

  it("未検査の値は必須列と正当な状態・正解値を備えるときだけ行として受理する", () => {
    expect(isEpisodeRow(episodeRow())).toBe(true);
    expect(isEpisodeRow({ ...episodeRow(), status: "archived" })).toBe(false);
    expect(isEpisodeRow(null)).toBe(false);
    expect(isEpisodeQuestionRow(questionRow())).toBe(true);
    expect(isEpisodeQuestionRow({ ...questionRow(), correct_value: 101 })).toBe(false);
    expect(isEpisodeQuestionRow({ ...questionRow(), correct_value: 50.5 })).toBe(false);
    expect(isEpisodeQuestionRow({ ...questionRow(), question_number: "1" })).toBe(false);
    expect(isEpisodeQuestionRow({ ...questionRow(), image_path: 3 })).toBe(false);
  });

  it("同一 (episode_id, account_id) の招待は 2 件目を挿入しない", async () => {
    const store = createInMemoryEpisodeStore();
    await store.insertEpisode(episodeRow());
    const invitation = { episode_id: "ep-1", account_id: "acc-1", invited_at: "2026-08-28T01:00:00.000Z" };
    expect(await store.insertInvitationIfAbsent(invitation)).toBe(true);
    expect(await store.insertInvitationIfAbsent({ ...invitation, invited_at: "2026-08-28T03:00:00.000Z" })).toBe(false);
    expect((await store.listInvitationsByEpisode("ep-1")).length).toBe(1);
    expect((await store.listInvitationsByAccount("acc-1")).length).toBe(1);
  });

  it("参加は冪等で、2 度目は既存行（同じ id）が返る", async () => {
    const store = createInMemoryEpisodeStore();
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
      joined_at: "2026-08-28T02:30:00.000Z",
    });
    expect(second.id).toBe(first.id);
    expect((await store.listParticipantsByEpisode("ep-1")).length).toBe(1);
    expect((await store.findParticipant("ep-1", "acc-1"))?.id).toBe("p-1");
    expect(await store.findParticipant("ep-1", "acc-2")).toBeUndefined();
  });

  it("同一 (episode_id, question_number) の再登録は行 id を保った上書きになる", async () => {
    const store = createInMemoryEpisodeStore();
    await store.insertEpisode(episodeRow());
    await store.upsertQuestion(questionRow());
    const updated = await store.upsertQuestion(
      questionRow({ id: "q-other", text: "1日は何時間？", correct_value: 24 }),
    );
    expect(updated.id).toBe("q-1");
    const questions = await store.listQuestionsByEpisode("ep-1");
    expect(questions.length).toBe(1);
    expect(questions[0]?.correct_value).toBe(24);
  });

  it("問題一覧は問題番号の昇順で返る", async () => {
    const store = createInMemoryEpisodeStore();
    await store.insertEpisode(episodeRow());
    await store.upsertQuestion(questionRow({ id: "q-3", question_number: 3 }));
    await store.upsertQuestion(questionRow({ id: "q-2", question_number: 2 }));
    expect((await store.listQuestionsByEpisode("ep-1")).map((q) => q.question_number)).toEqual([2, 3]);
  });

  it("エピソードの更新は存在するときだけ成功する", async () => {
    const store = createInMemoryEpisodeStore();
    await store.insertEpisode(episodeRow());
    expect(await store.updateEpisodeIfPresent(episodeRow({ status: "live" }))).toBe(true);
    expect((await store.findEpisodeById("ep-1"))?.status).toBe("live");
    expect(await store.updateEpisodeIfPresent(episodeRow({ id: "ep-none" }))).toBe(false);
  });
});

describe("episodes/json_episode_store 永続の往復と壊れた入力の扱い", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "episode-store-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("書き込んだ 4 表を、同じファイルから作り直した実装が読み戻せる", async () => {
    const path = episodesFilePath(dir);
    expect(path.endsWith(EPISODES_FILE_NAME)).toBe(true);
    const store = createJsonEpisodeStore(path);
    await store.insertEpisode(episodeRow());
    await store.insertInvitationIfAbsent({
      episode_id: "ep-1",
      account_id: "acc-1",
      invited_at: "2026-08-28T01:00:00.000Z",
    });
    await store.insertParticipantIfAbsent({
      id: "p-1",
      episode_id: "ep-1",
      account_id: "acc-1",
      joined_at: "2026-08-28T02:00:00.000Z",
    });
    await store.upsertQuestion(questionRow());

    const reopened = createJsonEpisodeStore(path);
    expect((await reopened.findEpisodeById("ep-1"))?.title).toBe("第1回");
    expect((await reopened.listInvitationsByEpisode("ep-1")).length).toBe(1);
    expect((await reopened.findParticipant("ep-1", "acc-1"))?.id).toBe("p-1");
    expect((await reopened.listQuestionsByEpisode("ep-1"))[0]?.correct_value).toBe(47);
  });

  it("壊れた JSON ファイルは読み捨てて空集合として扱う（起動を止めない）", async () => {
    const path = episodesFilePath(dir);
    await mkdir(dir, { recursive: true });
    await writeFile(path, "{ これは JSON ではない", "utf8");
    const store = createJsonEpisodeStore(path);
    expect((await store.listEpisodesOrderedByCreatedAt()).length).toBe(0);
  });

  it("壊れた行だけを読み捨て、正しい行は読み戻す", async () => {
    const path = episodesFilePath(dir);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        episodes: [episodeRow(), { id: "broken" }],
        invitations: [{ episode_id: "ep-1" }],
        participants: "not an array",
        questions: [questionRow(), questionRow({ id: "q-bad", correct_value: 999 })],
      }),
      "utf8",
    );
    const store = createJsonEpisodeStore(path);
    expect((await store.listEpisodesOrderedByCreatedAt()).length).toBe(1);
    expect((await store.listInvitationsByEpisode("ep-1")).length).toBe(0);
    expect((await store.listParticipantsByEpisode("ep-1")).length).toBe(0);
    expect((await store.listQuestionsByEpisode("ep-1")).length).toBe(1);
  });
});
