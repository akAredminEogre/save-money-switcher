---
codd:
  node_id: test:acceptance-criteria
  type: test
  depends_on:
  - id: req:save-money-switcher-requirements
    relation: derives_from
    semantic: governance
  depended_by:
  - id: design:system-design
    relation: constrained_by
    semantic: governance
  - id: test:test-strategy
    relation: depends_on
    semantic: verification
  conventions:
  - targets:
    - module:scoring
    - module:tablet
    reason: 回答・判定・スコアリングは 0〜100 の整数のみ受理し、小数・負値・100 超は UI とサーバの双方で拒否する（論点G）。違反時リリース不可。
  - targets:
    - module:scoring
    - module:tv_display
    reason: 現金感を薄めない＝円建て・ポイント等への置換禁止（表示・内部表現とも円／論点B★設計原則）。違反時リリース不可。
  - targets:
    - module:control_panel
    - role:host
    reason: 締切・開示・取消の発動権限は司会者（制御盤）のみで、副司会・解答者端末からは不可（論点7）。違反時リリース不可。
  - targets:
    - module:config
    - module:participants
    reason: 同時接続上限は既定 8 台・ハードコード禁止・設定で 8→16→32 へ非改修変更可（論点10）。違反時リリース不可。
  - targets:
    - module:scoring
    - module:game_flow
    reason: c 正解発表後の正解ライブ編集は自動再採点し残額・TV d/e へ即時反映（E-3残）。違反時リリース不可。
  - targets:
    - module:realtime_sync
    reason: クラウド実行の WEB アプリで全端末をリアルタイム同期し、ホスト PC をサーバにしない（2026-08-08 確定）。違反時リリース不可。
  modules:
  - questions
  - media
  - scoring
  - game_flow
  - participants
  - control_panel
  - tablet
  - tv_display
  - realtime_sync
  - config
---

# 受け入れ基準（Acceptance Criteria）

## 1. Overview

本書は `save-money-switcher`（SAVE MONEY 方式の家族クイズ操作盤）の**受け入れ基準（Acceptance Criteria）／不合格基準（Failure Criteria）**と、`codd propagate` が E2E テストを自動生成するための**メタプロンプト**を定義する。要件は `docs/requirements/requirements.md`（`req:save-money-switcher-requirements`, status: approved）を唯一の真実として反映し、本書はそこに記述された機能・画面・ワークフロー・API・運用ルールを網羅する。

### 1.1 対象プロダクトの確定像（要件の要約）

- **形態**: クラウド上で実行する WEB アプリ。制御盤（司会者のノートPC）／TV（HDMI 拡張ディスプレイ）／各解答者タブレット（入力専用）はいずれも**クラウド公開URL**へブラウザ接続し、**インターネット経由の WebSocket でリアルタイム同期**する。**ホストPCはサーバにしない**（2026-08-08 確定）。
- **ゲームルール（案A＝SAVE MONEY 準拠・個人戦）**: 先渡し **10,000円** / 誤差1につき **−100円** / ピタリ賞（誤差0）は他プレイヤーから **+1,000円** / 1ゲーム **10問** / 全問終了時の**残額最多が勝ち**。回答は **0〜100 の整数**のみ。**現金感を薄めない**（円建て・ポイント置換禁止）。
- **進行状態機**: 受付中（入力可）→ 司会者「そこまで」で **締切（全端末ロック）** → 司会者「解答オープン！」で **一斉開示**。開示前は他者解答を伏せる。各問は **b（解答オープン）/ c（正解発表）/ d（得点精算）** のどこまで進んだかを保持する。
- **TV 5モード（MC切替）**: a 出題（動画 → 画像 → テキストの3段フォールバック） / b 解答オープン / c 正解発表 / d 1問ごとの得点精算（**氏名・解答・誤差・増減円・ピタリ賞・残額**の6列全員表） / e 全員の得点一覧（全問通算）。切替は制御盤側から **①順送り「次へ」 ②「戻る」 ③各モードへの個別ジャンプ** の3系統。
- **タブレット（N-1）**: 入力専用最小UI＝**問題番号・数値入力・送信済み表示・自分の残額**のみ。入力は **+1 / −1 / +10 / −10 の4ボタン方式**。他者情報は出さない。
- **参加登録（論点9改）**: ホスト画面の QR をタブレットで読み、**氏名を自己入力**。**1人=1台**。端末番号固定割当は不採用。
- **同時接続上限（論点10）**: 既定 **8台**、**ハードコード禁止**、設定値で **8→16→32** へ非改修変更可。上限超過は接続を断る（判定は設定値を参照）。
- **問題データ（E-1/E-2/N-2）**: 事前ファイルを読み込み **DB 登録**して保持。動画は問題ファイルにパス記載＋所定フォルダへ事前配置。ゲーム進行中も**問題・正解をライブ編集可**（DB 更新 UI）。
- **再採点（E-3残）**: 「c 正解発表」実行後に正解をライブ編集すると**自動再採点し残額へ反映**。dまで進んでいれば残額の差分再計算を伴い、TV の d/e を同時更新する。
- **権限（論点7）**: 締切・開示・取消の発動は**司会者（制御盤）のみ**。取消は初版から司会者権限操作として含む。

