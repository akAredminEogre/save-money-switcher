---
codd:
  node_id: operations:runbook
  type: operations
  depends_on:
  - id: design:system-design
    relation: depends_on
    semantic: technical
  - id: infra:deployment-setup
    relation: depends_on
    semantic: technical
  depended_by:
  - id: test:test-strategy
    relation: depends_on
    semantic: verification
  conventions:
  - targets:
    - module:realtime_sync
    reason: 本番当日のインターネット接続を前提とし、回線断を運用リスクとして扱い再接続・状態復帰手順を明記すること（2026-08-08 確定）。違反時リリース不可。
  - targets:
    - module:config
    - module:participants
    reason: 接続上限（8→16→32）の設定変更手順をコード改修なしの運用操作として記すこと（論点10）。違反時リリース不可。
  modules:
  - realtime_sync
  - config
  - participants
---

# 運用手順書（当日回線確保・回線断時運用・接続上限変更）

> **⚠ 2026-08-28 殿裁可「案A（事前アカウント方式）」により参加手順が改定された（cmd_2553）。**
>
> 本書中の「`/join` で氏名を自己入力して参加する」手順（§2 の参加受付・QR 到達確認・分岐 A/B の確認・
> 満席平易文の記述）は**失効**しており、履歴として残す。有効な手順は次のとおり:
>
> 1. **初期管理者の投入（初回のみ）**: `ADMIN_LOGIN_ID` / `ADMIN_INITIAL_PASSWORD` を起動時にだけ
>    env で渡す（冪等・既存パスワードは上書きしない）。資格情報は秘密保管庫にのみ置き、
>    `.env`・ログ・証跡へ平文を書かない。投入結果は起動ログの
>    `initial admin seed: created | already_exists | not_configured` で確認する。
> 2. **参加**: 各人は配られた URL（QR が符号化するのは `/login`）でログインする。氏名の自己入力は無い。
> 3. **保護面**: `/control-panel` と `/admin/*` は admin セッション必須。未ログインは `/login` へ誘導、
>    非 admin は 403。ホスト操作コマンド（`POST /host/command`）も同じ門番を通る。
> 4. **家族限定アクセス制御（PC-INV-3）**: `JOIN_ACCESS_MODE=authenticated`（分岐 B）で確定。
>    分岐 A（`JOIN_ACCESS_TOKEN`）は用いない。
> 5. **データ退避**: アカウントは `DATA_DIR`（既定 `./data`）配下の `accounts.json`。破壊的変更・
>    再デプロイの前に**このファイルを退避**する（消えると全員ログインできなくなる）。
>
> エピソード・招待・エピソード参加（P2）と Lightsail デプロイ（P3）は未実装であり、本書へは
> 実装後に追記する。

## 1. Overview

本書は `save-money-switcher`（クラウド WEB アプリ版『賞金先渡しクイズ SAVE MONEY』家族用操作盤）の **`operations:runbook`** であり、技術的親である `design:system-design`（`docs/design/system_design.md`）と `infra:deployment-setup`（`docs/infra/deployment_setup.md`）を唯一の真実源として、**本番当日の運用手順**を権威をもって定める。対象は次の 3 手順を中核とする。

1. **当日回線確保**（`module:realtime_sync`）— 本番当日のインターネット接続を前提に、主回線とバックアップ回線を事前に確保・検証する。
2. **回線断時運用**（`module:realtime_sync`）— 回線断を「オフライン完結」ではなく**運用リスク**として扱い、切断検知 → 回線切替 → **再接続・状態復帰**の手順を明記する。
3. **接続上限変更**（`module:config` / `module:participants`）— 同時接続上限を **8 → 16 → 32** へ、**コード改修なしの運用操作**（環境変数 `MAX_TABLET_CONNECTIONS` の変更）として変更する。

ここに記す 🟦 確定値・不変条件に反する運用・成果物は**リリース不可（release-blocking）**として扱う。本書は稼働中システムの「回し方」を定めるものであり、コード成果物（`src/**/*.ts`・`tests/**/*.ts`）とビルド／CI 定義（`.github/workflows/ci.yml`・`Dockerfile`）を参照・生成対象とする。

### 1.1 プロダクト運用像（確定）

- **形態**: クラウド上で常時稼働する単一の Node（LTS 20）プロセス（`node dist/main.js`）が唯一の HTTP/WebSocket 権威。制御盤（`/control-panel`）・TV（`/tv`）・解答者タブレット（`/tablet`）・参加受付（`/join`）はすべて**クラウド公開 URL（`PUBLIC_BASE_URL`）へブラウザ接続する純クライアント**であり、待受ソケットを持たない。**ホスト PC はサーバにしない**（2026-08-08 確定）。
- **ゲーム運用**: 先渡し **10,000 円** ／ 誤差 1 につき **−100 円** ／ ピタリ賞（誤差 0）で他プレイヤーから **+1,000 円** ／ **1 ゲーム 10 問** ／ 残額最多勝ち。回答は **0〜100 の整数のみ**。**円建て固定**（`point`／`pt`／`点` 禁止）。
- **進行操作**: 受付中 → 司会者「そこまで」で**締切（全タブレットロック）** → 「解答オープン！」で**一斉開示（b）** → 正解発表（c）→ 得点精算（d）→ 全員一覧（e）。締切・開示・正解発表・取消・TV モード切替は**司会者（制御盤・`role: host`）のみ**発火できる。
- **永続化**: `questions`／`answers`／`participants`／`balances`／`game_state` を永続 DB（既定 managed PostgreSQL・`DATABASE_URL`）へ保持。問題は事前ファイル読込で `questions` へ登録し、ランタイム出題は**常に DB から供給**する。メディア（画像／動画）は `MEDIA_ROOT` の耐久ストレージへ事前配置する。
- **家族限定アクセス制御**: `/join` の無制御公開はリリース不可。デプロイ時に **分岐 A（`JOIN_ACCESS_MODE=url_secret` ＋ `JOIN_ACCESS_TOKEN`）** または **分岐 B（`JOIN_ACCESS_MODE=authenticated`）** を必ず構成する。

### 1.2 リリースブロッキング規約への遵守（本書が運用化する制約）

