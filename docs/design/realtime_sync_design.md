---
codd:
  node_id: design:realtime-sync-design
  type: design
  depends_on:
  - id: design:system-design
    relation: depends_on
    semantic: technical
  depended_by:
  - id: design:operational-behavior-model
    relation: depends_on
    semantic: technical
  - id: detailed_design:sequence-flows
    relation: depends_on
    semantic: technical
  - id: infra:deployment-setup
    relation: depends_on
    semantic: technical
  - id: test:test-strategy
    relation: depends_on
    semantic: verification
  conventions:
  - targets:
    - module:realtime_sync
    reason: クラウド経由の WebSocket 等でリアルタイム同期し、締切・開示・モード切替が全端末へ同期反映されること。ホスト PC をサーバにしない。違反時リリース不可。
  - targets:
    - module:config
    - module:participants
    reason: 接続上限判定は設定値を参照し、上限超過時は接続を断る挙動が設定変更に追随すること（論点10）。違反時リリース不可。
  - targets:
    - module:realtime_sync
    reason: 回線断は運用リスクとして扱い、切断・再接続時の状態整合（進行状態・回答保持）を設計で担保すること。違反時リリース不可。
  modules:
  - realtime_sync
  - game_flow
  - participants
  operation_flow:
    actors:
    - id: host
      label: 司会者（制御盤）
      surface: /control-panel
    - id: contestant
      label: 解答者（タブレット）
      surface: /tablet
    - id: audience
      label: 観客（TV）
      surface: /tv
    - id: system
      label: クラウドサーバ（realtime_sync WebSocket 権威）
    operations:
    - id: op_establish_connection
      actor: system
      verb: accept
      target: websocket_session
      trigger: 端末が公開 URL をブラウザで開き WebSocket 接続してロールを申告する
      route: /control-panel | /tv | /tablet | /join
      preconditions:
      - WebSocket 待受はクラウドサーバのみに存在する
      measurement_source: 接続時のロール申告と（contestant は）resume トークン
      durable_state: hub のロール別接続レジストリ（host/contestant/audience）
      readback: 接続直後にロール投影済み state_snapshot を unicast で返す
      expected_outcomes:
      - セッションにロール（host/contestant/audience）が確定する
      - 制御盤ブラウザは待受ソケットを持たず配信はクラウド権威から届く
      dod_obligations:
      - id: dod_conn_cloud_authority
        text: WebSocket の待受はクラウドサーバ側のみに存在し、制御盤ブラウザは待受ソケットを開かない
      - id: dod_conn_role_scoped_session
        text: 接続確立時にセッションのロールが確定し、以後の配信投影と権限判定がそのロールを単一判定点として参照する
    - id: op_enforce_connection_limit
      actor: system
      verb: reject
      target: tablet_connection
      trigger: contestant 接続数が MAX_TABLET_CONNECTIONS に達した状態での新規タブレット接続試行
      route: /join
      measurement_source: 現在の contestant 接続数と src/config の MAX_TABLET_CONNECTIONS 解決値
      threshold: MAX_TABLET_CONNECTIONS（既定 8）
      preconditions:
      - connected_contestants >= MAX_TABLET_CONNECTIONS
      durable_state: 既存接続・participants・answers・balances は不変
      expected_outcomes:
      - 上限超過のタブレット接続は connection_rejected とともに WS close(4001) で断られる
      - 既存の接続と保持データは影響を受けない
      - host/audience 接続はタブレット上限に数えない別チャネルとして扱う
      boundary_cases:
      - 既定 8: 8 台目は接続可・9 台目は拒否
      - 設定 16: 16 台目は接続可・17 台目は拒否
      - 設定 32: 32 台目は接続可・33 台目は拒否
      - 切断でスロット解放後は同数まで再受入可
      dod_obligations:
      - id: dod_limit_default_eight
        text: 設定未指定時に 8 台まで接続でき 9 台目が拒否される
      - id: dod_limit_config_follows
        text: MAX_TABLET_CONNECTIONS を 16/32 へ設定変更するとコード改修なしに上限がその値へ追随する
      - id: dod_limit_no_hardcode
        text: 上限判定は src/config の解決値を参照し、ソースに数値リテラル 8 のハードコードが存在しない
      - id: dod_limit_existing_unaffected
        text: 上限拒否の発生時に既存接続のセッション・回答・残額・進行状態が変化しない
    - id: op_broadcast_state_transition
      actor: system
      verb: broadcast
      target: connected_endpoints
      trigger: ドメインイベント（answers_locked/answers_opened/answer_revealed/settlement_computed/tv_mode_changed/balance_updated/participant_joined/trigger_undone）の確定
      measurement_source: game_state と balances の確定済み遷移
      durable_state: 各イベントに単調増加の seq を付与
      consumer_surfaces:
      - control_panel
      - tv_display
      - contestant_tablets
      readback: 遅参・再接続端末は state_snapshot で最新へ整合
      visible_to:
      - host
      - contestant
      - audience
      threshold: 状態遷移の全端末反映 p95 <= 2000ms（暫定ゲート・F-04）
      expected_outcomes:
      - 該当ロールの接続中全端末へロール投影済みイベントが配信される
      - 配信はロール投影を通し、可視範囲外の情報は当該ロールへ送られない
      dod_obligations:
      - id: dod_broadcast_all_role_endpoints
        text: 状態遷移イベントが当該ロールの接続中全端末へ配信される
      - id: dod_broadcast_role_projection
        text: 配信ペイロードはロール投影を経由し、解答者端末へ他者の解答・残額・得点が配信されない
      - id: dod_broadcast_latency_gate
        text: 状態遷移の全端末反映が p95 <= 2000ms を満たす
    - id: op_propagate_deadline
      actor: host
      verb: lock
      target: contestant_tablets
      trigger: 制御盤で「そこまで」を押下
      route: /control-panel
      forbidden_actors:
      - contestant
      - audience
      from_state: accepting
      to_state: answers_locked
      durable_state: game_state.stage = answers_locked
      consumer_surfaces:
      - contestant_tablets
      expected_outcomes:
      - answers_locked が接続中の全解答者タブレットへ配信され入力が同期ロックされる
      - 締切後のタブレットからの submit_answer はサーバで拒否される
      dod_obligations:
      - id: dod_deadline_host_only
        text: 締切コマンドは role host のみ発動でき contestant/audience からの締切コマンドは command_denied(403)
          で拒否される
      - id: dod_deadline_sync_lock
        text: 締切の配信で接続中の全解答者タブレットが締切表示へ同期し以後の送信が拒否される
    - id: op_propagate_disclosure
      actor: host
      verb: open
      target: tv_and_endpoints
      trigger: 制御盤で「解答オープン！」を押下
      route: /control-panel
      forbidden_actors:
      - contestant
      - audience
      from_state: answers_locked
      to_state: answers_opened
      durable_state: game_state.stage = answers_opened
      visible_to:
      - audience
      consumer_surfaces:
      - tv_mode_b
      expected_outcomes:
      - 開示前は他者の解答がどのロールの端末へも配信されない
      - 開示後 TV(b) へ全員の氏名と解答が一斉配信される
      dod_obligations:
      - id: dod_disclosure_hidden_before
        text: answers_opened 未配信の間は解答者・観客のいずれの端末へも他者の解答が配信されない
      - id: dod_disclosure_reveals_on_tv
        text: answers_opened の配信で TV(b) が全員の氏名と解答を表示する
    - id: op_propagate_mode_switch
      actor: host
      verb: switch
      target: tv_display
      trigger: 制御盤の「次へ」「戻る」または各モード個別ジャンプ
      route: /control-panel
      ui_pattern: next_back_jump
      forbidden_actors:
      - contestant
      - audience
      durable_state: game_state.tv_mode
      consumer_surfaces:
      - tv_mode_a
      - tv_mode_b
      - tv_mode_c
      - tv_mode_d
      - tv_mode_e
      expected_outcomes:
      - 3 系統いずれの操作でも tv_mode_changed が配信され接続中の TV が対応モードへ切り替わる
      dod_obligations:
      - id: dod_mode_switch_host_only
        text: モード切替は role host のみ発動でき contestant/audience からのモード切替は command_denied(403)
          で拒否される
      - id: dod_mode_switch_sync_tv
        text: 次へ・戻る・個別ジャンプの 3 系統いずれでも tv_mode_changed が配信され接続中の TV が対応モードへ切り替わる
    - id: op_recover_on_reconnect
      actor: system
      verb: recover
      target: reconnecting_endpoint
      trigger: 回線断後の端末が再接続し（contestant は resume トークンを添えて）resume する
      route: /control-panel | /tv | /tablet
      measurement_source: サーバ権威の game_state（current_question_number/stage/tv_mode）と
        balances と answers
      durable_state: 端末側は状態を保持せずサーバ権威から再構成する
      readback: ロール投影済み state_snapshot を返し以後の live 配信へ合流させる
      expected_outcomes:
      - 再接続端末が現在問題番号・進行段階・TV モードへ復帰する
      - 解答者は自分の残額と送信済み状態へ復帰し他者情報は復帰対象外
      - 復帰値の権威はサーバの game_state と balances でありクライアント保存値に依存しない
      boundary_cases:
      - 制御盤が落ちても TV/タブレット間の配信はクラウド権威で継続する
      - 無効・失効トークンの再接続は新規参加として扱い上限判定を再度通す
      dod_obligations:
      - id: dod_reconnect_progression
        text: 再接続端末が現在問題番号・進行段階・TV モードへ復帰する
      - id: dod_reconnect_own_balance
        text: 再接続した解答者が自分の残額と送信済み状態へ復帰し、他者の解答・残額は復帰対象に含まれない
      - id: dod_reconnect_server_authority
        text: 復帰値がサーバの game_state と balances から供給され、クライアント保存値に依存しない
      - id: dod_reconnect_control_panel_resilient
        text: 制御盤の切断中も TV とタブレットの同期がクラウド権威経由で継続する
    - id: op_preserve_answer_across_reconnect
      actor: system
      verb: preserve
      target: answer
      trigger: 受付中に送信済みの解答を持つ端末が切断・再接続する
      measurement_source: answers テーブル（question_id + participant_id の一意キー）
      preconditions:
      - 当該問の game_state.stage が accepting のとき submit は upsert される
      durable_state: answers（question_id + participant_id で一意）
      readback: 再接続後の state_snapshot が送信済み状態を反映する
      from_state: accepting
      to_state: accepting
      expected_outcomes:
      - 受付中に永続した解答が切断・再接続を跨いで保持される
      - 再接続後の再送で同一問・同一参加者の解答が重複永続化されない
      boundary_cases:
      - ack 前切断で resume 再送 → upsert により重複なく保持
      - 締切後の resume 再送 → 拒否されるが既存の永続解答は保持
      dod_obligations:
      - id: dod_answer_preserved_across_reconnect
        text: 受付中に送信済みの解答が接続断・再接続後も answers に保持され送信済み表示へ復帰する
      - id: dod_answer_no_duplicate
        text: 再接続後の再送で同一 question_id + participant_id の解答行が重複せず一意に保たれる
