---
codd:
  node_id: test:test-strategy
  type: test
  depends_on:
  - id: req:save-money-switcher-requirements
    relation: derives_from
    semantic: governance
  - id: test:acceptance-criteria
    relation: depends_on
    semantic: verification
  - id: governance:decision-records
    relation: depends_on
    semantic: verification
  - id: design:system-design
    relation: depends_on
    semantic: verification
  - id: design:realtime-sync-design
    relation: depends_on
    semantic: verification
  - id: design:data-model-design
    relation: depends_on
    semantic: verification
  - id: design:question-media-intake-design
    relation: depends_on
    semantic: verification
  - id: design:scoring-engine-design
    relation: depends_on
    semantic: verification
  - id: design:participation-connection-design
    relation: depends_on
    semantic: verification
  - id: design:operational-behavior-model
    relation: depends_on
    semantic: verification
  - id: design:surface-copy-obligations
    relation: depends_on
    semantic: verification
  - id: detailed_design:shared-domain-model
    relation: depends_on
    semantic: verification
  - id: detailed_design:er-crud-model
    relation: depends_on
    semantic: verification
  - id: detailed_design:state-machines
    relation: depends_on
    semantic: verification
  - id: detailed_design:sequence-flows
    relation: depends_on
    semantic: verification
  - id: detailed_design:component-dependency-map
    relation: depends_on
    semantic: verification
  - id: plan:implementation-plan
    relation: depends_on
    semantic: verification
  - id: infra:deployment-setup
    relation: depends_on
    semantic: verification
  - id: operations:runbook
    relation: depends_on
    semantic: verification
  depended_by: []
  conventions: []
  modules:
  - config
  - control_panel
  - game_flow
  - media
  - participants
  - questions
  - realtime_sync
  - scoring
  - tablet
  - tv_display
---

# テスト戦略と検証可能挙動レジストリ（Test Strategy and Verifiable Behavior Registry）

## 1. Overview

### 1.1 本書の役割 — VB 名前空間の唯一の正準所有者

本書は `save-money-switcher`（クラウド WEB アプリ版『賞金先渡しクイズ SAVE MONEY』を家族で遊ぶ操作盤）の **テスト戦略** であり、同時に本プロジェクトの **検証可能挙動（Verifiable Behavior, VB）id 名前空間を単独所有する正準レジストリ** である。要件 `req:save-money-switcher-requirements`（approved）を唯一の真実源とし、それを統べる設計群（`design:system-design`／`design:realtime-sync-design`／`design:data-model-design`／`design:question-media-intake-design`／`design:scoring-engine-design`／`design:participation-connection-design`／`design:operational-behavior-model`／`design:surface-copy-obligations`／`detailed_design:*`／`plan:implementation-plan`／`infra:deployment-setup`／`operations:runbook`）の `operation_flow` と `dod_obligations` を漏れなく検証義務へ写像する。

- **VB は本書 §1.6 でのみ宣言する。** 兄弟の `test:acceptance-criteria`（`docs/test/acceptance_criteria.md`）は VB を宣言せず、自らの受け入れ基準 `AC-xx` を本書の `VB-xx` へ後方参照する（REFERENCE-ONLY）。本書の `VB-01`〜`VB-55` は `AC-01`〜`AC-39` の `Canonical VBs` 列と一致し、`VB-56` 以降は AC が明示しない設計義務（家族限定アクセス制御・再接続整合・入稿堅牢性・ライブ編集拡張・サーフェス／コピー義務・勝者同点）を追加宣言する。
- **VB id は不変（immutable）。** 一度発番した id は改番・改名・転用しない。下流のテストマーカー `// codd: covers vb=<id>` が id に束縛されるため、退役は行削除、追加は新規発番で行う。
- **各 VB は原子的（atomic）** で、公開サーフェスにおける **観測可能な入力 → 帰結**（呼び出し／イベント → 戻り値・raised error・emit 出力・永続後の読み戻し・可視 UI 変化）として表す。内部状態のみで観測不能な性質は VB としない（設計 prose で扱う）。設計時 `operation_flow` レコードを運用テスト義務の権威的出典とし、要件・設計に無い E2E 挙動は発明せず、欠落があれば §1.7 で flag する。

### 1.2 対象プロダクトの確定像（テスト対象の要約）

- **形態**: クラウド上で常時稼働する単一の Node（LTS 20）プロセス（`node dist/main.js`）が唯一の HTTP/WebSocket 権威。制御盤 `/control-panel`・TV `/tv`・解答者タブレット `/tablet`・参加受付 `/join` は**クラウド公開 URL（`PUBLIC_BASE_URL`）へブラウザ接続する純クライアント**であり待受ソケットを持たない。**ホスト PC はサーバにしない**。
- **ゲームルール（案A・SAVE MONEY 準拠・個人戦）**: 先渡し **10,000 円** / 誤差1につき **−100円** / ピタリ賞（誤差0）で他プレイヤーから **+1,000円** / **1ゲーム10問** / 残額最多勝ち。回答は **0〜100 の整数**のみ。**円建て固定**（`point`/`pt`/`点` 禁止）。
- **進行状態機**: `accepting` →（「そこまで」`answers_locked`）→（「解答オープン！」`answers_opened`＝b）→（正解発表 `answer_revealed`＝c）→（得点精算 `settlement_computed`＝d）。各問は b/c/d のどこまで進んだかを `rounds.stage` に保持。
- **TV 5モード（MC切替）**: a 出題（動画→画像→テキストの3段フォールバック）/ b 解答オープン / c 正解発表 / d 1問精算（**氏名/解答/誤差/増減円/ピタリ賞/残額**の6列全員表）/ e 全問通算一覧。切替は制御盤から **①「次へ」 ②「戻る」 ③個別ジャンプ** の3系統。
- **タブレット**: 入力専用最小 UI（**問題番号/数値入力/送信済み表示/自分の残額**のみ）。入力は **+1/−1/+10/−10 の4ボタン**。他者情報・出題内容・全体一覧は出さない。
- **参加登録・上限**: QR 読取→氏名自己入力・1人=1台。同時接続上限は既定 **8**、`MAX_TABLET_CONNECTIONS` で **8→16→32** へ非改修追随、超過は `connection_rejected`＋WS `close(4001)`。
- **問題データ・再採点**: 事前ファイル読込で `questions` へ DB 登録・DB 供給。進行中もライブ編集可。「c 正解発表」実行後の正解ライブ編集は**自動再採点**し、d 到達なら残額差分再計算と TV d/e 同時更新。
- **権限**: 締切・開示・正解発表・精算・モード切替・取消・入稿・ライブ編集は**司会者（制御盤・`role: host`）のみ**。取消は初版から host 権限操作として含む。

### 1.3 実装・テストの技術前提（scaffold 固定・釈義不可）