| # | 対象 | 規約（release-blocking） | 本書での運用化箇所 | 遵守の言明 |
|---|---|---|---|---|
| RUN-C1 | `module:realtime_sync` | 本番当日のインターネット接続を前提とし、回線断を運用リスクとして扱い**再接続・状態復帰手順を明記**する（2026-08-08 確定） | §2.1・§2.5・§2.6・§3 | §2.1 で主／バックアップ回線を当日確保し、§2.5 で切断検知パラメータと再接続復帰（サーバ側 `game_state`／`balances` を権威とする状態復帰）を、§2.6 で回線断時の運用フローを手順化する。オフライン完結・ホスト PC のサーバ化による吸収は明示的に禁止する。 |
| RUN-C2 | `module:config` / `module:participants` | 接続上限（**8 → 16 → 32**）の設定変更手順を**コード改修なしの運用操作**として記す（論点 10） | §2.7 | 上限は環境変数 `MAX_TABLET_CONNECTIONS` として `src/config/connection_limit.ts` の `resolveMaxTabletConnections()` が単一解決する。§2.7 は PaaS の環境変数を書き換えて再起動するだけの手順（ソース無改修・リテラル `8` 非埋め込み）として上限変更を記す。 |

### 1.3 継承する不変条件（運用が侵してはならない）

| # | 対象 | 不変条件 | 運用上の担保箇所 |
|---|---|---|---|
| INV-1 | `module:realtime_sync` | クラウドの単一 WebSocket 権威。ホスト PC をサーバにしない | §2.2・§2.6 |
| INV-2 | `db:questions` / `module:questions` | 問題は事前ファイル読込 → DB 登録 → DB 保持、ランタイムは DB 供給 | §2.4 |
| INV-3 | `module:config` / `module:participants` | 上限は既定 8・ハードコード禁止・設定で 32 まで破綻しない | §2.7 |
| INV-4 | `module:participants` | 家族限定アクセス制御（分岐 A/B）を必ず構成・無制御公開不可 | §2.3・§3.4 |
| INV-5 | `role:host` | 締切・開示・正解発表・取消・モード切替は host のみ | §2.4・§3.5 |
| INV-6 | `module:scoring` / `module:tablet` | 0〜100 整数のみ受理（UI／サーバ二重防衛） | §2.4・§3.3 |
| INV-7 | `module:scoring` / `module:tv_display` | 円建て固定（`point`／`pt`／`点` 禁止） | §3.6 |
| INV-8 | 全 HTTP/WS | 健全性 `< 500`（5xx を出さない）／同期反映 **p95 ≤ 2,000ms**（暫定ゲート・F-04） | §3.1・§3.2 |

### 1.4 実装・ツールチェーン前提（scaffold 固定・釈義不可）

- **実装言語 = TypeScript のみ。** 本書が参照・生成するソースパス（`src/main.ts`・`src/config/*.ts`・`src/realtime_sync/*.ts` 等）・モジュール構成・依存管理・ツールチェーンはすべて TypeScript／Node 慣行のみを用い、他言語の拡張子・マニフェスト・ツールは例示・フォールバックとしても登場させない。ビルドは `tsc` が `src/**/*.ts` を `dist/**/*.js`（NodeNext・`.js` 出力）へ emit する。出荷ランタイム依存は `ws`（WebSocket）・`qrcode`（QR 生成）を用いる。
- **テストランナー = Vitest（固定・release-blocking のグラウンドトゥルース）。** verify／CI が実際に走らせるのは Vitest（`vitest run`）であり、本書はこれを再解釈・上書きしない。本書の全テスト例は Vitest 自身の宣言 API（`import { describe, it, expect } from "vitest";`）で記述する。「ランタイム依存を最小化する」方針は**出荷コードのランタイム依存**（`ws`・`qrcode` の採否）にのみ及び、テストランナーには及ばない。依存数の哲学を根拠に別フレームワークや Node 組み込み `node:test` を CI ランナーに用いてはならない。
- **モジュール解決 = NodeNext/Node16。** すべての相対 import 指定子は**出力される `.js` ファイル名を明示した拡張子**を伴う（`import { x } from "./x.js"`。`"./x"`・`"./x.ts"` は不可）。re-export・default/namespace import・type-only import も同一規約。拡張子欠落は `tsc`（＝ `npm run build`）で **TS2835** となりコンパイル不能で、CI のビルド段が落ちる。
- **レイアウト契約（output-path fence 強制）。** 本書が参照・宣言するコード成果物のソースは**必ず `src/` 配下**、テストは**必ず `tests/` 配下**（`test/`・`spec/`・`specs/` を発明しない）。`package.json`・`package-lock.json`・`tsconfig.json`・`vitest.config.ts` は harness scaffold 所有につき、本書はこれらを成果物として出力・宣言しない。`npm run build`／`npm run start`／`npm test` は scaffold 提供のスクリプトとして参照するのみで再定義しない。`.github/workflows/ci.yml`・`Dockerfile` は**言語非依存の運用資産**でありリポジトリルートに置く（`src/`／`tests/` のフェンス対象でも harness 所有 runner/tool 設定でもない）。

---

## 2. Runbook

本節は本番当日を時系列で回す実運用手順である。各手順は「前提 → 手順 → 検証 → 逸脱時の対応」を持ち、release-blocking 規約（§1.2）に紐づく。

### 2.1 手順 R-1: 当日回線確保（RUN-C1・INV-1）

本番当日のインターネット接続を前提とするため、**主回線とバックアップ回線を事前に確保・検証**してから開始する。ホスト PC をサーバにしないため、確保すべきは「全端末がクラウド公開 URL へ到達できる回線」であって、ホスト PC の LAN／AP ではない。

**前提**
- クラウドへ最新リリースがデプロイ済で、起動時プリフライト（`assertReleaseReady()`）を通過して稼働している（§3.4 のゲート G1–G6）。
- 会場に**主回線**（据置光回線または会場 Wi-Fi）と**バックアップ回線**（モバイルテザリング／ポケット Wi-Fi／別 ISP 等、主回線と経路が独立するもの）が用意されている。

**手順**
1. **クラウド稼働確認**: 任意端末のブラウザで `${PUBLIC_BASE_URL}/healthz` を開き、応答が **`< 500`** であることを確認する（curl 併用可: `curl -s -o /dev/null -w '%{http_code}' ${PUBLIC_BASE_URL}/healthz`）。
2. **主回線での全サーフェス到達確認**: 主回線に接続した状態で、制御盤 PC で `/control-panel`、TV で `/tv`、代表タブレット 1 台で `/join` → `/tablet` を開き、各サーフェスの可視コンテンツが描画されることを確認する。
3. **バックアップ回線の事前検証**: 主回線を一時的に切り、バックアップ回線（テザリング等）に切り替えて手順 2 を再実行し、同一クラウド URL へ到達できることを確認する。検証後は主回線へ戻す。
4. **QR 到達確認**: 制御盤に表示される参加 QR（`buildJoinUrl()` が `PUBLIC_BASE_URL` と、分岐 A 時は秘匿トークン `t` を符号化）をタブレットで読み取り、`/join` の氏名入力画面が出ることを確認する。
5. **アクセス制御構成確認**: `JOIN_ACCESS_MODE` が `url_secret`（`JOIN_ACCESS_TOKEN` 付き）または `authenticated` で構成されていること（§3.4 ゲート G1）。無制御公開のままでは稼働に到達していないはずだが、当日も二重に確認する。
6. **接続上限確認**: 参加人数に対し `MAX_TABLET_CONNECTIONS` が十分か確認する。人数が既定 8 を超える場合は §2.7 の上限変更を**ゲーム開始前に**済ませておく。

