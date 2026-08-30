---
codd:
  node_id: design:participation-connection-design
  type: design
  depends_on:
  - id: design:system-design
    relation: depends_on
    semantic: technical
  - id: design:realtime-sync-design
    relation: depends_on
    semantic: technical
  depended_by:
  - id: design:operational-behavior-model
    relation: depends_on
    semantic: technical
  - id: infra:deployment-setup
    relation: constrained_by
    semantic: governance
  - id: test:test-strategy
    relation: depends_on
    semantic: verification
  conventions:
  - targets:
    - module:participants
    reason: "（2026-08-28 案A 改定。旧: 参加はホスト画面の QR を読み氏名を自己入力し、1人=1台（入力専用）で紐付ける・端末番号固定割当は不採用（論点9改）） → 案A 準拠: 参加は事前発行アカウントでの /login ログインにより成立する（身元はサーバ側セッション権威）。端末番号固定割当は不採用（論点9改・案A でも同じ）。違反時リリース不可。"
  - targets:
    - module:config
    - module:participants
    reason: 同時接続上限は既定 8・ハードコード禁止・設定パラメータとして外出しし、上限超過時は接続を断る挙動が設定値を参照して機能すること（論点10）。違反時リリース不可。
  - targets:
    - module:participants
    reason: 家族限定アクセス制御方式を設計責務として抱え、無認証の無制限公開を採らないこと。違反時リリース不可。
  modules:
  - participants
  - config
  - realtime_sync
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
      label: クラウドサーバ（realtime_sync 権威 / participants）
    operations:
    - id: op_display_join_qr
      actor: host
      verb: display
      target: join_qr
      trigger: 司会者が制御盤を開くと参加用 QR が表示される
      route: /control-panel
      ui_pattern: qr_display
      preconditions:
      - PUBLIC_BASE_URL が設定済み
      measurement_source: resolvePublicBaseUrl() と（分岐A時）JOIN_ACCESS_TOKEN
      readback: QR 読取りでクラウド公開の /join へ到達する
      visible_to:
      - host
      forbidden_actors:
      - contestant
      - audience
      expected_outcomes:
      - 制御盤に /join 公開 URL を符号化した QR が表示される
      - QR 提示面に事前氏名台帳・端末番号割当の入力要素が存在しない
      dod_obligations:
      - id: dod_qr_encodes_public_join_url
        text: 制御盤に表示される QR がクラウド公開の /join URL を符号化し、読取りで /join へ到達する
      - id: dod_qr_no_seat_ledger
        text: QR 提示面に事前氏名台帳・端末番号割当の入力要素が存在しない
    - id: op_guard_family_access
      actor: system
      verb: guard
      target: join_access
      trigger: 解答者が /join へ到達し参加確定を試行
      route: /join
      measurement_source: 提示トークン（分岐A）またはセッション認証状態（分岐B）と src/config のアクセス制御設定
      preconditions:
      - 参加アクセス制御が URL 秘匿トークンまたは認証のいずれかで構成されている
      durable_state: なし（アクセス判定は設定と提示情報から導出）
      consumer_surfaces:
      - join_page
      expected_outcomes:
      - 分岐A では秘匿トークン一致のときのみ /join 参加が許可される
      - 分岐B では認証済のときのみ許可され、ログイン→リダイレクト→描画のフローを備える
      - どちらの制御も未構成なら参加を許可しない（無制御公開は成立しない）
      - 受入は src/config の上限解決点と role 判定を必ず経由する
      boundary_cases:
      - アクセス制御未構成 → 参加不可（無認証の無制限公開はリリース不可構成）
      - 分岐A トークン不一致 → 参加不可
      - 分岐B 未認証 → /join は保護ナビを露出せずログインへ誘導
      dod_obligations:
      - id: dod_access_no_open_public
        text: URL 秘匿トークンも認証も未構成の場合に /join の参加確定が許可されず、無制御公開が構成上も実行上も成立しない
      - id: dod_access_single_resolution
        text: 分岐 A/B いずれでも参加受入が src/config の上限解決点と role 判定の単一経路を経由する
      - id: dod_access_no_protected_nav
        text: 未認証・未参加の /join に制御盤操作等の保護ナビが露出しない
    - id: op_join_game
      actor: contestant
      verb: join
      target: game_session
      trigger: 制御盤の QR を読取り /join で氏名を自己入力して参加確定
      route: /join
      ui_pattern: qr_scan_then_name_input
      preconditions:
      - 家族限定アクセス制御を通過している（分岐A トークン一致 または 分岐B 認証済）
      - contestant 接続数が MAX_TABLET_CONNECTIONS 未満
      - 氏名が非空かつ MAX_DISPLAY_NAME_LENGTH 以下
      measurement_source: 解答者の自己入力氏名
      durable_state: participants テーブル（id / name / joined_at / connection_id）
      readback: 制御盤の参加者一覧と TV(e) 全問通算一覧に反映
      visible_to:
      - host
      - audience
      forbidden_actors: []
      expected_outcomes:
      - 自己入力した氏名で participants に 1 人 1 レコードが作られ connection_id へ紐付く
      - 参加が制御盤の参加者一覧と TV(e) に反映される
      - 端末番号の固定割当や事前氏名台帳を用いずに参加が成立する
      boundary_cases:
      - 空・空白のみの氏名 → UI とサーバの双方で拒否
      - MAX_DISPLAY_NAME_LENGTH 超過の氏名 → UI とサーバの双方で拒否
      - 同名の別人 → それぞれ別の participants レコード（氏名は一意キーでない）
      - 同一端末の resume なし再 /join → 新規参加として上限判定を再通過
      dod_obligations:
      - id: dod_join_self_name
        text: 参加者が自己入力した氏名が participants に永続し、制御盤の参加者一覧に表示される
      - id: dod_join_no_seat_fixed
        text: 端末番号の固定割当や事前氏名台帳の UI/API を用いずに参加が成立する
      - id: dod_join_one_device
        text: 参加確定 1 回につき connection_id へ紐づく participants レコードが 1 件だけ生成される
      - id: dod_join_reflected
        text: 参加確定が制御盤の参加者一覧と TV(e) の全問通算一覧へ反映される
      - id: dod_join_name_validation
        text: 空・空白のみ・上限長超過の氏名は /join の UI とサーバの双方で拒否され participants に入らない
    - id: op_enforce_connection_limit
      actor: system
      verb: reject
      target: tablet_connection
      trigger: contestant 接続数が MAX_TABLET_CONNECTIONS に達した状態での新規参加確定の試行
      route: /join
      measurement_source: 現在の contestant 接続数と src/config の MAX_TABLET_CONNECTIONS 解決値
      threshold: MAX_TABLET_CONNECTIONS（既定 8）
      preconditions:
      - connected_contestants >= MAX_TABLET_CONNECTIONS
      durable_state: 既存接続・participants・answers・balances は不変
      consumer_surfaces:
      - join_page
      expected_outcomes:
      - admitTablet が over_limit を返し参加が成立しない
      - realtime_sync が connection_rejected とともに WS close(4001) で断る
      - 既存の接続と保持データ（participants/answers/balances/進行状態）は影響を受けない
      - host/audience 接続はタブレット上限に数えない別チャネルとして扱う
      - /join に満席の平易文が表示され設定キー名・接続数会計は露出しない
      boundary_cases:
      - 既定 8: 8 台目は許可・9 台目は拒否
      - 設定 16: 16 台目は許可・17 台目は拒否
      - 設定 32: 32 台目は許可・33 台目は拒否
      - 切断でスロット解放後は同数まで再受入可
      dod_obligations:
      - id: dod_limit_default_eight
        text: 設定未指定時に 8 台まで接続でき 9 台目が拒否される
      - id: dod_limit_config_follows
        text: MAX_TABLET_CONNECTIONS を 16/32 へ設定変更するとコード改修なしに上限がその値へ追随する
      - id: dod_limit_no_hardcode
        text: 上限判定は src/config の解決値を参照し、判定コードに数値リテラル 8 のハードコードが存在しない
      - id: dod_limit_existing_unaffected
        text: 上限拒否の発生時に既存接続のセッション・回答・残額・進行状態が変化しない
      - id: dod_limit_join_full_copy
        text: /join の満席表示が job-to-be-done 平易文で、設定キー名・接続数会計・ロール識別子を露出しない