- **実装言語 = TypeScript のみ。** 全ファイルパス・パッケージ配置・依存管理・ツールチェーンは TypeScript 慣行のみを用いる（他言語の拡張子・マニフェスト・ツールは例示・フォールバックとしても登場させない）。稼働ランタイムは Node（LTS 20）、ビルドは `tsc` が `src/**/*.ts` → `dist/**/*.js`（NodeNext）へ emit する。出荷ランタイム依存は `ws`（WebSocket）・`qrcode`（QR 生成）。
- **テストランナー = Vitest（scaffold・verify で固定・release-blocking のグラウンドトゥルース）。** 本書のすべてのテスト記述・例は Vitest 自身の宣言 API（`import { describe, it, expect } from "vitest";`）を対象とする。ランタイム依存最小化の方針は**出荷コードの実行時依存**（`ws`/`qrcode` の採否）にのみ及び、テストランナーには及ばない。依存数の哲学を根拠に別フレームワークや Node 組み込み `node:test` をランナーに用いてはならない。verify が実際に走らせるのは Vitest（`vitest run`）である。
- **モジュール解決 = NodeNext/Node16。** 相対 import は**必ず出力ファイル名の拡張子 `.js` を明示**する（`import { assertAnswerScore } from "../../src/scoring/answer_score.js";`。`"./x"` も `"./x.ts"` も不可）。type-only import・re-export・default/namespace import も同一規約。拡張子欠落は **TS2835** でコンパイル不能となり `npm run build` が落ちる。
- **レイアウト契約（output-path fence 強制）**: テストは**必ず `tests/` 配下**、ソースは**必ず `src/` 配下**（`test/`・`spec/`・`specs/` を発明しない。`tests/scoring/`・`tests/e2e/helpers/` 等のサブディレクトリは可）。`package.json`・`package-lock.json`・`tsconfig.json`・`vitest.config.ts` は harness scaffold が所有し、本書はこれらを成果物として出力・宣言しない。CI 定義（`.github/workflows/ci.yml`）・`Dockerfile` は言語非依存の運用資産でありリポジトリルートに置く。
- **E2E の駆動**: ブラウザ操作は Playwright を**ライブラリ import**（`import { chromium, type Page } from "playwright";`）して駆動し、宣言・検証は Vitest（`describe/it/expect`）で行う。API/WS 統合は `fetch` / Playwright `request` context / `ws` クライアントを用い、いずれも `expect` で検証する。

### 1.4 テストレベルと配置

| レベル | 対象 | 配置（`tests/` 配下） | 主手段 |
|---|---|---|---|
| **Unit** | 純関数・値型・述語・設定解決・依存境界 | `tests/scoring/*.test.ts`・`tests/game_state/*.test.ts`・`tests/config/*.test.ts`・`tests/participants/*.test.ts`・`tests/realtime_sync/*.test.ts`・`tests/questions/*.test.ts`・`tests/media/*.test.ts`・`tests/architecture/dependency_rules.test.ts` | Vitest（I/O なし・純関数） |
| **API 統合** | エンドポイント応答・ステータス・データ契約・WS 配信 | `tests/e2e/<domain>.spec.ts` | Playwright `request` / `fetch` / `ws` クライアント（サーバの検証） |
| **ブラウザ** | 実ユーザー操作・可視 UI・遷移・禁止要素/禁止コピーの不在 | `tests/e2e/<domain>.browser.spec.ts` | Playwright `page`（ユーザー体験の検証） |

ファイル名でレベルが即判別できること（`.spec.ts`=API、`.browser.spec.ts`=ブラウザ）。共有処理は `tests/e2e/helpers/` に集約する（§4.3）。

### 1.5 検証可能挙動の列挙方針

VB は要件・設計の `operation_flow`／`dod_obligations`／`boundary_cases` から機械的に導出した。遷移連鎖（例: 送信 → `answer_submitted` 永続 → 誤差×−100・残額導出 → TV d/e 反映）は各リンクを別 VB として原子化する。閾値・境界（0〜100 整数、既定8/16/32、誤差0/1、p95 ≤ 2,000ms）は下/丁度/上を別 VB または別シナリオで押さえる。要件で未確定の部分（F-01〜F-06）は確定部分のみ VB として検証し、未確定部分は §1.7 の flag と `test.fixme()` に回す。

### 1.6 検証可能挙動レジストリ（VB Registry・正準・トレーサビリティ）

以下が本プロジェクトの全 VB とその検証シナリオである。第1列の `VB-<id>` を `codd test audit` が機械解析する。`検証レベル` は §1.4 の Unit / API / Browser。`テストシナリオ` は §4.2 のドメイン出力ファイル（`tests/e2e/`）または Unit ファイルを指す。`カバレッジ / フラグ` はカバー状況と、未確定に伴う `test.fixme()` の対象を示す。

**クラウド・アーキテクチャ / リアルタイム同期（module:realtime_sync）**

| VB | 観測可能な入力 → 帰結（公開サーフェス） | 検証レベル | テストシナリオ（`tests/` 配下） | カバレッジ / フラグ |
|----|----------------------------------------|-----------|-------------------------------|---------------------|
| VB-01 | 制御盤/TV/タブレットの3クライアント種別がクラウド公開URLへブラウザ接続し、初期ロードが `status < 500` かつ 200 系で可視描画される | Browser, API | `realtime-sync.browser.spec.ts` / `realtime-sync.spec.ts` | covered |
| VB-02 | host の締切/開示/モード切替/再採点が確定すると、当該ロールの接続中全端末へドメインイベントが配信される | API, Browser | `realtime-sync.spec.ts` / `.browser.spec.ts` | covered |
| VB-03 | 状態遷移の全端末反映が p95 ≤ 2,000ms を満たす | API | `realtime-sync.spec.ts`（perf 相当） | covered（F-04 暫定ゲート） |
| VB-04 | 制御盤ブラウザを閉じても TV とタブレット間の同期がクラウド権威経由で継続する（制御盤は待受サーバでない） | Browser | `realtime-sync.browser.spec.ts` | covered |
| VB-05 | 回線断後に再接続した端末が現在問題番号・進行段階・TVモード・自分の残額へサーバ権威（`game_state`/`balances`）から復帰する | Browser, API | `realtime-sync.spec.ts` / `.browser.spec.ts` | covered |
| VB-60 | 受付中に送信済みの解答が接続断・再接続を跨いで保持され、送信済み表示へ復帰する | API, Browser | `realtime-sync.spec.ts` / `.browser.spec.ts` | covered |
| VB-61 | 再接続後の再送で同一 `(question_id, participant_id)` の解答行が重複せず一意に保たれる | API | `realtime-sync.spec.ts` | covered |
| VB-62 | 配信ペイロードがロール投影を経由し、解答者端末へ他者の解答・残額・得点が配信されない | API | `realtime-sync.spec.ts` | covered |

**参加登録・端末紐付け・家族限定アクセス制御（module:participants）**

| VB | 観測可能な入力 → 帰結（公開サーフェス） | 検証レベル | テストシナリオ | カバレッジ / フラグ |
|----|----------------------------------------|-----------|---------------|---------------------|
| VB-06 | 制御盤に参加用クラウドURLを符号化した QR が可視要素として表示される | Browser | `participation.browser.spec.ts` | covered |
| VB-07 | タブレットが `/join` で氏名を自己入力して参加確定すると `participants` に1人1レコードが `connection_id` 紐付きで永続する | Browser, API | `participation.spec.ts` / `.browser.spec.ts` | covered |
| VB-08 | 参加確定が制御盤の参加者一覧と TV(e) 全問通算一覧に反映される | Browser, API | `participation.spec.ts` / `.browser.spec.ts` | covered |
| VB-09 | 端末番号の固定割当・事前氏名台帳の UI/API を用いずに参加が成立する（該当入力要素が存在しない） | Browser | `participation.browser.spec.ts` | covered |
| VB-56 | 家族限定アクセス制御が未構成の場合 `/join` の参加確定が許可されない（無制御公開が成立しない） | API, Browser | `participation.spec.ts` / `.browser.spec.ts` | covered |
| VB-57 | 分岐A(URL秘匿)で提示トークンが設定トークンと一致するときのみ参加が許可され、不一致は拒否される | API | `participation.spec.ts` | covered（未構成時は F-05 で `test.fixme()`） |
| VB-58 | 未認証・未参加の `/join` に保護ナビ(制御盤操作)が露出せず、分岐B認証時はログイン→リダイレクト→氏名入力描画のフローを備える | Browser | `participation.browser.spec.ts` | 認証未実装なら F-05 で `test.fixme()` |
| VB-59 | 空・空白のみ・上限長超過の氏名が UI とサーバの双方で拒否され `participants` に入らない | API, Browser | `participation.spec.ts` / `.browser.spec.ts` | covered |
| VB-81 | `/join` に氏名入力欄と「参加する」が表示され、事前氏名台帳・端末番号割当の入力要素が存在しない | Browser | `participation.browser.spec.ts` | covered |
| VB-85 | 制御盤の QR 提示面に事前氏名台帳・端末番号割当の入力要素が存在しない | Browser | `participation.browser.spec.ts` | covered |