### 1.2 本書とトレーサビリティ（REFERENCE-ONLY）

検証可能挙動（Verifiable Behavior, VB）の**正準レジストリは `docs/test/test_strategy.md`** に置く。本書は VB を**宣言しない**（先頭列が `VB-*` の表を持たない）。本書は独自の受け入れ基準 ID（`AC-xx`）を宣言し、各 AC を正準 VB へ**後方の列（`Canonical VBs`）で参照**する。設計時の `operation_flow` 記録を運用テスト義務の権威的出典とし、要件・設計に無い挙動は発明せず、欠落した設計義務は本書内で明示的に **flag** する（§2.10）。

### 1.3 実装・テストの技術前提（scaffold 固定・釈義不可）

- **実装言語**: TypeScript。全ファイルパス・パッケージ配置・依存管理・ツールチェーンは TypeScript 規約のみを用いる（要件の「言語未定」は本ビルドの scaffold により TypeScript に確定済みとして扱う）。
- **テストランナー**: **Vitest**（scaffold・verify コマンドで固定、リリースブロッキングの ground truth）。全テストは Vitest の宣言 API（`describe / it / expect`）で記述する。ランタイム依存最小化の方針は**出荷コードの実行時依存にのみ**適用され、テストランナーには適用しない。Node 組み込み `node:test` 等でランナーを置換してはならない。
- **モジュール解決**: NodeNext/Node16。相対 import は**必ず出力ファイル名の拡張子 `.js` を明示**する（例 `import { x } from "./x.js"`。`"./x"` も `"./x.ts"` も不可。type-only・re-export・namespace/default import も同一規約）。拡張子欠落は TS2835 でコンパイル不能となりリリース不可。
- **レイアウト契約**（harness 所有・output-path fence 強制）: テストは**必ず `tests/` 配下**、ソースは**必ず `src/` 配下**に置く。`package.json` / `package-lock.json` / `tsconfig.json` / `vitest.config.ts` は harness scaffold が所有し、本書はこれらを成果物として出力・宣言しない。
- **E2E テスト宣言**: 下記メタプロンプトが生成する E2E も Vitest 宣言 API を用い、ブラウザ操作は Playwright を**ライブラリとして** import（`import { chromium } from "playwright";`）して駆動する。API 統合は `fetch` / Playwright `request` context を用い、いずれも `expect` で検証する。

## 2. Acceptance Criteria

各基準は「合格条件（満たせば PASS）」を機械検証可能な形で述べる。`検証レベル` は Unit（`tests/` 直下のユニット）/ API（`tests/e2e/<domain>.spec.ts`）/ Browser（`tests/e2e/<domain>.browser.spec.ts`）を指す。`Canonical VBs` 列は `docs/test/test_strategy.md` の正準 VB を参照する（本書は VB を宣言しない）。

### 2.1 クラウド・アーキテクチャ / リアルタイム同期（module:realtime_sync）

| AC ID | 合格条件 | 検証レベル | Canonical VBs |
|-------|---------|-----------|---------------|
| AC-01 | 制御盤・TV・解答者タブレットの3クライアント種別が、いずれも**クラウド公開URL**（ブラウザ）へ接続でき、初期ロードが `<500` かつ 200 系で描画される | Browser, API | VB-01 |
| AC-02 | 状態遷移（締切・開示・モード切替・再採点）が接続中の全端末へ WebSocket で**リアルタイム反映**される（E2E ゲート: 反映まで p95 ≤ 2,000ms。※設計に固定 SLA が無いため本値はテストゲートとして設定し §2.10 で flag） | Browser, API | VB-02, VB-03 |
| AC-03 | サーバはクラウド側で稼働し、**ホストPC（制御盤ブラウザ）はサーバとして待受しない**（制御盤を落としても他端末間の同期はサーバ経由で継続する） | Browser | VB-04 |
| AC-04 | 回線断・再接続時、再接続した端末が最新のゲーム状態（現在問題番号・進行モード・残額）へ復帰する | Browser, API | VB-05 |

### 2.2 参加登録・端末紐付け（module:participants）