**検証**
- 主回線・バックアップ回線の双方で `/healthz` が `< 500`、かつ制御盤・TV・タブレットが描画できること。
- 参加 QR から `/join` 経由で 1 台がテスト参加でき、制御盤の参加者一覧と TV(e) に反映されること（テスト参加者は開始前に取り消す／破棄する）。

**逸脱時**
- どちらか一方の回線でしか到達できない場合でも開始は可能だが、単一障害点となるため、可能ならもう一方を復旧させる。両回線とも到達不可なら**開始しない**（クラウド前提を満たさない）。
- クラウドが `5xx` を返す／`/healthz` に 60 秒以内に到達しない場合はデプロイ不良を疑い、直前リリースへのロールバック（§3.4）を運用側で実施してから再確認する。

> **RUN-C1 遵守の言明（当日回線確保）**: 主回線とバックアップ回線を当日確保・事前検証する手順を明記し、確保対象を「全端末がクラウド公開 URL へ到達する回線」に限定した。ホスト PC のサーバ化・LAN 完結によるオフライン吸収は選択肢に含めない。

### 2.2 手順 R-2: デプロイ・起動と稼働開始（INV-1）

**前提**: CI（`npm ci → npm run build → npm test`）が green。CD が `Dockerfile` マルチステージビルド → `ghcr.io` push → 永続プロセス型 PaaS（`Fly.io`／`Render`／`Railway`／`Google Cloud Run`〈最小 1〉等）へ **1 インスタンス**でデプロイ可能。

**手順**
1. **環境変数注入**: PaaS のシークレットストア／設定に §2.8 の環境変数を投入する。機密（`DATABASE_URL`・`JOIN_ACCESS_TOKEN`）はシークレットストア経由のみ、非機密（`PUBLIC_BASE_URL`・`MAX_TABLET_CONNECTIONS`・`PORT`・`MEDIA_ROOT`・`JOIN_ACCESS_MODE`・`HEARTBEAT_*`）は設定として投入する。
2. **デプロイ**: `main` マージ／リリースタグで CD を起動し、単一インスタンスへリリースする。
3. **起動時プリフライト**: `src/main.ts` の `assertReleaseReady()` が「アクセス制御未構成／上限未解決／公開 URL 欠落」を検知した場合、プロセスは非 0 終了し PaaS は直前リリースを維持する（無制御公開を「起動させない」）。
4. **スキーマ適用**: `ensureSchema()` が `DATABASE_URL` の永続 DB にスキーマを適用する。
5. **ポストデプロイスモーク**: `${PUBLIC_BASE_URL}/healthz` を **2 秒間隔・最大 60 秒**ポーリングし `< 500` を確認する。到達しなければ直前リリースへロールバックする。

**検証**: WS 昇格が透過されること（`/tv` を 2 枚開き、制御盤の TV モード切替が両方へ即時反映される）。制御盤 PC を落としても TV／タブレット間同期がクラウド権威経由で継続すること（INV-1）。

### 2.3 手順 R-3: 家族限定アクセス制御の当日確認（INV-4）

**手順（分岐 A: URL 秘匿）**
1. `JOIN_ACCESS_MODE=url_secret`・`JOIN_ACCESS_TOKEN=<不透明トークン>` が構成されていることを確認する。
2. 制御盤が表示する QR にトークン `t` が符号化され、トークンなしの `/join` 直打ちが拒否されることを確認する。
3. トークンは口頭・画面共有・SNS 等に露出させない（QR 提示のみ）。

**手順（分岐 B: 認証）**
1. `JOIN_ACCESS_MODE=authenticated` を確認する。
2. 未認証で `/join` を開くと**ログイン → 正しいリダイレクト → 氏名入力描画**のフローになり、保護された制御盤ナビが露出しないことを確認する。

いずれの分岐でも受入判定は `src/config/` の上限解決点と `role: host` 判定の**単一経路**を経由する。方式最終決定は §3.4 の技術選定に従うが、**どちらも未構成のまま稼働することは起動時ゲートで拒否済み**である。

### 2.4 手順 R-4: 本番進行オペレーション（司会者操作・INV-5/INV-6）

本番中に司会者（制御盤）が行う操作系列を確定順で示す。すべて `role: host` セッションからのみ発火でき、`role: answerer`・副司会からの当該コマンドはサーバ側で **401/403** 拒否される。

1. **問題読込（`op_load_questions`）**: ゲーム未開始またはライブ編集フェーズで、制御盤から事前問題ファイルを読み込み `questions`（`text`／`image_path`／`video_path`／`correct_value`〈0〜100 整数〉）へ登録する。ランタイム出題は DB から供給し、ファイル再読込に依存しない（INV-2）。
2. **参加受付（`op_join_game`）**: 参加 QR を提示し、各解答者がタブレットで読み取り `/join` で**氏名を自己入力**して参加確定する（1 人 = 1 台）。参加は `participants` に登録され、制御盤の参加者一覧と TV(e) に反映される。端末番号の固定割当・事前氏名台帳は用いない。
3. **受付中の解答（`op_submit_answer`）**: 解答者はタブレットの **+1／−1／+10／−10 の 4 ボタン**で 0〜100 を作り送信する。**UI とサーバ双方**で 0〜100 整数のみ受理し、負値・小数・100 超・非数値を拒否する（INV-6・二重防衛）。タブレットは他者情報・出題内容・全体一覧を出さず、自分の残額と送信済みのみ表示する。
4. **締切（`op_lock_answers`）**: 制御盤で「そこまで」を押下 → `game_state.stage = answers_locked`。全タブレット入力がロックされ、以降の送信はサーバで拒否される。
5. **解答オープン（`op_open_answers`）**: 「解答オープン！」で `answers_opened`（b）。開示前はどの端末にも他者解答が出ておらず、開示後に TV(b) が氏名＋解答を一斉表示する。
6. **正解発表（`op_reveal_correct`）**: `answer_revealed`（c）。TV(c) に正解値を提示。**以降のライブ編集は自動再採点対象**として `game_state` に記録される。
7. **得点精算（`op_compute_settlement`）**: `settlement_computed`（d）。誤差 = |解答 − 正解|、増減円 = 誤差 × **−100 円**、誤差 0 のピタリ賞に **+1,000 円**。TV(d) の 6 列表（氏名／解答／誤差／増減円／ピタリ賞／残額）と TV(e) の全問通算が更新される。全プレイヤーの残額初期値は **10,000 円**。
8. **TV モード切替（`op_switch_tv_mode`）**: 制御盤の **①「次へ」 ②「戻る」 ③各モード個別ジャンプ**の 3 系統で a〜e を切り替える。a は**動画 → 画像 → テキスト**の 3 段フォールバックで出題面を解決する。
9. **勝者判別（`op_determine_winner`）**: 10 問すべてが `settlement_computed` に達すると、残額最多のプレイヤーが TV(e) で勝者として判別可能に表示される。

