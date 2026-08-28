/**
 * エピソードの業務層（`episodes/episode_service.ts`・AC-A3〜AC-A6 / issue #2 R3〜R6）。
 *
 * 固定する契約:
 *   - 受理境界（回名・問題番号 1〜10・問題文非空・正解 0〜100 整数）を満たさぬ入力は拒む。
 *   - 招待されていない者はエピソードへ参加できない（AC-A5 の裏返し）。
 *   - 参加は冪等で、返る参加者識別子（＝既存ドメインへ渡す `participantId`）は増えない。
 *   - 招待エピソード一覧には**招待された回だけ**が出る（招待されていない回は出ない）。
 *   - 同じ問題番号への再登録は上書き編集であり、問は増えない。
 */

import { describe, it, expect } from "vitest";
import {
  createEpisode,
  findEpisode,
  findParticipation,
  inviteAccount,
  isInvited,
  joinEpisode,
  listEpisodeQuestions,
  listEpisodes,
  listInvitations,
  listInvitedEpisodes,
  listParticipants,
  listQuestionsForPlay,
  registerQuestion,
  updateEpisode,
  EpisodeNotFoundError,
  InvalidCorrectValueError,
  InvalidEpisodeTitleError,
  InvalidQuestionNumberError,
  InvalidQuestionTextError,
  NotInvitedError,
} from "../../src/episodes/episode_service.js";
import { createInMemoryEpisodeStore } from "../../src/episodes/episode_store.js";
import { MAX_EPISODE_TITLE_LENGTH } from "../../src/episodes/episode.js";

/** 決定的な採番・時刻（検証を実行時刻へ依存させない）。 */
function deps(prefix: string): { newId: () => string; now: () => string } {
  let seq = 0;
  return {
    newId: (): string => `${prefix}-${(seq += 1)}`,
    now: (): string => `2026-08-28T00:00:${String(seq).padStart(2, "0")}.000Z`,
  };
}

describe("episodes/episode_service エピソードの作成・編集", () => {
  it("作成した回は準備中で始まり、一覧と単体取得の双方から読める", async () => {
    const store = createInMemoryEpisodeStore();
    const episode = await createEpisode(store, { title: " 第1回 ", createdBy: "acc-admin" }, deps("ep"));
    expect(episode.status).toBe("draft");
    expect(episode.title).toBe("第1回"); // 前後空白は落とす
    expect((await listEpisodes(store)).map((e) => e.id)).toEqual([episode.id]);
    expect((await findEpisode(store, episode.id))?.title).toBe("第1回");
  });

  it("空・空白のみ・上限超過の回名は拒む", async () => {
    const store = createInMemoryEpisodeStore();
    for (const title of ["", "   ", "あ".repeat(MAX_EPISODE_TITLE_LENGTH + 1)]) {
      await expect(createEpisode(store, { title, createdBy: "acc-admin" })).rejects.toBeInstanceOf(
        InvalidEpisodeTitleError,
      );
    }
  });

  it("名前と状態を編集でき、与えなかったフィールドは変わらない", async () => {
    const store = createInMemoryEpisodeStore();
    const created = await createEpisode(store, { title: "第1回", createdBy: "acc-admin" }, deps("ep"));
    const renamed = await updateEpisode(store, created.id, { title: "第1回 家族戦" }, deps("t"));
    expect(renamed.title).toBe("第1回 家族戦");
    expect(renamed.status).toBe("draft");
    const started = await updateEpisode(store, created.id, { status: "live" }, deps("t"));
    expect(started.status).toBe("live");
    expect(started.title).toBe("第1回 家族戦");
  });

  it("存在しない回の編集・招待・参加・問題登録は EpisodeNotFoundError になる", async () => {
    const store = createInMemoryEpisodeStore();
    await expect(updateEpisode(store, "none", { title: "x" })).rejects.toBeInstanceOf(EpisodeNotFoundError);
    await expect(inviteAccount(store, "none", "acc-1")).rejects.toBeInstanceOf(EpisodeNotFoundError);
    await expect(joinEpisode(store, "none", "acc-1")).rejects.toBeInstanceOf(EpisodeNotFoundError);
    await expect(
      registerQuestion(store, "none", { questionNumber: 1, text: "問", correctValue: 1 }),
    ).rejects.toBeInstanceOf(EpisodeNotFoundError);
  });
});

