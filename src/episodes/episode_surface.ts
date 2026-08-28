/**
 * エピソード各面のビュー投影（`module:episodes`・設計 D4 / surface_copy_obligations の作法）。
 *
 * 純粋なビュー投影であり、永続も認可も行わない。可視文言の義務（§2.8）に従い、内部ロール識別子・
 * 内部イベント名・設定キー名を面へ出さず、状態は運用語（準備中 / 開催中 / 終了）で表す。
 * 入力欄の受理境界（回名の上限・問題番号の範囲・正解値の範囲・お名前の上限・パスワードの最短長）は
 * すべて既存の単一定義点を引き写し、UI とサーバで境界を二重定義しない。
 *
 * 対象の面:
 *   - 管理者のエピソード一覧（issue #2 R3・AC-A3）… {@link renderAdminEpisodeList}
 *   - 管理者のエピソード詳細（R4・AC-A3 / AC-A4）… {@link renderAdminEpisodeDetail}
 *   - 解答者の招待エピソード一覧（R6・AC-A5 / AC-A6）… {@link renderInvitedEpisodeList}
 */

import { MAX_DISPLAY_NAME_LENGTH } from "../participants/name.js";
import { MIN_PASSWORD_LENGTH } from "../accounts/password.js";
import { MAX_LOGIN_ID_LENGTH } from "../accounts/account_service.js";
import { ANSWER_MAX, ANSWER_MIN } from "../scoring/answer_score.js";
import { QUESTION_NUMBER_MAX, QUESTION_NUMBER_MIN } from "../persistence/schema.js";
import {
  EPISODE_STATUSES,
  MAX_EPISODE_TITLE_LENGTH,
  type Episode,
  type EpisodeQuestion,
  type EpisodeStatus,
} from "./episode.js";

/** 状態の可視ラベル（内部語 `draft`/`live`/`finished` を面へ出さない唯一の写像点）。 */
export const EPISODE_STATUS_LABELS: Readonly<Record<EpisodeStatus, string>> = {
  draft: "準備中",
  live: "開催中",
  finished: "終了",
};

/** 管理者のエピソード一覧の見出し。 */
export const ADMIN_EPISODE_LIST_HEADING = "エピソード一覧";

/** エピソード新規作成セクションの CTA。 */
export const EPISODE_CREATE_SUBMIT_LABEL = "新しい回を作る";

/** 回名入力欄の可視ラベル。 */
export const EPISODE_TITLE_LABEL = "回の名前";

/** エピソードがまだ 1 件も無いときの平易文。 */
export const EPISODE_LIST_EMPTY_MESSAGE = "まだ回がありません。";

/** 解答者のエピソード一覧の見出し。 */
export const INVITED_EPISODE_LIST_HEADING = "ご参加いただける回";

/** 招待された回がまだ無いときの平易文。 */
export const INVITED_EPISODE_LIST_EMPTY_MESSAGE = "ご招待されている回はまだありません。";

/** 参加の CTA。 */
export const EPISODE_JOIN_LABEL = "参加する";

/** 参加済みの回を開く CTA。 */
export const EPISODE_OPEN_LABEL = "解答画面へ";

/** 問題登録セクションの見出し。 */
export const QUESTION_SECTION_HEADING = "問題と正解";

/** 問題登録の CTA。 */
export const QUESTION_SUBMIT_LABEL = "問題を登録する";

/** 解答者セクションの見出し。 */
export const MEMBER_SECTION_HEADING = "解答者";

/** 解答者アカウント作成の CTA。 */
export const MEMBER_CREATE_SUBMIT_LABEL = "解答者を作って招待する";

/** 既存メンバー招待の CTA。 */
export const MEMBER_INVITE_SUBMIT_LABEL = "この人を招待する";

/** 回の設定（名前・状態）の CTA。 */
export const EPISODE_UPDATE_SUBMIT_LABEL = "この回を保存する";