**ライブ編集と自動再採点の運用（`op_live_edit_correct` / `op_auto_rescore`）**
- 進行中も制御盤から**問題・正解の双方**を編集でき、DB に永続する。
- **c 到達済み**の問題の正解を直すと自動再採点が走り、各人の残額へ即時反映される。**d 到達済み**なら残額の差分再計算を伴い TV の d／e を同時更新する。**c 未到達**の正解編集では再採点は起きない（境界外）。

**取消（`op_undo_trigger`）**
- 司会者は取消で直近の対象操作を戻せる（初版から host 権限操作）。取消の具体挙動（直近のみか任意問題再開示か）が曖昧な範囲は推測運用せず、§3.5 の F028 に従う。

### 2.5 手順 R-5: 切断検知と再接続・状態復帰の仕様（RUN-C1・INV-1）

回線断時運用（§2.6）の土台となる、システムの切断検知・復帰仕様を運用者が把握するための節である。

- **切断検知**: サーバは WS ハートビートを **ping `HEARTBEAT_PING_INTERVAL_MS`（既定 15,000ms）／pong 無応答 `HEARTBEAT_PONG_TIMEOUT_MS`（既定 30,000ms）** で監視し、無応答を切断確定として当該接続スロットを解放する。閾値は `src/config/heartbeat_config.ts` 経由の設定値であり、当日ネットワーク実測で調整可能（値に依らず整合は成立・§3.7）。
- **状態復帰の権威**: 端末の再接続時、最新のゲーム状態（**現在問題番号・進行段階（stage）・TV モード・自分の残額**）はサーバ側の **`game_state`／`balances`（永続 DB）を唯一の権威**として復帰する。クライアントはローカルに真実を持たない。
- **スロットと再入場**: 切断で解放されたスロットは、当該端末の再接続時に `MAX_TABLET_CONNECTIONS` の範囲で再受入される。上限到達中は `connection_rejected` ＋ WS `close(4001)` と `/join` の満席平易文で表し、`5xx` は出さない。既存接続・`participants`／`answers`／`balances` は不変。
- **再デプロイ耐性**: DB が永続するため、ゲーム中の再起動・再デプロイを跨いで進行状態が保たれ、端末は復帰できる。

### 2.6 手順 R-6: 回線断時運用（RUN-C1・INV-1）

回線断は**オフライン完結で吸収せず、運用リスクとして回線側で対処**する。ホスト PC のサーバ化は禁止。

**症状の切り分け**
- **単一端末のみ切断**（他端末は正常）: その端末のローカル回線／ブラウザの問題。→ 手順 A。
- **会場の全端末が同時に切断**（クラウドは他拠点から `< 500`）: 会場の主回線ダウン。→ 手順 B。
- **クラウド自体が `5xx`／到達不可**: プラットフォーム障害。→ 手順 C。

**手順 A（単一端末の回線断）**
1. 当該端末を主回線／バックアップ回線へ再接続する（Wi-Fi 再選択、テザリング切替）。
2. ブラウザで該当サーフェス URL を再読込する。§2.5 の通り、`game_state`／`balances` から最新状態へ自動復帰する。
3. 解答者タブレットなら、再接続後にスロットが再受入されること・自分の残額が正しいことを確認する。復帰前に締切が実行されていた場合、当該問への送信はサーバで拒否される（終端状態ガード）。

**手順 B（会場主回線ダウン）**
1. 制御盤 PC・TV・全タブレットの接続先を**バックアップ回線（テザリング等）へ切替**える（§2.1 手順 3 で事前検証済みの経路）。
2. 各端末でサーフェス URL を再読込し、クラウド権威から状態復帰させる。
3. 制御盤で参加者一覧・現在問題番号・進行段階・各残額が一貫していることを確認する。
4. 回線不安定中に誤って締切／開示等のトリガーが飛んだ疑いがあれば、司会者の**取消**（§2.4・host のみ）で戻す。

**手順 C（クラウド障害）**
1. `${PUBLIC_BASE_URL}/healthz` を別回線から確認し、プラットフォーム障害かを判定する。
2. 直前リリースが健全なら PaaS のロールバック（§3.4）を実施し、`/healthz` の `< 500` 回復を待つ。
3. 回復後、各端末を再読込して状態復帰させる。DB が権威のため進行は保たれる。

**明示的な禁止事項**
- 回線断を理由に**ホスト PC をサーバに切り替えて LAN 完結で継続する運用は禁止**（INV-1・リリース不可構成）。復旧は常に「回線を回復し、クラウド権威へ再接続する」経路で行う。

> **RUN-C1 遵守の言明（回線断時運用）**: 切断検知（ping 15,000ms／pong 30,000ms）、サーバ側 `game_state`／`balances` を権威とする状態復帰、単一端末・会場主回線・クラウド障害の 3 系統の復旧手順を明記した。いずれもオフライン完結・ホスト PC のサーバ化を用いず、回線切替と再接続で復帰する。

### 2.7 手順 R-7: 接続上限変更 8 → 16 → 32（RUN-C2・INV-3）

同時接続上限は**環境変数 `MAX_TABLET_CONNECTIONS` の変更のみで、ソースを改修せず**に切り替える。上限判定は `src/config/connection_limit.ts` の `resolveMaxTabletConnections()` が単一解決し、判定コード（`server.ts`／`admission.ts`）に数値リテラル `8` は存在しない。