| AC ID | 合格条件 | 検証レベル | Canonical VBs |
|-------|---------|-----------|---------------|
| AC-05 | ホスト画面（制御盤）が参加用クラウドURLの **QR コード**を表示する（可視要素として存在する） | Browser | VB-06 |
| AC-06 | タブレットが参加URLへ接続し**氏名を自己入力**して参加でき、参加が制御盤・TV(e)へ反映される（1人=1台） | Browser, API | VB-07, VB-08 |
| ~~AC-07~~（**2026-08-28 殿裁可 案A により差替**） | ~~同一参加を**端末番号の固定割当では行わない**（事前氏名・座席登録の UI/API が存在しない、または未使用で成立する）~~ → **差替後**: 参加は**事前発行アカウントでのログイン**により成立する（氏名自己入力の `/join` は存在しない）。端末番号の固定割当を行わない点は差替後も同じ | Browser | VB-09 |
| AC-A1 | 未ログインで `/control-panel` へ来ると `/login` へ誘導される（保護面が素通りしない） | Browser | 案A |
| AC-A2 | 管理者アカウントでログインすると `/control-panel` と `/admin/*` に入れる。contestant では 403 | Browser | 案A |
| AC-A3 | 管理者がエピソードを作成でき、一覧→詳細へ遷移し、問題・正解を登録できる（**P2**） | Browser | 案A |
| AC-A4 | 管理者が解答者アカウント（ログイン ID / 初期パスワード）を作成し、当該エピソードへ招待できる（**P2**） | Browser | 案A |
| AC-A5 | 解答者が配られた URL・ID・パスワードでログインすると、招待された回のみが一覧に出る（**P2**） | Browser | 案A |
| AC-A6 | 解答者が一覧から回へ参加でき、解答面で自分の表示名と残額が見える（**P2**） | Browser | 案A |
| AC-A7 | `/me` で自分の表示名とパスワードを変更できる | Browser | 案A |
| AC-A8 | パスワードは平文で保存・ログ出力・画面表示のいずれもされない（scrypt ハッシュのみ） | Unit / Browser | 案A |
| AC-A9 | tsc 0 errors ／ vitest 全 pass ／ 新規 skip/todo を足さない | CI | 案A |

### 2.3 同時接続上限・設定外出し（module:config, module:participants）

| AC ID | 合格条件 | 検証レベル | Canonical VBs |
|-------|---------|-----------|---------------|
| AC-08 | 同時接続タブレット上限の**既定値が 8**である（設定未指定時に 8 台まで接続でき、9台目が拒否される） | API, Browser | VB-10, VB-11 |
| AC-09 | 上限値が**設定パラメータとして外出し**されており、**ソースに数値リテラル 8 がハードコードされていない**（設定注入で上限が変わることを実証） | Unit, API | VB-12 |
| AC-10 | 上限を **16 / 32 へコード改修なしで変更**でき、変更後は 16台目/32台目まで接続可・その次が拒否される（上限判定が設定値を参照） | API | VB-13, VB-14 |
| AC-11 | 上限超過時、超過接続は**接続を断られ**、既存接続は影響を受けない | API, Browser | VB-15 |

### 2.4 ゲーム進行・状態機（module:game_flow）

| AC ID | 合格条件 | 検証レベル | Canonical VBs |
|-------|---------|-----------|---------------|
| AC-12 | 受付中は解答者タブレットから回答を入力・送信でき、`answer_submitted` が永続化される | API, Browser | VB-16 |
| AC-13 | 司会者「そこまで」（締切）操作後、**全解答者タブレットの入力がロック**され、以降の送信が拒否される | Browser, API | VB-17, VB-18 |
| AC-14 | 開示前（b 未実行）は**他者の解答が伏せられ**、どの端末にも表示されない | Browser, API | VB-19 |
| AC-15 | 司会者「解答オープン！」（開示）操作で、TV(b) に **氏名＋解答**が一斉開示される | Browser | VB-20 |
| AC-16 | 各問について進行状態（b / c / d のどこまで進んだか）がサーバ側に保持され、再採点判定（§2.7）の前提となる | API | VB-21 |

### 2.5 制御盤の権限境界・取消（module:control_panel, role:host）

| AC ID | 合格条件 | 検証レベル | Canonical VBs |
|-------|---------|-----------|---------------|
| AC-17 | **締切・開示・取消**の発動権限は**司会者（制御盤）のみ**。制御盤からの発動は成功する | Browser, API | VB-22 |
| AC-18 | 解答者タブレット・副司会（制御盤以外）からは締切・開示・取消を**発動できない**（該当 API は 401/403 を返し、UI に該当操作要素が存在しない） | API, Browser | VB-23, VB-24 |
| AC-19 | 司会者による**取消**操作が初版から機能し、直近の対象操作が取り消される（取消の具体挙動が設計で未確定な範囲は §2.10 で flag し、当該部分は `test.fixme()`） | Browser, API | VB-25 |

### 2.6 スコアリング・入力仕様（module:scoring, module:tablet）— リリースブロッキング

