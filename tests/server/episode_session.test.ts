/**
 * エピソード ⇄ 進行セッションの橋渡し（`server/episode_session.ts`・設計 D3 の互換規約）。
 *
 * 固定する契約:
 *   - 参加者を進行セッションへ載せる際、`episode_participants.id` が既存ドメインの
 *     `participantId` としてそのまま渡る（既存 QC 済みドメインは無改変で動く）。
 *   - 同じ回の再読込は進行状態（到達段階・解答・精算）を壊さず、参加者と出題だけを揃える。
 *   - 別の回が進行中なら載せ替えを拒む（進行中のゲームを消さない）。
 *   - 参加者として解答が受理され、精算まで既存 scoring がそのまま働く。
 */

import { describe, it, expect } from "vitest";
import {
  EpisodeBusyError,
  resolveSessionParticipantId,
  syncEpisodeIntoSession,
  type EpisodeSessionDeps,
} from "../../src/server/episode_session.js";
import { createSession, balanceFor, currentQuestion, questionCount } from "../../src/server/session.js";
import { applyAnswer, applyHostCommand } from "../../src/server/orchestrator.js";
import { buildTabletFragment } from "../../src/server/view_builders.js";
import { createInMemoryEpisodeStore, type EpisodeStore } from "../../src/episodes/episode_store.js";
import {
  createEpisode,
  inviteAccount,
  joinEpisode,
  registerQuestion,
} from "../../src/episodes/episode_service.js";

/** 決定的な採番・時刻。 */
function deps(prefix: string): { newId: () => string; now: () => string } {
  let seq = 0;
  return {
    newId: (): string => `${prefix}-${(seq += 1)}`,
    now: (): string => `2026-08-28T00:00:${String(seq).padStart(2, "0")}.000Z`,
  };
}

/** 表示名の解決口（アカウント永続層の代わりに固定の対応表を用いる）。 */
function sessionDeps(store: EpisodeStore, names: Record<string, string>): EpisodeSessionDeps {
  return {
    store,
    resolveDisplayName: async (accountId: string): Promise<string | undefined> => names[accountId],
  };
}

/** 招待済み・参加済みの解答者 1 人と問 2 問を持つ回を用意する。 */
async function seedEpisode(store: EpisodeStore): Promise<{ episodeId: string; participantId: string }> {
  const episode = await createEpisode(store, { title: "第1回", createdBy: "acc-admin" }, deps("ep"));
  await inviteAccount(store, episode.id, "acc-child", deps("inv"));
  const participant = await joinEpisode(store, episode.id, "acc-child", deps("p"));
  await registerQuestion(store, episode.id, { questionNumber: 1, text: "都道府県はいくつ？", correctValue: 47 }, deps("q1"));
  await registerQuestion(store, episode.id, { questionNumber: 2, text: "1日は何時間？", correctValue: 24 }, deps("q2"));
  return { episodeId: episode.id, participantId: participant.id };
}

