/**
 * エピソード各面のビュー投影（`episodes/episode_surface.ts`・surface_copy_obligations §2.8）。
 *
 * 固定する契約:
 *   - 状態は運用語（準備中 / 開催中 / 終了）で出し、内部語（draft/live/finished）を面へ出さない。
 *   - 入力欄の受理境界は既存の単一定義点を引き写す（UI とサーバで二重定義しない）。
 *   - 解答者一覧は参加済み・招待済みを可視ラベルで区別する。
 *   - 招待エピソード一覧は渡された回だけを出し、参加済みなら CTA が「解答画面へ」に変わる。
 */

import { describe, it, expect } from "vitest";
import {
  renderAdminEpisodeDetail,
  renderAdminEpisodeList,
  renderInvitedEpisodeList,
  EPISODE_JOIN_LABEL,
  EPISODE_OPEN_LABEL,
  EPISODE_STATUS_LABELS,
  MEMBER_INVITED_LABEL,
  MEMBER_JOINED_LABEL,
} from "../../src/episodes/episode_surface.js";
import { MAX_EPISODE_TITLE_LENGTH, type Episode } from "../../src/episodes/episode.js";
import { MAX_DISPLAY_NAME_LENGTH } from "../../src/participants/name.js";
import { MIN_PASSWORD_LENGTH } from "../../src/accounts/password.js";
import { ANSWER_MAX, ANSWER_MIN } from "../../src/scoring/answer_score.js";
import { QUESTION_NUMBER_MAX, QUESTION_NUMBER_MIN } from "../../src/persistence/schema.js";

function episode(overrides: Partial<Episode> = {}): Episode {
  return {
    id: "ep-1",
    title: "第1回",
    status: "draft",
    createdBy: "acc-admin",
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
    ...overrides,
  };
}

/** 面の可視文言に内部語が現れないことを確かめる（§2.8 の内部語非露出）。 */
function visibleTextOf(value: unknown): string {
  return JSON.stringify(value);
}

describe("episodes/episode_surface 管理者のエピソード一覧", () => {
  it("状態は運用語で出し、内部語を面へ出さない", () => {
    const view = renderAdminEpisodeList([
      episode(),
      episode({ id: "ep-2", title: "第2回", status: "live" }),
      episode({ id: "ep-3", title: "第3回", status: "finished" }),
    ]);
    expect(view.episodes.map((e) => e.statusLabel)).toEqual([
      EPISODE_STATUS_LABELS.draft,
      EPISODE_STATUS_LABELS.live,
      EPISODE_STATUS_LABELS.finished,
    ]);
    const text = visibleTextOf(view.episodes.map((e) => [e.title, e.statusLabel]));
    for (const internal of ["draft", "live", "finished"]) {
      expect(text).not.toContain(internal);
    }
  });

  it("回が無いときは平易文を持ち、回名入力欄の上限は単一定義点を引き写す", () => {
    const view = renderAdminEpisodeList([]);
    expect(view.episodes).toEqual([]);
    expect(view.emptyMessage.length).toBeGreaterThan(0);
    expect(view.titleMaxLength).toBe(MAX_EPISODE_TITLE_LENGTH);
  });
});

describe("episodes/episode_surface 管理者のエピソード詳細", () => {
  const detail = renderAdminEpisodeDetail({
    episode: episode({ status: "live" }),
    questions: [
      {
        id: "q-1",
        episodeId: "ep-1",
        questionNumber: 1,
        text: "都道府県はいくつ？",
        correctValue: 47,
        imagePath: null,
        videoPath: null,
      },
    ],
    members: [
      { accountId: "acc-a", displayName: "たろう", participantId: "p-1" },
      { accountId: "acc-b", displayName: "はなこ" },
    ],
    invitableAccounts: [{ accountId: "acc-c", displayName: "じろう" }],
  });

  it("参加済みと招待済みを可視ラベルで区別する", () => {
    expect(detail.members.map((m) => m.stateLabel)).toEqual([MEMBER_JOINED_LABEL, MEMBER_INVITED_LABEL]);
    expect(detail.members[0]?.participantId).toBe("p-1");
    expect(detail.members[1]?.participantId).toBeUndefined();
  });

  it("状態選択肢は全状態を運用語ラベル付きで持ち、現在の状態を保つ", () => {
    expect(detail.status).toBe("live");
    expect(detail.statusLabel).toBe(EPISODE_STATUS_LABELS.live);
    expect(detail.statusOptions.map((o) => o.label)).toEqual([
      EPISODE_STATUS_LABELS.draft,
      EPISODE_STATUS_LABELS.live,
      EPISODE_STATUS_LABELS.finished,
    ]);
  });

  it("入力欄の受理境界はすべて既存の単一定義点を引き写す", () => {
    expect(detail.questionNumberMin).toBe(QUESTION_NUMBER_MIN);
    expect(detail.questionNumberMax).toBe(QUESTION_NUMBER_MAX);
    expect(detail.correctValueMin).toBe(ANSWER_MIN);
    expect(detail.correctValueMax).toBe(ANSWER_MAX);
    expect(detail.displayNameMaxLength).toBe(MAX_DISPLAY_NAME_LENGTH);
    expect(detail.minPasswordLength).toBe(MIN_PASSWORD_LENGTH);
    expect(detail.titleMaxLength).toBe(MAX_EPISODE_TITLE_LENGTH);
  });

  it("登録済みの問は問題文と正解値をそのまま持つ", () => {
    expect(detail.questions).toEqual([{ questionNumber: 1, text: "都道府県はいくつ？", correctValue: 47 }]);
  });
});

describe("episodes/episode_surface 解答者の招待エピソード一覧（AC-A5 / AC-A6）", () => {
  it("参加済みの回は CTA が解答画面へ変わり、未参加の回は参加の CTA を出す", () => {
    const view = renderInvitedEpisodeList(
      [episode(), episode({ id: "ep-2", title: "第2回", status: "live" })],
      ["ep-2"],
    );
    expect(view.episodes.map((e) => [e.id, e.joined, e.actionLabel])).toEqual([
      ["ep-1", false, EPISODE_JOIN_LABEL],
      ["ep-2", true, EPISODE_OPEN_LABEL],
    ]);
  });

  it("招待された回が無いときは平易文を持つ", () => {
    const view = renderInvitedEpisodeList([]);
    expect(view.episodes).toEqual([]);
    expect(view.emptyMessage.length).toBeGreaterThan(0);
  });
});