| AC ID | 合格条件 | 検証レベル | Canonical VBs |
|-------|---------|-----------|---------------|
| AC-20 | ゲーム開始時、各プレイヤーへ **10,000円**が先渡しされ、初期残額が 10,000 円で表示される | API, Browser | VB-26 |
| AC-21 | 誤差 = \|解答 − 正解\| が **0〜100 の整数**として算出され、**増減円 = 誤差 × −100** で減算される（誤差5 → −500円） | Unit, API | VB-27, VB-28 |
| AC-22 | **ピタリ賞**（誤差0）成立時、当該プレイヤーへ **+1,000円**が反映される（1,000円の拠出元＝他プレイヤー配分の具体挙動は要件で未確定。§2.10 で flag し、拠出側は `test.fixme()`。加算側 +1,000 は検証必須） | Unit, API, Browser | VB-29, VB-30 |
| AC-23 | 全問（**10問**）終了時、**残額最多**のプレイヤーが勝者として e モードで判別可能に表示される | API, Browser | VB-31 |
| AC-24 | 入力・判定・スコアリングの全経路で **0〜100 の整数のみ受理**する。**小数・負値・100超**は **UI とサーバの双方で拒否**する（境界: 0=可 / 100=可 / −1=不可 / 101=不可 / 50.5=不可）。**リリースブロッキング** | Unit, API, Browser | VB-32, VB-33, VB-34 |
| AC-25 | 金額表示・内部表現ともに**円建て**で、ポイント・点等への置換が存在しない（可視文字列・API レスポンスとも「円」を基調とし、`point`/`pt`/`点` 表現が禁止パターンとして不在）。**リリースブロッキング** | Browser, API | VB-35 |

### 2.7 ライブ編集・自動再採点（module:scoring, module:game_flow）— リリースブロッキング

| AC ID | 合格条件 | 検証レベル | Canonical VBs |
|-------|---------|-----------|---------------|
| AC-26 | ゲーム進行中に制御盤から**問題・正解の双方をライブ編集**でき、編集が DB 更新として永続化・読み戻せる | API, Browser | VB-36 |
| AC-27 | 「**c 正解発表**」実行後に正解をライブ編集（＝直し）すると、**自動再採点**され、各人の残額へ即時反映される（c 未到達の編集は再採点対象外） | API, Browser | VB-37, VB-38 |
| AC-28 | d（得点精算）まで進んだ問題の正解を直した場合、**残額の差分再計算**が行われ、TV の **d 精算表示・e 全員一覧表示が同時更新**される。**リリースブロッキング** | Browser, API | VB-39, VB-40 |

### 2.8 タブレット UI（module:tablet）

| AC ID | 合格条件 | 検証レベル | Canonical VBs |
|-------|---------|-----------|---------------|
| AC-29 | タブレット画面は**入力専用最小UI**で、可視要素は **現在の問題番号 / 数値入力 / 送信済み表示 / 自分の残額**に限られる | Browser | VB-41 |
| AC-30 | 数値入力は **+1 / −1 / +10 / −10 の4ボタン方式**で 0〜100 の整数を増減する（テンキー直接入力ではない。境界で 0 未満・100 超へ振り切れない） | Browser | VB-42, VB-43 |
| AC-31 | タブレットに**他者の残額・得点・解答、および出題内容の提示・全体一覧が表示されない**（禁止要素の不在をアサート） | Browser | VB-44 |

### 2.9 TV 表示・MC 切替・出題フォールバック（module:tv_display）

| AC ID | 合格条件 | 検証レベル | Canonical VBs |
|-------|---------|-----------|---------------|
| AC-32 | TV は **a 出題 / b 解答オープン / c 正解発表 / d 得点精算 / e 全員一覧**の5モードを表示できる | Browser | VB-45 |
| AC-33 | MC 切替は制御盤から **①順送り「次へ」 ②「戻る」 ③各モード個別ジャンプ**の3系統で行え、TV の表示モードが対応して切り替わる（URL/表示状態の双方を検証） | Browser | VB-46, VB-47 |
| AC-34 | a モード出題は **動画 → 画像 → テキスト**の3段フォールバックで出題面を解決する（動画パス有→動画 / 動画無・画像有→画像 / 双方無→テキスト） | Browser, API | VB-48, VB-49 |
| AC-35 | d モードは当該問の**全員表（6列: 氏名 / 解答 / 誤差 / 増減円 / ピタリ賞 / 残額）**を表示する。増減円・残額は §2.6 の算出と一致する | Browser | VB-50 |
| AC-36 | e モードは**全問通算**の全員得点一覧を表示し、d（当該問フォーカス）と役割が分かれる | Browser | VB-51 |

### 2.10 問題データ入稿・MVP 演出（module:config / module:game_flow）