---

# 参加登録・接続管理設計（QR 参加・氏名自己入力・接続上限外出し）

> **⚠ 2026-08-28 殿裁可「案A（事前アカウント方式）」により本書の参加方式は改定された（cmd_2553）。**
>
> 旧方式（QR を読み **氏名を自己入力**してその場で参加する）は**破棄**され、参加は
> **事前に発行されたアカウントでログインする**方式へ全面移行した。本書のうち「氏名自己入力」
> 「その場参加」「`connection_id` による 1 人 = 1 台」を前提とする記述（PC-INV-1 / PC-INV-4 /
> §2.3 / §2.4 / `dod_join_self_name` / `dod_join_no_seat_fixed` / `dod_join_one_device`）は
> **失効**しており、下記の取消線つき記述として履歴保存のためにのみ残す。
>
> 有効な参加・認証の設計は次のとおり:
>
> - アカウント（`accounts`）・パスワード（scrypt）・セッション Cookie・`/login` / `/logout` …
>   `src/accounts/` / `src/auth/`（P1・実装済）
> - エピソード・招待・エピソード参加（`episodes` / `episode_invitations` /
>   `episode_participants`）… P2（未実装）
> - 家族限定アクセス制御（PC-INV-3）は **`JOIN_ACCESS_MODE=authenticated`（分岐 B）で確定**し、
>   分岐 A（URL 秘匿トークン）は用いない。PC-INV-3 自体（無認証の無制限公開を採らない）は
>   案A でも**有効**であり、ログイン必須という形でより強く満たされる。
> - PC-INV-2（接続上限の設定外出し）・PC-INV-5（保護ナビ非露出）・PC-INV-6（クラウド権威）は
>   案A でも**有効**である。

## 1. Overview

本書は `save-money-switcher`（クラウド WEB アプリ版『賞金先渡しクイズ SAVE MONEY』家族用操作盤）における **`module:participants` と `module:config`（接続上限外出し部分）の詳細設計**であり、上位の `design:system-design`（`docs/design/system_design.md`）を唯一の技術的親とし、兄弟の `design:realtime-sync-design`（`docs/design/realtime_sync_design.md`）と接続管理の責務を分担する。realtime_sync 設計 §1.1 が「参加登録 UI（`design:participation-connection-design`）は各兄弟設計に委ね」と明示したとおり、**QR 参加・氏名自己入力・参加者レコード生成・同時接続上限の設定外出しと受入判定・家族限定アクセス制御方式**を本書が権威をもって確定する。ここに記す 🟦 確定値・不変条件に反する成果物は**リリース不可（release-blocking）**として扱う。

### 1.1 本設計のスコープと責務境界

本書が権威をもつのは次の 3 領域である。

1. **QR 参加と氏名自己入力（`op_join_game` / `op_display_join_qr`）** — 制御盤（`/control-panel`）がクラウド公開の参加 URL（`/join`）を符号化した **QR** を表示し、解答者タブレットがそれを読取って `/join` へ到達し、**氏名を自己入力**して参加確定する。**1 人 = 1 台（入力専用）**で `participants` に紐付け、**端末番号の固定割当・事前氏名台帳は不採用**（論点9改）。
2. **同時接続上限の外出しと受入判定（`op_enforce_connection_limit`）** — 上限は `src/config/` の設定パラメータ `MAX_TABLET_CONNECTIONS`（既定 **8**）から単一解決し、**ハードコードを禁止**、上限超過の新規参加を断る。判定は設定値を参照し、**16／32 へコード改修なしに追随**する（論点10）。
3. **家族限定アクセス制御方式（`op_guard_family_access`）** — 参加ベクタ（QR が指す公開 `/join`）に対し、**無認証の無制限公開を採らず**、分岐 A（URL 秘匿）／分岐 B（認証）のいずれかの制御を必ず通す設計責務を抱える。

**責務境界（兄弟設計との分担）**: 本書は「参加レコードの生成・氏名検証・上限の設定解決と受入可否の**決定ロジック**・アクセス制御ゲート・QR 提示」を所有する。WebSocket のトランスポート（`ws` 待受・接続レジストリ・ロール投影 fan-out・`connection_rejected` イベント＋`WS close(4001)` の**通知機構**・resume トークン・heartbeat）は `design:realtime-sync-design`（`src/realtime_sync/`）が所有し、本書の `resolveMaxTabletConnections()`／`admitTablet()` を**呼び出す消費者**である。スコア計算式は `design:scoring-engine-design`、DB 物理設計は `design:data-model-design`、TV 表示は `module:tv_display` に委ねる。

### 1.2 リリースブロッキング不変条件（本設計が具体化する制約）