**同時接続上限・設定外出し（module:config, module:participants）**

| VB | 観測可能な入力 → 帰結（公開サーフェス） | 検証レベル | テストシナリオ | カバレッジ / フラグ |
|----|----------------------------------------|-----------|---------------|---------------------|
| VB-10 | 上限未設定(既定8)で 8 台目タブレットまで接続が成立する | API | `connection-limit.spec.ts` | covered |
| VB-11 | 9 台目のタブレット接続が `connection_rejected`＋WS `close(4001)` で断られる | API | `connection-limit.spec.ts` | covered |
| VB-12 | 上限が `MAX_TABLET_CONNECTIONS` として外出しされ、設定注入で受入可否が変わる（判定経路に数値リテラル 8 が無い） | Unit, API | `tests/config/connection_limit.test.ts`・`tests/participants/admission.test.ts` / `connection-limit.spec.ts` | covered |
| VB-13 | `MAX_TABLET_CONNECTIONS=16` で 16 台目まで接続可・17 台目拒否（コード改修なし追随） | API | `connection-limit.spec.ts` | covered |
| VB-14 | `MAX_TABLET_CONNECTIONS=32` で 32 台目まで接続可・33 台目拒否 | API | `connection-limit.spec.ts` | covered |
| VB-15 | 上限超過拒否時に既存接続・`participants`・`answers`・`balances` が不変である | API, Browser | `connection-limit.spec.ts` / `.browser.spec.ts` | covered |
| VB-82 | 満席時の `/join` に job-to-be-done 平易文が表示され、設定キー名・接続数会計・ロール識別子が露出しない | Browser | `connection-limit.browser.spec.ts` / `participation.browser.spec.ts` | covered |

**ゲーム進行・状態機（module:game_flow）**

| VB | 観測可能な入力 → 帰結（公開サーフェス） | 検証レベル | テストシナリオ | カバレッジ / フラグ |
|----|----------------------------------------|-----------|---------------|---------------------|
| VB-16 | 受付中(accepting)にタブレットが送信した 0〜100 整数解答が `answers` に永続化され再表示できる | API, Browser | `game-flow.spec.ts` / `.browser.spec.ts` | covered |
| VB-17 | host「そこまで」(lock)後、全解答者タブレットの入力がロックされる | Browser, API | `game-flow.browser.spec.ts` / `.spec.ts` | covered |
| VB-18 | 締切(`answers_locked`)後の submit がサーバで拒否され `answers` に追加されない（既存解答は保持） | API | `game-flow.spec.ts` | covered |
| VB-19 | 開示(b)未実行の間は他者の解答がどの端末にも表示・配信されない | Browser, API | `game-flow.spec.ts` / `.browser.spec.ts` | covered |
| VB-20 | host「解答オープン！」(open)で TV(b) に全員の氏名＋解答が一斉表示される | Browser | `game-flow.browser.spec.ts` | covered |
| VB-21 | 各問の進行段階(b/c/d)がサーバ側 `rounds.stage` に保持され再取得できる | API | `game-flow.spec.ts` | covered |

**制御盤の権限境界・取消（module:control_panel, role:host）**

| VB | 観測可能な入力 → 帰結（公開サーフェス） | 検証レベル | テストシナリオ | カバレッジ / フラグ |
|----|----------------------------------------|-----------|---------------|---------------------|
| VB-22 | 締切・開示・取消を制御盤(host)から発動すると成功する | Browser, API | `control-authority.spec.ts` / `.browser.spec.ts` | covered |
| VB-23 | 解答者タブレット・非hostから締切・開示・取消コマンドを送ると 401/403 で拒否される | API | `control-authority.spec.ts` | covered |
| VB-24 | 非host UI(`/tablet`,`/tv`)に締切・開示・取消の操作要素が存在しない | Browser | `control-authority.browser.spec.ts` | covered |
| VB-25 | host の取消(undo)で `trigger_undone` が配信され直近の対象操作が取り消される | Browser, API | `control-authority.spec.ts` / `.browser.spec.ts` | host限定は covered。巻き戻し副作用詳細は F-03 で `test.fixme()` |
| VB-74 | 得点精算(settle)は host のみ発動でき、非host の精算コマンドは 401/403 で拒否される | API | `control-authority.spec.ts` | covered |
| VB-75 | モード切替は host のみ発動でき、非host のモード切替は 403 で拒否される | API | `control-authority.spec.ts` | covered |
| VB-77 | 制御盤に締切/開示/正解発表/精算/次へ/戻る/取消/個別ジャンプの操作要素が司会者向け操作語で存在する | Browser | `control-authority.browser.spec.ts` | covered |
| VB-78 | 制御盤に解答者用の数値入力送信面(+1/-1/+10/-10 と送信)が存在しない | Browser | `control-authority.browser.spec.ts` | covered |

**スコアリング・入力仕様（module:scoring, module:tablet）— リリースブロッキング**

| VB | 観測可能な入力 → 帰結（公開サーフェス） | 検証レベル | テストシナリオ | カバレッジ / フラグ |
|----|----------------------------------------|-----------|---------------|---------------------|
| VB-26 | ゲーム開始(参加確定)時に各プレイヤーの `balances.amount` が 10,000 円で初期化され表示される | API, Browser | `tests/scoring/apply_question_score.test.ts` / `scoring.spec.ts` / `.browser.spec.ts` | covered |
| VB-27 | 誤差 = \|解答 − 正解\| が 0〜100 の整数として算出される | Unit, API | `tests/scoring/apply_question_score.test.ts` / `scoring.spec.ts` | covered |
| VB-28 | 増減円 = 誤差 × −100 で減算される（誤差5 → −500円） | Unit, API | `tests/scoring/apply_question_score.test.ts` / `scoring.spec.ts` | covered |
| VB-29 | 誤差0のピタリ賞で当該プレイヤーへ +1,000 円が加算される | Unit, API, Browser | `tests/scoring/*` / `scoring.spec.ts` / `.browser.spec.ts` | 加算側 covered。拠出配分は F-02 で `test.fixme()` |
| VB-30 | 誤差1では −100 円のみでピタリ賞が付かない（誤差0直上の境界・不連続） | Unit, API | `tests/scoring/apply_question_score.test.ts` / `scoring.spec.ts` | covered |
| VB-31 | 全10問終了時に残額最多のプレイヤーが e モードで勝者として判別可能に表示される | API, Browser | `scoring.spec.ts` / `tv-display.browser.spec.ts` | covered |
| VB-32 | 入力値 0 と 100 が入力・判定・スコアリングの全経路で受理される | Unit, API, Browser | `tests/scoring/*` / `scoring.spec.ts` / `.browser.spec.ts` | covered |
| VB-33 | 入力値 −1/101/50.5 が UI(タブレット)側で拒否され送信できない | Browser | `scoring.browser.spec.ts` / `tablet-ui.browser.spec.ts` | covered |
| VB-34 | 入力値 −1/101/50.5 がサーバ側でも拒否され `answers` に入らない | API | `scoring.spec.ts` | covered |
| VB-35 | 金額が全サーフェス・API・内部表現で円建てであり `point`/`pt`/`点` が存在しない | Browser, API | `scoring.spec.ts` / `tv-display.browser.spec.ts` / `tablet-ui.browser.spec.ts` | covered |
| VB-76 | 残額同点時に複数の共同首位が e モードで勝者として提示される（同点優先順位を発明しない） | API, Browser | `tests/scoring/determine_winner.test.ts` / `scoring.spec.ts` / `tv-display.browser.spec.ts` | covered（F-06 タイブレーク導入時は再評価） |