| AC ID | 合格条件 | 検証レベル | Canonical VBs |
|-------|---------|-----------|---------------|
| AC-37 | 事前の問題ファイルを読み込み、問題（テキスト・任意の画像パス・任意の動画パス・正解値）が **DB 登録**され、ランタイムで DB から供給される | API | VB-52, VB-53 |
| AC-38 | 動画は問題ファイルのパス記載＋所定フォルダ事前配置で解決され、当日その場入力の UI/API に依存しない | API, Browser | VB-54 |
| AC-39 | 正解発表（MVP 最小限）は**開示一覧＋正解値＋得点増減（円）の表示まで**で成立する（効果音・カウントダウン・アニメ・ランキング演出を要求しない） | Browser | VB-55 |

### 2.11 設計義務の欠落フラグ（flag — 発明せず殿判断へ）

以下は要件で未確定または曖昧なため、E2E は**確定部分のみアサート**し、未確定部分を `test.fixme()` として残す。設計義務の追加が必要な場合は推測実装せず F028 相当で殿判断を仰ぐ。

- **F-01（残額の下限・脱落）**: 家族版の確定要件は「誤差×−100円」「先渡し10,000円」のみで、**残額の 0 下限・全額喪失での脱落**は参考 SAVE MONEY（🟨）にあるが確定要件に無い。E2E は残額が負に至る経路を**下限を仮定せず**検証し、下限/脱落を導入する実装が現れた場合はフラグする。
- **F-02（ピタリ賞の拠出配分）**: 「他プレイヤーから +1,000円獲得」の**拠出元と配分（総額1,000か各人からか、複数同時ピタリ時の扱い）**が未確定。加算側 +1,000 は検証必須、拠出/配分側は `test.fixme()`。
- **F-03（取消の具体挙動）**: 直近操作のみ戻せるか／任意問題を再開示できるか等が未確定（論点7）。発動権限＝制御盤のみは確定ゆえ検証し、挙動詳細は `test.fixme()`。
- **F-04（同期レイテンシ SLA）**: 設計に固定 SLA が無い。AC-02 の 2,000ms はテストゲートとして設定し、SLA 確定時に更新する旨をフラグする。
- **F-05（家族限定アクセス制御）**: URL 知得のみか認証を設けるかが greenfield 未確定。認証が実装されていればログイン→リダイレクト→描画フローを検証し、未実装なら該当ブラウザテストを `test.fixme()`。

### 2.12 非機能・セキュリティ・データ取扱いの受け入れ観点

- **アクセス制御（権限境界）**: 締切・開示・取消は制御盤（role:host）のみ。API は host 以外に 401/403 を返し、非 host UI に該当操作要素が存在しないこと（AC-17/AC-18）。認証未確定分は F-05 に従う。
- **入力バリデーション（サーバ側最終防衛）**: 0〜100 整数の検証を**サーバ側でも**行い、UI を迂回した不正値（負値・小数・100超・非数値）を拒否する（AC-24）。
- **プライバシー / データ取扱い**: 収集する個人データは解答者の**自己入力した氏名と当日の解答・残額**に限る。タブレットは他者情報を保持・表示しない（AC-31）。~~氏名は当日その場参加を前提とし、恒久的な事前氏名台帳を持たない（AC-07）。~~ → **2026-08-28 案A により改定**: 表示名は恒久アカウント（`accounts.display_name`）が持ち、参加は事前発行アカウントでのログインにより成立する。
- **設定の外部化**: 同時接続上限は環境変数／設定ファイル／設定テーブル等の**設定パラメータ**として注入し、コードに定数リテラルを埋め込まない（AC-09）。

## 3. Failure Criteria

以下のいずれかに該当する場合、当該ビルドは**リリース不可**（release-blocking）とする。

### 3.1 非交渉条項（Non-negotiable Conventions）違反 — 即リリース不可

| # | 対象 | 不合格条件 | 関連 AC |
|---|------|-----------|---------|
| NC-1 | module:scoring, module:tablet | 回答・判定・スコアリングのいずれかが小数・負値・100超を受理する、または UI かサーバの**片方でしか**拒否しない（0〜100 整数の二重防衛が破れる） | AC-24 |
| NC-2 | module:scoring, module:tv_display | 金額の表示または内部表現が円建てでない／ポイント・点等へ置換されている（現金感を薄める記述・実装の混入） | AC-25 |
| NC-3 | module:control_panel, role:host | 締切・開示・取消を制御盤（host）以外（副司会・解答者端末）から発動できる | AC-17, AC-18 |
| NC-4 | module:config, module:participants | 同時接続上限がハードコードされている／既定 8 でない／設定変更（8→16→32）が非改修で効かない／上限判定が設定値を参照しない | AC-08〜AC-11 |
| NC-5 | module:scoring, module:game_flow | c 正解発表後の正解ライブ編集で自動再採点されない、または残額・TV d/e へ即時反映されない | AC-27, AC-28 |
| NC-6 | module:realtime_sync | クラウド実行の WEB アプリで全端末をリアルタイム同期していない／ホストPC をサーバとする構成になっている | AC-01〜AC-03 |