describe("episodes/episode_service 招待と参加（AC-A4〜AC-A6）", () => {
  it("招待した回だけが解答者の一覧に出る（招待されていない回は出ない）", async () => {
    const store = createInMemoryEpisodeStore();
    const invitedEpisode = await createEpisode(store, { title: "第1回", createdBy: "acc-admin" }, deps("ep1"));
    const otherEpisode = await createEpisode(store, { title: "第2回", createdBy: "acc-admin" }, deps("ep2"));
    await inviteAccount(store, invitedEpisode.id, "acc-child", deps("inv"));

    const listed = await listInvitedEpisodes(store, "acc-child");
    expect(listed.map((e) => e.id)).toEqual([invitedEpisode.id]);
    expect(listed.some((e) => e.id === otherEpisode.id)).toBe(false);
    expect(await isInvited(store, invitedEpisode.id, "acc-child")).toBe(true);
    expect(await isInvited(store, otherEpisode.id, "acc-child")).toBe(false);
    expect((await listInvitations(store, invitedEpisode.id)).map((i) => i.accountId)).toEqual(["acc-child"]);
  });

  it("招待は冪等（同じ人を二度招待しても 1 件のまま）", async () => {
    const store = createInMemoryEpisodeStore();
    const episode = await createEpisode(store, { title: "第1回", createdBy: "acc-admin" }, deps("ep"));
    await inviteAccount(store, episode.id, "acc-child", deps("inv"));
    await inviteAccount(store, episode.id, "acc-child", deps("inv"));
    expect((await listInvitations(store, episode.id)).length).toBe(1);
  });

  it("招待されていない者は参加できない", async () => {
    const store = createInMemoryEpisodeStore();
    const episode = await createEpisode(store, { title: "第1回", createdBy: "acc-admin" }, deps("ep"));
    await expect(joinEpisode(store, episode.id, "acc-stranger")).rejects.toBeInstanceOf(NotInvitedError);
    expect((await listParticipants(store, episode.id)).length).toBe(0);
  });

  it("参加は冪等で、参加者識別子は二度目も同じ（既存ドメインへ渡す鍵が増えない）", async () => {
    const store = createInMemoryEpisodeStore();
    const episode = await createEpisode(store, { title: "第1回", createdBy: "acc-admin" }, deps("ep"));
    await inviteAccount(store, episode.id, "acc-child", deps("inv"));
    const first = await joinEpisode(store, episode.id, "acc-child", deps("p"));
    const second = await joinEpisode(store, episode.id, "acc-child", deps("p"));
    expect(second.id).toBe(first.id);
    expect((await listParticipants(store, episode.id)).length).toBe(1);
    expect((await findParticipation(store, episode.id, "acc-child"))?.id).toBe(first.id);
    expect(await findParticipation(store, episode.id, "acc-other")).toBeUndefined();
  });
});

describe("episodes/episode_service 問題と正解の登録（AC-A3）", () => {
  it("登録した問は問題番号順に読め、既存ドメインの問題型へ写せる", async () => {
    const store = createInMemoryEpisodeStore();
    const episode = await createEpisode(store, { title: "第1回", createdBy: "acc-admin" }, deps("ep"));
    await registerQuestion(store, episode.id, { questionNumber: 2, text: "1日は何時間？", correctValue: 24 }, deps("q2"));
    await registerQuestion(store, episode.id, { questionNumber: 1, text: "都道府県はいくつ？", correctValue: 47 }, deps("q1"));

    const questions = await listEpisodeQuestions(store, episode.id);
    expect(questions.map((q) => q.questionNumber)).toEqual([1, 2]);
    const forPlay = await listQuestionsForPlay(store, episode.id);
    expect(forPlay.map((q) => q.correctValue)).toEqual([47, 24]);
    expect(forPlay[0]?.imagePath).toBeNull();
    expect(forPlay[0]?.videoPath).toBeNull();
  });

  it("同じ問題番号への再登録は上書き編集であり、問は増えない", async () => {
    const store = createInMemoryEpisodeStore();
    const episode = await createEpisode(store, { title: "第1回", createdBy: "acc-admin" }, deps("ep"));
    await registerQuestion(store, episode.id, { questionNumber: 1, text: "最初の問", correctValue: 10 }, deps("q"));
    await registerQuestion(store, episode.id, { questionNumber: 1, text: "直した問", correctValue: 20 }, deps("q"));
    const questions = await listEpisodeQuestions(store, episode.id);
    expect(questions.length).toBe(1);
    expect(questions[0]?.text).toBe("直した問");
    expect(questions[0]?.correctValue).toBe(20);
  });

  it("問題番号・問題文・正解値の受理境界を外れた入力は拒む", async () => {
    const store = createInMemoryEpisodeStore();
    const episode = await createEpisode(store, { title: "第1回", createdBy: "acc-admin" }, deps("ep"));
    await expect(
      registerQuestion(store, episode.id, { questionNumber: 0, text: "問", correctValue: 1 }),
    ).rejects.toBeInstanceOf(InvalidQuestionNumberError);
    await expect(
      registerQuestion(store, episode.id, { questionNumber: 11, text: "問", correctValue: 1 }),
    ).rejects.toBeInstanceOf(InvalidQuestionNumberError);
    await expect(
      registerQuestion(store, episode.id, { questionNumber: 1, text: "   ", correctValue: 1 }),
    ).rejects.toBeInstanceOf(InvalidQuestionTextError);
    for (const correctValue of [-1, 101, 50.5]) {
      await expect(
        registerQuestion(store, episode.id, { questionNumber: 1, text: "問", correctValue }),
      ).rejects.toBeInstanceOf(InvalidCorrectValueError);
    }
    expect((await listEpisodeQuestions(store, episode.id)).length).toBe(0);
  });
});