/** 参加済みを示す可視ラベル。 */
export const MEMBER_JOINED_LABEL = "参加済み";

/** 招待のみ（未参加）を示す可視ラベル。 */
export const MEMBER_INVITED_LABEL = "招待済み";

/** 一覧の 1 行（管理者・解答者で共有する最小の形）。 */
export interface EpisodeListItemView {
  readonly id: string;
  readonly title: string;
  /** 状態の可視ラベル（内部語ではない）。 */
  readonly statusLabel: string;
}

/** 管理者のエピソード一覧のビューモデル。 */
export interface AdminEpisodeListView {
  readonly heading: string;
  readonly episodes: readonly EpisodeListItemView[];
  readonly emptyMessage: string;
  readonly titleLabel: string;
  readonly titleMaxLength: number;
  readonly createSubmitLabel: string;
}

/** 管理者のエピソード一覧を描画する。 */
export function renderAdminEpisodeList(episodes: readonly Episode[]): AdminEpisodeListView {
  return {
    heading: ADMIN_EPISODE_LIST_HEADING,
    episodes: episodes.map(toListItem),
    emptyMessage: EPISODE_LIST_EMPTY_MESSAGE,
    titleLabel: EPISODE_TITLE_LABEL,
    titleMaxLength: MAX_EPISODE_TITLE_LENGTH,
    createSubmitLabel: EPISODE_CREATE_SUBMIT_LABEL,
  };
}

/** エピソード → 一覧行の写像（状態は可視ラベルへ畳む）。 */
function toListItem(episode: Episode): EpisodeListItemView {
  return {
    id: episode.id,
    title: episode.title,
    statusLabel: EPISODE_STATUS_LABELS[episode.status],
  };
}

/** 詳細面に出す 1 問。 */
export interface EpisodeQuestionView {
  readonly questionNumber: number;
  readonly text: string;
  readonly correctValue: number;
}

/** 詳細面に出す解答者 1 人（招待済み・参加済みの別を可視ラベルで持つ）。 */
export interface EpisodeMemberView {
  readonly accountId: string;
  readonly displayName: string;
  /** 参加済みなら参加者識別子（未参加は `undefined`）。 */
  readonly participantId?: string;
  readonly stateLabel: string;
}

/** 招待先に選べるアカウント（まだ招待していない解答者）。 */
export interface InvitableAccountView {
  readonly accountId: string;
  readonly displayName: string;
}

/** 状態選択肢（可視ラベル付き）。 */
export interface EpisodeStatusOptionView {
  readonly value: EpisodeStatus;
  readonly label: string;
}

/** 管理者のエピソード詳細のビューモデル。 */
export interface AdminEpisodeDetailView {
  readonly episodeId: string;
  readonly title: string;
  readonly statusLabel: string;
  readonly status: EpisodeStatus;
  readonly statusOptions: readonly EpisodeStatusOptionView[];
  readonly titleLabel: string;
  readonly titleMaxLength: number;
  readonly updateSubmitLabel: string;
  readonly questionSectionHeading: string;
  readonly questions: readonly EpisodeQuestionView[];
  readonly questionNumberMin: number;
  readonly questionNumberMax: number;
  readonly correctValueMin: number;
  readonly correctValueMax: number;
  readonly questionSubmitLabel: string;
  readonly memberSectionHeading: string;
  readonly members: readonly EpisodeMemberView[];
  readonly invitableAccounts: readonly InvitableAccountView[];
  readonly displayNameMaxLength: number;
  readonly loginIdMaxLength: number;
  readonly minPasswordLength: number;
  readonly memberCreateSubmitLabel: string;
  readonly memberInviteSubmitLabel: string;
}

