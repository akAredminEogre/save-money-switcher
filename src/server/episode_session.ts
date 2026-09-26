/**
 * エピソード ⇄ 進行セッションの橋渡し（`module:server`・案A P2 / 設計 D3）。
 *
 * 恒久側（`episodes` の永続データ）と揮発側（`server/session.ts` の in-memory 進行状態）の
 * 唯一の接続点である。既存 QC 済みドメイン（scoring / game_state / realtime_sync / render_*）は
 * `participantId: string` を鍵に動くため、ここで **`episode_participants.id` を
 * `Participant.id` として渡す**（設計 D3 の互換規約）。ドメイン側は無改変のまま案A に載る。
 *
 * 1 卓が同時に進められる回は 1 つである（家族の 1 卓運用）。ゆえに束ね直しの規約は次のとおり:
 *   - 同じ回を再度読み込む … 出題集合と参加者だけを最新へ揃える（進行状態は壊さない）。
 *   - 別の回を読み込む・進行中の回が無い … その回で束ね直す（受付段階・第 1 問から）。
 *   - 別の回が既に進行中（出題開始済み） … {@link EpisodeBusyError} で拒む。進行中のゲームを
 *     他者の操作で消さないための業務的な拒否であり、5xx にはしない。
 */

import {
  findParticipation,
  listParticipants,
  listQuestionsForPlay,
} from "../episodes/episode_service.js";
import type { EpisodeStore } from "../episodes/episode_store.js";
import type { Participant } from "../participants/participant.js";
import {
  bindEpisode,
  refreshEpisodeBinding,
  session,
  type EpisodeBinding,
  type Session,
} from "./session.js";

/** 別の回が進行中で、要求された回を進行セッションへ載せられない。 */
export class EpisodeBusyError extends Error {
  constructor() {
    super("別の回が進行中です。進行中の回を終えてからお試しください。");
    this.name = "EpisodeBusyError";
  }
}

/** エピソード橋渡しの依存（永続境界と、アカウント表示名の解決口）。 */
export interface EpisodeSessionDeps {
  readonly store: EpisodeStore;
  /**
   * 参加者アカウントの表示名を解決する。`accounts` への依存を関数 1 本へ絞ることで、
   * 本モジュールがアカウント永続層の実装を知らずに済む（面へ出す氏名の出所は 1 つ）。
   */
  readonly resolveDisplayName: (accountId: string) => Promise<string | undefined>;
}

/**
 * 当該エピソードの参加者を、既存ドメインの {@link Participant} 列へ写す。
 *
 * `connectionId` は「1 人 = 1 台」を担保する一意キーであり、案A ではエピソード参加者レコードが
 * その役目を負う。ゆえに参加者識別子をそのまま与える（別系統の識別子を発明しない）。
 * 表示名を解決できないアカウント（削除済み等）は面へ出す氏名が無いため一覧に載せない。
 */
async function toParticipants(deps: EpisodeSessionDeps, episodeId: string): Promise<Participant[]> {
  const participants: Participant[] = [];
  for (const entry of await listParticipants(deps.store, episodeId)) {
    const displayName = await deps.resolveDisplayName(entry.accountId);
    if (displayName === undefined) continue;
    participants.push({
      id: entry.id,
      name: displayName,
      joinedAt: entry.joinedAt,
      connectionId: entry.id,
    });
  }
  return participants;
}

/**
 * 当該エピソードを進行セッションへ載せる（束ね直し・更新のいずれか）。
 *
 * @throws {EpisodeBusyError} 別の回が既に進行中（出題開始済み）である。
 */
export async function syncEpisodeIntoSession(
  deps: EpisodeSessionDeps,
  episodeId: string,
  s: Session = session,
): Promise<void> {
  if (s.episodeId !== episodeId && s.loaded) throw new EpisodeBusyError();
  const binding: EpisodeBinding = {
    episodeId,
    questions: await listQuestionsForPlay(deps.store, episodeId),
    participants: await toParticipants(deps, episodeId),
  };
  if (s.episodeId === episodeId) refreshEpisodeBinding(binding, s);
  else bindEpisode(binding, s);
}

/**
 * 当該アカウントが、進行セッションに載っている回の参加者として持つ `participantId` を返す。
 * 回が載っていない・その回へ参加していないなら `undefined`（解答は受け付けられない）。
 */
export async function resolveSessionParticipantId(
  deps: EpisodeSessionDeps,
  accountId: string,
  s: Session = session,
): Promise<string | undefined> {
  if (s.episodeId === null) return undefined;
  const participation = await findParticipation(deps.store, s.episodeId, accountId);
  return participation?.id;
}
