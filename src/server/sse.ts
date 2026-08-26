/**
 * SSE 接続レジストリと配信（`module:server`・cmd_2159 Phase1・要確認D）。
 *
 * transport は **Server-Sent Events**（`text/event-stream`・単方向 server→client）。realtime_sync の
 * event モデルと 1:1 で地続きであり、ws 依存を導入せず plain HTTP で WSL2 越えも素直に届く
 * （設計 c_live_update）。各コマンド適用後、レジストリの全接続に対し「そのロールのサーフェスを
 * 現在の session state から再構築 → HTML 断片を `data:` で push」する。ロール可視境界は
 * {@link fragmentFor}（host=制御盤 / answerer=自分のタブレット / audience=TV）で担保する。
 *
 * push は HTML をそのまま生データに載せず `data: <JSON>\n\n` で JSON 封筒化する（HTML 内の改行が
 * SSE のレコード境界と衝突しないため・QR SVG 等の複数行も安全）。クライアントは `JSON.parse` して
 * `html` を対象コンテナへ innerHTML swap する。
 */

import type { ServerResponse } from "node:http";
import type { Role } from "../realtime_sync/protocol.js";
import { session } from "./session.js";
import {
  buildControlPanelFragment,
  buildTabletFragment,
  buildTvFragment,
  type ControlPanelContext,
} from "./view_builders.js";

/** 制御盤ロール描画に要する config/QR 由来の解決済みコンテキストの供給関数（main.ts が注入）。 */
export type HostContextProvider = (connectedTablets: number) => ControlPanelContext;

let hostContextProvider: HostContextProvider | null = null;

/** 制御盤コンテキスト供給関数を登録する（起動時に main.ts が呼ぶ）。 */
export function setHostContextProvider(provider: HostContextProvider): void {
  hostContextProvider = provider;
}

interface Connection {
  readonly id: number;
  readonly res: ServerResponse;
  readonly role: Role;
  readonly participantId: string | null;
}

const connections = new Map<number, Connection>();
let connectionSeq = 0;

/** 現在の解答者（タブレット）接続数（参加確定済みの answerer 接続のみ計上）。 */
export function connectedTabletCount(): number {
  let count = 0;
  for (const conn of connections.values()) {
    if (conn.role === "answerer" && conn.participantId !== null) count += 1;
  }
  return count;
}

/** 当該接続のロールに応じたサーフェス断片を現在の session state から組み立てる。 */
function fragmentFor(conn: Connection): string {
  switch (conn.role) {
    case "host": {
      const ctx: ControlPanelContext =
        hostContextProvider !== null
          ? hostContextProvider(connectedTabletCount())
          : { joinUrl: "", joinQrSvg: "", maxTabletConnections: 0, connectedTablets: 0 };
      return buildControlPanelFragment(ctx);
    }
    case "answerer":
      return buildTabletFragment(conn.participantId);
    case "audience":
      return buildTvFragment();
  }
}

/** 1 接続へ HTML 断片を JSON 封筒で push する。 */
function push(conn: Connection, html: string): void {
  conn.res.write(`data: ${JSON.stringify({ type: "render", html })}\n\n`);
}

/**
 * 新規 SSE 接続を登録する。出題開始済み（実プレイ・`session.loaded`）の場合のみ初期描画を
 * 送り、未出題（起動直後・E2E の fresh server）では静的 GET chrome を温存する（progressive
 * enhancement で既存 E2E を壊さないための境界）。
 */
export function addConnection(res: ServerResponse, role: Role, participantId: string | null): number {
  connectionSeq += 1;
  const id = connectionSeq;
  const conn: Connection = { id, res, role, participantId };
  connections.set(id, conn);
  if (session.loaded) {
    push(conn, fragmentFor(conn));
  }
  return id;
}

/** 切断された接続をレジストリから外す。 */
export function removeConnection(id: number): void {
  connections.delete(id);
}

/** 全接続へ、各ロールの最新サーフェスを再構築して配信する（各コマンド適用後に呼ぶ）。 */
export function broadcast(): void {
  for (const conn of connections.values()) {
    try {
      push(conn, fragmentFor(conn));
    } catch {
      // 書込失敗（切断済み等）はレジストリから外して以降の配信対象にしない。
      connections.delete(conn.id);
    }
  }
}