---

# リアルタイム同期設計（WebSocket・状態配信・接続管理）

## 1. Overview

本書は `save-money-switcher`（クラウド WEB アプリ版『賞金先渡しクイズ SAVE MONEY』家族用操作盤）における **`module:realtime_sync` の詳細設計**であり、上位の `design:system-design`（`docs/design/system_design.md`）を唯一の技術的親として、WebSocket による接続確立・**状態配信（fan-out）**・**接続管理（上限判定と切断／再接続時の状態整合）**を確定する。ここに記す 🟦 確定値・不変条件に反する成果物は**リリース不可（release-blocking）**として扱う。

### 1.1 本設計のスコープ

本書が権威をもつのは、システム設計 §2.1／§2.4／§2.7／§2.11 が `module:realtime_sync` に委ねた次の 3 領域である。

1. **クラウド WebSocket 権威と状態配信** — クラウド上に一意に存在する WebSocket サーバが、締切・開示・正解発表・得点精算・モード切替・再採点・参加・残額更新の各ドメインイベントを**接続中の全端末へリアルタイム反映**する。**ホスト PC をサーバにしない**（制御盤ブラウザは待受ソケットを持たない）。
2. **接続管理（上限判定）** — 同時接続上限を `src/config/` の設定値 `MAX_TABLET_CONNECTIONS`（既定 8）から解決し、上限超過のタブレット接続を断る。上限は設定変更で 16／32 へ**コード改修なしに追随**する（論点10）。
3. **切断・再接続時の状態整合** — 回線断を**運用リスク**として扱い、再接続端末を**サーバ権威の進行状態**へ復帰させ、**受付中に送信済みの回答を保持**する。

出題面フォールバックの詳細（`design:question-media-intake-design`）、スコア計算式そのもの（`design:scoring-engine-design`）、DB スキーマの物理設計（`design:data-model-design`）、参加登録 UI（`design:participation-connection-design`）は各兄弟設計に委ね、本書はそれらの**配信・接続・整合**の側面のみを確定する。

### 1.2 リリースブロッキング不変条件（本設計が具体化する制約）

| # | 対象 | 不変条件 | 本書での具体化箇所 |
|---|---|---|---|
| RS-INV-1 | `module:realtime_sync` | クラウド上の WebSocket 権威へ制御盤／TV／解答者端末を接続し、**締切・開示・モード切替が全端末へ同期反映**される。**ホスト PC をサーバにしない** | §2.1・§2.4・§2.5・§2.8・Operational Behavior Model |
| RS-INV-2 | `module:config` / `module:participants` | 接続上限判定は**設定値を参照**し、上限超過時は接続を断る挙動が**設定変更に追随**する（論点10） | §2.6・§2.9・OBM `op_enforce_connection_limit` |
| RS-INV-3 | `module:realtime_sync` | 回線断は運用リスクとして扱い、**切断・再接続時の状態整合（進行状態・回答保持）**を設計で担保する | §2.7・OBM `op_recover_on_reconnect`／`op_preserve_answer_across_reconnect` |
| RS-INV-4（継承） | `role:host` / `role:contestant` | 締切・開示・正解発表・取消・モード切替の発火は **`role: host` のみ**。非 host コマンドは拒否 | §2.5・§2.9・OBM 各 host 操作 |
| RS-INV-5（継承） | `module:tablet` / privacy | ロール投影により**解答者端末へ他者の解答・残額・得点を配信しない**（開示前は他者解答をどのロールへも送らない） | §2.5・§2.9 |
| RS-INV-6（継承） | `module:scoring` / `module:tv_display` | 残額配信は**円建て固定**（`point`/`pt`/`点` 禁止） | §2.5・§2.9 |