| # | 対象 | 不変条件 | 本書での具体化箇所 |
|---|---|---|---|
| ~~PC-INV-1~~（**2026-08-28 殿裁可 案A により改定・失効**） | `module:participants` | ~~参加は制御盤の **QR（クラウド公開 URL）**を読み **氏名を自己入力**し、**1 人 = 1 台（入力専用）**で紐付ける。**端末番号固定割当は不採用**（論点9改）~~ → **改定後**: 参加は**事前発行アカウントでのログイン**により成立し、身元はサーバ側セッション（HttpOnly Cookie）が権威である。氏名の自己入力・`connection_id` による 1 台紐付けは行わない。端末番号固定割当を採らない点は改定後も同じ | `src/accounts/` / `src/auth/`・`docs/governance/decision_records.md`（案A ADR） |
| PC-INV-2 | `module:config` / `module:participants` | 同時接続上限は既定 **8**・**ハードコード禁止**・設定パラメータとして外出しし、上限超過時に接続を断る挙動が**設定値を参照して機能**する（論点10） | §2.5・OBM `op_enforce_connection_limit` |
| PC-INV-3 | `module:participants` | **家族限定アクセス制御方式**を設計責務として抱え、**無認証の無制限公開を採らない** | §2.6・§2.8・OBM `op_guard_family_access`・§3.1 |
| PC-INV-4（継承・**2026-08-28 案A により一部改定**） | `module:tablet` / privacy | タブレットは入力専用最小 UI で他者情報を保持・表示しない（**改定後も有効**）。収集個人データは~~自己入力氏名~~ → **アカウントの表示名**と当日の解答・残額に限る。~~恒久的な事前氏名台帳を持たない~~ → **案A では恒久アカウント（`accounts`）を持つ**（殿裁可により前提が変わった） | §2.4・§2.8・`src/accounts/account.ts` |
| PC-INV-5（継承） | `role:host` / `role:contestant` | 参加 QR 提示は司会者面（`/control-panel`）に限り、`/join` は解答者面。エントリ／事前認証面は保護ナビを露出しない | §1.4・§2.6・§2.7 |
| PC-INV-6（継承） | `module:realtime_sync` | 参加はクラウド権威に接続して成立し、**ホスト PC をサーバにしない**（制御盤ブラウザは待受ソケットを持たない） | §2.1・§2.7 |

**各不変条件は該当節で「本書がどう遵守するか」を明示する（下記本文の『遵守の言明』）。**

### 1.3 実装・ツールチェーン前提（scaffold 固定・釈義不可）

- **実装言語 = TypeScript のみ。** 本書のファイルパス（`src/participants/*.ts`・`src/config/*.ts` 等）・モジュール構成・依存管理・ツールチェーン参照はすべて TypeScript 慣行のみを用い、他言語の拡張子・マニフェスト・ツールは例示・フォールバックとしても登場させない。QR 生成には Node 上の軽量ライブラリ **`qrcode`（npm）**を採り（§3.1）、クライアントの QR 読取りはタブレット標準カメラ／ブラウザに委ねる。
- **テストランナー = Vitest（固定・release-blocking のグラウンドトゥルース）。** verify が実際に走らせるのは Vitest であり、本書はこれを再解釈・上書きしない。本書の全テスト例は Vitest 自身の宣言 API（`import { describe, it, expect } from "vitest";`）で記述する。「ランタイム依存を最小化する」方針は**出荷コードのランタイム依存**（例: `qrcode` の採否）にのみ及び、テストランナーには及ばない。依存数の哲学を根拠に別フレームワークや Node 組み込み `node:test` を用いてはならない。
- **モジュール解決 = NodeNext/Node16。** すべての相対 import 指定子は**出力される `.js` ファイル名を明示した拡張子**を伴う（`import { x } from "./x.js"`。`"./x"`・`"./x.ts"` は不可）。re-export（`export { x } from "./x.js"`）・default/namespace import・type-only import（`import type { T } from "./x.js"`）も同一規約。拡張子欠落は TS2835 でコンパイル不能。
- **レイアウト契約（output-path fence 強制）。** ソースは**必ず `src/` 配下**、テストは**必ず `tests/` 配下**（`test/`・`spec/`・`specs/` を発明しない）。`package.json`・`package-lock.json`・`tsconfig.json`・`vitest.config.ts` は harness scaffold 所有につき、本書はこれらを成果物として出力・宣言しない。

### 1.4 アクター向けサーフェス／コピー義務

要件が定めるロール（内部識別子 → 可視ラベル）: `role: host` → **司会者**、`role: contestant` → **解答者**、観客（TV 視聴者）。可視コピーには**可視ラベル**を用い、内部識別子（host/contestant）・設定キー名（`MAX_TABLET_CONNECTIONS`／`PUBLIC_BASE_URL`）・内部会計（接続数）・アクセス制御の内部方式・実装根拠・環境前提を露出させない。全サーフェス共通で `point`／`pt`／`点` を禁止し、金額は「円」で表す。

| サーフェス | ルート | 主対象アクター | 目的 | 許可アクション／ナビゲーション | 禁止アクション／ナビゲーション | 必須の可視コピー意図 | 禁止コピー |
|---|---|---|---|---|---|---|---|
| 参加受付 | `/join` | 解答者 | QR 経由の参加・氏名自己入力 | 氏名入力・「参加する」確定 | 事前氏名台帳／端末番号割当の提示、保護された制御盤ナビの露出、他者情報の閲覧 | 「お名前を入力してください」「参加する」等の解答者向け参加導線。満席時「ただいま満席のため参加できません」 | ロール解決済みの曖昧な保護ナビ・設定キー名・接続数会計・環境前提・`point`/`pt`/`点` |
| 制御盤（参加 QR 面） | `/control-panel` | 司会者 | 参加用 QR の提示・参加者一覧・接続状況把握 | 参加 QR 表示・参加者一覧確認・接続数/上限の把握（司会者は当該境界の管理者ゆえ「◯/◯台」表示可） | 解答者の入力操作面を出さない | 参加用 QR・「参加者 ◯名」・「◯/◯台」等の司会者向け把握コピー | 内部 role 識別子ラベル・テスト/デモ/サンプル表記・`point`/`pt`/`点` |
| タブレット（参加後） | `/tablet` | 解答者 | 入力専用最小 UI（本書は参加成立後の遷移先として言及） | 自分の入力・送信・自分の残額（円）閲覧 | 他者の残額/得点/解答・出題内容・全体一覧・司会者操作 | 問題番号・数値入力・送信済み表示・自分の残額（円） | 他者情報・司会者操作語・`point`/`pt`/`点` |

**エントリ／事前認証サーフェス**（`/join`・分岐 B 未認証時の到達点）は、アクセス状態に整合しない保護ナビ（制御盤操作等）を露出しない。分岐 B 導入時は「ログイン → 正しいリダイレクト → 期待コンテンツ（`/join` の氏名入力）描画」のフローを備える。上限拒否・アクセス拒否のコピーは job-to-be-done 言語（満席で参加不可／このリンクからは参加できません）に限り、内部の接続数会計・設定キー名・アクセス制御方式を露出しない。

---

## 2. Architecture

### 2.1 参加登録トポロジと全体フロー（PC-INV-1/PC-INV-6）

```
 司会者 PC(制御盤)                                   解答者タブレット
  /control-panel                                     /join
     │ ①参加用 QR を表示                                  │
     │  buildJoinUrl()/renderJoinQrSvg()                 │
     │  (src/participants/join_link.ts, qr.ts)           │
     │ ─────────── QR（/join 公開 URL を符号化）──────────▶│ ②QR 読取り→ /join へ遷移
     │                                                   │ ③アクセス制御通過（分岐A/B）
     │                                                   │ ④氏名を自己入力
     │                                                   │ ⑤「参加する」で参加確定 submit
     ▼                                                   ▼
 ┌────────────────── クラウド（realtime_sync 権威・唯一の待受） ──────────────────┐
 │ ⑥ checkJoinAccess()（src/participants/access_control.ts）＝家族限定ゲート        │
 │ ⑦ limit = resolveMaxTabletConnections()（src/config/connection_limit.ts）       │
 │    admitTablet({limit, connected},{name})（src/participants/admission.ts）       │
 │      ok   → registerParticipant()：participants へ 1 レコード(name/connection_id)│
 │      over → connection_rejected + WS close(4001)（realtime_sync が通知）         │
 │ ⑧ participant_joined を配信 → 制御盤 参加者一覧・TV(e) 全問通算一覧へ反映        │
 └──────────────────────────────────────────────────────────────────────────────┘
```

