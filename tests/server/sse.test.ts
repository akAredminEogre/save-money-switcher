/**
 * SSE 接続レジストリ（`server/sse.ts`・案A）。
 *
 * 固定する契約:
 *   - 接続に載る身元は**サーバがセッションから決めた値**であり、解答面（answerer）の接続は
 *     ログイン必須ゆえ必ず身元を持つ。制御盤の「接続中のタブレット n / N」はその数を出す。
 *   - 観客面（audience）は未ログインでも購読でき身元を持たない（計上しない）。
 *   - 切断した接続は計上から外れる。
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ServerResponse } from "node:http";
import {
  addConnection,
  removeConnection,
  connectedTabletCount,
  setHostContextProvider,
} from "../../src/server/sse.js";

/** `write` だけを備えた最小の応答スタブ（レジストリは push でしか res に触らない）。 */
function fakeResponse(): ServerResponse {
  return { write: () => true } as unknown as ServerResponse;
}

const opened: number[] = [];

beforeEach(() => {
  for (const id of opened.splice(0)) removeConnection(id);
  // 制御盤断片の組み立てには起動時に main.ts が注入するコンテキストが要る（上限台数は 1 以上）。
  setHostContextProvider((connectedTablets) => ({
    joinUrl: "",
    joinQrSvg: "",
    maxTabletConnections: 4,
    connectedTablets,
  }));
});

function open(role: "host" | "answerer" | "audience", identity: string | null): number {
  const id = addConnection(fakeResponse(), role, identity);
  opened.push(id);
  return id;
}

describe("server/sse 接続レジストリと解答者接続数", () => {
  it("身元を持つ answerer 接続だけを計上する", () => {
    expect(connectedTabletCount()).toBe(0);
    open("answerer", "acc_child_1");
    open("answerer", "acc_child_2");
    expect(connectedTabletCount()).toBe(2);
  });

  it("観客（身元なし）と司会者の接続は解答者数に混ざらない", () => {
    open("audience", null);
    open("host", "acc_admin");
    expect(connectedTabletCount()).toBe(0);
  });

  it("身元の無い answerer 接続は計上しない（案A では発生し得ない状態を計上へ漏らさない）", () => {
    open("answerer", null);
    expect(connectedTabletCount()).toBe(0);
  });

  it("切断した接続は計上から外れる", () => {
    const id = open("answerer", "acc_child_1");
    expect(connectedTabletCount()).toBe(1);
    removeConnection(id);
    expect(connectedTabletCount()).toBe(0);
  });
});