各不変条件は該当節で「本書がどう遵守するか」を明示する（下記本文）。

### 1.3 実装・ツールチェーン前提（scaffold 固定・釈義不可）

- **実装言語 = TypeScript のみ。** 本書のファイルパス（`src/realtime_sync/*.ts` 等）・モジュール構成・依存管理・ツールチェーン参照はすべて TypeScript 慣行のみを用い、他言語の拡張子・マニフェスト・ツールは例示・フォールバックとしても登場させない。WebSocket サーバ実装には Node 上の軽量ライブラリ **`ws`** を採り（§3.1）、クライアントはブラウザ標準の `WebSocket` API を用いる。
- **テストランナー = Vitest（固定・release-blocking のグラウンドトゥルース）。** verify が実際に走らせるのは Vitest であり、本書はこれを再解釈・上書きしない。本書の全テスト例は Vitest 自身の宣言 API（`import { describe, it, expect } from "vitest";`）で記述する。「ランタイム依存を最小化する」方針は**出荷コードのランタイム依存**（例: `ws` の採否）にのみ及び、テストランナーには及ばない。依存数の哲学を根拠に別フレームワークや Node 組み込み `node:test` を用いてはならない。
- **モジュール解決 = NodeNext/Node16。** すべての相対 import 指定子は**出力される `.js` ファイル名を明示した拡張子**を伴う（`import { x } from "./x.js"`。`"./x"`・`"./x.ts"` は不可）。re-export（`export { x } from "./x.js"`）・default/namespace import・type-only import（`import type { T } from "./x.js"`）も同一規約。拡張子欠落は TS2835 でコンパイル不能。
- **レイアウト契約（output-path fence 強制）。** ソースは**必ず `src/` 配下**、テストは**必ず `tests/` 配下**（`test/`・`spec/`・`specs/` を発明しない）。`package.json`・`package-lock.json`・`tsconfig.json`・`vitest.config.ts` は harness scaffold 所有につき、本書はこれらを成果物として出力・宣言しない。

### 1.4 アクター向けサーフェス／コピー義務（同期が駆動する可視状態）

`realtime_sync` は主にバックエンドだが、配信結果として各サーフェスの可視状態を駆動する。要件のロール（内部識別子 → 可視ラベル）: `role: host` → **司会者**、`role: contestant` → **解答者**、観客（TV 視聴者）。可視コピーには**可視ラベル**を用い、内部識別子（host/contestant）・内部イベント名（`answers_locked` 等）・設定キー名（`MAX_TABLET_CONNECTIONS`）・実装根拠・環境前提を露出させない。全サーフェス共通で `point`／`pt`／`点` を禁止し、金額は「円」で表す。

| サーフェス | ルート | 主対象 | 同期が駆動する可視状態 | 必須の可視コピー意図 | 禁止コピー／禁止ナビ |
|---|---|---|---|---|---|
| タブレット | `/tablet` | 解答者 | 受付中／締切の入力状態、送信済み表示、自分の残額（円）、再接続復帰 | 「受付中」「締切」「送信済み」「あなたの残額 ◯◯円」 | 他者の解答/残額/得点、司会者操作語、内部イベント名、`point`/`pt`/`点` |
| 参加受付 | `/join` | 解答者 | 上限到達時の参加拒否表示 | 「ただいま満席のため参加できません」等の解答者向け平易文 | 設定キー名・上限数値の内部表現・ロール識別子・保護された制御盤ナビの露出 |
| TV | `/tv` | 観客 | 配信されたモード（a〜e）に応じた表示のみ（受動） | a 出題面／b 氏名＋解答／c 正解値／d 6 列表（円表記）／e 全問通算 | 入力・操作要素、接続/復帰のデバッグ表示、`point`/`pt`/`点` |
| 制御盤 | `/control-panel` | 司会者 | 参加者一覧（参加/切断の反映）、接続数と上限の状況、配信結果のエコー | 司会者が接続状況を把握できる可視化（司会者は当該境界の管理者ゆえ「◯/◯台」表示可） | 内部 role 識別子ラベル、テスト/デモ/サンプル表記 |

**エントリ／事前認証サーフェス**（`/join`・未認証到達点）は、アクセス状態に整合しない保護ナビ（制御盤操作等）を露出しない。上限拒否コピーは job-to-be-done 言語（満席で参加不可）に限り、内部の接続数会計・設定キーを露出しない。

---

## 2. Architecture

### 2.1 WebSocket トポロジ（クラウド権威・RS-INV-1 の具体化）

```
                     ┌──────────────────── クラウド（常時稼働・唯一の WS 権威） ─────────────────────┐
                     │                                                                              │
 司会者 PC(制御盤)    │  ┌──────────────────────────────┐          ┌──────────────────────────┐    │
  /control-panel ◀──┼─▶│ src/realtime_sync/server.ts    │◀────────▶│ DB（サーバ権威の状態）   │    │
                     │  │   ws サーバ / upgrade / 認証    │          │ game_state / answers /   │    │
 TV(HDMI 拡張)       │  │ src/realtime_sync/hub.ts       │          │ balances / participants  │    │
  /tv          ◀────┼─▶│   ロール別接続レジストリ        │          └──────────────────────────┘    │
                     │  │ src/realtime_sync/fanout.ts    │                                            │
 解答者タブレット×N   │  │   ロール投影 / 配信            │  heartbeat.ts(ping/pong)  recovery.ts     │
  /tablet      ◀────┼─▶│ src/realtime_sync/protocol.ts  │  rejoin.ts(resume token)  (snapshot)      │
                     │  └──────────────────────────────┘                                            │
                     └──────────────────────────────────────────────────────────────────────────────┘
```

- **WebSocket 待受はクラウドサーバ側にのみ存在する。** 制御盤・TV・タブレットのブラウザはいずれも**クライアント接続**であり、`localhost` 待受・ホスト PC の AP 化・LAN 完結を含む構成は本設計に反しリリース不可（RS-INV-1）。制御盤ブラウザは配信の発生源ではなく、`host` コマンドを送る一クライアントに過ぎない。
- **単一権威の帰結（AC-03）**: 制御盤が落ちても、TV とタブレット間の同期はクラウドサーバ経由で継続する。状態はサーバ側 `game_state`／`balances`／`answers` に持ち、クライアント切断は権威に影響しない。
- HTTP 面は健全性ベースライン **`< 500`（5xx を出さない）** を満たし、`/healthz` を提供する。WS 昇格は同一オリジンのアップグレード経路で受ける（§2.11）。

**RS-INV-1 遵守の言明**: WS 権威をクラウドの `src/realtime_sync/server.ts` に一意化し、制御盤ブラウザに待受ソケットを持たせない構造を §2.1・§2.4・§2.5 で固定する。`dod_conn_cloud_authority` がこれを機械可検に固定する。

### 2.2 モジュール構成とソース配置（`src/` 配下・snake_case）