describe("server/episode_session エピソードを進行セッションへ載せる", () => {
  it("参加者識別子がそのまま既存ドメインの参加者 id になり、出題は回の登録問になる", async () => {
    const store = createInMemoryEpisodeStore();
    const { episodeId, participantId } = await seedEpisode(store);
    const s = createSession();

    await syncEpisodeIntoSession(sessionDeps(store, { "acc-child": "たろう" }), episodeId, s);

    expect(s.episodeId).toBe(episodeId);
    expect(s.participants.map((p) => p.id)).toEqual([participantId]);
    expect(s.participants[0]?.name).toBe("たろう");
    expect(questionCount(s)).toBe(2);
    expect(currentQuestion(s).correctValue).toBe(47);
  });

  it("表示名を解決できない参加者は一覧へ載せない（面へ出す氏名を捏造しない）", async () => {
    const store = createInMemoryEpisodeStore();
    const { episodeId } = await seedEpisode(store);
    const s = createSession();
    await syncEpisodeIntoSession(sessionDeps(store, {}), episodeId, s);
    expect(s.participants).toEqual([]);
  });

  it("同じ回の再読込は進行状態を壊さず、後から参加した人を足す", async () => {
    const store = createInMemoryEpisodeStore();
    const { episodeId, participantId } = await seedEpisode(store);
    const s = createSession();
    const names: Record<string, string> = { "acc-child": "たろう" };
    await syncEpisodeIntoSession(sessionDeps(store, names), episodeId, s);

    expect(applyHostCommand("load_questions", undefined, s).ok).toBe(true);
    expect(applyAnswer(participantId, 40, s).ok).toBe(true);

    // 途中から 2 人目が参加する。
    await inviteAccount(store, episodeId, "acc-sister", deps("inv2"));
    const later = await joinEpisode(store, episodeId, "acc-sister", deps("p2"));
    names["acc-sister"] = "はなこ";
    await syncEpisodeIntoSession(sessionDeps(store, names), episodeId, s);

    expect(s.loaded).toBe(true);
    expect(s.answers.get(1)?.get(participantId)).toBe(40);
    expect(s.participants.map((p) => p.id)).toEqual([participantId, later.id]);
  });

  it("別の回が進行中なら載せ替えを拒む（進行中のゲームを消さない）", async () => {
    const store = createInMemoryEpisodeStore();
    const { episodeId } = await seedEpisode(store);
    const other = await createEpisode(store, { title: "第2回", createdBy: "acc-admin" }, deps("ep2"));
    const s = createSession();
    await syncEpisodeIntoSession(sessionDeps(store, { "acc-child": "たろう" }), episodeId, s);
    expect(applyHostCommand("load_questions", undefined, s).ok).toBe(true);

    await expect(
      syncEpisodeIntoSession(sessionDeps(store, { "acc-child": "たろう" }), other.id, s),
    ).rejects.toBeInstanceOf(EpisodeBusyError);
    expect(s.episodeId).toBe(episodeId);
  });

  it("進行前なら別の回へ束ね直せる（受付段階・第1問から始まる）", async () => {
    const store = createInMemoryEpisodeStore();
    const { episodeId, participantId } = await seedEpisode(store);
    const other = await createEpisode(store, { title: "第2回", createdBy: "acc-admin" }, deps("ep2"));
    await registerQuestion(store, other.id, { questionNumber: 1, text: "1年は何か月？", correctValue: 12 }, deps("oq"));
    const s = createSession();
    await syncEpisodeIntoSession(sessionDeps(store, { "acc-child": "たろう" }), episodeId, s);
    expect(s.participants.map((p) => p.id)).toEqual([participantId]);

    await syncEpisodeIntoSession(sessionDeps(store, { "acc-child": "たろう" }), other.id, s);
    expect(s.episodeId).toBe(other.id);
    expect(s.participants).toEqual([]);
    expect(questionCount(s)).toBe(1);
    expect(currentQuestion(s).correctValue).toBe(12);
  });

  it("進行セッションに載っている回の参加者だけが自分の参加者識別子を解決できる", async () => {
    const store = createInMemoryEpisodeStore();
    const { episodeId, participantId } = await seedEpisode(store);
    const s = createSession();
    const d = sessionDeps(store, { "acc-child": "たろう" });

    expect(await resolveSessionParticipantId(d, "acc-child", s)).toBeUndefined(); // まだ回を載せていない
    await syncEpisodeIntoSession(d, episodeId, s);
    expect(await resolveSessionParticipantId(d, "acc-child", s)).toBe(participantId);
    expect(await resolveSessionParticipantId(d, "acc-stranger", s)).toBeUndefined();
  });
});

describe("server/episode_session 既存ドメインとの接続（AC-A6）", () => {
  it("参加した解答者の解答が受理され、精算まで既存の採点がそのまま働く", async () => {
    const store = createInMemoryEpisodeStore();
    const { episodeId, participantId } = await seedEpisode(store);
    const s = createSession();
    await syncEpisodeIntoSession(sessionDeps(store, { "acc-child": "たろう" }), episodeId, s);

    expect(applyHostCommand("load_questions", undefined, s).ok).toBe(true);
    expect(applyAnswer(participantId, 45, s).ok).toBe(true);
    for (const command of ["lock_answers", "open_answers", "reveal_answer", "compute_settlement"]) {
      expect(applyHostCommand(command, undefined, s).ok, command).toBe(true);
    }
    // 誤差 2（正解 47・解答 45）に応じて残額が動く（金額の規則は既存 scoring が持つ）。
    expect(s.settlements.get(1)?.[0]?.participantId).toBe(participantId);
    expect(s.settlements.get(1)?.[0]?.error).toBe(2);
    expect(Number.isInteger(balanceFor(participantId, s))).toBe(true);
  });

  it("参加していない者の解答は受理されない", async () => {
    const store = createInMemoryEpisodeStore();
    const { episodeId } = await seedEpisode(store);
    const s = createSession();
    await syncEpisodeIntoSession(sessionDeps(store, { "acc-child": "たろう" }), episodeId, s);
    const result = applyAnswer("not-a-participant", 10, s);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it("問題が 1 問も無い回は出題を始められない（在らぬ問を捏造しない）", async () => {
    const store = createInMemoryEpisodeStore();
    const empty = await createEpisode(store, { title: "第3回", createdBy: "acc-admin" }, deps("ep3"));
    const s = createSession();
    await syncEpisodeIntoSession(sessionDeps(store, {}), empty.id, s);
    const result = applyHostCommand("load_questions", undefined, s);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
  });

  it("解答面には自分の表示名が出る（他者の情報は持ち込まない）", async () => {
    const store = createInMemoryEpisodeStore();
    const { episodeId, participantId } = await seedEpisode(store);
    await inviteAccount(store, episodeId, "acc-sister", deps("inv2"));
    await joinEpisode(store, episodeId, "acc-sister", deps("p2"));
    const s = createSession();
    await syncEpisodeIntoSession(
      sessionDeps(store, { "acc-child": "たろう", "acc-sister": "はなこ" }),
      episodeId,
      s,
    );
    const fragment = buildTabletFragment(participantId, s);
    expect(fragment).toContain("たろう");
    expect(fragment).not.toContain("はなこ");
  });
});
