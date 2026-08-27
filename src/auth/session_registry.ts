/**
 * サーバ側セッションの発行・解決・破棄（`module:auth`・設計 D2）。
 *
 * セッションは **サーバのメモリ**に持ち、クライアントへは推測不能な識別子だけを Cookie で渡す
 * （`cookie.ts`）。ロールや口座 ID をクライアントへ持たせないため、Cookie を書き換えても
 * 権限は上がらない。プロセス再起動で失効してよい（失効時は再ログイン・設計 D2）。
 *
 * 発行するセッションは既存 {@link Session}（`participants/authorize.ts`）の形をそのまま満たす。
 * ゆえに `requireHost` / `authorizeTrigger` という既存の判定核をそのまま使え、認可判定を
 * 二重に作らない。
 */

import { randomBytes } from "node:crypto";
import type { Role, Session } from "../participants/authorize.js";

/** セッション識別子の乱数長（バイト）。128bit（設計 D2）。 */
export const SESSION_ID_BYTES = 16;

/** 発行済みセッション。{@link Session} を満たすため既存の認可判定へそのまま渡せる。 */
export interface AuthSession extends Session {
  /** セッション識別子（Cookie に載る値）。 */
  readonly sid: string;
  /** ログインしているアカウントの内部識別子。 */
  readonly accountId: string;
  /** 認可ロール（アカウントロールからの写像）。 */
  readonly role: Role;
  /** 発行時刻（ISO-8601）。 */
  readonly issuedAt: string;
}

/** セッション台帳。発行・解決・破棄のみを持つ。 */
export interface SessionRegistry {
  /** 新しいセッションを発行して返す。 */
  issue(accountId: string, role: Role): AuthSession;
  /** セッション識別子から解決する（無効・未知なら `undefined`）。 */
  get(sessionId: string | undefined): AuthSession | undefined;
  /** セッションを破棄する（存在しなくても失敗しない）。 */
  destroy(sessionId: string | undefined): void;
  /** 現在保持しているセッション数（監視・テスト用）。 */
  size(): number;
}

/** 採番・時刻の注入口（テストが決定的に固定できるようにする）。 */
export interface SessionRegistryDeps {
  readonly newSessionId?: () => string;
  readonly now?: () => string;
}

/** 推測不能なセッション識別子を採番する（128bit の乱数を 16 進で表す）。 */
export function newSessionId(): string {
  return randomBytes(SESSION_ID_BYTES).toString("hex");
}

/** in-memory なセッション台帳を生成する。 */
export function createSessionRegistry(deps: SessionRegistryDeps = {}): SessionRegistry {
  const issueId = deps.newSessionId ?? newSessionId;
  const now = deps.now ?? ((): string => new Date().toISOString());
  const sessions = new Map<string, AuthSession>();

  return {
    issue(accountId: string, role: Role): AuthSession {
      const sid = issueId();
      const session: AuthSession = { sid, accountId, role, issuedAt: now() };
      sessions.set(sid, session);
      return session;
    },
    get(sessionId: string | undefined): AuthSession | undefined {
      if (sessionId === undefined) return undefined;
      return sessions.get(sessionId);
    },
    destroy(sessionId: string | undefined): void {
      if (sessionId === undefined) return;
      sessions.delete(sessionId);
    },
    size(): number {
      return sessions.size;
    },
  };
}