| ファイル | 責務 |
|---|---|
| `src/realtime_sync/server.ts` | `ws` サーバ起動・HTTP アップグレード受理・接続時ロール確定・admission 呼出 |
| `src/realtime_sync/hub.ts` | ロール別（host/contestant/audience）接続レジストリ・接続/切断の会計・配信の起点 |
| `src/realtime_sync/fanout.ts` | ロール投影（`projectForRole`）・可視範囲フィルタ・イベント配信 |
| `src/realtime_sync/protocol.ts` | メッセージ封筒（型）・コマンド種別・ドメインイベント種別・close コード |
| `src/realtime_sync/recovery.ts` | サーバ権威から `state_snapshot` を構築（`buildSnapshot`） |
| `src/realtime_sync/heartbeat.ts` | ping/pong・無応答検知・切断確定・接続スロット解放 |
| `src/realtime_sync/rejoin.ts` | 参加時 resume トークン発行・再接続時の participant 再バインド |
| `src/config/connection_limit.ts` | `MAX_TABLET_CONNECTIONS` の単一解決点（`resolveMaxTabletConnections`） |
| `src/participants/admission.ts` | 上限判定の純関数（`admitTablet`）— 現接続数と上限から受入可否を返す |

相対 import は全ファイルで `.js` 拡張子を明示する。例:

```typescript
// src/realtime_sync/server.ts
import { WebSocketServer } from "ws";
import type { Role, ServerEvent } from "./protocol.js";
import { registerConnection } from "./hub.js";
import { resolveMaxTabletConnections } from "../config/connection_limit.js";
import { admitTablet } from "../participants/admission.js";
export { startRealtimeServer } from "./server_bootstrap.js";
```

### 2.3 メッセージプロトコル（`src/realtime_sync/protocol.ts`）

全メッセージは JSON 封筒で表す。サーバ→クライアントのイベントには**単調増加の `seq`** を付与し、順序保証・重複検知・再接続後の整合に用いる。

```typescript
// src/realtime_sync/protocol.ts
export type Role = "host" | "contestant" | "audience";
export type GameStage =
  | "accepting" | "answers_locked" | "answers_opened"
  | "answer_revealed" | "settlement_computed";
export type TvMode = "a" | "b" | "c" | "d" | "e";

export type DomainEventType =
  | "answers_locked" | "answers_opened" | "answer_revealed"
  | "settlement_computed" | "trigger_undone" | "tv_mode_changed"
  | "participant_joined" | "balance_updated";

export interface ServerEvent<T = unknown> {
  type: DomainEventType | "state_snapshot" | "connection_rejected"
      | "command_denied" | "submit_ack";
  seq: number;             // セッション単位で単調増加
  stage?: GameStage;
  questionNumber?: number;
  tvMode?: TvMode;
  currency?: "円";         // 金額を含むイベントは円建て固定（RS-INV-6）
  payload: T;
  ts: number;              // サーバ時刻(ms)
}

export const CLOSE_OVER_LIMIT = 4001;   // 上限超過での接続拒否
```

**クライアント → サーバ（コマンド）と許可ロール**

| コマンド | 許可ロール | 効果（配信されるイベント） |
|---|---|---|
| `join` | contestant（参加前） | `participants` へ 1 レコード生成・resume トークン発行 → `participant_joined` |
| `resume` | 任意（トークン提示） | 既存 participant へ再バインド → `state_snapshot`（unicast） |
| `submit_answer` | contestant | 受付中のみ `answers` へ upsert → `submit_ack`（unicast）／`balance_updated` は精算時 |
| `lock` | **host のみ** | `stage=answers_locked` → `answers_locked` を全端末へ |
| `open` | **host のみ** | `stage=answers_opened` → `answers_opened`（TV b） |
| `reveal` | **host のみ** | `stage=answer_revealed` → `answer_revealed`（TV c） |
| `settle` | **host のみ** | `balances` 更新 → `settlement_computed`／`balance_updated`（TV d/e・各自の残額） |
| `undo` | **host のみ** | `trigger_undone` |
| `switch_mode` | **host のみ** | `game_state.tv_mode` 更新 → `tv_mode_changed`（TV） |
| `live_edit` | **host のみ** | `questions` 更新。開示済み(c 以降)なら再採点 → `balance_updated` |

非 host が host コマンドを送った場合、サーバは接続を閉じず `command_denied`（HTTP 意味論の **403**／未認証は **401**）を unicast で返す（§2.9・RS-INV-4）。

### 2.4 状態配信モデル（fan-out・RS-INV-1）

- **配信の起点は `hub.ts`。** `host` コマンドが検証・適用され `game_state`／`balances` の遷移が確定した時点、または `system` 主導のイベント（再採点・接続上限拒否など）が確定した時点で、`hub` が該当ドメインイベントを生成し、`fanout.projectForRole` を通して**ロール別に投影**したうえで該当ロールの全接続へ push する。
- **リアルタイム反映（AC-02）**: `answers_locked`／`answers_opened`／`answer_revealed`／`settlement_computed`／`tv_mode_changed`／`balance_updated`／`participant_joined`／`trigger_undone` は、接続中の該当ロール全端末へ配信される。締切は全解答者タブレットへ、開示・正解・精算・モード切替は TV へ、参加・残額は制御盤／TV／該当解答者へ、それぞれ投影して届く。
- **スケーラビリティ選定軸（RS-INV-2）**: `ws` によるロール別レジストリと投影配信は、既定 8 台に最適化しつつ `MAX_TABLET_CONNECTIONS` を 16／32 へ設定変更しても破綻しない（32 台程度の同時接続で全端末反映が継続する）ことを選定軸に含める。
- **同期反映の測定ゲート**: 状態遷移の全端末反映を **p95 ≤ 2,000ms** のテストゲートに設定する。設計に固定 SLA が無いため本値は暫定ゲートであり、SLA 確定時に更新する（F-04・§3.3）。

### 2.5 ロール投影と可視境界（`fanout.ts`・RS-INV-4/5/6）

配信は必ず `projectForRole` を経由し、**ロールごとに可視範囲を絞ったペイロードのみ**を送る。これはプライバシーとネタバレ防止を**トランスポート層で強制**する設計である。

| ロール | 受信する状態 | 受信しない状態 |
|---|---|---|
| `host`（制御盤） | 全進行状態・参加者一覧・全員の解答/残額・接続数と上限 | — |
| `audience`（TV） | 現在の `tv_mode` に応じた表示（a〜e）。b 以降のみ氏名＋解答、d/e で円建ての残額表 | 開示前(b 未実行)の他者解答 |
| `contestant`（タブレット） | 現在問題番号・`accepting/answers_locked` 状態・自分の `submit_ack`・**自分の残額（円）**のみ | **他者の解答・残額・得点、出題内容、全体一覧**（一切投影しない） |

```typescript
// src/realtime_sync/fanout.ts（抜粋・型はイメージ）
export function projectForRole(
  event: ServerEvent,
  ctx: { role: Role; participantId?: string; disclosed: boolean },
): ServerEvent | null {
  if (ctx.role === "contestant") {
    // 解答者へは自分に関する情報のみ。他者解答・他者残額は常に投影外。
    if (event.type === "answers_opened" || event.type === "answer_revealed") return null;
    if (event.type === "balance_updated") return projectOwnBalance(event, ctx.participantId);
    // ...
  }
  if (ctx.role === "audience" && !ctx.disclosed) {
    if (revealsOthersAnswers(event)) return null; // 開示前の他者解答は送らない
  }
  return event; // host は全量
}
```