- **参加はクラウド権威への接続で成立する。** WebSocket 待受はクラウドサーバ側にのみ存在し、制御盤ブラウザは QR を提示する一クライアントに過ぎない。`localhost` 待受・ホスト PC の AP 化・LAN 完結を含む構成は本設計に反しリリース不可（PC-INV-6・継承 INV-1）。
- 全 HTTP 応答は健全性ベースライン **`< 500`（5xx を出さない）** を満たす。上限拒否・アクセス拒否は 5xx ではなく、`/join` の平易文＋（トランスポート層の）`connection_rejected`／`WS close(4001)` で表す。

**PC-INV-6 遵守の言明**: 参加受入・参加者永続・イベント配信をすべてクラウド権威側に置き、制御盤ブラウザに待受・権威を持たせない。QR は公開 URL を符号化するのみで、参加の権威源にはならない。

### 2.2 モジュール構成とソース配置（`src/` 配下・snake_case）

`governance:decision-records` の module→格納先マッピングに従う。DB テーブルは snake_case、URL ルートは kebab-case、環境変数は SCREAMING_SNAKE_CASE、ロール／ドメインイベントは snake_case を用いる。

| ファイル | 責務 |
|---|---|
| `src/config/connection_limit.ts` | `MAX_TABLET_CONNECTIONS` の単一解決点（`resolveMaxTabletConnections()`）。既定 8 の唯一の宣言。 |
| `src/config/public_base_url.ts` | 参加 URL 生成の基底となるクラウド公開 URL の解決（`resolvePublicBaseUrl()`・`PUBLIC_BASE_URL`）。 |
| `src/config/access_control_config.ts` | 家族限定アクセス制御の設定解決（`resolveJoinAccessToken()`／`resolveAccessMode()`）。 |
| `src/participants/name.ts` | 自己入力氏名の検証（`isValidDisplayName`）と表示長上限 `MAX_DISPLAY_NAME_LENGTH`。 |
| `src/participants/admission.ts` | 上限判定の純関数（`admitTablet({ limit, connected }, { name })`）— 現接続数・上限・氏名から受入可否を返す。 |
| `src/participants/access_control.ts` | 家族限定アクセスゲート（`checkJoinAccess`）— 分岐 A/B の許可判定。無制御公開を返さない。 |
| `src/participants/registration.ts` | 受入成立時の参加者レコード生成（`registerParticipant`）— 1 人 = 1 台の紐付け。 |
| `src/participants/participant_repository.ts` | `participants` テーブルの永続化・参加者一覧の読み出し（`insertParticipant`／`listParticipants`）。 |
| `src/participants/join_link.ts` | 参加 URL の組立（`buildJoinUrl`）— `/join` 公開 URL（分岐 A 時は秘匿トークン付与）。 |
| `src/participants/qr.ts` | 参加 URL の QR 符号化（`renderJoinQrSvg`・`qrcode` 使用）。 |

相対 import は全ファイルで `.js` 拡張子を明示する。例:

```typescript
// src/participants/registration.ts
import type { JoinRequest } from "./admission.js";
import { isValidDisplayName } from "./name.js";
import { insertParticipant } from "./participant_repository.js";
export { registerParticipant } from "./registration_impl.js";
```

### 2.3 ~~データモデル（`participants` テーブル・PC-INV-1）~~（**2026-08-28 案A により改定**）

> **改定**: 身元の権威は `participants`（当日その場参加）から `accounts`（恒久アカウント）へ移った。
> エピソードごとの参加者は P2 で `episode_participants` として表す。既存 QC 済みドメイン
> （scoring / game_state / realtime_sync / render_*）が鍵として用いる `participantId` には
> `episode_participants.id` を渡し、ドメイン側は無改変で保つ。以下は履歴として残す。

参加登録の永続化は `participants` テーブルが所有する（物理設計は `design:data-model-design` に委ねるが、以下のスキーマ責務は本書で確定する）。

| カラム | 責務 |
|---|---|
| `id` | 参加者の安定識別子（PK）。**これがゲーム内アイデンティティ**であり、再接続（realtime_sync の resume）はこの `id` へ再バインドする。 |
| `name` | **解答者が自己入力した氏名**（1〜`MAX_DISPLAY_NAME_LENGTH` 文字・非空）。氏名は一意キーではない（同名の別人を許容）。 |
| `joined_at` | 参加確定時刻。 |
| `connection_id` | **1 人 = 1 台の現行紐付け**。参加確定時に付与し、再接続時に更新する。 |

- **PC-INV-1 準拠**: 参加確定ごとに `participants` へ **1 レコードのみ**を生成し、`connection_id` により 1 台へ紐付ける。**端末番号カラム・事前氏名台帳テーブルは持たない**（座席固定割当・事前氏名登録の UI/API を提供しない）。
- **PC-INV-4 準拠**: 収集する個人データは `name`（自己入力）と当日の解答・残額（後者は `answers`／`balances` 側）に限る。`participants` は当日その場参加を前提とし、**恒久的な事前氏名台帳を保持しない**。ゲームセッション終了時にレコードは破棄対象とする。

### 2.4 ~~QR 参加と氏名自己入力~~（**2026-08-28 殿裁可 案A により失効**・`op_display_join_qr` / `op_join_game`・PC-INV-1）

> **本節は失効した。** 案A では `/join`（氏名自己入力フォーム）は存在せず、QR が符号化するのは
> `/login`（ログイン入口）である（QR は破棄せず**意味を付け替えた**）。以下は履歴として残す。

#### 2.4.1 QR 提示（司会者面・`op_display_join_qr`）

- 制御盤（`/control-panel`）は `buildJoinUrl()` が解決したクラウド公開の `/join` URL を `renderJoinQrSvg()` で **QR（SVG）**に符号化して表示する。QR 面には**事前氏名台帳・端末番号割当の入力要素を置かない**（`dod_qr_no_seat_ledger`）。
- `buildJoinUrl()` は `resolvePublicBaseUrl()`（`PUBLIC_BASE_URL`）を基底に `/join` を組み立てる。分岐 A（URL 秘匿）を採る場合は秘匿トークンをクエリ `t` として付与する（§2.6）。

```typescript
// src/participants/join_link.ts
import { resolvePublicBaseUrl } from "../config/public_base_url.js";
import { resolveJoinAccessToken } from "../config/access_control_config.js";

export function buildJoinUrl(): string {
  const url = new URL("/join", resolvePublicBaseUrl());
  const token = resolveJoinAccessToken(); // 分岐A: 秘匿トークン（未設定なら分岐B/未構成）
  if (token) url.searchParams.set("t", token);
  return url.toString();
}
```