**ライブ編集・自動再採点（module:scoring, module:game_flow, module:questions）— リリースブロッキング**

| VB | 観測可能な入力 → 帰結（公開サーフェス） | 検証レベル | テストシナリオ | カバレッジ / フラグ |
|----|----------------------------------------|-----------|---------------|---------------------|
| VB-36 | 進行中に host が問題文・正解値をライブ編集すると `questions` に永続し再取得で読み戻せる | API, Browser | `live-edit-rescoring.spec.ts` / `.browser.spec.ts` | covered |
| VB-37 | c(正解発表)実行後に正解をライブ編集すると自動再採点され各人の残額へ即時反映される | API, Browser | `live-edit-rescoring.spec.ts` / `.browser.spec.ts` | covered |
| VB-38 | c 未到達で正解を編集しても再採点は起きず `balances` 不変（境界外） | API | `live-edit-rescoring.spec.ts` | covered |
| VB-39 | d(精算)到達済みの問の正解訂正で残額の差分再計算が行われる | API, Browser | `live-edit-rescoring.spec.ts` / `.browser.spec.ts` | covered |
| VB-40 | 差分再計算に伴い TV(d) 精算表示と TV(e) 全員一覧が同時更新される | Browser | `live-edit-rescoring.browser.spec.ts` | covered |
| VB-68 | 動画/画像パスのライブ編集が永続し、次の a モード描画が編集後の `video→image→text` 規定順に従う | API, Browser | `live-edit-rescoring.spec.ts` / `tv-display.browser.spec.ts` | covered |
| VB-69 | 問題文・メディアパスのみの編集では再採点が走らず `balances` が不変である | API | `live-edit-rescoring.spec.ts` | covered |
| VB-70 | 差分更新後の `balances` が `answers`＋編集後 `correct_value` からの全再計算と一致する（監査不変式） | Unit, API | `tests/scoring/rescore_question.test.ts` / `live-edit-rescoring.spec.ts` | covered |
| VB-71 | ライブ編集の正解値も 0〜100 整数のみ受理し範囲外はサーバと DB CHECK で拒否される | API | `live-edit-rescoring.spec.ts` | covered |
| VB-72 | ライブ編集は host のみ発動でき、非host の編集コマンドは 401/403 で拒否される | API | `live-edit-rescoring.spec.ts` / `control-authority.spec.ts` | covered |

**タブレット UI（module:tablet）**

| VB | 観測可能な入力 → 帰結（公開サーフェス） | 検証レベル | テストシナリオ | カバレッジ / フラグ |
|----|----------------------------------------|-----------|---------------|---------------------|
| VB-41 | タブレット画面の可視要素が 問題番号/数値入力/送信済み表示/自分の残額 に限られる | Browser | `tablet-ui.browser.spec.ts` | covered |
| VB-42 | 数値入力が +1/−1/+10/−10 の4ボタン方式で 0〜100 を増減する（テンキー直接入力でない） | Browser | `tablet-ui.browser.spec.ts` | covered |
| VB-43 | ステッパが 0 未満・100 超へ振り切れない（境界クランプ） | Browser | `tablet-ui.browser.spec.ts` | covered |
| VB-44 | タブレットに他者の残額/得点/解答・出題内容・全体一覧が表示されない | Browser | `tablet-ui.browser.spec.ts` | covered |

**TV 表示・MC 切替・出題フォールバック（module:tv_display）**

| VB | 観測可能な入力 → 帰結（公開サーフェス） | 検証レベル | テストシナリオ | カバレッジ / フラグ |
|----|----------------------------------------|-----------|---------------|---------------------|
| VB-45 | TV が a/b/c/d/e の5モードを表示できる | Browser | `tv-display.browser.spec.ts` | covered |
| VB-46 | 制御盤の「次へ」「戻る」「個別ジャンプ」の3系統でモード切替コマンドが発火する | Browser | `tv-display.browser.spec.ts` | covered |
| VB-47 | モード切替で TV の表示モード(URL/可視コンテンツ)が対応値へ切り替わる | Browser | `tv-display.browser.spec.ts` | covered |
| VB-48 | a モードで動画パス有の問は動画が出題面として描画される（画像有無に関わらず動画優先） | Browser, API | `tv-display.browser.spec.ts` / `.spec.ts` | covered |
| VB-49 | a モードで動画無・画像有は画像、双方無はテキストへフォールバックする | Browser, API | `tv-display.browser.spec.ts` / `.spec.ts` | covered |
| VB-50 | d モードが当該問の6列表(氏名/解答/誤差/増減円/ピタリ賞/残額)を円建てで表示し §scoring 算出と一致する | Browser | `tv-display.browser.spec.ts` | covered |
| VB-51 | e モードが全問通算の全員得点一覧を表示し d(当該問フォーカス)と役割が分かれる | Browser | `tv-display.browser.spec.ts` | covered |
| VB-55 | MVP の正解発表が開示一覧＋正解値＋得点増減(円)の表示で成立し効果音/カウントダウン/アニメ/ランキング演出を要求しない | Browser | `tv-display.browser.spec.ts` | covered |
| VB-73 | 正解発表(reveal)実行で当該問が開示済み(c)として記録され TV(c) に正解値が表示される | Browser, API | `tv-display.browser.spec.ts` / `live-edit-rescoring.spec.ts` | covered |
| VB-83 | TV a モードの表示に生ファイルパス文字列や `fallback` 等の内部語が露出しない | Browser | `tv-display.browser.spec.ts` | covered |
| VB-84 | TV にいかなる入力・操作要素も存在せず可視文言が観客向けで司会者操作語を含まない | Browser | `tv-display.browser.spec.ts` | covered |

**問題データ入稿・MVP 演出（module:questions, module:media, module:config）**

| VB | 観測可能な入力 → 帰結（公開サーフェス） | 検証レベル | テストシナリオ | カバレッジ / フラグ |
|----|----------------------------------------|-----------|---------------|---------------------|
| VB-52 | 事前問題ファイルを読み込むと各問(text/画像パス/動画パス/正解値)が `questions` に DB 登録される | API | `question-data.spec.ts` | covered |
| VB-53 | ランタイム出題が `questions` テーブルから供給され再取得で登録時と同一の text・`correct_value` を返す | API | `question-data.spec.ts` | covered |
| VB-54 | 動画が問題ファイルのパス記載＋所定フォルダ配置で解決され、当日その場入力の UI/API に依存しない | API, Browser | `question-data.spec.ts` / `.browser.spec.ts` | covered |
| VB-63 | 入稿検証エラーが1件でもある問題ファイルでは `questions` が1行も登録されない（全 or 無） | API | `question-data.spec.ts` | covered |
| VB-64 | 宣言された画像/動画パスに所定フォルダ配下の実体が無い場合は問題番号を添えて入稿が拒否される | API | `question-data.spec.ts` | covered |
| VB-65 | `correct_value` が 0〜100 の整数以外の問題は入稿で拒否される（入稿検証＋DB CHECK） | API, Unit | `question-data.spec.ts` / `tests/questions/load_questions.test.ts` | covered |
| VB-66 | `image_path`/`video_path` 未指定の問題が NULL として登録・出題できる | API | `question-data.spec.ts` | covered |
| VB-67 | 問題読込は host のみ発動でき、非host の読込コマンドは 401/403 で拒否される | API | `question-data.spec.ts` / `control-authority.spec.ts` | covered |

**サーフェス／コピー義務（module:control_panel, module:tablet, module:tv_display）— 全ロール横断**