- **RS-INV-4 遵守**: `host` コマンドの適用前に `hub` がセッションのロール属性を単一判定点として検査し、非 host には `command_denied` を返す（`dod_deadline_host_only`／`dod_mode_switch_host_only`／取消は継承の `dod_undo_host_only`）。
- **RS-INV-5 遵守**: `projectForRole` が解答者への他者情報投影を構造的に禁じる（`dod_broadcast_role_projection`／`dod_disclosure_hidden_before`）。
- **RS-INV-6 遵守**: 残額を含むイベント（`settlement_computed`／`balance_updated`）は `currency: "円"` を保持し、`point`/`pt`/`点` の語を封筒・表示のいずれにも含めない（`dod_settle_currency_yen` 継承）。

なお 0〜100 整数の二重防衛（`op_submit_answer`）は `src/tablet/`（UI）と `src/scoring/validate_answer.ts`（サーバ）の責務であり、`realtime_sync` は `submit_answer` を受理する前に**サーバ側バリデーションを通過した値のみ** `answers` へ渡す。範囲外値は `submit_ack` を返さず拒否する（境界: 0=可／100=可／−1・101・50.5=不可）。

### 2.6 接続管理・同時接続上限（`admission.ts` / `connection_limit.ts`・RS-INV-2）

- **上限の単一解決点**: `MAX_TABLET_CONNECTIONS` は `src/config/connection_limit.ts` の `resolveMaxTabletConnections()` のみが解決する。既定は **8**（未設定時のフォールバックであり、判定コードに数値リテラル `8` を埋め込まない）。設定機構は環境変数を既定とする（§3.1）。
- **上限の対象**: 上限は **contestant（タブレット）接続**に対して課す。`host`（制御盤）・`audience`（TV）は別チャネルとして受け、タブレット上限には数えない。
- **admission 判定**: `src/participants/admission.ts` の `admitTablet({ limit, connected }, { name })` が純関数として受入可否を返す。`server.ts` は接続受理時に現在の contestant 接続数 `connected` と `limit` を渡し、`ok=false` なら `connection_rejected` を unicast して WS を `CLOSE_OVER_LIMIT(4001)` で閉じる。既存接続・`participants`・`answers`・`balances` は不変（`dod_limit_existing_unaffected`）。
- **設定追随（改修不要）**: `limit` を毎回 `resolveMaxTabletConnections()` から取り直すため、`MAX_TABLET_CONNECTIONS=16/32` へ変えると判定が即追随する（`dod_limit_config_follows`）。
- **スロット会計と切断解放**: `heartbeat.ts` が無応答を検知して切断を確定した時点で contestant スロットを 1 解放する。これにより上限会計が実接続と一致する（切断後は同数まで再受入可＝境界ケース）。

**RS-INV-2 遵守の言明**: 上限判定を設定値参照に一元化し（`dod_limit_no_hardcode`）、既定 8／設定 16／32 の各境界で 8/9・16/17・32/33 台目の可否を機械可検に固定する（§2.10 のテスト）。

`/join` の拒否表示は job-to-be-done 言語（「ただいま満席のため参加できません」）に限り、設定キー名や内部会計を露出しない（§1.4）。

### 2.7 切断・再接続と状態整合（`recovery.ts` / `rejoin.ts` / `heartbeat.ts`・RS-INV-3）

回線断は**運用リスク**であり（当日インターネット接続前提・バックアップ回線／テザリングで運用側担保）、オフライン完結やホスト PC のサーバ化で吸収してはならない（RS-INV-1）。コードは当日接続前提で、切断→再接続の**状態整合**を担保する。

- **切断検知**: `heartbeat.ts` が **15 秒間隔で ping**、**30 秒 pong 無し**で切断確定。切断確定で `hub` から当該接続を除去し、contestant ならスロットを解放する。`participants` 行と resume トークンは残す（identity は生存）。
- **再接続と権威復帰（AC-04）**: 端末が再接続すると `resume`（contestant は participant にひも付く**不透明 resume トークン**を添える）を送る。`recovery.buildSnapshot` が**サーバ権威**の `game_state`（`current_question_number`／`stage`／`tv_mode`）・`balances`・`answers` から**ロール投影済み `state_snapshot`** を構築して unicast する。クライアントは自身の保存値を破棄してスナップショットで再描画し、以後の live 配信に合流する。復帰値はサーバ権威が唯一の出典であり、クライアント保存値に依存しない（`dod_reconnect_server_authority`）。
  - 解答者は**現在問題番号・進行段階・TV モード連動**と**自分の残額・送信済み状態**へ復帰する。**他者情報は復帰対象外**（投影で除外）。
  - 無効・失効トークンの再接続は新規参加として扱い、上限判定（§2.6）を再度通す。
- **回答保持（`op_preserve_answer_across_reconnect`）**: `submit_answer` は受付中に `answers` へ **`question_id + participant_id` 一意キーで upsert** し、`submit_ack` の前に永続化する。ゆえに ack 後切断は解答を失わない。ack 前切断で resume 後に再送しても、upsert により**重複行を作らず**同一に保たれる（`dod_answer_no_duplicate`）。締切後の再送はサーバで拒否されるが、既に永続した解答は保持される。再接続後の `state_snapshot` は送信済み状態を反映する（`dod_answer_preserved_across_reconnect`）。
- **制御盤切断の耐性（AC-03）**: host が切断中でも TV／タブレット間の配信はクラウド権威で継続する。host 再接続時は全量スナップショットで復帰する（`dod_reconnect_control_panel_resilient`）。

**RS-INV-3 遵守の言明**: 進行状態の復帰権威をサーバ側 `game_state`／`balances` に、回答保持を `answers` の一意 upsert に固定し、`op_recover_on_reconnect`／`op_preserve_answer_across_reconnect` の各 `dod_obligations` で機械可検化する。

### 2.8 締切・開示・モード切替の全端末反映（RS-INV-1）

| host 操作 | 遷移 | 配信イベント | 到達サーフェス | 同期挙動 |
|---|---|---|---|---|
| 「そこまで」`lock` | `accepting → answers_locked` | `answers_locked` | 全解答者タブレット | 入力が同期ロックされ、以後の `submit_answer` は拒否 |
| 「解答オープン！」`open` | `answers_locked → answers_opened` | `answers_opened` | TV(b) | 開示前は他者解答をどのロールへも送らず、開示で TV に氏名＋解答を一斉表示 |
| 正解発表 `reveal` | `answers_opened → answer_revealed` | `answer_revealed` | TV(c) | 当該問を開示済み(c 以降)として記録。以後の正解ライブ編集は自動再採点対象 |
| 得点精算 `settle` | `answer_revealed → settlement_computed` | `settlement_computed`／`balance_updated` | TV(d/e)・各自 | 円建ての残額表を TV d/e へ、各解答者へ自分の残額を投影配信 |
| 「次へ／戻る／個別ジャンプ」`switch_mode` | `tv_mode` 更新 | `tv_mode_changed` | TV(a〜e) | 3 系統いずれでも TV の表示モードが対応値へ切替 |
| 取消 `undo` | `trigger_undone` | `trigger_undone` | 該当サーフェス | 直近の対象操作を取り消す（挙動詳細は §3.2） |