#### 2.4.2 氏名自己入力と参加確定（解答者面・`op_join_game`）

- 解答者は QR 読取りで `/join` へ到達し、**アクセス制御（§2.6）を通過**したうえで、氏名入力欄（「お名前を入力してください」）へ**自己入力**し「参加する」で確定する。事前氏名台帳から選ぶ導線・端末番号を選ぶ導線は提供しない（`dod_join_no_seat_fixed`）。
- 氏名は **UI とサーバの双方**で検証する。`src/participants/name.ts` の `isValidDisplayName` を UI（`/join`）とサーバ（`registration.ts`）で共有し、**空・空白のみ・上限長超過を拒否**する（`dod_join_name_validation`）。表示長上限 `MAX_DISPLAY_NAME_LENGTH = 20`（TV 表示の安定のための設計選択値）。

```typescript
// src/participants/name.ts
export const MAX_DISPLAY_NAME_LENGTH = 20;

export function isValidDisplayName(raw: string): boolean {
  const trimmed = raw.trim();
  const length = [...trimmed].length; // コードポイント単位で数える
  return length >= 1 && length <= MAX_DISPLAY_NAME_LENGTH;
}
```

- 参加確定は **アクセス制御 → 氏名検証 → 上限判定** の順で通過して初めて成立し、`registerParticipant()` が `participants` へ 1 レコードを生成する。成立で `participant_joined` を配信し、制御盤の参加者一覧と TV(e) 全問通算一覧へ反映する（§2.7・`dod_join_reflected`）。
- **1 人 = 1 台（`dod_join_one_device`）**: 参加確定 1 回につき 1 レコードを `connection_id` へ紐付ける。同一端末が resume トークンなしに `/join` を再度開いた場合は**新規参加として上限判定を再通過**する（realtime_sync の「無効・失効トークンの再接続は新規参加扱い」と整合）。

**PC-INV-1 遵守の言明**: 参加は QR（公開 URL）読取り＋氏名自己入力＋1 台紐付けのみで成立し、端末番号固定割当・事前氏名台帳の UI/API を一切設けない。これを `dod_join_self_name`／`dod_join_no_seat_fixed`／`dod_join_one_device` で機械可検化する。

### 2.5 同時接続上限の外出しと受入判定（`op_enforce_connection_limit`・PC-INV-2）

- **上限の単一解決点**: `MAX_TABLET_CONNECTIONS` は `src/config/connection_limit.ts` の `resolveMaxTabletConnections()` のみが解決する。**既定 8 はこのファイルの単一の名前付き定数 `DEFAULT_MAX_TABLET_CONNECTIONS` としてのみ宣言**し、判定コード（`admission.ts`／`src/realtime_sync/server.ts`／`src/tablet/`）には数値リテラル 8 を一切置かない。設定機構は環境変数を既定とする（§3.1）。

```typescript
// src/config/connection_limit.ts
const DEFAULT_MAX_TABLET_CONNECTIONS = 8; // 外出しパラメータの既定値の唯一の宣言点

export function resolveMaxTabletConnections(): number {
  const raw = process.env.MAX_TABLET_CONNECTIONS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_MAX_TABLET_CONNECTIONS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_MAX_TABLET_CONNECTIONS;
  return parsed;
}
```

- **受入判定の純関数**: `src/participants/admission.ts` の `admitTablet({ limit, connected }, { name })` が、`connected >= limit` なら `{ ok: false, reason: "over_limit" }` を、氏名不正なら `{ ok: false, reason: "invalid_name" }` を、いずれも満たさなければ `{ ok: true }` を返す。判定は渡された `limit`（＝設定解決値）のみを参照し、数値リテラルを持たない。

```typescript
// src/participants/admission.ts
import { isValidDisplayName } from "./name.js";

export interface AdmissionInput { limit: number; connected: number; }
export interface JoinRequest { name: string; }
export interface AdmissionResult { ok: boolean; reason?: "over_limit" | "invalid_name"; }

export function admitTablet(state: AdmissionInput, req: JoinRequest): AdmissionResult {
  if (!isValidDisplayName(req.name)) return { ok: false, reason: "invalid_name" };
  if (state.connected >= state.limit) return { ok: false, reason: "over_limit" };
  return { ok: true };
}
```

- **設定追随（改修不要・`dod_limit_config_follows`）**: `server.ts` は接続受理時に `limit` を毎回 `resolveMaxTabletConnections()` から取り直して `admitTablet` に渡すため、`MAX_TABLET_CONNECTIONS=16/32` へ変えると判定が即追随する。
- **上限の対象**: 上限は **contestant（タブレット）接続**に課す。`host`（制御盤）・`audience`（TV）は別チャネルとして受け、タブレット上限に数えない（realtime_sync 設計と整合）。
- **既存不変（`dod_limit_existing_unaffected`）**: `ok=false` の拒否時、realtime_sync が `connection_rejected` ＋ `WS close(4001)` で断り、既存接続・`participants`・`answers`・`balances` は変化しない。切断でスロット解放後は同数まで再受入可（realtime_sync の heartbeat がスロットを解放）。
- **満席コピー（`dod_limit_join_full_copy`）**: `/join` の拒否表示は「ただいま満席のため参加できません」等の job-to-be-done 平易文に限り、設定キー名（`MAX_TABLET_CONNECTIONS`）・接続数会計・ロール識別子を露出しない（§1.4）。

**PC-INV-2 遵守の言明**: 上限を `src/config/` の単一解決点へ外出しし（`dod_limit_no_hardcode`）、判定を設定値参照の純関数に一元化して、既定 8／設定 16／32 の各境界で 8/9・16/17・32/33 台目の可否を機械可検に固定する（§2.10 のテスト）。

### 2.6 家族限定アクセス制御（`op_guard_family_access`・PC-INV-3）

参加ベクタは QR が指すクラウド公開 `/join` である。**無認証の無制限公開はリリース不可**であり、以下 2 分岐のいずれかで抑制する。方式決定は §3.1 に保留するが、**いずれの分岐でも**受入は `src/config/` の上限解決点（§2.5）と `role: host` チェック（継承）を必ず経由させ、`checkJoinAccess` のゲートを通す。

- **分岐 A（URL 秘匿）**: 参加 URL に不透明な秘匿トークン `t` を付与（`buildJoinUrl` が付与、`resolveJoinAccessToken()`＝`JOIN_ACCESS_TOKEN` が解決）。`/join` は提示トークンが設定トークンと一致した場合のみ参加を許可する。ブラスト半径抑制は**接続上限（既定 8）**と**トリガー権限の司会者限定**が担保する。
- **分岐 B（認証導入）**: セッション認証で許可判定する。導入時は「ログイン → 正しいリダイレクト → 期待コンテンツ（`/join` 氏名入力）描画」のフローを備える。未認証の `/join` は保護された制御盤ナビを露出せずログインへ誘導する。