**手順**
1. **現行値の確認**: PaaS の環境変数設定で現在の `MAX_TABLET_CONNECTIONS`（未設定なら既定 8）を確認する。
2. **新値の設定**: 目標人数に応じて `MAX_TABLET_CONNECTIONS=16` または `=32` をシークレットストア／設定で設定する。**ソースコードは一切変更しない。**
3. **容量整合（32 台時）**: 上限を 32 へ上げる場合、インスタンスのメモリ／同時接続・ファイルディスクリプタ上限を **タブレット 32 ＋ 制御盤 1 ＋ TV 数台（≒ 34 WS）** を保持できるサイズ（目安 1 vCPU／512MB–1GB RAM）へ合わせる。単一インスタンスの in-memory hub が権威を保つ構成を維持する。
4. **反映（再起動）**: 環境変数は起動時に `process.env` へ取り込まれるため、PaaS でインスタンスを**再起動／再デプロイ**して新値を反映する。以後、接続受理のたびに `resolveMaxTabletConnections()` が新値を取り直し、**コード改修なしに上限がその値へ追随**する。
5. **タイミング**: 再起動は一時的に全 WS を切断するため、**原則ゲーム開始前**に実施する。やむを得ずゲーム中に行う場合は、各端末が §2.5 の状態復帰で自動再接続することを前提とし、復帰後の一貫性を制御盤で確認する。

**検証（境界）**

| 設定 `MAX_TABLET_CONNECTIONS` | 接続可の最大 | 拒否される台 |
|---|---|---|
| 未設定（既定 8） | 8 台目まで可 | 9 台目を拒否 |
| 16 | 16 台目まで可 | 17 台目を拒否 |
| 32 | 32 台目まで可 | 33 台目を拒否 |

上限超過は `5xx` を出さず `connection_rejected` ＋ WS `close(4001)` と `/join` の満席平易文で表し、既存接続は影響を受けない。設定変更が値へ追随することは Vitest で機械可検に固定する（`tests/config/connection_limit.test.ts`・§4 の unit ジョブ）。

```typescript
// tests/config/connection_limit_change.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { resolveMaxTabletConnections } from "../../src/config/connection_limit.js";
import { admitTablet } from "../../src/participants/admission.js";

describe("接続上限のコード無改修な変更（8→16→32）", () => {
  afterEach(() => { delete process.env.MAX_TABLET_CONNECTIONS; });

  it("未設定時の既定は 8（リテラル埋め込みではない）", () => {
    expect(resolveMaxTabletConnections()).toBe(8);
  });

  it("環境変数を 16/32 に変えると非改修で追随する", () => {
    process.env.MAX_TABLET_CONNECTIONS = "16";
    expect(resolveMaxTabletConnections()).toBe(16);
    process.env.MAX_TABLET_CONNECTIONS = "32";
    expect(resolveMaxTabletConnections()).toBe(32);
  });

  it("上限到達で新規接続を断り既存は不変（判定は設定値参照）", () => {
    expect(() => admitTablet({ limit: 32, connected: 32 }, { name: "33人目" })).toThrow();
  });
});
```

> **RUN-C2 遵守の言明（接続上限変更）**: 8 → 16 → 32 の変更を「環境変数 `MAX_TABLET_CONNECTIONS` の設定 → 再起動」という**コード改修なしの運用操作**として手順化した。上限は `resolveMaxTabletConnections()` の単一解決点を経由し、ソースに `8` のハードコードは無い。32 台時のインスタンス容量整合も手順に含めた。

### 2.8 環境変数運用カタログ（設定外出し・INV-3）

すべての稼働パラメータは環境変数として注入し、`src/config/` の単一解決点でのみ解決する。判定コードにリテラルを撒かない。

| 環境変数 | 解決点（`src/config/`） | 既定 | 区分 | 運用上の役割 |
|---|---|---|---|---|
| `MAX_TABLET_CONNECTIONS` | `connection_limit.ts` : `resolveMaxTabletConnections()` | 8 | 非機密 | タブレット同時接続上限（§2.7 で 16/32 へ変更） |
| `PUBLIC_BASE_URL` | `public_base_url.ts` : `resolvePublicBaseUrl()` | 必須（未設定は起動拒否） | 非機密 | 参加 QR／~~`/join`~~ **`/login`** の基底クラウド公開 URL。**https ならセッション Cookie に `Secure` が付く** |
| `DATA_DIR` | `data_dir.ts` : `resolveDataDir()` | `./data`（CWD 相対） | 非機密 | 永続データ（`accounts.json`）の置き場。**デプロイで消えぬ場所を指すこと** |
| `ADMIN_LOGIN_ID` | `seed_admin.ts` : `resolveInitialAdminCredentials()` | undefined（→投入せず起動） | **機密** | 初期管理者のログイン ID（初回投入時のみ与える） |
| `ADMIN_INITIAL_PASSWORD` | `seed_admin.ts` : `resolveInitialAdminCredentials()` | undefined（→投入せず起動） | **機密** | 初期管理者の初期パスワード。**保存も記録もされず scrypt ハッシュだけが残る** |
| `ADMIN_DISPLAY_NAME` | `seed_admin.ts` : `resolveInitialAdminCredentials()` | 「司会者」 | 非機密 | 初期管理者の画面表示名 |
| `JOIN_ACCESS_MODE` | `access_control_config.ts` : `resolveAccessMode()` | undefined（→起動拒否） | 非機密 | 家族限定制御の方式。**案A では `authenticated` で確定**（`url_secret` は用いない） |
| `JOIN_ACCESS_TOKEN` | `access_control_config.ts` : `resolveJoinAccessToken()` | undefined | **機密** | 分岐 A の秘匿トークン |
| `DATABASE_URL` | `server_runtime.ts` : `resolveDatabaseUrl()` | 必須（未設定は起動拒否） | **機密** | 永続 DB 接続文字列（INV-2） |
| `PORT` | `server_runtime.ts` : `resolvePort()` | 8080 | 非機密 | HTTP/WS 待受ポート |
| `MEDIA_ROOT` | `media_config.ts` : `resolveMediaRoot()` | `/data/media` | 非機密 | 画像／動画の所定配置ルート |
| `HEARTBEAT_PING_INTERVAL_MS` | `heartbeat_config.ts` : `resolvePingIntervalMs()` | 15000 | 非機密 | WS ping 間隔 |
| `HEARTBEAT_PONG_TIMEOUT_MS` | `heartbeat_config.ts` : `resolvePongTimeoutMs()` | 30000 | 非機密 | pong 無応答での切断確定・スロット解放 |
| `E2E_BASE_URL` | 検証ハーネス | 検証時注入 | 非機密 | E2E の対象オリジン |
| `NODE_ENV` | ランタイム標準 | `production` | 非機密 | 実行モード |