自動再採点（継承 `op_auto_rescore`）は `system` 主導イベントとして、開示済み(c 以降)の正解ライブ編集で `balance_updated` を配信し、d 到達問では残額差分を TV d/e へ同時更新する。c 未到達の正解編集では再採点イベントを配信しない（境界外）。

### 2.9 セキュリティ・アクセス制御・プライバシー（トランスポート層）

- **権限境界（RS-INV-4）**: `lock/open/reveal/settle/undo/switch_mode/live_edit` は `role: host` セッションのみ許可。`hub` がロール属性を単一判定点として検査し、非 host には `command_denied`（403／未認証 401）を返す。非 host UI に該当操作要素を置かない。
- **家族限定アクセス制御（継承 INV-4・分岐保持）**: WS 昇格前の到達点は分岐 A（URL 秘匿）／分岐 B（認証）のいずれかで抑制する（§3.1）。**無制御公開はリリース不可**。いずれの分岐でも上限判定（§2.6 の単一解決点）と `role: host` チェックを必ず経由する。分岐 B 導入時はログイン→正しいリダイレクト→期待コンテンツ描画のフローを備える。
- **プライバシー（RS-INV-5）**: `projectForRole` により解答者端末へ他者情報を配信しない。収集する個人データは解答者が自己入力した氏名と当日の解答・残額に限り、恒久的な事前氏名台帳を持たない。resume トークンは participant にひも付く不透明値で、他者データへのアクセス権を含まない。
- **配信ペイロード最小化**: 各ロールへ可視範囲外のフィールドを含めない（投影で除去）ため、クライアント側改竄によっても他者情報を得られない。

### 2.10 テスト戦略との整合（Vitest / レイアウト / モジュール指定子）

- テストは**すべて `tests/` 配下**、ソースは**すべて `src/` 配下**。`package.json`・`package-lock.json`・`tsconfig.json`・`vitest.config.ts` は harness 所有につき著さない。
- ユニット: `tests/realtime_sync/admission.test.ts`・`tests/realtime_sync/fanout.test.ts`・`tests/realtime_sync/recovery.test.ts`・`tests/realtime_sync/protocol.test.ts`。
- E2E: API/WS 統合 `tests/e2e/realtime_sync.spec.ts`（複数 WS クライアントで多端末反映を検証）、ブラウザ `tests/e2e/realtime_sync.browser.spec.ts`（Playwright を**ライブラリ import** で駆動、宣言・検証は Vitest）。共有ヘルパは `tests/e2e/helpers/`（`.js` 参照）。

接続上限の受け入れ（`src/config/` の解決値を参照し設定に追随することを固定）:

```typescript
// tests/realtime_sync/admission.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { resolveMaxTabletConnections } from "../../src/config/connection_limit.js";
import { admitTablet } from "../../src/participants/admission.js";

describe("同時接続上限は設定値を参照し追随する", () => {
  afterEach(() => { delete process.env.MAX_TABLET_CONNECTIONS; });

  it("未設定時の既定 8：8 台目は許可・9 台目は拒否", () => {
    const limit = resolveMaxTabletConnections();
    expect(limit).toBe(8);
    expect(admitTablet({ limit, connected: 7 }, { name: "8人目" }).ok).toBe(true);
    expect(admitTablet({ limit, connected: 8 }, { name: "9人目" }).ok).toBe(false);
  });

  it("設定 32 を非改修で反映：32 台目は許可・33 台目は拒否", () => {
    process.env.MAX_TABLET_CONNECTIONS = "32";
    const limit = resolveMaxTabletConnections();
    expect(admitTablet({ limit, connected: 31 }, { name: "32人目" }).ok).toBe(true);
    expect(admitTablet({ limit, connected: 32 }, { name: "33人目" }).ok).toBe(false);
  });
});
```

ロール投影（解答者へ他者情報を配信しないこと・開示前の他者解答を伏せること）:

```typescript
// tests/realtime_sync/fanout.test.ts
import { describe, it, expect } from "vitest";
import { projectForRole } from "../../src/realtime_sync/fanout.js";

describe("ロール投影による可視境界", () => {
  it("開示前は観客へ他者の解答を配信しない", () => {
    const ev = {
      type: "answers_opened", seq: 1, ts: 0,
      payload: { answers: [{ name: "太郎", value: 40 }] },
    } as const;
    expect(projectForRole(ev, { role: "audience", disclosed: false })).toBeNull();
  });

  it("解答者へは他者の残額を投影しない（自分の残額のみ）", () => {
    const ev = {
      type: "balance_updated", seq: 2, ts: 0, currency: "円",
      payload: { balances: { p1: 9500, p2: 10000 } },
    } as const;
    const p = projectForRole(ev, { role: "contestant", participantId: "p1", disclosed: true });
    expect(p?.payload).toEqual({ balance: 9500, currency: "円" });
    expect(JSON.stringify(p)).not.toContain("p2");
  });
});
```

再接続復帰（サーバ権威からの進行状態・自分の残額の復元・他者情報の除外）:

```typescript
// tests/realtime_sync/recovery.test.ts
import { describe, it, expect } from "vitest";
import { buildSnapshot } from "../../src/realtime_sync/recovery.js";

describe("再接続時の状態整合", () => {
  it("解答者はサーバ権威の進行状態と自分の残額・送信済みへ復帰する", () => {
    const snap = buildSnapshot(
      { currentQuestionNumber: 3, stage: "answers_locked", tvMode: "a" },
      { role: "contestant", participantId: "p1", disclosed: false },
      { balances: { p1: 9500, p2: 10000 }, submitted: { p1: true } },
    );
    expect(snap.currentQuestionNumber).toBe(3);
    expect(snap.stage).toBe("answers_locked");
    expect(snap.tvMode).toBe("a");
    expect(snap.ownBalance).toBe(9500);
    expect(snap.ownSubmitted).toBe(true);
    expect((snap as Record<string, unknown>).participants).toBeUndefined();
    expect(JSON.stringify(snap)).not.toContain("p2");
  });
});
```

Vitest 以外（`node:test` 等）をランナーに用いない。ランタイム依存最小化の方針はテストランナーに及ばない。

### 2.11 非機能要件（性能・可用性・観測）

- **健全性ベースライン**: 全 HTTP 応答は **`< 500`**。WS 昇格失敗も 5xx を出さず、上限拒否は `connection_rejected` ＋ close `4001` で表す。
- **同期反映**: 状態遷移の全端末反映は **p95 ≤ 2,000ms**（暫定テストゲート・F-04）。
- **接続数**: 既定 8、設定で 16／32 まで（RS-INV-2）。切断検知は ping 15 秒／pong 猶予 30 秒。
- **可用性前提**: 当日インターネット接続を前提とし、回線断は運用リスクとして扱う。ホスト PC のサーバ化による耐障害策は禁止（RS-INV-1）。
- **起動シーケンス（検証環境）**: `npm ci` → `npm run build` → `npm run start`（クラウド WEB アプリ＋WebSocket ゆえサーバ常駐必須）。`/healthz` が `< 500` を返すまで**最大 60 秒**ポーリングしてから試験開始。`E2E_BASE_URL` にクラウド公開 URL（WS 昇格可能なオリジン）を注入。