```typescript
// src/participants/access_control.ts
import { resolveJoinAccessToken } from "../config/access_control_config.js";
import { resolveAccessMode } from "../config/access_control_config.js";

export interface AccessContext { presentedToken?: string; authenticated: boolean; }

export function checkJoinAccess(ctx: AccessContext): { granted: boolean } {
  const mode = resolveAccessMode(); // "url_secret" | "authenticated" | undefined
  if (mode === "url_secret") {
    const expected = resolveJoinAccessToken();
    return { granted: expected !== undefined && ctx.presentedToken === expected };
  }
  if (mode === "authenticated") {
    return { granted: ctx.authenticated };
  }
  // どちらの制御も未構成なら参加を許可しない：無制御公開は実行時にも成立させない
  return { granted: false };
}
```

**PC-INV-3 遵守の言明**: `checkJoinAccess` は**アクセス制御が未構成の場合に `granted: false` を返す**設計とし、URL 秘匿トークンも認証もない「無制御公開」を構成上も実行時にも成立させない（`dod_access_no_open_public`）。いずれの分岐でも受入は上限解決点と `role: host` 判定の単一経路を通す（`dod_access_single_resolution`）。未認証／未参加の `/join` は保護ナビを露出しない（`dod_access_no_protected_nav`）。

### 2.7 制御盤・TV への反映（`op_join_game` の readback）

- 参加確定（`registerParticipant` 成立）で、realtime_sync（`src/realtime_sync/`）が `participant_joined` を **ロール投影して配信**する。配信先は **制御盤（司会者の参加者一覧）**と **TV(e)（全問通算の全員一覧に氏名が現れる）**。本書は参加者レコードとイベント発火の起点（producer）を所有し、fan-out の機構は realtime_sync が所有する（責務境界・§1.1）。
- 制御盤は参加者一覧に加え、司会者が当該境界の管理者であることから**接続数と上限の把握（「◯/◯台」）**を可視化できる（§1.4）。解答者タブレットへは他者の参加情報を投影しない（継承 RS-INV-5・タブレットは入力専用最小 UI）。
- 切断（heartbeat 無応答検知）で接続スロットは解放されるが、`participants` 行と `id` は identity として生存し、再接続は同一 `id` へ再バインドされる（realtime_sync の recovery／rejoin）。

**PC-INV-5 遵守の言明**: 参加 QR の提示は司会者面（`/control-panel`）に限り、`/join` は解答者面として保護ナビを持たない。参加の可視反映は司会者・観客の可視範囲へのみ投影され、解答者タブレットへ他者情報を出さない。

### 2.8 セキュリティ・アクセス制御・プライバシー

- **家族限定アクセス制御（PC-INV-3）**: §2.6 の `checkJoinAccess` を唯一のゲートとし、無制御公開を実行時にも拒む。分岐 A のトークン・分岐 B の認証状態は `src/config/access_control_config.ts` を通じて解決し、判定を単一経路へ集約する。
- **入力検証（サーバ側最終防衛）**: 氏名は UI を迂回した不正入力（空・空白のみ・上限長超過・制御文字）を**サーバ側でも**拒否する（`registration.ts` が `isValidDisplayName` を再適用）。上限判定も UI 表示に依存せずサーバ側 `admitTablet` を権威とする。
- **プライバシー / データ取扱い（PC-INV-4）**: 収集個人データは解答者が自己入力した氏名と当日の解答・残額に限る。恒久的な事前氏名台帳を持たず、当日その場参加を前提とする。参加者一覧・氏名の可視範囲は司会者（管理者）と観客（TV 開示後）に限り、他解答者のタブレットへは投影しない。秘匿トークン・resume トークンは participant にひも付く不透明値で、他者データへのアクセス権を含まない。
- **円建て固定（継承 INV-7）**: 本書が直接扱う金額表示はないが、参加が反映される TV(e) の一覧は円建てであり、`point`／`pt`／`点` の語を可視コピーに含めない。

### 2.9 非機能要件（性能・可用性・観測）

- **健全性ベースライン**: `/join`・`/control-panel` を含む全 HTTP 応答は **`< 500`**（5xx を出さない）。上限拒否・アクセス拒否は業務ステータス（`/join` 平易文＋トランスポート層 `connection_rejected`／`WS close(4001)`）で表し、5xx にしない。
- **反映レイテンシ**: `participant_joined` の制御盤／TV(e) 反映は状態遷移配信の暫定テストゲート **p95 ≤ 2,000ms** に従う（F-04・realtime_sync 設計と共有）。
- **可用性前提**: 参加は当日インターネット接続を前提とし、クラウド権威に接続して成立する。回線断は運用リスク（バックアップ回線／テザリングで担保）であり、ホスト PC のサーバ化で吸収してはならない（PC-INV-6）。
- **容量**: 同時参加は既定 8、設定で 16／32 まで（PC-INV-2）。
- **起動シーケンス（検証環境）**: `npm ci` → `npm run build` → `npm run start`（クラウド WEB アプリ＋WebSocket ゆえサーバ常駐必須）。ベース URL（または `/healthz`）が `< 500` を返すまで**最大 60 秒**ポーリングしてから試験開始。`E2E_BASE_URL` にクラウド公開 URL、`PUBLIC_BASE_URL`・`MAX_TABLET_CONNECTIONS`・アクセス制御設定を検証環境の値で注入する。

### 2.10 テスト戦略との整合（Vitest / レイアウト / モジュール指定子）

- テストは**すべて `tests/` 配下**、ソースは**すべて `src/` 配下**。`package.json`・`package-lock.json`・`tsconfig.json`・`vitest.config.ts` は harness 所有につき著さない。
- ユニット: `tests/participants/admission.test.ts`・`tests/participants/name.test.ts`・`tests/participants/access_control.test.ts`・`tests/participants/join_link.test.ts`・`tests/config/connection_limit.test.ts`。
- E2E: API/WS 統合 `tests/e2e/participation.spec.ts`（複数 WS クライアントで上限・参加反映を検証）、ブラウザ `tests/e2e/participation.browser.spec.ts`（Playwright を**ライブラリ import**（`import { chromium } from "playwright";`）で駆動し、宣言・検証は Vitest（`describe/it/expect`）で行う）。共有ヘルパは `tests/e2e/helpers/`（`.js` 参照）。

同時接続上限が設定値に追随することを固定（realtime_sync 設計の受け入れと同一の関数境界を共有）:

```typescript
// tests/participants/admission.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { resolveMaxTabletConnections } from "../../src/config/connection_limit.js";
import { admitTablet } from "../../src/participants/admission.js";

describe("同時接続上限は設定値を参照し追随する", () => {
  afterEach(() => { delete process.env.MAX_TABLET_CONNECTIONS; });

  it("未設定時の既定 8：8 台目は許可・9 台目は拒否（リテラル埋め込みではない）", () => {
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

氏名自己入力の二重防衛（UI とサーバで共有する検証関数の境界）:

```typescript
// tests/participants/name.test.ts
import { describe, it, expect } from "vitest";
import { isValidDisplayName, MAX_DISPLAY_NAME_LENGTH } from "../../src/participants/name.js";