機密（`DATABASE_URL`・`JOIN_ACCESS_TOKEN`・`ADMIN_LOGIN_ID`・`ADMIN_INITIAL_PASSWORD`）はリポジトリ・ログ・QR 表示面・クライアント配信ペイロードへ露出させず、PaaS シークレットストア／GitHub Actions 暗号化シークレットにのみ保持する。

### 2.9 手順 R-8: ゲーム終了後のデータライフサイクル（プライバシー・INV-6 継承）

- 収集する個人データは解答者が**自己入力した氏名**と当日の**解答・残額**に限る。`participants` は当日その場参加を前提とし、**恒久的な事前氏名台帳を持たない**。
- ゲームセッション終了後、当日の `participants`／`answers`／`balances` レコードは破棄対象とし、次回へ持ち越さない（運用手順として当日データを保持し続けない）。
- ログ・監視面（§3）には他者解答・残額を解答者ロールへ露出させず、金額表記に `point`／`pt`／`点` を用いない（円建て固定・INV-7）。

---

## 3. Monitoring

稼働中システムの観測は、INV-8（健全性 `< 500`・同期 p95 ≤ 2,000ms）と各 release-blocking 規約の**逸脱を検知**することを目的とする。しきい値・対象・アラート方針を具体値で定める。

### 3.1 ヘルスとエラー率（INV-8）

- **`/healthz` 稼働監視**: プラットフォームのヘルスチェックで `${PUBLIC_BASE_URL}/healthz` を **2 秒間隔・最大 60 秒**でプローブし、`< 500` を稼働条件とする。失敗時は自動再起動／直前リリースへロールバック（§3.4）。
- **HTTP エラー率**: `/control-panel`・`/tv`・`/tablet`・`/join`・`/media/*`・`/healthz` を含む全 HTTP 応答の `5xx` 発生率を監視する。**`5xx` は 0 が正常**（業務上の拒否は `connection_rejected`／`command_denied`／`/join` 満席平易文で表し `< 500` を保つ）。`5xx` 出現はアラート。
- **監視用メトリクス公開点**（`src/` 配下・`.js` import）:

```typescript
// src/monitoring/metrics.ts
import { getConnectionCounts } from "../realtime_sync/hub.js";
import { resolveMaxTabletConnections } from "../config/connection_limit.js";

export interface HealthSnapshot {
  status: "ok";
  tabletConnections: number;
  maxTabletConnections: number;
  http5xxTotal: number;
  syncLatencyP95Ms: number;
}

export function buildHealthSnapshot(): HealthSnapshot {
  const counts = getConnectionCounts();
  return {
    status: "ok",
    tabletConnections: counts.answerer,
    maxTabletConnections: resolveMaxTabletConnections(),
    http5xxTotal: counts.http5xxTotal,
    syncLatencyP95Ms: counts.syncLatencyP95Ms,
  };
}
```

### 3.2 同期反映レイテンシ（INV-8・F-04）

- 状態遷移（締切・開示・正解発表・モード切替・再採点）の**全端末反映**を **p95 ≤ 2,000ms** の暫定テストゲートとして監視する。§4 の performance ジョブが Vitest でこの閾値を検証し、稼働中は `syncLatencyP95Ms`（§3.1）を観測する。
- p95 が閾値を超える場合はインスタンスサイジング（§2.7 手順 3）を見直す。SLA が確定した時点で本ゲート値を更新する（F-04）。

### 3.3 接続上限・受入監視（INV-3・RUN-C2）

- **接続数対上限**: `tabletConnections` と `maxTabletConnections`（現行 `MAX_TABLET_CONNECTIONS`）を並べて監視し、上限到達（`connection_rejected` の発生）を検知する。上限到達が想定外なら §2.7 で上限を引き上げる。
- **既存接続不変の確認**: 上限超過拒否時に既存接続・`participants`／`answers`／`balances` が不変であることを、参加者数の連続性で監視する。

### 3.4 デプロイリリースゲート監視（INV-1/INV-2/INV-3/INV-4）

デプロイ許可前に次を機械的に検証し、1 つでも不合格ならデプロイ中止／ロールバックする。稼働中も構成ドリフトを監視する。

| ゲート | 条件 | 根拠 | 検証点 |
|---|---|---|---|
| G1 アクセス制御構成 | `JOIN_ACCESS_MODE` が `url_secret`（トークン付き）または `authenticated` | INV-4 | `checkReleaseReadiness()`・CD 検証 |
| G2 接続上限解決 | `resolveMaxTabletConnections()` が整数（既定 8／設定 16・32） | INV-3 | `tests/config/*` |
| G3 公開 URL | `PUBLIC_BASE_URL` 設定済 | INV-1 | 起動時 |
| G4 永続 DB | `DATABASE_URL` 設定済・`ensureSchema()` 成功 | INV-2 | 起動時 |
| G5 WS 昇格 | デプロイ先が WS Upgrade を透過・維持 | INV-1 | §2.2・E2E |
| G6 ヘルス | `/healthz` が 60 秒以内に `< 500` | INV-8 | ポストデプロイスモーク |

- **ロールバック**: G1–G6 いずれか不合格・スモーク不達なら、CD は直前リリースを維持／復帰する。無制御公開（G1 不合格）は起動時 `assertReleaseReady()` の非 0 終了で稼働到達を阻止する。

### 3.5 権限境界・アクセス監視（INV-5）

- 締切・開示・正解発表・得点精算・取消・モード切替の発火が `role: host` セッションのみであることを、非 host からの当該コマンドに対する **401/403** 応答率で監視する。想定外の許可（`role: answerer` からの発火成立）は重大アラート。
- `/join`（未認証／事前認証サーフェス）が、アクセス状態に整合しない保護ナビ（制御盤操作等）を露出していないことを監視する。

### 3.6 切断検知・ハートビート監視（RUN-C1）

- WS ping/pong の稼働を監視し、`HEARTBEAT_PING_INTERVAL_MS`（15,000ms）／`HEARTBEAT_PONG_TIMEOUT_MS`（30,000ms）に対する無応答切断・スロット解放・再接続復帰の連鎖が成立していることを確認する。切断急増は会場回線劣化のシグナルとしてバックアップ回線切替（§2.6 手順 B）の判断に用いる。

### 3.7 シークレット露出・プライバシー監視（INV-6/INV-7 継承）