| VB | 観測可能な入力 → 帰結（公開サーフェス） | 検証レベル | テストシナリオ | カバレッジ / フラグ |
|----|----------------------------------------|-----------|---------------|---------------------|
| VB-79 | 制御盤・タブレット・TV の可視文言に内部ロール識別子/内部イベント名/設定キー名/デモ・テスト表記が存在しない | Browser | `control-authority.browser.spec.ts` / `tablet-ui.browser.spec.ts` / `tv-display.browser.spec.ts` | covered |
| VB-80 | 全サーフェスでロールが 司会者/解答者/観客 の可視ラベルで表され `host/answerer/audience` が露出しない（単一ラベル定義から供給） | Browser, Unit | `tests/game_state/role_labels.test.ts` / 各 `*.browser.spec.ts` | covered |

**カバレッジ結論**: VB-01〜VB-85 の 85 挙動すべてが少なくとも 1 つの検証シナリオへ写像されている。未検証（無シナリオ）の VB は存在しない。未確定要件に伴う一部は §1.7 のとおり確定部分を検証し、未確定部分のみ `test.fixme()` で明示保留する。

### 1.7 未確定フラグと `test.fixme()` の取り回し（発明せず flag）

設計時 `operation_flow` に無い挙動は発明しない。以下は要件で未確定または曖昧なため、確定部分のみアサートし未確定部分を `test.fixme()` として残す。設計義務の追加が必要な場合は推測実装せず F028 相当で殿判断を仰ぐ。

- **F-01（残額の下限・脱落）**: 確定要件は「誤差×−100円」「先渡し10,000円」のみで、残額の 0 下限・全額喪失での脱落は確定要件に無い。E2E は残額が負に至る経路を**下限を仮定せず**検証し、下限/脱落を導入する実装が現れた場合にフラグする。
- **F-02（ピタリ賞の拠出配分）**: VB-29 の加算側 +1,000 は検証必須。拠出元と配分（総額1,000か各人からか、複数同時ピタリの扱い）は未確定ゆえ拠出側は `test.fixme()`。
- **F-03（取消の具体挙動）**: VB-25 の発動権限＝制御盤(host)のみは確定ゆえ検証し、巻き戻し範囲（直近のみか任意問題再開示か、d 到達問の残額差分巻き戻し）は `test.fixme()`。
- **F-04（同期レイテンシ SLA）**: 設計に固定 SLA が無い。VB-03 の p95 ≤ 2,000ms はテストゲートとして設定し、SLA 確定時に更新する旨をフラグする。
- **F-05（家族限定アクセス制御）**: VB-56 の未構成時に参加不許可は値に依らず検証必須。VB-57/VB-58 は分岐A（`JOIN_ACCESS_TOKEN`）実装時はトークン一致判定を、分岐B（認証）実装時はログイン→リダイレクト→描画を検証し、いずれも未実装なら該当を `test.fixme()`。
- **F-06（残額同点時の勝者優先順位）**: VB-76 は同点を複数の共同首位として提示し、優先順位を発明しない。タイブレークを導入する実装が現れた場合にフラグする。
- **F-06'（動画コーデック/配信方式）**: TV a モードで確実に再生できるコンテナ/コーデックの固定値は設計に無い。VB-48/VB-49 はパス存在と解決順のみを義務とし、再生可否は入稿検証の拡張対象としてフラグする。

## 2. Acceptance Criteria

各基準は「満たせば PASS」を機械検証可能な形で述べる。VB 名前空間の宣言は §1.6 が唯一の owner であり、本節はそれを参照する。テスト対象は稼働中サーバ（§4.9）を前提とし、全 HTTP アサーションはまず `status < 500`（健全性ベースライン）を確認してから業務ステータスを検証する。

### 2.1 スイート合格の必要十分条件（Quality Gate）

以下を**全て**満たすときのみ合格とする。

1. **全 PASS・SKIP ゼロ**: 選択スイート内に FAIL が 1 件も残らず、実装済み挙動の SKIP が 0 件であること。未実装エンドポイント・未確定挙動は `test.fixme()` で明示し、SKIP と区別する。
2. **VB 完全カバレッジ**: §1.6 の VB-01〜VB-85 の各挙動が、少なくとも 1 つの PASS するシナリオ（Unit / API / Browser のいずれか）でカバーされていること。`codd test audit` が各 VB を PASS へ紐付けられること。
3. **operation_flow 運用義務のカバレッジ**: 全設計の `operation_flow.operations[].dod_obligations` に未検証の抜けが無いこと（各 `dod_*` が §1.6 の VB を通じて検証されること）。
4. **リリースブロッキング規約の遵守**: §3 の NC-1〜NC-6、レイアウト/ツールチェーン規約、5xx 健全性ベースライン、遷移の URL＋可視要素二重検証をすべて満たすこと。
5. **両レベルの生成・実行**: API 統合テストとブラウザテストが両レベルとも生成・実行され、ファイル命名規約（`.spec.ts` / `.browser.spec.ts`）に従うこと。

### 2.2 ドメイン別の合格条件（VB 参照）

| ドメイン | 合格条件（要旨） | 主要 VB | 検証レベル |
|---------|-----------------|--------|-----------|
| クラウド同期 | 3クライアントがクラウドURLへ接続・全端末リアルタイム反映・制御盤非サーバ・再接続復帰・回答保持・ロール投影 | VB-01〜VB-05, VB-60〜VB-62 | Browser, API |
| 参加・アクセス制御 | QR 表示・氏名自己入力参加・1人1台・固定割当不採用・未構成時参加不許可・氏名検証・保護ナビ非露出 | VB-06〜VB-09, VB-56〜VB-59, VB-81, VB-85 | Browser, API |
| 接続上限 | 既定8・9台目拒否・設定外出し・16/32 非改修追随・既存不変・満席平易文 | VB-10〜VB-15, VB-82 | Unit, API, Browser |
| ゲーム進行 | 受付中送信永続・締切ロック・締切後拒否・開示前伏せ・TV(b)一斉表示・段階保持 | VB-16〜VB-21 | API, Browser |
| 権限境界・取消 | host のみ発動成功・非host 401/403・非host UI に操作要素なし・取消 host限定 | VB-22〜VB-25, VB-74, VB-75, VB-77, VB-78 | API, Browser |
| スコアリング（RB） | 10,000円初期化・誤差×−100・ピタリ+1000・誤差1境界・0/100受理・−1/101/50.5 二重防衛拒否・円建て・勝者・同点 | VB-26〜VB-35, VB-76 | Unit, API, Browser |
| ライブ編集・再採点（RB） | 問題/正解編集永続・c 後自動再採点・c 前非誘発・d 差分再計算・TV d/e 同時更新・メディア編集反映・全再計算一致・host限定・範囲防衛 | VB-36〜VB-40, VB-68〜VB-72 | API, Browser, Unit |
| タブレット UI | 最小UI限定・4ボタン・クランプ・他者情報/出題内容/全体一覧の不在 | VB-41〜VB-44 | Browser |
| TV 表示 | 5モード・3系統切替・URL＋可視二重検証・出題面フォールバック・6列表・通算一覧・c 正解値・内部語非露出・入力要素不在・MVP最小演出 | VB-45〜VB-51, VB-55, VB-73, VB-83, VB-84 | Browser, API |
| 問題データ入稿 | ファイル→DB登録・DB供給・動画パス解決・全or無・未配置拒否・整数防衛・任意NULL・host限定 | VB-52〜VB-54, VB-63〜VB-67 | API, Browser, Unit |
| サーフェス／コピー | 内部語非露出・可視ラベル写像（司会者/解答者/観客） | VB-79, VB-80 | Browser, Unit |

（RB＝リリースブロッキング）

### 2.3 レベル分離の合格条件（API 統合 vs ブラウザ）