describe("自己入力氏名の検証", () => {
  it("空・空白のみは拒否", () => {
    expect(isValidDisplayName("")).toBe(false);
    expect(isValidDisplayName("   ")).toBe(false);
  });
  it("非空の氏名は受理し、上限長超過は拒否", () => {
    expect(isValidDisplayName("太郎")).toBe(true);
    expect(isValidDisplayName("あ".repeat(MAX_DISPLAY_NAME_LENGTH))).toBe(true);
    expect(isValidDisplayName("あ".repeat(MAX_DISPLAY_NAME_LENGTH + 1))).toBe(false);
  });
});
```

家族限定アクセス制御（無制御公開を成立させないこと・分岐 A の一致判定）:

```typescript
// tests/participants/access_control.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { checkJoinAccess } from "../../src/participants/access_control.js";

describe("家族限定アクセス制御ゲート", () => {
  afterEach(() => {
    delete process.env.JOIN_ACCESS_MODE;
    delete process.env.JOIN_ACCESS_TOKEN;
  });

  it("制御が未構成なら参加を許可しない（無制御公開は成立しない）", () => {
    expect(checkJoinAccess({ authenticated: false }).granted).toBe(false);
  });

  it("分岐A（URL 秘匿）：トークン一致のみ許可", () => {
    process.env.JOIN_ACCESS_MODE = "url_secret";
    process.env.JOIN_ACCESS_TOKEN = "family-secret";
    expect(checkJoinAccess({ presentedToken: "family-secret", authenticated: false }).granted).toBe(true);
    expect(checkJoinAccess({ presentedToken: "wrong", authenticated: false }).granted).toBe(false);
  });
});
```

参加 URL の QR がクラウド公開 `/join` を符号化すること:

```typescript
// tests/participants/join_link.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { buildJoinUrl } from "../../src/participants/join_link.js";

describe("参加 URL の組立", () => {
  afterEach(() => {
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.JOIN_ACCESS_MODE;
    delete process.env.JOIN_ACCESS_TOKEN;
  });

  it("クラウド公開の /join を符号化する", () => {
    process.env.PUBLIC_BASE_URL = "https://save-money.example.com";
    const url = new URL(buildJoinUrl());
    expect(url.origin).toBe("https://save-money.example.com");
    expect(url.pathname).toBe("/join");
  });
});
```

Vitest 以外（`node:test` 等）をランナーに用いない。ランタイム依存最小化の方針はテストランナーに及ばない。

### Operational Behavior Model

以下の単一 YAML ブロックが、`module:participants` と接続上限外出しの運用挙動について実装計画と E2E 生成が共有する権威的出典である。要件・上位設計に無い挙動は発明せず、未確定は `boundary_cases` または §3 のフラグへ回す。親設計と同一の操作は安定 ID（`dod_join_self_name`／`dod_join_no_seat_fixed`／`dod_limit_*`）を再用し、本書固有の QR 提示・アクセス制御・氏名検証・1 台紐付けの義務を追加する。

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
      label: クラウドサーバ（realtime_sync 権威 / participants）
  operations:
    - id: op_display_join_qr
      actor: host
      verb: display
      target: join_qr
      trigger: 司会者が制御盤を開くと参加用 QR が表示される
      route: /control-panel
      ui_pattern: qr_display
      preconditions:
        - PUBLIC_BASE_URL が設定済み
      measurement_source: resolvePublicBaseUrl() と（分岐A時）JOIN_ACCESS_TOKEN
      readback: QR 読取りでクラウド公開の /join へ到達する
      visible_to: [host]
      forbidden_actors: [contestant, audience]
      expected_outcomes:
        - 制御盤に /join 公開 URL を符号化した QR が表示される
        - QR 提示面に事前氏名台帳・端末番号割当の入力要素が存在しない
      dod_obligations:
        - id: dod_qr_encodes_public_join_url
          text: 制御盤に表示される QR がクラウド公開の /join URL を符号化し、読取りで /join へ到達する
        - id: dod_qr_no_seat_ledger
          text: QR 提示面に事前氏名台帳・端末番号割当の入力要素が存在しない
    - id: op_guard_family_access
      actor: system
      verb: guard
      target: join_access
      trigger: 解答者が /join へ到達し参加確定を試行
      route: /join
      measurement_source: 提示トークン（分岐A）またはセッション認証状態（分岐B）と src/config のアクセス制御設定
      preconditions:
        - 参加アクセス制御が URL 秘匿トークンまたは認証のいずれかで構成されている
      durable_state: なし（アクセス判定は設定と提示情報から導出）
      consumer_surfaces: [join_page]
      expected_outcomes:
        - 分岐A では秘匿トークン一致のときのみ /join 参加が許可される
        - 分岐B では認証済のときのみ許可され、ログイン→リダイレクト→描画のフローを備える
        - どちらの制御も未構成なら参加を許可しない（無制御公開は成立しない）
        - 受入は src/config の上限解決点と role 判定を必ず経由する
      boundary_cases:
        - アクセス制御未構成 → 参加不可（無認証の無制限公開はリリース不可構成）
        - 分岐A トークン不一致 → 参加不可
        - 分岐B 未認証 → /join は保護ナビを露出せずログインへ誘導
      dod_obligations:
        - id: dod_access_no_open_public
          text: URL 秘匿トークンも認証も未構成の場合に /join の参加確定が許可されず、無制御公開が構成上も実行上も成立しない
        - id: dod_access_single_resolution
          text: 分岐 A/B いずれでも参加受入が src/config の上限解決点と role 判定の単一経路を経由する
        - id: dod_access_no_protected_nav
          text: 未認証・未参加の /join に制御盤操作等の保護ナビが露出しない
    - id: op_join_game
      actor: contestant
      verb: join
      target: game_session
      trigger: 制御盤の QR を読取り /join で氏名を自己入力して参加確定
      route: /join
      ui_pattern: qr_scan_then_name_input
      preconditions:
        - 家族限定アクセス制御を通過している（分岐A トークン一致 または 分岐B 認証済）
        - contestant 接続数が MAX_TABLET_CONNECTIONS 未満
        - 氏名が非空かつ MAX_DISPLAY_NAME_LENGTH 以下
      measurement_source: 解答者の自己入力氏名
      durable_state: participants テーブル（id / name / joined_at / connection_id）
      readback: 制御盤の参加者一覧と TV(e) 全問通算一覧に反映
      visible_to: [host, audience]
      forbidden_actors: []
      expected_outcomes:
        - 自己入力した氏名で participants に 1 人 1 レコードが作られ connection_id へ紐付く
        - 参加が制御盤の参加者一覧と TV(e) に反映される
        - 端末番号の固定割当や事前氏名台帳を用いずに参加が成立する
      boundary_cases:
        - 空・空白のみの氏名 → UI とサーバの双方で拒否
        - MAX_DISPLAY_NAME_LENGTH 超過の氏名 → UI とサーバの双方で拒否
        - 同名の別人 → それぞれ別の participants レコード（氏名は一意キーでない）
        - 同一端末の resume なし再 /join → 新規参加として上限判定を再通過
      dod_obligations:
        - id: dod_join_self_name
          text: 参加者が自己入力した氏名が participants に永続し、制御盤の参加者一覧に表示される
        - id: dod_join_no_seat_fixed
          text: 端末番号の固定割当や事前氏名台帳の UI/API を用いずに参加が成立する
        - id: dod_join_one_device
          text: 参加確定 1 回につき connection_id へ紐づく participants レコードが 1 件だけ生成される
        - id: dod_join_reflected
          text: 参加確定が制御盤の参加者一覧と TV(e) の全問通算一覧へ反映される
        - id: dod_join_name_validation
          text: 空・空白のみ・上限長超過の氏名は /join の UI とサーバの双方で拒否され participants に入らない
    - id: op_enforce_connection_limit
      actor: system
      verb: reject
      target: tablet_connection
      trigger: contestant 接続数が MAX_TABLET_CONNECTIONS に達した状態での新規参加確定の試行
      route: /join
      measurement_source: 現在の contestant 接続数と src/config の MAX_TABLET_CONNECTIONS 解決値
      threshold: MAX_TABLET_CONNECTIONS（既定 8）
      preconditions:
        - connected_contestants >= MAX_TABLET_CONNECTIONS
      durable_state: 既存接続・participants・answers・balances は不変
      consumer_surfaces: [join_page]
      expected_outcomes:
        - admitTablet が over_limit を返し参加が成立しない
        - realtime_sync が connection_rejected とともに WS close(4001) で断る
        - 既存の接続と保持データ（participants/answers/balances/進行状態）は影響を受けない
        - host/audience 接続はタブレット上限に数えない別チャネルとして扱う
        - /join に満席の平易文が表示され設定キー名・接続数会計は露出しない
      boundary_cases:
        - 既定 8: 8 台目は許可・9 台目は拒否
        - 設定 16: 16 台目は許可・17 台目は拒否
        - 設定 32: 32 台目は許可・33 台目は拒否
        - 切断でスロット解放後は同数まで再受入可
      dod_obligations:
        - id: dod_limit_default_eight
          text: 設定未指定時に 8 台まで接続でき 9 台目が拒否される
        - id: dod_limit_config_follows
          text: MAX_TABLET_CONNECTIONS を 16/32 へ設定変更するとコード改修なしに上限がその値へ追随する
        - id: dod_limit_no_hardcode
          text: 上限判定は src/config の解決値を参照し、判定コードに数値リテラル 8 のハードコードが存在しない
        - id: dod_limit_existing_unaffected
          text: 上限拒否の発生時に既存接続のセッション・回答・残額・進行状態が変化しない
        - id: dod_limit_join_full_copy
          text: /join の満席表示が job-to-be-done 平易文で、設定キー名・接続数会計・ロール識別子を露出しない
```