### 3.2 レイアウト・ツールチェーン規約違反 — リリース不可

- テストファイルが `tests/` 以外（`test/`・`spec/`・`specs/` 等）に置かれ、verify ランナーに発見されず「テスト成果物が生成されなかった」と読める。
- ソースが `src/` 以外に置かれ output-path fence に落とされる。
- `package.json` / `package-lock.json` / `tsconfig.json` / `vitest.config.ts` を成果物として出力・改変している。
- 相対 import が `.js` 拡張子を欠く／`.ts` を書く（TS2835 でコンパイル不能）。type-only・re-export も同様。
- Vitest 以外（`node:test` 等）をテストランナーとして用いている。

### 3.3 テスト品質ゲート違反 — リリース不可

- 選択スイート内に **FAIL が1件でも残る**（全 PASS でない）。
- **SKIP が1件でも残る**（`test.fixme()` 済みの未実装エンドポイント明示は SKIP と区別するが、実装済み挙動の SKIP は不可）。
- HTTP アサーションで **5xx（サーバ内部エラー／DB 断）を業務ステータスとして見逃している**（`<500` の健全性ベースラインを検証していない）。
- ページ遷移で **URL のみ／HTTP ステータスのみ**を確認し、遷移先の可視コンテンツを検証していない（サイレントな 404 リダイレクトや 200-中身相違を取り逃す）。
- 認証があるにもかかわらず**ログイン→リダイレクト→描画フロー**を欠く（F-05 の未実装時は `test.fixme()` で明示）。
- `operation_flow` 由来の運用テスト義務、および正準 VB のカバレッジに未検証の抜けがある。

## 4. E2E Test Generation Meta-Prompt

> このセクションは `codd propagate` が E2E テストを自動生成するための機械可読指示である。生成器は本節に従い、`docs/requirements/requirements.md` の設計時 `operation_flow` と `docs/test/test_strategy.md` の正準 VB を出発点にテスト義務を導出し、次に具体的な E2E 証拠候補へ落とす。

### 4.1 生成物の分類・レベル分離（必須）

E2E は**2レベルに分離**し、混同しない。

- **API 統合テスト** → `tests/e2e/<domain>.spec.ts`。Playwright `request` context または `fetch` でエンドポイント応答・ステータス・データ契約を検証する（サーバの検証）。
- **ブラウザテスト** → `tests/e2e/<domain>.browser.spec.ts`。Playwright を**ライブラリ import**（`import { chromium, type Page } from "playwright";`）し、Vitest 宣言 API 内で実ブラウザ操作（クリック・入力・遷移）と**可視 UI 状態**を検証する（ユーザー体験の検証）。
- ファイル名から即座にレベルが判別できること（`.spec.ts` = API、`.browser.spec.ts` = ブラウザ）。

**共通ルール（全 HTTP アサーション）**: まず応答ステータスが **`<500`** であることを検証し、その後で業務ステータス（200/302/401/403 等）を検証する。5xx は未処理例外・DB 断であり、4xx（認証失敗・未検出）とはカテゴリが異なる。共通ヘルパ `assertServerHealthy(response)` を経由する。

**ブラウザ遷移ルール**: ユーザー操作（フォーム送信・リンク／ボタンクリック）による遷移は、**遷移先 URL のアサート**と**遷移先の可視要素を最低1つ**のアサートを両方行う。

**ログインフロー（認証がある場合）**: (1) ログインページへ遷移 → (2) 資格情報入力・送信 → (3) 正しいログイン後 URL へのリダイレクトをアサート → (4) 遷移先が期待コンテンツを描画することをアサート。認証が未実装（F-05）なら該当を `test.fixme()`。

### 4.2 MECE ドメイン分解と出力ファイルマッピング

各ファイルは**重複しない単一の挙動ドメイン**を所有する。

| ドメイン | 主対象モジュール | API 統合テスト | ブラウザテスト |
|---------|----------------|----------------|----------------|
| realtime-sync | module:realtime_sync | `tests/e2e/realtime-sync.spec.ts` | `tests/e2e/realtime-sync.browser.spec.ts` |
| participation | module:participants | `tests/e2e/participation.spec.ts` | `tests/e2e/participation.browser.spec.ts` |
| connection-limit | module:config, module:participants | `tests/e2e/connection-limit.spec.ts` | `tests/e2e/connection-limit.browser.spec.ts` |
| game-flow | module:game_flow | `tests/e2e/game-flow.spec.ts` | `tests/e2e/game-flow.browser.spec.ts` |
| control-authority | module:control_panel, role:host | `tests/e2e/control-authority.spec.ts` | `tests/e2e/control-authority.browser.spec.ts` |
| scoring | module:scoring, module:tablet | `tests/e2e/scoring.spec.ts` | `tests/e2e/scoring.browser.spec.ts` |
| live-edit-rescoring | module:scoring, module:game_flow | `tests/e2e/live-edit-rescoring.spec.ts` | `tests/e2e/live-edit-rescoring.browser.spec.ts` |
| tablet-ui | module:tablet | `tests/e2e/tablet-ui.spec.ts` | `tests/e2e/tablet-ui.browser.spec.ts` |
| tv-display | module:tv_display | `tests/e2e/tv-display.spec.ts` | `tests/e2e/tv-display.browser.spec.ts` |
| question-data | module:config, module:game_flow | `tests/e2e/question-data.spec.ts` | `tests/e2e/question-data.browser.spec.ts` |

