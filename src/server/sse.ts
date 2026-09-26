/**
 * SSE 接続レジストリと配信（`module:server`・cmd_2159 Phase1・要確認D）。
 *
 * transport は **Server-Sent Events**（`text/event-stream`・単方向 server→client）。realtime_sync の
 * event モデルと 1:1 で地続きであり、ws 依存を導入せず plain HTTP で WSL2 越えも素直に届く
 * （設計 c_live_update）。各コマンド適用後、レジストリの全接続に対し「そのロールのサーフェスを
 * 現在の session state から再構築 → HTML 断片を `data:` で push」する。ロール可視境界は
 * {@link fragmentFor}（host=制御盤 / contestant=自分のタブレット / audience=TV）で担保する。
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
  /**
   * 当該接続の身元。案A では**ログインセッションのアカウント ID**（`/tablet/answer` が
   * orchestrator へ渡す鍵と同一）。未ログインでも購読できる観客面（tv）だけが `null`。
   * エピソード参加者レコード（`episode_participants`）との突合は P2 の関心事ゆえ、P1 では
   * この ID が `session.participants` に見つからないのが正しい状態である。
   */
  readonly participantId: string | null;
}

const connections = new Map<number, Connection>();
let connectionSeq = 0;

/**
 * 現在の解答者（タブレット）接続数（身元の在る contestant 接続のみ計上）。案A では解答面の購読に
 * ログインが要る（`auth/surface_access.ts`）ゆえ、これは「ログイン済みで解答面を開いている
 * 接続の数」である。制御盤の「接続中のタブレット n / N」はこの値を出す。
 */
export function connectedTabletCount(): number {
  let count = 0;
  for (const conn of connections.values()) {
    if (conn.role === "contestant" && conn.participantId !== null) count += 1;
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
    case "contestant":
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
 * 新規 SSE 接続を登録し、現在のロール投影を即送信する。
 * これにより参加直後の tablet が初期残額（10,000円）を正確に表示し、
 * リロード後の host が最新の参加者ロスターを即座に受け取る。
 */
export function addConnection(res: ServerResponse, role: Role, participantId: string | null): number {
  connectionSeq += 1;
  const id = connectionSeq;
  const conn: Connection = { id, res, role, participantId };
  connections.set(id, conn);
  push(conn, fragmentFor(conn));
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