- **API 統合テスト**（`tests/e2e/<domain>.spec.ts`）: エンドポイント応答・ステータス・データ契約を Playwright `request` / `fetch` / `ws` で検証する（サーバの検証）。全 HTTP アサーションは共有ヘルパ `assertServerHealthy(response)` を経由し、まず `status < 500` を確認してから業務ステータス（200/302/401/403 等）を検証する。
- **ブラウザテスト**（`tests/e2e/<domain>.browser.spec.ts`）: Playwright `page` で実操作（クリック・4ボタン入力・フォーム送信・遷移）と可視 UI を検証する（ユーザー体験の検証）。ユーザー操作による遷移は**遷移先 URL のアサート**と**遷移先の可視要素を最低1つ**のアサートを両方行う（HTTP ステータスのみ・URL のみは不合格）。認証がある場合（F-05）はログインページ遷移 → 資格情報入力・送信 → 正しいログイン後 URL へのリダイレクト → 期待コンテンツ描画の4段を検証し、認証未実装なら `test.fixme()`。

## 3. Failure Criteria

以下のいずれかに該当する場合、当該ビルドは**リリース不可（release-blocking）**とする。

### 3.1 非交渉条項（Non-negotiable Conventions）違反 — 即リリース不可

| # | 対象 | 不合格条件 | 関連 VB |
|---|------|-----------|---------|
| NC-1 | module:scoring, module:tablet | 回答・判定・スコアリングのいずれかが小数・負値・100超を受理する、または UI かサーバの**片方でしか**拒否しない（0〜100 整数の二重防衛が破れる） | VB-27, VB-28, VB-32, VB-33, VB-34, VB-65, VB-71 |
| NC-2 | module:scoring, module:tv_display | 金額の表示または内部表現が円建てでない／ポイント・点等へ置換されている（現金感を薄める記述・実装の混入） | VB-35, VB-79 |
| NC-3 | module:control_panel, role:host | 締切・開示・正解発表・精算・モード切替・取消・入稿・ライブ編集を制御盤(host)以外（副司会・解答者端末）から発動できる | VB-22〜VB-25, VB-67, VB-72, VB-74, VB-75 |
| NC-4 | module:config, module:participants | 同時接続上限がハードコードされている／既定 8 でない／設定変更(8→16→32)が非改修で効かない／上限判定が設定値を参照しない | VB-10〜VB-15 |
| NC-5 | module:scoring, module:game_flow | c 正解発表後の正解ライブ編集で自動再採点されない、または残額・TV d/e へ即時反映されない（差分更新が全再計算と一致しない） | VB-37, VB-39, VB-40, VB-70 |
| NC-6 | module:realtime_sync | クラウド実行の WEB アプリで全端末をリアルタイム同期していない／ホスト PC をサーバとする構成になっている／ロール投影を欠き解答者へ他者情報が配信される | VB-01〜VB-04, VB-62 |
| NC-7 | module:participants | 家族限定アクセス制御が未構成のまま `/join` が参加を許可する（無制御公開） | VB-56 |

### 3.2 レイアウト・ツールチェーン規約違反 — リリース不可

- テストファイルが `tests/` 以外（`test/`・`spec/`・`specs/` 等）に置かれ、verify ランナーに発見されず「テスト成果物が生成されなかった」と読める。
- ソースが `src/` 以外に置かれ output-path fence に落とされる。
- `package.json` / `package-lock.json` / `tsconfig.json` / `vitest.config.ts` を成果物として出力・改変している。
- 相対 import が `.js` 拡張子を欠く／`.ts` を書く（TS2835 でコンパイル不能・`npm run build` が落ちる）。type-only import・re-export も同様。
- Vitest 以外（`node:test` 等）をテストランナーとして用いている。

### 3.3 テスト品質ゲート違反 — リリース不可

- 選択スイート内に **FAIL が1件でも残る**（全 PASS でない）。
- **SKIP が1件でも残る**（`test.fixme()` 済みの未実装エンドポイント・未確定挙動の明示は SKIP と区別するが、実装済み挙動の SKIP は不可）。
- HTTP アサーションで **5xx（サーバ内部エラー／DB 断）を業務ステータスとして見逃している**（`status < 500` の健全性ベースラインを検証していない）。上限拒否・アクセス拒否・締切後送信・非host コマンド・不正遷移が 5xx で表れている（本来は `connection_rejected`＋WS `close(4001)` / `command_denied` 403・401 / 満席平易文 / 業務エラー写像で表す）。
- ページ遷移で **URL のみ／HTTP ステータスのみ**を確認し、遷移先の可視コンテンツを検証していない（サイレントな 404 リダイレクトや 200-中身相違を取り逃す）。
- 認証があるにもかかわらず**ログイン→リダイレクト→描画フロー**を欠く（F-05 の未実装時は `test.fixme()` で明示）。
- `operation_flow` 由来の運用テスト義務、および §1.6 の VB カバレッジに未検証の抜けがある。
- 未確定（F-01〜F-06）の挙動を推測実装して確定値として検証している（発明したセマンティクスは不合格。確定部分のみ検証し未確定部分は `test.fixme()`）。

## 4. E2E Test Generation Meta-Prompt

> このセクションは `codd propagate` が E2E テストを自動生成するための機械可読指示である。生成器は本節に従い、要件・全設計の設計時 `operation_flow` と本書 §1.6 の正準 VB を出発点にテスト義務を導出し、次に具体的な E2E 証拠候補へ落とす。要件・設計に無い挙動は発明せず、欠落した設計義務は §1.7 のフラグに従って `test.fixme()` で残す。

### 4.1 生成物の分類・レベル分離（必須）

E2E は**2レベルに分離**し、混同しない。

- **API 統合テスト** → `tests/e2e/<domain>.spec.ts`。Playwright `request` context / `fetch` / `ws` クライアントでエンドポイント応答・ステータス・データ契約・WS 配信を検証する（サーバの検証）。
- **ブラウザテスト** → `tests/e2e/<domain>.browser.spec.ts`。Playwright を**ライブラリ import**（`import { chromium, type Browser, type Page } from "playwright";`）し、Vitest 宣言 API 内で実ブラウザ操作（4ボタン入力・クリック・フォーム送信・遷移）と**可視 UI 状態**を検証する（ユーザー体験の検証）。
- ファイル名から即座にレベルが判別できること（`.spec.ts`=API、`.browser.spec.ts`=ブラウザ）。

**共通ルール（全 HTTP アサーション）**: まず応答ステータスが **`< 500`** であることを検証し、その後で業務ステータス（200/302/401/403 等）を検証する。5xx は未処理例外・DB 断であり、4xx（認証失敗・未検出）とはカテゴリが異なる。共通ヘルパ `assertServerHealthy(response)` を必ず経由する。

**ブラウザ遷移ルール**: ユーザー操作（フォーム送信・リンク／ボタンクリック）による遷移は、**遷移先 URL のアサート**と**遷移先の可視要素を最低1つ**のアサートを両方行う。

**ログインフロー（認証がある場合・F-05）**: (1) ログインページへ遷移 → (2) 資格情報入力・送信 → (3) 正しいログイン後 URL へのリダイレクトをアサート → (4) 遷移先が期待コンテンツ（`/join` 氏名入力等）を描画することをアサート。認証が未実装なら該当を `test.fixme()`。

### 4.2 MECE ドメイン分解と出力ファイルマッピング

各ファイルは**重複しない単一の挙動ドメイン**を所有する。サーフェス／コピー義務（VB-79/VB-80）と家族限定アクセス制御（VB-56〜VB-58）は、当該サーフェスを所有するドメインの browser/API spec 内で検証する。