### 4.3 共有ヘルパ（必須・重複排除）

`tests/e2e/helpers/` 配下に共通処理を集約し、spec 間の重複を禁じる。相対 import は `.js` 拡張子で参照する。

- `tests/e2e/helpers/server-health.ts` — `assertServerHealthy(response)`（`<500` ベースライン）。
- `tests/e2e/helpers/auth.ts` — 司会者ログイン（F-05 未確定時は no-op ＋ `test.fixme()` フック）と host コンテキスト確立。
- `tests/e2e/helpers/join.ts` — QR 由来の参加URL取得 → タブレット参加 → 氏名自己入力フロー。
- `tests/e2e/helpers/game-setup.ts` — 問題ファイル読込→DB登録、プレイヤー準備、進行モード（b/c/d）到達のセットアップ。
- `tests/e2e/helpers/unique-id.ts` — `uniqueName(prefix)` 等、実行毎ユニーク識別子生成。
- `tests/e2e/helpers/assertions.ts` — 6列 d 表の検証、円建て表記・禁止パターン不在の共通アサート。

例（ブラウザ spec の骨子。宣言は Vitest、駆動は Playwright ライブラリ、import は `.js`）:

```typescript
// @generated-from: docs/test/acceptance-criteria.md
// @generated-by: codd propagate
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { loginAsHost } from "./helpers/auth.js";
import { assertServerHealthy } from "./helpers/server-health.js";
import { uniqueName } from "./helpers/unique-id.js";

describe("control-authority (browser)", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
  afterAll(async () => { await browser.close(); });

  it("host can lock answers and the deadline reflects on the TV surface", async () => {
    const page: Page = await browser.newPage();
    const res = await page.goto(process.env.E2E_BASE_URL + "/control-panel");
    expect(res!.status()).toBeLessThan(500);
    await loginAsHost(page);
    // ...操作 → 遷移先 URL と可視要素の双方をアサート
  });
});
```

### 4.4 シナリオ導出（operation_flow → VB → 証拠候補）

まず設計時 `operation_flow` と正準 VB からテスト義務を導出し、次に具体的 E2E 証拠へ落とす。設計が宣言する軸を持つ挙動は、以下の型を網羅する。

- **正常系 / 異常系**: 受付中の送信成功（正常）、締切後の送信拒否（異常）、0〜100外の拒否（異常）。
- **永続化・読み戻し**: 問題ファイル読込→DB登録→再取得で同一（question-data）、送信解答の永続化と再表示。
- **権限境界**: 締切・開示・取消を host は成功、非 host（タブレット/副司会）は 401/403（control-authority）。
- **終端状態**: 10問終了時の勝者確定（e モード）、勝敗判別。
- **クロスアクター反映**: タブレット送信 → 制御盤で受信可視化 → TV(b) で開示、の別アクター間反映。
- **派生状態・リードモデル連鎖**: 解答（producer）→ `answer_submitted`（durable event）→ 誤差×−100・残額（derived）→ TV d/e（consumer surface）。この連鎖を通しで検証する。
- **閾値・境界**: 下記 §4.5。

### 4.5 計測・閾値・境界の検証（producer→durable→derived→consumer）

閾値・件数・割合・残額を持つ値は、境界の**下/丁度/上**を可能な限り検証する。

- **入力値（0〜100 整数）**: 0（下限=可）/ 100（上限=可）/ −1（下限未満=UI+サーバ拒否）/ 101（上限超=拒否）/ 50.5（小数=拒否）。UI 拒否とサーバ拒否の**両方**を独立に検証。
- **ピタリ賞（誤差0境界）**: 誤差0 → +1,000 反映（丁度）／誤差1 → −100 のみ（直上）。拠出配分は F-02 に従い `test.fixme()`。
- **同時接続上限（既定8）**: 8台目=接続可（丁度）／9台目=拒否（上）。設定を16へ変更後 16台目可・17台目拒否、32へ変更後 32台目可・33台目拒否（上限判定が設定値追随）。
- **再採点連鎖（c→d）**: c 到達問の正解を N→M へ直す → 全員の誤差・増減円・残額が再計算され TV d/e が更新（丁度=編集前後の差分一致）。c 未到達の編集では再採点が起きない（下＝境界外）。
- **同期反映（AC-02 / F-04）**: 状態遷移が全端末へ p95 ≤ 2,000ms で反映（テストゲート）。