---

## 3. Open Questions

壁打ち（要件定義）フェーズはクローズ済で殿判断待ちの論点は残っていない。以下は実装組み立てフェーズで MAS が決める技術選定、推測実装せず殿判断を仰ぐ点、検証ゲートで暫定運用中のフラグである。「推奨なし」「要検討」「TBD」の空白は残さず、確定した制約・既定機構・暫定ゲート値を明記する。

### 3.1 技術選定（MAS 決定・殿判断不要）

| 項目 | 決定/既定 | 制約・選定軸 |
|---|---|---|
| QR 生成ライブラリ | **`qrcode`（npm）**を採用（`src/participants/qr.ts` で SVG 符号化） | ランタイム依存最小化方針に整合する焦点の狭い軽量ライブラリ。QR は公開 `/join` URL の符号化のみで参加の権威源にしない。テストランナー（Vitest）とは無関係。 |
| 上限設定の持ち方 | 環境変数 `MAX_TABLET_CONNECTIONS` を既定機構とする | 環境変数／設定ファイル／DB 設定テーブルのいずれでも可だが `src/config/connection_limit.ts` が唯一の解決点。既定 8 は同ファイルの単一定数のみで宣言し、判定コードにリテラルを撒かない（PC-INV-2）。 |
| 参加 URL 基底 | 環境変数 `PUBLIC_BASE_URL` を既定機構とする | クラウド公開 URL を注入。QR/参加リンク組立の単一解決点（`src/config/public_base_url.ts`）。 |
| 家族限定アクセス制御 | **分岐 A（URL 秘匿・`JOIN_ACCESS_TOKEN`）／B（認証・`JOIN_ACCESS_MODE=authenticated`）を保持**（§2.6・PC-INV-3） | 無認証の無制限公開はリリース不可。`checkJoinAccess` は未構成時に参加を許可しない。方式決定まで接続上限（既定 8）とトリガー権限の司会者限定をブラスト半径抑制策とし、いずれの分岐でも上限解決点・`role: host` の単一経路を経由。 |
| 氏名表示長上限 | `MAX_DISPLAY_NAME_LENGTH = 20`（コードポイント単位） | TV 表示の安定のための設計選択値。UI とサーバで同一の `isValidDisplayName` を共有し二重防衛。実測により調整余地はあるが、非空・上限以下の検証は値に依らず成立させる。 |

### 3.2 F028 エスカレーション（推測実装しない）

- **同名参加者の識別表示（論点9改の周辺）**: 「同名の別人」を許容する（氏名は一意キーでない・identity は `participants.id`）方針は確定だが、TV(e)・制御盤一覧で同名を区別する表示上の付記（連番・参加順など）が要件に無いため発明しない。区別表示が必要と判明した場合は選択肢を添えて F028 で殿判断を仰ぐ。**1 人 = 1 台・氏名自己入力・端末番号固定割当不採用**は確定ゆえ実装・検証する。

### 3.3 検証ゲートで暫定運用中のフラグ（設計義務の欠落・発明せず flag）

- **F-05（家族限定アクセス制御）**: §3.1 の分岐 A/B 未決につき、分岐 A（`JOIN_ACCESS_TOKEN`）が設定されていればトークン一致判定を検証し、分岐 B（認証）が実装されていれば `/join` 到達前のログイン → リダイレクト → 氏名入力描画のフローを検証、いずれも未実装なら該当ブラウザテストを `test.fixme()`。ただし `checkJoinAccess` の**未構成時 `granted: false`**（無制御公開を成立させない）は値に依らず検証必須。無制御公開のまま出荷はリリース不可（PC-INV-3）。
- **F-04（反映レイテンシ SLA）**: 設計に固定 SLA が無いため、`participant_joined` の制御盤／TV(e) 反映は暫定テストゲート **p95 ≤ 2,000ms**（realtime_sync 設計と共有）で検証し、SLA 確定時に更新する。
- **接続数会計とスロット解放の整合**: 上限判定は本書の `admitTablet`／`resolveMaxTabletConnections` を権威とし、切断検知→スロット解放の機構は realtime_sync（heartbeat: ping 15 秒／pong 猶予 30 秒）に委ねる。切断後に同数まで再受入可となる整合は、当日ネットワーク実測前でも既定値で検証を通し、実測後に切断検知パラメータを更新する。