- ログ・監視ダッシュボード・エラーメッセージに `JOIN_ACCESS_TOKEN`・`DATABASE_URL` が出力されていないことを監視する。
- 金額表記に `point`／`pt`／`点` が現れないこと（円建て固定）、他者解答・残額が解答者ロールへ露出していないことを監視する。
- ゲーム終了後の当日データ破棄（§2.9）が運用手順どおり実施されたことを確認する。

### 3.8 アラート方針（暫定しきい値）

| 監視項目 | しきい値 | アクション |
|---|---|---|
| `/healthz` `5xx` | 1 回でも発生 | 自動再起動 → 継続すればロールバック（§3.4） |
| HTTP `5xx` 率 | > 0% | 直近デプロイ調査・ロールバック判断 |
| 同期 p95 | > 2,000ms | インスタンスサイジング見直し（§2.7） |
| 非 host コマンド許可 | 1 回でも成立 | 重大: 権限境界不具合として即時対応（INV-5） |
| WS 切断急増 | 短時間に多数 | 会場回線劣化疑い・バックアップ回線切替（§2.6） |
| 接続拒否（上限） | 想定人数未満で発生 | 上限誤設定を疑い §2.7 で是正 |

---

## 4. CI/CD Pipeline Generation Meta-Prompt

本節は `.github/workflows/ci.yml` を生成するための**機械可読な指示**である。生成器（`codd propagate`）は本節の指示に従い、下記の完全な YAML を出力ファイル `.github/workflows/ci.yml`（リポジトリルート・言語非依存の運用資産）へ書き出すこと。生成物は harness 所有の runner/tool 設定 4 ファイル（`package.json`・`package-lock.json`・`tsconfig.json`・`vitest.config.ts`）を一切上書き・宣言してはならない。

### 4.1 生成ディレクティブ

1. **出力ファイル**: `.github/workflows/ci.yml`。先頭に生成マーカーを YAML コメントとして必ず含める: `# // @generated-by: codd propagate`（`#` で始まる YAML コメント行に、リテラル文字列 `// @generated-by: codd propagate` を含める）。
2. **トリガー**: `on: pull_request` を対象ブランチ `main`／`develop` に対して発火させる。
3. **テストレベル → ジョブ導出**: テスト戦略の各レベルに 1 ジョブを対応させる。**unit**（`tests/config/*`・`tests/participants/*`・`tests/scoring.test.ts`・`tests/rescoring.test.ts`・`tests/connection_limit.test.ts`・`tests/admission.test.ts` 等、DB 非依存の Vitest ユニット）／**integration**（API・WebSocket 統合・DB 依存）／**e2e**（`tests/e2e/*.spec.ts`・`*.browser.spec.ts`。Playwright を**ライブラリ import** で駆動し、宣言・検証は Vitest）／**performance**（同期反映 p95 ≤ 2,000ms を Vitest で検証）。
4. **ビルド検証（テスト前必須）**: 独立の `build` ジョブで `npm run build`（`tsc`）を実行し、**成功後にのみ**テストジョブを走らせる（`needs: build`）。NodeNext の `.js` 指定子欠落は TS2835 でビルド失敗する。
5. **データベース**: 本プロジェクトは永続 DB（既定 managed PostgreSQL）を用いるため、integration／e2e／performance ジョブに **PostgreSQL サービスコンテナ**（`postgres:16`）を付し、`DATABASE_URL` を当該サービスへ向ける。起動後に**シード**（`node dist/db/seed.js`。`ensureSchema()` 適用＋サンプル `questions`／`participants` 投入）を実行する。
6. **E2E のサーバ起動（web app）**: 本プロジェクトは web app（`/control-panel`・`/tv`・`/tablet`・`/join`）であるため、e2e／performance ジョブは**テスト前にアプリをビルドし `node dist/main.js` でサーバ起動**し、**readiness チェック**（`curl` で `/healthz` を 2 秒間隔・最大 60 秒ポーリングし `< 500` を待機）を挟んでからテストを実行する（レースコンディション回避）。CLI／ライブラリではなく web app なので、この起動は必須。
7. **キャッシュ**: `actions/setup-node@v4` の `cache: npm` で依存キャッシュを有効化し、各ジョブで `npm ci` を高速化する。
8. **環境変数／シークレット**: 下表を各ジョブへ設定する。**GitHub Secrets にすべき**もの（本番相当の機密）を明記する。CI 上の `DATABASE_URL` はサービスコンテナ向けの一時値であり Secret にしない。
9. **マージゲート**: 全テストジョブ（`build`・`unit`・`integration`・`e2e`・`performance`）の成功を PR マージ条件とする。§4.4 のブランチ保護を推奨設定として付す。
10. **失敗通知**: Slack／メール通知は**推奨（任意）**。導入する場合は失敗時のみ発火する通知ステップを各ジョブ末に付す（必須ではない）。

### 4.2 前提ツール検証（Prerequisite Validation）

CI ステップが呼ぶツールは、プロジェクトの依存マニフェストに存在するもの・ランナー同梱のもの・サービスコンテナのみとする。

| ツール | 供給元 | 判定 |
|---|---|---|
| `tsc`（`npm run build`） | harness scaffold の `typescript`（devDep）＋ `package.json` scripts | 導入済（scaffold）。生成可 |
| Vitest（`npm test` / `npx vitest run`） | harness scaffold（release-blocking の固定ランナー） | 導入済（scaffold）。生成可。`node:test` 等の代替ランナーは用いない |
| `ws`・`qrcode` | 出荷ランタイム依存（`package.json` dependencies） | 導入済。ビルド／起動で使用 |
| `node dist/main.js` / `node dist/db/seed.js` | プロジェクト成果物（`src/main.ts`／データモデル層 `src/db/seed.ts` の emit 物） | **前提**: `src/db/seed.ts`（`design:data-model-design` 所有）が存在し `dist/db/seed.js` へ emit されること。無ければ seed 提供を先行タスクとする |
| `playwright`（`chromium`） | e2e のブラウザ駆動（ライブラリ import） | **前提（要追加）**: `playwright` を dev 依存として `package.json` に追加し、CI に `npx playwright install --with-deps chromium` のブラウザ導入ステップを含める。未導入のままブラウザ E2E を走らせない |
| `curl` | `ubuntu-latest` ランナー同梱 | 導入済。readiness ポーリングに使用（`wait-on` 等の追加依存は不要） |
| `postgres:16` | GitHub Actions サービスコンテナ | 外部イメージ。追加依存不要 |