| ドメイン | 主対象モジュール | API 統合テスト | ブラウザテスト | 主要 VB |
|---------|----------------|----------------|----------------|--------|
| realtime-sync | module:realtime_sync | `tests/e2e/realtime-sync.spec.ts` | `tests/e2e/realtime-sync.browser.spec.ts` | VB-01〜05, 60〜62 |
| participation | module:participants | `tests/e2e/participation.spec.ts` | `tests/e2e/participation.browser.spec.ts` | VB-06〜09, 56〜59, 81, 85 |
| connection-limit | module:config, module:participants | `tests/e2e/connection-limit.spec.ts` | `tests/e2e/connection-limit.browser.spec.ts` | VB-10〜15, 82 |
| game-flow | module:game_flow | `tests/e2e/game-flow.spec.ts` | `tests/e2e/game-flow.browser.spec.ts` | VB-16〜21 |
| control-authority | module:control_panel, role:host | `tests/e2e/control-authority.spec.ts` | `tests/e2e/control-authority.browser.spec.ts` | VB-22〜25, 67, 72, 74, 75, 77〜79 |
| scoring | module:scoring, module:tablet | `tests/e2e/scoring.spec.ts` | `tests/e2e/scoring.browser.spec.ts` | VB-26〜35, 76 |
| live-edit-rescoring | module:scoring, module:game_flow, module:questions | `tests/e2e/live-edit-rescoring.spec.ts` | `tests/e2e/live-edit-rescoring.browser.spec.ts` | VB-36〜40, 68〜73 |
| tablet-ui | module:tablet | `tests/e2e/tablet-ui.spec.ts` | `tests/e2e/tablet-ui.browser.spec.ts` | VB-41〜44 |
| tv-display | module:tv_display, module:media | `tests/e2e/tv-display.spec.ts` | `tests/e2e/tv-display.browser.spec.ts` | VB-45〜51, 55, 73, 83, 84 |
| question-data | module:questions, module:config | `tests/e2e/question-data.spec.ts` | `tests/e2e/question-data.browser.spec.ts` | VB-52〜54, 63〜67 |

### 4.3 共有ヘルパ（必須・重複排除）

`tests/e2e/helpers/` 配下に共通処理を集約し、spec 間の重複を禁じる。相対 import は `.js` 拡張子で参照する。

- `tests/e2e/helpers/server-health.ts` — `assertServerHealthy(response)`（`status < 500` ベースライン）。
- `tests/e2e/helpers/auth.ts` — 司会者ログイン（F-05 未確定時は no-op ＋ `test.fixme()` フック）と host セッション確立（`Session.role === "host"` の付与）。
- `tests/e2e/helpers/join.ts` — QR 由来の参加URL取得（`PUBLIC_BASE_URL` ＋ 分岐A時トークン `t`）→ タブレット参加 → 氏名自己入力フロー。
- `tests/e2e/helpers/game-setup.ts` — 問題ファイル読込→DB(`questions`)登録、プレイヤー準備（`participants`・`balances=10000`）、進行段階（accepting/b/c/d）到達のセットアップ。
- `tests/e2e/helpers/unique-id.ts` — `uniqueName(prefix)` 等、実行毎ユニーク識別子生成。
- `tests/e2e/helpers/assertions.ts` — TV d の6列表（氏名/解答/誤差/増減円/ピタリ賞/残額）検証、円建て表記・`point`/`pt`/`点` 禁止パターン不在、可視ラベル（司会者/解答者/観客）の共通アサート。
- `tests/e2e/helpers/ws-client.ts` — `ws` クライアントの接続・ロール申告・イベント購読・上限拒否(`close(4001)`)観測。

例（ブラウザ spec の骨子。宣言は Vitest、駆動は Playwright ライブラリ、import は `.js`）:

```typescript
// @generated-from: docs/test/test_strategy.md
// @generated-by: codd propagate
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { loginAsHost } from "./helpers/auth.js";
import { assertServerHealthy } from "./helpers/server-health.js";
import { uniqueName } from "./helpers/unique-id.js";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8080";

describe("control-authority (browser) — covers vb=VB-22 vb=VB-24 vb=VB-77 vb=VB-78", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
  afterAll(async () => { await browser.close(); });

  it("host can lock answers and the deadline reflects on the TV/tablet surfaces", async () => {
    const page: Page = await browser.newPage();
    const res = await page.goto(`${BASE_URL}/control-panel`);
    expect(res!.status()).toBeLessThan(500);          // 健全性ベースライン
    await loginAsHost(page);
    await page.getByRole("button", { name: "そこまで" }).click();
    // 遷移/状態変化: URL と可視要素の双方をアサート
    await expect(page).toHaveURL(new RegExp("/control-panel"));
    await expect(page.getByText("締切")).toBeVisible();
    await page.close();
  });
});
```

例（API spec の骨子。二重防衛のサーバ側・境界・健全性ベースライン）:

```typescript
// @generated-from: docs/test/test_strategy.md
// @generated-by: codd propagate
import { describe, it, expect } from "vitest";
import { request } from "playwright";
import { assertServerHealthy } from "./helpers/server-health.js";
import { uniqueName } from "./helpers/unique-id.js";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8080";

describe("scoring (api) — covers vb=VB-34 vb=VB-32", () => {
  it("server rejects -1/101/50.5 and accepts 0/100 boundaries", async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const participant = uniqueName("player");            // 実行毎ユニーク
    for (const invalid of [-1, 101, 50.5]) {
      const res = await ctx.post("/tablet/answer", { data: { participant, value: invalid } });
      assertServerHealthy(res);                          // まず < 500
      expect([400, 422]).toContain(res.status());        // 業務ステータス
    }
    for (const valid of [0, 100]) {
      const res = await ctx.post("/tablet/answer", { data: { participant, value: valid } });
      assertServerHealthy(res);
      expect(res.status()).toBe(200);
    }
    await ctx.dispose();
  });
});
```

### 4.4 シナリオ導出（operation_flow → VB → 証拠候補）

まず各設計の `operation_flow` と §1.6 の VB からテスト義務を導出し、次に具体的 E2E 証拠へ落とす。設計が宣言する軸を持つ挙動は以下の型を網羅する。

- **正常系 / 異常系**: 受付中の送信成功（VB-16）、締切後の送信拒否（VB-18）、0〜100外の拒否（VB-33/VB-34）。
- **永続化・読み戻し**: 問題ファイル読込→DB登録→再取得で同一（VB-52/VB-53）、送信解答の永続化と再表示（VB-16）、ライブ編集の永続と読み戻し（VB-36）。
- **権限境界**: 締切・開示・正解発表・精算・モード切替・取消・入稿・ライブ編集を host は成功（VB-22）、非 host（タブレット/副司会）は 401/403（VB-23/VB-67/VB-72/VB-74/VB-75）。
- **終端状態**: 10問終了時の勝者確定（VB-31）、締切後の送信拒否（VB-18）、c 未到達の再採点非誘発（VB-38）。
- **クロスアクター反映**: タブレット送信 → 制御盤で受信可視化 → TV(b) で開示（VB-20）、参加 → 制御盤一覧＋TV(e)（VB-08）。
- **派生状態・リードモデル連鎖**: 解答（producer）→ `answer_submitted`（durable event）→ 誤差×−100・残額（derived）→ TV d/e（consumer surface）の連鎖を通しで検証（VB-27/VB-28/VB-50/VB-51）。差分更新の全再計算一致（VB-70）。
- **閾値・境界**: 下記 §4.5。

### 4.5 計測・閾値・境界の検証（producer→durable→derived→consumer）

閾値・件数・割合・残額を持つ値は、境界の**下/丁度/上**を可能な限り検証する。