/** 管理者のエピソード詳細の描画入力。 */
export interface AdminEpisodeDetailInput {
  readonly episode: Episode;
  readonly questions: readonly EpisodeQuestion[];
  /** 招待済みの解答者（表示名と、参加済みなら参加者識別子）。 */
  readonly members: readonly {
    readonly accountId: string;
    readonly displayName: string;
    readonly participantId?: string;
  }[];
  /** まだ招待していない解答者アカウント。 */
  readonly invitableAccounts: readonly InvitableAccountView[];
}

/** 管理者のエピソード詳細を描画する（R4 の集約面）。 */
export function renderAdminEpisodeDetail(input: AdminEpisodeDetailInput): AdminEpisodeDetailView {
  return {
    episodeId: input.episode.id,
    title: input.episode.title,
    status: input.episode.status,
    statusLabel: EPISODE_STATUS_LABELS[input.episode.status],
    statusOptions: EPISODE_STATUSES.map((status) => ({
      value: status,
      label: EPISODE_STATUS_LABELS[status],
    })),
    titleLabel: EPISODE_TITLE_LABEL,
    titleMaxLength: MAX_EPISODE_TITLE_LENGTH,
    updateSubmitLabel: EPISODE_UPDATE_SUBMIT_LABEL,
    questionSectionHeading: QUESTION_SECTION_HEADING,
    questions: input.questions.map((question) => ({
      questionNumber: question.questionNumber,
      text: question.text,
      correctValue: question.correctValue,
    })),
    questionNumberMin: QUESTION_NUMBER_MIN,
    questionNumberMax: QUESTION_NUMBER_MAX,
    correctValueMin: ANSWER_MIN,
    correctValueMax: ANSWER_MAX,
    questionSubmitLabel: QUESTION_SUBMIT_LABEL,
    memberSectionHeading: MEMBER_SECTION_HEADING,
    members: input.members.map((member) => ({
      accountId: member.accountId,
      displayName: member.displayName,
      ...(member.participantId !== undefined ? { participantId: member.participantId } : {}),
      stateLabel: member.participantId !== undefined ? MEMBER_JOINED_LABEL : MEMBER_INVITED_LABEL,
    })),
    invitableAccounts: input.invitableAccounts,
    displayNameMaxLength: MAX_DISPLAY_NAME_LENGTH,
    loginIdMaxLength: MAX_LOGIN_ID_LENGTH,
    minPasswordLength: MIN_PASSWORD_LENGTH,
    memberCreateSubmitLabel: MEMBER_CREATE_SUBMIT_LABEL,
    memberInviteSubmitLabel: MEMBER_INVITE_SUBMIT_LABEL,
  };
}

/** 解答者の一覧に出す 1 行（参加済みかどうかで CTA が変わる）。 */
export interface InvitedEpisodeItemView extends EpisodeListItemView {
  readonly joined: boolean;
  readonly actionLabel: string;
}

/** 解答者の招待エピソード一覧のビューモデル。 */
export interface InvitedEpisodeListView {
  readonly heading: string;
  readonly episodes: readonly InvitedEpisodeItemView[];
  readonly emptyMessage: string;
}

/**
 * 解答者の招待エピソード一覧を描画する（AC-A5）。渡された集合がそのまま面になるゆえ、
 * 「招待されていない回を渡さない」ことは呼出側（`episode_service.listInvitedEpisodes`）が担保する。
 */
export function renderInvitedEpisodeList(
  episodes: readonly Episode[],
  joinedEpisodeIds: readonly string[] = [],
): InvitedEpisodeListView {
  const joined = new Set(joinedEpisodeIds);
  return {
    heading: INVITED_EPISODE_LIST_HEADING,
    episodes: episodes.map((episode) => {
      const hasJoined = joined.has(episode.id);
      return {
        ...toListItem(episode),
        joined: hasJoined,
        actionLabel: hasJoined ? EPISODE_OPEN_LABEL : EPISODE_JOIN_LABEL,
      };
    }),
    emptyMessage: INVITED_EPISODE_LIST_EMPTY_MESSAGE,
  };
}