### 4.6 アクター向けサーフェス／コピー網羅

設計の surface/copy 義務からブラウザ E2E 義務を導く。

- **必須の可視ラベル/コピーをアサート**: TV d モードの6列見出し（氏名 / 解答 / 誤差 / 増減円 / ピタリ賞 / 残額）、金額の**円**表記、初期残額 10,000 円、QR 表示。
- **禁止アクション/リンク/コピーの不在をアサート**: タブレットに他者残額・得点・解答・全体一覧・出題提示が無いこと（AC-31）、非 host UI に締切/開示/取消操作が無いこと（AC-18）、`point`/`pt`/`点` 表記の不在（AC-25）。
- **アクター別の文言**: 制御盤（司会者向け操作系）／TV（観客向け提示系）／タブレット（解答者向け入力系）で対象が異なる文言を、それぞれのサーフェスで検証する。

### 4.7 アーキテクチャ適応（ルート走査）

生成時に**実際のルート／エンドポイント構造を走査**し、要件が示す挙動に対応するルートが未実装なら、当該テストを**スキップせず `test.fixme()`** でマークする（実装到来を明示的な穴として残す）。制御盤／TV／タブレットの各 URL、締切・開示・取消・モード切替・ライブ編集の API、WebSocket の実体を確認し、未実装分を `test.fixme()` 化する。認証（F-05）が未実装ならログインフローを `test.fixme()`。

### 4.8 変更を伴うテストデータ / 前提フィクスチャ

- **変更系（作成・更新）シナリオ**: 氏名・問題・解答など作成/更新するテストは**実行毎ユニーク識別子**（`uniqueName()`）を用い、**明示的クリーンアップ／冪等 teardown** を行う。反復実行が stale データや一意制約で落ちないこと。
- **前提依存シナリオ**: 既存レコード（登録済み問題・進行モード b/c/d 到達等）に依存するテストは、アサート前に**シナリオ/ヘルパ内で前提を確立または冪等リセット**する。可変な共有シードを、再生成または不変証明なしに信頼しない。

### 4.9 実行環境（サーバ起動）

E2E は稼働中サーバを要する。`package.json` の scripts・フレームワーク設定・エントリポイントから project type を検出し、起動シーケンスを組む。

- **起動手順**: `npm ci` → `npm run build` → `npm run start`（本アプリはクラウド WEB アプリ＋WebSocket ゆえサーバ常駐必須）。
- **ヘルスチェック待ち**: 起動後、ベース URL（または `/healthz`）が `<500` を返すまで**最大 60 秒**ポーリングしてから試験開始。CI では**サーバをバックグラウンド起動**し、health-check 通過後にテスト実行を開始する。
- **接続情報**: `E2E_BASE_URL` でクラウド公開URL（テスト環境）を注入。同時接続上限の設定（既定8／16／32）は設定パラメータ注入で切替え、AC-08〜AC-11 を検証する。
- **ブラウザ起動設定**: ブラウザテストは `chromium.launch({ headless: true })` を用いる（CI ヘッドレス）。realtime-sync / cross-actor 検証は複数 `page`（制御盤・タブレット・TV）を同時に開く。

### 4.10 生成マーカー

全生成ファイルの先頭に以下を含める。手書きテスト（`// @manual`）は再生成時に保存する。

```typescript
// @generated-from: docs/test/acceptance-criteria.md
// @generated-by: codd propagate
```

### 4.11 実行ポリシー（一括実行 → 収集 → 修復）

選択スイート**全体を実行**し、**全 FAIL を収集**してから修復に着手する。関連する失敗（例: 再採点連鎖・同期反映）をまとめて整合的に直す。個別失敗ごとの逐次修復で全体像を失わない。

### 4.12 品質ゲート（PASS 基準）

以下を全て満たすときのみ合格とする。

- 選択スイートが**全 PASS・SKIP ゼロ**（未実装は `test.fixme()` で明示、実装済み挙動の SKIP は不可）。
- `operation_flow` 由来の運用義務および正準 VB（`docs/test/test_strategy.md`）のカバレッジに抜けが無い。
- §3 のリリースブロッキング条項（NC-1〜NC-6・レイアウト/ツールチェーン規約・5xx 健全性ベースライン・遷移の URL＋可視要素二重検証）を全て遵守。
- API 統合テストとブラウザテストが**両レベルとも生成・実行**され、ファイル命名規約（`.spec.ts` / `.browser.spec.ts`）に従う。