- **入力値（0〜100 整数）**: 0（下限=可・VB-32）/ 100（上限=可・VB-32）/ −1（下限未満=拒否）/ 101（上限超=拒否）/ 50.5（小数=拒否）。UI 拒否（VB-33）とサーバ拒否（VB-34）を**両方**独立に検証。ステッパのクランプ境界（VB-43）。
- **ピタリ賞（誤差0境界）**: 誤差0 → +1,000 反映（丁度・VB-29）／誤差1 → −100 のみ（直上・VB-30）。拠出配分は F-02 に従い `test.fixme()`。
- **同時接続上限（既定8）**: 8台目=接続可（丁度・VB-10）／9台目=拒否（上・VB-11）。設定16へ変更後 16台目可・17台目拒否（VB-13）、32へ変更後 32台目可・33台目拒否（VB-14）。上限判定が設定値追随（VB-12）。
- **再採点連鎖（c→d）**: c 到達問の正解を N→M へ直す → 全員の誤差・増減円・残額が再計算され TV d/e が更新（VB-37/VB-39/VB-40・丁度=編集前後の差分一致）。c 未到達の編集では再採点が起きない（VB-38・下＝境界外）。text/メディアのみ編集で非誘発（VB-69）。
- **同期反映（VB-03 / F-04）**: 状態遷移が全端末へ p95 ≤ 2,000ms で反映（テストゲート）。
- **出題面フォールバック**: 動画有→動画（VB-48）／動画無・画像有→画像／双方無→テキスト（VB-49）。

### 4.6 アクター向けサーフェス／コピー網羅

各設計の surface/copy 義務からブラウザ E2E 義務を導く。

- **必須の可視ラベル/コピーをアサート**: TV d モードの6列見出し（氏名/解答/誤差/増減円/ピタリ賞/残額・VB-50）、金額の**円**表記（VB-35）、初期残額 10,000 円（VB-26）、QR 表示（VB-06）、`/join` の「お名前を入力してください」「参加する」（VB-81）、制御盤の司会者向け操作語（VB-77）、可視ラベル 司会者/解答者/観客（VB-80）。
- **禁止アクション/リンク/コピーの不在をアサート**: タブレットに他者残額・得点・解答・全体一覧・出題提示が無いこと（VB-44）、非 host UI に締切/開示/取消操作が無いこと（VB-24）、制御盤に解答者入力面が無いこと（VB-78）、TV に入力・操作要素が無いこと（VB-84）、`point`/`pt`/`点`・内部イベント名・設定キー名・生ファイルパス・`fallback` 等の内部語・デモ/テスト表記の不在（VB-35/VB-79/VB-83）、内部識別子 `host/answerer/audience` の非露出（VB-80）、満席平易文が内部会計を露出しないこと（VB-82）。
- **アクター別の文言**: 制御盤（司会者向け操作系）／TV（観客向け提示系）／タブレット（解答者向け入力系）で対象が異なる文言を、それぞれのサーフェスで検証する。

### 4.7 アーキテクチャ適応（ルート走査）

生成時に**実際のルート／エンドポイント構造を走査**し、要件が示す挙動に対応するルートが未実装なら、当該テストを**スキップせず `test.fixme()`** でマークする（実装到来を明示的な穴として残す）。制御盤(`/control-panel`)／TV(`/tv`)／タブレット(`/tablet`)／参加受付(`/join`)の各 URL、`/healthz`、`/media/*`、締切・開示・正解発表・精算・モード切替・ライブ編集・取消・入稿の各コマンド API、WebSocket 昇格の実体を確認し、未実装分を `test.fixme()` 化する。認証（F-05）が未実装ならログインフローを `test.fixme()`。取消の巻き戻し副作用（F-03）・ピタリ賞拠出配分（F-02）は未確定部分を `test.fixme()`。

### 4.8 変更を伴うテストデータ / 前提フィクスチャ

- **変更系（作成・更新）シナリオ**: 氏名・問題・解答など作成/更新するテストは**実行毎ユニーク識別子**（`uniqueName()`）を用い、**明示的クリーンアップ／冪等 teardown**（`afterEach`/`afterAll` で当該 `participants`/`answers`/`questions` を破棄）を行う。反復実行が stale データや一意制約（`unique(question_id, participant_id)`・`participants.connection_id`）で落ちないこと。氏名は当日その場参加を前提とし、恒久台帳を残さない。
- **前提依存シナリオ**: 既存レコード（登録済み問題・進行段階 b/c/d 到達・参加者・接続数）に依存するテストは、アサート前に**シナリオ/ヘルパ内で前提を確立または冪等リセット**する（`game-setup.ts` で `questions` 読込・段階到達・`balances=10000` 初期化を再現）。可変な共有シードを、再生成または不変証明なしに信頼しない。

### 4.9 実行環境（サーバ起動）

E2E は稼働中サーバを要する。`package.json` の scripts・フレームワーク設定・エントリポイント（`src/main.ts` → `dist/main.js`）から project type（クラウド WEB アプリ＋WebSocket）を検出し、起動シーケンスを組む。

- **起動手順**: `npm ci` → `npm run build`（`tsc`：NodeNext の `.js` 指定子欠落は TS2835 で失敗）→ 永続 DB（既定 managed PostgreSQL・`DATABASE_URL`）へ `node dist/db/seed.js`（`ensureSchema()`＋サンプル `questions`/`participants` 投入）→ `node dist/main.js`（サーバ常駐必須）。
- **ヘルスチェック待ち**: 起動後、ベース URL（または `/healthz`）が `< 500` を返すまで**最大 60 秒**（2 秒間隔）ポーリングしてから試験開始。CI（GitHub Actions）では**サーバをバックグラウンド起動**し、health-check 通過後にテスト実行を開始する。
- **接続情報・設定注入**: `E2E_BASE_URL`（WS 昇格可能なオリジン）・`PUBLIC_BASE_URL`・`JOIN_ACCESS_MODE`／`JOIN_ACCESS_TOKEN`・`DATABASE_URL`・`MEDIA_ROOT`・`HEARTBEAT_PING_INTERVAL_MS`／`HEARTBEAT_PONG_TIMEOUT_MS` を検証環境値で注入。同時接続上限の設定（既定8／16／32）は `MAX_TABLET_CONNECTIONS` 注入で切替え、VB-10〜VB-15 を検証する。
- **ブラウザ起動設定**: ブラウザテストは `chromium.launch({ headless: true })` を用いる（CI ヘッドレス・`npx playwright install --with-deps chromium` を前提）。realtime-sync / cross-actor 検証は複数 `page`（制御盤・タブレット・TV）を同時に開き、または複数 `ws` クライアントで多端末反映を検証する。

### 4.10 生成マーカー

全生成ファイルの先頭に以下を含める。各テストブロックには対応 VB を `covers vb=<id>` としてタイトルまたはコメントに記す。手書きテスト（`// @manual`）は再生成時に保存する。

```typescript
// @generated-from: docs/test/test_strategy.md
// @generated-by: codd propagate
```

### 4.11 実行ポリシー（一括実行 → 収集 → 修復）

選択スイート**全体を実行**し、**全 FAIL を収集**してから修復に着手する。関連する失敗（例: 再採点連鎖 VB-37〜VB-40・VB-70、同期反映 VB-02〜VB-05・VB-60〜VB-62）をまとめて整合的に直す。個別失敗ごとの逐次修復で全体像を失わない。

### 4.12 品質ゲート（PASS 基準）

以下を全て満たすときのみ合格とする（§2.1 と一致）。

- 選択スイートが**全 PASS・SKIP ゼロ**（未実装は `test.fixme()` で明示、実装済み挙動の SKIP は不可）。
- §1.6 の正準 VB（VB-01〜VB-85）と各設計の `operation_flow` 由来の運用義務のカバレッジに抜けが無い（`codd test audit` が各 VB を PASS へ紐付ける）。
- §3 のリリースブロッキング条項（NC-1〜NC-7・レイアウト/ツールチェーン規約・5xx 健全性ベースライン・遷移の URL＋可視要素二重検証・未確定挙動の非発明）を全て遵守。
- API 統合テストとブラウザテストが**両レベルとも生成・実行**され、ファイル命名規約（`.spec.ts` / `.browser.spec.ts`）に従う。