### Operational Behavior Model

以下の単一 YAML ブロックが、`module:realtime_sync` の運用挙動について実装計画と E2E 生成が共有する権威的出典である。要件・上位設計に無い挙動は発明せず、未確定は `boundary_cases` または §3 のフラグへ回す。

```yaml
operation_flow:
  actors:
    - id: host
      label: 司会者（制御盤）
      surface: /control-panel
    - id: contestant
      label: 解答者（タブレット）
      surface: /tablet
    - id: audience
      label: 観客（TV）
      surface: /tv
    - id: system
      label: クラウドサーバ（realtime_sync WebSocket 権威）
  operations:
    - id: op_establish_connection
      actor: system
      verb: accept
      target: websocket_session
      trigger: 端末が公開 URL をブラウザで開き WebSocket 接続してロールを申告する
      route: /control-panel | /tv | /tablet | /join
      preconditions:
        - WebSocket 待受はクラウドサーバのみに存在する
      measurement_source: 接続時のロール申告と（contestant は）resume トークン
      durable_state: hub のロール別接続レジストリ（host/contestant/audience）
      readback: 接続直後にロール投影済み state_snapshot を unicast で返す
      expected_outcomes:
        - セッションにロール（host/contestant/audience）が確定する
        - 制御盤ブラウザは待受ソケットを持たず配信はクラウド権威から届く
      dod_obligations:
        - id: dod_conn_cloud_authority
          text: WebSocket の待受はクラウドサーバ側のみに存在し、制御盤ブラウザは待受ソケットを開かない
        - id: dod_conn_role_scoped_session
          text: 接続確立時にセッションのロールが確定し、以後の配信投影と権限判定がそのロールを単一判定点として参照する
    - id: op_enforce_connection_limit
      actor: system
      verb: reject
      target: tablet_connection
      trigger: contestant 接続数が MAX_TABLET_CONNECTIONS に達した状態での新規タブレット接続試行
      route: /join
      measurement_source: 現在の contestant 接続数と src/config の MAX_TABLET_CONNECTIONS 解決値
      threshold: MAX_TABLET_CONNECTIONS（既定 8）
      preconditions:
        - connected_contestants >= MAX_TABLET_CONNECTIONS
      durable_state: 既存接続・participants・answers・balances は不変
      expected_outcomes:
        - 上限超過のタブレット接続は connection_rejected とともに WS close(4001) で断られる
        - 既存の接続と保持データは影響を受けない
        - host/audience 接続はタブレット上限に数えない別チャネルとして扱う
      boundary_cases:
        - 既定 8: 8 台目は接続可・9 台目は拒否
        - 設定 16: 16 台目は接続可・17 台目は拒否
        - 設定 32: 32 台目は接続可・33 台目は拒否
        - 切断でスロット解放後は同数まで再受入可
      dod_obligations:
        - id: dod_limit_default_eight
          text: 設定未指定時に 8 台まで接続でき 9 台目が拒否される
        - id: dod_limit_config_follows
          text: MAX_TABLET_CONNECTIONS を 16/32 へ設定変更するとコード改修なしに上限がその値へ追随する
        - id: dod_limit_no_hardcode
          text: 上限判定は src/config の解決値を参照し、ソースに数値リテラル 8 のハードコードが存在しない
        - id: dod_limit_existing_unaffected
          text: 上限拒否の発生時に既存接続のセッション・回答・残額・進行状態が変化しない
    - id: op_broadcast_state_transition
      actor: system
      verb: broadcast
      target: connected_endpoints
      trigger: ドメインイベント（answers_locked/answers_opened/answer_revealed/settlement_computed/tv_mode_changed/balance_updated/participant_joined/trigger_undone）の確定
      measurement_source: game_state と balances の確定済み遷移
      durable_state: 各イベントに単調増加の seq を付与
      consumer_surfaces: [control_panel, tv_display, contestant_tablets]
      readback: 遅参・再接続端末は state_snapshot で最新へ整合
      visible_to: [host, contestant, audience]
      threshold: 状態遷移の全端末反映 p95 <= 2000ms（暫定ゲート・F-04）
      expected_outcomes:
        - 該当ロールの接続中全端末へロール投影済みイベントが配信される
        - 配信はロール投影を通し、可視範囲外の情報は当該ロールへ送られない
      dod_obligations:
        - id: dod_broadcast_all_role_endpoints
          text: 状態遷移イベントが当該ロールの接続中全端末へ配信される
        - id: dod_broadcast_role_projection
          text: 配信ペイロードはロール投影を経由し、解答者端末へ他者の解答・残額・得点が配信されない
        - id: dod_broadcast_latency_gate
          text: 状態遷移の全端末反映が p95 <= 2000ms を満たす
    - id: op_propagate_deadline
      actor: host
      verb: lock
      target: contestant_tablets
      trigger: 制御盤で「そこまで」を押下
      route: /control-panel
      forbidden_actors: [contestant, audience]
      from_state: accepting
      to_state: answers_locked
      durable_state: game_state.stage = answers_locked
      consumer_surfaces: [contestant_tablets]
      expected_outcomes:
        - answers_locked が接続中の全解答者タブレットへ配信され入力が同期ロックされる
        - 締切後のタブレットからの submit_answer はサーバで拒否される
      dod_obligations:
        - id: dod_deadline_host_only
          text: 締切コマンドは role host のみ発動でき contestant/audience からの締切コマンドは command_denied(403) で拒否される
        - id: dod_deadline_sync_lock
          text: 締切の配信で接続中の全解答者タブレットが締切表示へ同期し以後の送信が拒否される
    - id: op_propagate_disclosure
      actor: host
      verb: open
      target: tv_and_endpoints
      trigger: 制御盤で「解答オープン！」を押下
      route: /control-panel
      forbidden_actors: [contestant, audience]
      from_state: answers_locked
      to_state: answers_opened
      durable_state: game_state.stage = answers_opened
      visible_to: [audience]
      consumer_surfaces: [tv_mode_b]
      expected_outcomes:
        - 開示前は他者の解答がどのロールの端末へも配信されない
        - 開示後 TV(b) へ全員の氏名と解答が一斉配信される
      dod_obligations:
        - id: dod_disclosure_hidden_before
          text: answers_opened 未配信の間は解答者・観客のいずれの端末へも他者の解答が配信されない
        - id: dod_disclosure_reveals_on_tv
          text: answers_opened の配信で TV(b) が全員の氏名と解答を表示する
    - id: op_propagate_mode_switch
      actor: host
      verb: switch
      target: tv_display
      trigger: 制御盤の「次へ」「戻る」または各モード個別ジャンプ
      route: /control-panel
      ui_pattern: next_back_jump
      forbidden_actors: [contestant, audience]
      durable_state: game_state.tv_mode
      consumer_surfaces: [tv_mode_a, tv_mode_b, tv_mode_c, tv_mode_d, tv_mode_e]
      expected_outcomes:
        - 3 系統いずれの操作でも tv_mode_changed が配信され接続中の TV が対応モードへ切り替わる
      dod_obligations:
        - id: dod_mode_switch_host_only
          text: モード切替は role host のみ発動でき contestant/audience からのモード切替は command_denied(403) で拒否される
        - id: dod_mode_switch_sync_tv
          text: 次へ・戻る・個別ジャンプの 3 系統いずれでも tv_mode_changed が配信され接続中の TV が対応モードへ切り替わる
    - id: op_recover_on_reconnect
      actor: system
      verb: recover
      target: reconnecting_endpoint
      trigger: 回線断後の端末が再接続し（contestant は resume トークンを添えて）resume する
      route: /control-panel | /tv | /tablet
      measurement_source: サーバ権威の game_state（current_question_number/stage/tv_mode）と balances と answers
      durable_state: 端末側は状態を保持せずサーバ権威から再構成する
      readback: ロール投影済み state_snapshot を返し以後の live 配信へ合流させる
      expected_outcomes:
        - 再接続端末が現在問題番号・進行段階・TV モードへ復帰する
        - 解答者は自分の残額と送信済み状態へ復帰し他者情報は復帰対象外
        - 復帰値の権威はサーバの game_state と balances でありクライアント保存値に依存しない
      boundary_cases:
        - 制御盤が落ちても TV/タブレット間の配信はクラウド権威で継続する
        - 無効・失効トークンの再接続は新規参加として扱い上限判定を再度通す
      dod_obligations:
        - id: dod_reconnect_progression
          text: 再接続端末が現在問題番号・進行段階・TV モードへ復帰する
        - id: dod_reconnect_own_balance
          text: 再接続した解答者が自分の残額と送信済み状態へ復帰し、他者の解答・残額は復帰対象に含まれない
        - id: dod_reconnect_server_authority
          text: 復帰値がサーバの game_state と balances から供給され、クライアント保存値に依存しない
        - id: dod_reconnect_control_panel_resilient
          text: 制御盤の切断中も TV とタブレットの同期がクラウド権威経由で継続する
    - id: op_preserve_answer_across_reconnect
      actor: system
      verb: preserve
      target: answer
      trigger: 受付中に送信済みの解答を持つ端末が切断・再接続する
      measurement_source: answers テーブル（question_id + participant_id の一意キー）
      preconditions:
        - 当該問の game_state.stage が accepting のとき submit は upsert される
      durable_state: answers（question_id + participant_id で一意）
      readback: 再接続後の state_snapshot が送信済み状態を反映する
      from_state: accepting
      to_state: accepting
      expected_outcomes:
        - 受付中に永続した解答が切断・再接続を跨いで保持される
        - 再接続後の再送で同一問・同一参加者の解答が重複永続化されない
      boundary_cases:
        - ack 前切断で resume 再送 → upsert により重複なく保持
        - 締切後の resume 再送 → 拒否されるが既存の永続解答は保持
      dod_obligations:
        - id: dod_answer_preserved_across_reconnect
          text: 受付中に送信済みの解答が接続断・再接続後も answers に保持され送信済み表示へ復帰する
        - id: dod_answer_no_duplicate
          text: 再接続後の再送で同一 question_id + participant_id の解答行が重複せず一意に保たれる
```