### 4.3 生成 YAML（`.github/workflows/ci.yml`）

```yaml
# // @generated-by: codd propagate
name: ci
on:
  pull_request:
    branches: [main, develop]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build            # tsc(NodeNext): .js 指定子欠落は TS2835 で失敗
      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist

  unit:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: >-
          npx vitest run
          tests/config tests/participants
          tests/scoring.test.ts tests/rescoring.test.ts
          tests/connection_limit.test.ts tests/admission.test.ts

  integration:
    needs: build
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: ci
          POSTGRES_PASSWORD: ci
          POSTGRES_DB: save_money
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U ci"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      DATABASE_URL: postgres://ci:ci@localhost:5432/save_money   # CI 一時値: Secret にしない
      MAX_TABLET_CONNECTIONS: "8"
      PUBLIC_BASE_URL: http://127.0.0.1:8080
      JOIN_ACCESS_MODE: url_secret
      JOIN_ACCESS_TOKEN: ci-family-secret                        # CI 一時値: Secret にしない
      MEDIA_ROOT: /tmp/media
      PORT: "8080"
      NODE_ENV: test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: node dist/db/seed.js       # ensureSchema + サンプル questions/participants 投入
      - run: npx vitest run tests/integration

  e2e:
    needs: [unit, integration]
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: ci
          POSTGRES_PASSWORD: ci
          POSTGRES_DB: save_money
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U ci"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      DATABASE_URL: postgres://ci:ci@localhost:5432/save_money
      MAX_TABLET_CONNECTIONS: "8"
      PUBLIC_BASE_URL: http://127.0.0.1:8080
      JOIN_ACCESS_MODE: url_secret
      JOIN_ACCESS_TOKEN: ci-family-secret
      MEDIA_ROOT: /tmp/media
      PORT: "8080"
      NODE_ENV: test
      E2E_BASE_URL: http://127.0.0.1:8080
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium   # 前提: playwright を dev 依存へ追加
      - run: npm run build
      - run: node dist/db/seed.js
      - run: node dist/main.js &                            # web app サーバ起動（バックグラウンド）
      - name: wait for /healthz (< 500, max 60s @2s)
        run: |
          for i in $(seq 1 30); do
            code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/healthz || echo 000)
            if [ "$code" != "000" ] && [ "$code" -lt 500 ]; then echo "ready ($code)"; exit 0; fi
            sleep 2
          done
          echo "server not ready within 60s"; exit 1
      - run: npx vitest run tests/e2e

  performance:
    needs: e2e
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: ci
          POSTGRES_PASSWORD: ci
          POSTGRES_DB: save_money
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U ci"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      DATABASE_URL: postgres://ci:ci@localhost:5432/save_money
      MAX_TABLET_CONNECTIONS: "32"                          # 32 台規模で p95<=2000ms を検証
      PUBLIC_BASE_URL: http://127.0.0.1:8080
      JOIN_ACCESS_MODE: url_secret
      JOIN_ACCESS_TOKEN: ci-family-secret
      MEDIA_ROOT: /tmp/media
      PORT: "8080"
      NODE_ENV: test
      E2E_BASE_URL: http://127.0.0.1:8080
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: node dist/db/seed.js
      - run: node dist/main.js &
      - name: wait for /healthz (< 500, max 60s @2s)
        run: |
          for i in $(seq 1 30); do
            code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/healthz || echo 000)
            if [ "$code" != "000" ] && [ "$code" -lt 500 ]; then echo "ready ($code)"; exit 0; fi
            sleep 2
          done
          echo "server not ready within 60s"; exit 1
      - run: npx vitest run tests/perf        # 同期反映 p95<=2000ms をアサート
    # 任意: 失敗時のみ Slack 通知（推奨・非必須）。導入時は SLACK_WEBHOOK_URL を GitHub Secret にする。
    # - if: failure()
    #   run: curl -X POST -H 'Content-type: application/json'
    #        --data '{"text":"save-money-switcher CI performance ジョブが失敗しました"}'
    #        "${{ secrets.SLACK_WEBHOOK_URL }}"
```

### 4.4 環境変数・シークレット指定と マージゲート

**環境変数の GitHub Secrets 指定**（本番 CD／デプロイ相当。CI テストジョブの一時値は Secret にしない）:

| 変数 | CI テストジョブ | 本番デプロイ | GitHub Secret |
|---|---|---|---|
| `DATABASE_URL` | サービスコンテナ向け一時値（平文可） | 永続 DB 接続文字列（機密） | **本番のみ Secret** |
| `JOIN_ACCESS_TOKEN` | `ci-family-secret`（一時値） | 分岐 A の秘匿トークン（機密） | **本番のみ Secret** |
| `PUBLIC_BASE_URL` | `http://127.0.0.1:8080` | クラウド公開 URL | 非機密（変数） |
| `JOIN_ACCESS_MODE` | `url_secret` | `url_secret`／`authenticated` | 非機密（変数） |
| `MAX_TABLET_CONNECTIONS` | `8`（perf は `32`） | 8／16／32 | 非機密（変数） |
| `MEDIA_ROOT`／`PORT`／`NODE_ENV`／`HEARTBEAT_*` | 平文 | 平文 | 非機密（変数） |
| レジストリ／PaaS デプロイトークン（`GHCR_TOKEN`／`FLY_API_TOKEN` 等） | 不要 | CD で使用（機密） | **Secret** |
| `SLACK_WEBHOOK_URL`（任意通知採用時） | — | 失敗通知 | **Secret** |

**マージゲート（ブランチ保護の推奨設定）**: `main`／`develop` に対し、必須ステータスチェックとして **`build`・`unit`・`integration`・`e2e`・`performance` の全ジョブ成功**を要求する。加えて「Require branches to be up to date before merging」を有効化し、`main` への直 push を禁止（PR 経由必須）する。全テストジョブが green でない限り PR はマージできない。

**失敗通知**: Slack／メール通知は推奨だが必須ではない。採用する場合は §4.3 のコメント例のように `if: failure()` ステップで失敗時のみ発火させ、`SLACK_WEBHOOK_URL` を GitHub Secret にする。

**Runtime Compatibility の順守**: Node は LTS **20**、モジュール解決は NodeNext/Node16、テストランナーは Vitest（`vitest run`）に固定する。ESLint フラット設定や新しめの Node フラグなど、プロジェクトのバージョンより新しい構成は生成しない。CI が呼ぶツールは §4.2 で導入確認済みのものに限り、未導入の Playwright はブラウザ導入ステップ＋dev 依存追加を前提として明示した。