---

## 3. Open Questions

壁打ち（要件定義）フェーズはクローズ済で殿判断待ちの論点は残っていない。以下は実装組み立てフェーズで MAS が決める技術選定、推測実装せず殿判断を仰ぐ点、検証ゲートで暫定運用中のフラグである。「推奨なし」「要検討」「TBD」の空白は残さず、確定した制約・既定機構・暫定ゲート値を明記する。

### 3.1 技術選定（MAS 決定・殿判断不要）

| 項目 | 決定/既定 | 制約・選定軸 |
|---|---|---|
| WebSocket ライブラリ | **`ws`（npm）をサーバ実装に採用。** クライアントはブラウザ標準 `WebSocket` | ランタイム依存最小化方針に整合する軽量ライブラリ。ロール別 fan-out・resume・heartbeat は本設計（`hub`/`fanout`/`recovery`/`heartbeat`/`rejoin`）で自前構築し、状態整合ロジックを自プロダクト管理下に置く（RS-INV-3）。Socket.IO は再接続/room を内蔵するが依存が重いため不採用。テストランナー（Vitest）とは無関係。 |
| ホスティング / インフラ | クラウド常時稼働＋WebSocket 対応構成 | 当日インターネット接続前提で稼働。ホスト PC をサーバにしない（RS-INV-1）。回線断は運用側でバックアップ回線/テザリング確保。 |
| 上限設定の持ち方 | 環境変数 `MAX_TABLET_CONNECTIONS` を既定機構とする | 環境変数／設定ファイル／DB 設定テーブルのいずれでも可だが `src/config/connection_limit.ts` が唯一の解決点。ハードコード禁止（RS-INV-2）。 |
| 家族限定アクセス制御 | **分岐 A（URL 秘匿）／B（認証）を保持**（§2.9・継承 INV-4） | 無制御公開はリリース不可。方式決定まで接続上限（既定 8）とトリガー権限の司会者限定をブラスト半径抑制策とし、いずれの分岐でも上限判定・`role: host` の単一解決点を経由。 |
| resume トークンの寿命 | 当日ゲーム 1 セッションの生存期間を上限とする不透明値 | 恒久的な氏名台帳を持たない方針と整合（当日その場参加）。失効・無効時は新規参加として上限判定を再通過（§2.7）。 |

### 3.2 F028 エスカレーション（推測実装しない）

- **取消操作の同期挙動（論点 7・F-03）**: `trigger_undone` の配信対象と復帰範囲（直近操作のみ戻すか／任意問題を再開示できるか、d 到達問の残額差分の巻き戻し範囲）に曖昧が残る場合は、選択肢を添えて F028 で殿判断を仰ぐ。**発動権限＝制御盤（host）のみ**は確定ゆえ実装・検証し（`dod_undo_host_only` 継承）、配信の巻き戻し詳細は E2E で `test.fixme()`。
- **ピタリ賞拠出配分の配信（B・F-02）**: 加算側 +1,000 円の残額反映（`balance_updated` 配信）は確定・検証必須。拠出元と配分（総額 1,000 か各人からか、複数同時ピタリ時の扱い）が未確定なら F028 で選択肢提示。確定値（1,000 円・円建て・現金感を薄めない）は変更しない。

### 3.3 検証ゲートで暫定運用中のフラグ（設計義務の欠落・発明せず flag）

- **F-04（同期レイテンシ SLA）**: 設計に固定 SLA が無いため、§2.4／§2.11 の **p95 ≤ 2,000ms** は暫定テストゲートとして設定し、SLA 確定時に更新する（`dod_broadcast_latency_gate`）。
- **F-05（家族限定アクセス制御）**: §3.1 の分岐 A/B 未決につき、認証が実装されていれば WS 昇格前のログイン→リダイレクト→描画フローを検証し、未実装なら該当ブラウザテストを `test.fixme()`。無制御公開のまま出荷はリリース不可（継承 INV-4）。
- **切断検知パラメータ（ping 15 秒／pong 猶予 30 秒）**: 当日ネットワーク実測に基づき運用側で調整余地があるが、判定は `src/config/` 経由の設定値とし、無応答検知→スロット解放→再接続復帰の整合（RS-INV-3）は値に依らず成立させる。値が未計測の段階でも既定値で検証を通し、実測後に更新する。
