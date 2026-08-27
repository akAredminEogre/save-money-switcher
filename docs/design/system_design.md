---
codd:
  node_id: design:system-design
  type: design
  depends_on:
  - id: test:acceptance-criteria
    relation: constrained_by
    semantic: governance
  - id: governance:decision-records
    relation: constrained_by
    semantic: governance
  depended_by:
  - id: design:realtime-sync-design
    relation: depends_on
    semantic: technical
  - id: design:data-model-design
    relation: depends_on
    semantic: technical
  - id: design:question-media-intake-design
    relation: depends_on
    semantic: technical
  - id: design:scoring-engine-design
    relation: depends_on
    semantic: technical
  - id: design:participation-connection-design
    relation: depends_on
    semantic: technical
  - id: design:surface-copy-obligations
    relation: constrained_by
    semantic: governance
  - id: detailed_design:shared-domain-model
    relation: constrained_by
    semantic: governance
  - id: detailed_design:component-dependency-map
    relation: depends_on
    semantic: technical
  - id: infra:deployment-setup
    relation: depends_on
    semantic: technical
  - id: operations:runbook
    relation: depends_on
    semantic: technical
  - id: test:test-strategy
    relation: depends_on
    semantic: verification
  conventions:
  - targets:
    - module:realtime_sync
    reason: クラウド上のサーバへ制御盤／TV／解答者端末を接続しインターネット経由でリアルタイム同期（WebSocket 等）。ホスト PC をサーバにしない。違反時リリース不可。
  - targets:
    - db:questions
    - module:questions
    reason: 問題は事前ファイル読込で DB 登録・DB 保持し、ランタイムは DB から供給（E-1/E-2）。違反時リリース不可。
  - targets:
    - module:config
    - module:participants
    reason: 接続上限は既定 8・ハードコード禁止・設定変更で 32 台程度まで破綻しない同期基盤を選定軸に含める（論点10）。違反時リリース不可。
  - targets:
    - module:participants
    reason: 家族限定のアクセス制御（URL 秘匿か認証か）を設計責務として明示し、未定でも設計分岐として抱えること。無制御公開はリリース不可。
  - targets:
    - module:control_panel
    - role:host
    - role:answerer
    reason: 司会者（制御盤）・解答者（タブレット入力専用）・観客（TV）のロール境界と権限差を全体設計に反映する（論点7・第三要件）。違反時リリース不可。
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
  operation_flow:
    actors:
    - id: host
      label: 司会者（制御盤）
      surface: /control-panel
    - id: answerer
      label: 解答者（タブレット）
      surface: /tablet
    - id: audience
      label: 観客（TV）
      surface: /tv
    - id: system
      label: クラウドサーバ（realtime_sync）
    operations:
    - id: op_load_questions
      actor: host
      verb: load
      target: question_set
      trigger: 制御盤で事前問題ファイルの読込を実行
      route: /control-panel
      preconditions:
      - ゲーム未開始またはライブ編集フェーズ
      measurement_source: 事前問題ファイル
      durable_state: questions テーブル（text / image_path / video_path / correct_value）
      readback: ランタイム出題は questions テーブルから供給（ファイル再読込に依存しない）
      expected_outcomes:
      - 各問が questions テーブルへ登録される
      - correct_value が 0〜100 の整数で保持される
      dod_obligations:
      - id: dod_load_persist
        text: 読み込んだ全問が questions テーブルに登録され、再取得で登録時と同一の text と correct_value を返す
      - id: dod_load_runtime_from_db
        text: 出題面の解決元は questions テーブルであり、問題ファイルの再読込に依存しない
    - id: op_join_game
      actor: answerer
      verb: join
      target: game_session
      trigger: 制御盤の QR を読取り /join で氏名を自己入力して参加確定
      route: /join
      ui_pattern: qr_scan_then_name_input
      preconditions:
      - 接続数が MAX_TABLET_CONNECTIONS 未満
      durable_state: participants テーブル（name / connection_id）
      readback: 制御盤の参加者一覧と TV e モードに反映
      visible_to:
      - host
      - audience
      expected_outcomes:
      - 自己入力した氏名で participants に 1 人 1 レコードが作られる
      - 参加が制御盤と TV(e) に反映される
      forbidden_actors: []
      dod_obligations:
      - id: dod_join_self_name
        text: 参加者が自己入力した氏名が participants に永続し、制御盤の参加者一覧に表示される
      - id: dod_join_no_seat_fixed
        text: 端末番号の固定割当や事前氏名台帳の UI/API を用いずに参加が成立する
    - id: op_enforce_connection_limit
      actor: system
      verb: reject
      target: tablet_connection
      trigger: 接続数が MAX_TABLET_CONNECTIONS に達した状態での新規接続試行
      measurement_source: 現在接続数と MAX_TABLET_CONNECTIONS 設定値
      threshold: MAX_TABLET_CONNECTIONS（既定 8）
      preconditions:
      - connected >= MAX_TABLET_CONNECTIONS
      durable_state: 既存接続は不変
      expected_outcomes:
      - 上限超過の接続は断られる
      - 既存接続は影響を受けない
      boundary_cases:
      - 既定 8: 8 台目は接続可・9 台目は拒否
      - 設定 16: 16 台目は接続可・17 台目は拒否
      - 設定 32: 32 台目は接続可・33 台目は拒否
      dod_obligations:
      - id: dod_limit_default_eight
        text: 設定未指定時に 8 台まで接続でき 9 台目が拒否される
      - id: dod_limit_config_follows
        text: MAX_TABLET_CONNECTIONS を 16/32 へ設定変更するとコード改修なしに上限がその値へ追随する
      - id: dod_limit_no_hardcode
        text: 上限判定は設定値を参照し、ソースに数値リテラル 8 のハードコードが存在しない
    - id: op_submit_answer
      actor: answerer
      verb: submit
      target: answer
      trigger: タブレットの 4 ボタン（+1/-1/+10/-10）で値を作り送信
      route: /tablet
      ui_pattern: four_button_stepper
      measurement_source: タブレット数値入力
      preconditions:
      - 当該問の game_state.stage が accepting
      durable_state: answers テーブル（value / submitted_at）
      readback: 送信済み表示と自分の残額のみ（他者情報は不可視）
      from_state: accepting
      to_state: accepting
      expected_outcomes:
      - 0〜100 の整数のみ answer_submitted として永続化される
      boundary_cases:
      - 0 は受理
      - 100 は受理
      - -1 は UI とサーバの双方で拒否
      - 101 は UI とサーバの双方で拒否
      - 50.5 は UI とサーバの双方で拒否
      dod_obligations:
      - id: dod_submit_persist
        text: 受付中に送信した 0〜100 整数の解答が answers に永続化され再表示できる
      - id: dod_submit_range_dual_guard
        text: 負値・小数・100 超・非数値は UI とサーバの双方で拒否され answers に入らない
    - id: op_lock_answers
      actor: host
      verb: lock
      target: answers
      trigger: 制御盤で「そこまで」を押下
      route: /control-panel
      forbidden_actors:
      - answerer
      from_state: accepting
      to_state: answers_locked
      durable_state: game_state.stage = answers_locked
      consumer_surfaces:
      - answerer_tablets
      expected_outcomes:
      - 全解答者タブレットの入力がロックされる
      - 締切後の送信は拒否される
      dod_obligations:
      - id: dod_lock_host_only
        text: 締切は role host のみ発動でき answerer からの締切コマンドは 401/403 で拒否される
      - id: dod_lock_blocks_submit
        text: 締切後に解答者が送信を試みても answers に追加されず拒否される
    - id: op_open_answers
      actor: host
      verb: open
      target: answers
      trigger: 制御盤で「解答オープン！」を押下
      route: /control-panel
      forbidden_actors:
      - answerer
      from_state: answers_locked
      to_state: answers_opened
      durable_state: game_state.stage = answers_opened
      visible_to:
      - audience
      consumer_surfaces:
      - tv_mode_b
      expected_outcomes:
      - 開示前は他者解答が全端末で伏せられている
      - 開示後 TV(b) に氏名と解答が一斉表示される
      dod_obligations:
      - id: dod_open_hidden_before
        text: b 未実行の間はどの端末にも他者の解答が表示されない
      - id: dod_open_reveals_on_tv
        text: 開示後に TV(b) が全員の氏名と解答を表示する
    - id: op_reveal_correct
      actor: host
      verb: reveal
      target: correct_value
      trigger: 制御盤で正解発表を実行
      route: /control-panel
      forbidden_actors:
      - answerer
      from_state: answers_opened
      to_state: answer_revealed
      durable_state: game_state.stage = answer_revealed
      consumer_surfaces:
      - tv_mode_c
      expected_outcomes:
      - TV(c) に正解値が提示される
      - 以降の正解ライブ編集は自動再採点の対象となる
      dod_obligations:
      - id: dod_reveal_marks_disclosed
        text: 正解発表の実行で当該問が開示済み（c 以降）として game_state に記録される
    - id: op_compute_settlement
      actor: host
      verb: settle
      target: balances
      trigger: 制御盤で得点精算を実行
      route: /control-panel
      from_state: answer_revealed
      to_state: settlement_computed
      measurement_source: answers と questions.correct_value
      durable_state: balances（円・整数）
      consumer_surfaces:
      - tv_mode_d
      - tv_mode_e
      expected_outcomes:
      - 誤差 = 絶対値(解答 - 正解) が 0〜100 整数で算出される
      - 増減円 = 誤差 × -100 で残額が更新される
      - 誤差 0 のピタリ賞は +1000 円が加算される
      boundary_cases:
      - 誤差 0 は +1000（丁度）
      - 誤差 1 は -100 のみ（直上）
      dod_obligations:
      - id: dod_settle_initial_grant
        text: ゲーム開始時に各プレイヤーの balances が 10000 円で初期化されている
      - id: dod_settle_delta
        text: 誤差 5 の精算後に当該プレイヤーの残額が精算前より 500 円少ない
      - id: dod_settle_pitari_add
        text: 誤差 0 のプレイヤーに +1000 円が反映される（拠出配分側は forbidden 未確定として fixme）
      - id: dod_settle_currency_yen
        text: d の 6 列表と API 応答が円建てで表され point/pt/点 の語が存在しない
    - id: op_live_edit_correct
      actor: host
      verb: edit
      target: question_or_correct_value
      trigger: 制御盤のライブ編集 UI で問題または正解を更新
      route: /control-panel
      durable_state: questions テーブル更新
      readback: DB 再取得で編集後の値を返す
      expected_outcomes:
      - 問題・正解の双方を進行中に編集でき DB に永続する
      dod_obligations:
      - id: dod_edit_persist
        text: 進行中に編集した問題文と正解値が questions に永続し再取得で読み戻せる
    - id: op_auto_rescore
      actor: system
      verb: rescore
      target: balances
      trigger: 開示済み（c 以降）の問題で正解をライブ編集
      preconditions:
      - 当該問の game_state.stage が answer_revealed 以降
      measurement_source: 編集後 correct_value と既存 answers
      durable_state: balances 差分更新
      consumer_surfaces:
      - tv_mode_d
      - tv_mode_e
      from_state: answer_revealed
      to_state: answer_revealed
      expected_outcomes:
      - 正解訂正で全員の誤差・増減円・残額が自動再計算される
      - d 到達問は残額の差分再計算を伴い TV d/e が同時更新される
      boundary_cases:
      - c 到達問の正解訂正 → 再採点が走る
      - c 未到達の正解編集 → 再採点は走らない（境界外）
      dod_obligations:
      - id: dod_rescore_after_c
        text: c 実行後に正解を直すと自動再採点され各人の残額へ即時反映される
      - id: dod_rescore_no_before_c
        text: c 未到達の正解編集では再採点が起きない
      - id: dod_rescore_d_sync
        text: d 到達問の正解訂正で残額差分が再計算され TV の d と e が同時更新される
    - id: op_undo_trigger
      actor: host
      verb: undo
      target: last_trigger
      trigger: 制御盤で取消を実行
      route: /control-panel
      forbidden_actors:
      - answerer
      durable_state: trigger_undone イベント
      expected_outcomes:
      - 直近の対象操作が取り消される
      boundary_cases:
      - 取消の具体挙動（直近のみか任意問題再開示か）は未確定（F-03・fixme）
      dod_obligations:
      - id: dod_undo_host_only
        text: 取消は role host のみ発動でき answerer からの取消コマンドは 401/403 で拒否される
    - id: op_switch_tv_mode
      actor: host
      verb: switch
      target: tv_mode
      trigger: 制御盤の「次へ」「戻る」または各モード個別ジャンプ
      route: /control-panel
      ui_pattern: next_back_jump
      durable_state: game_state.tv_mode
      consumer_surfaces:
      - tv_mode_a
      - tv_mode_b
      - tv_mode_c
      - tv_mode_d
      - tv_mode_e
      expected_outcomes:
      - 3 系統の操作で TV の表示モードが対応して切り替わる
      - a モードは動画→画像→テキストの 3 段で出題面を解決する
      boundary_cases:
      - 動画パス有 → 動画
      - 動画無・画像有 → 画像
      - 双方無 → テキスト
      dod_obligations:
      - id: dod_tv_three_switch_systems
        text: 次へ・戻る・個別ジャンプの 3 系統いずれでも TV の表示モードが対応値へ切り替わる
      - id: dod_tv_a_fallback
        text: a モードが動画・画像・テキストの優先順で出題面を解決する
    - id: op_determine_winner
      actor: system
      verb: determine
      target: winner
      trigger: 10 問目の得点精算が完了
      preconditions:
      - 10 問すべてが settlement_computed
      measurement_source: 全問通算の balances
      consumer_surfaces:
      - tv_mode_e
      from_state: settlement_computed
      to_state: game_finished
      expected_outcomes:
      - 残額最多のプレイヤーが e モードで勝者として判別可能に表示される
      dod_obligations:
      - id: dod_winner_most_balance
        text: 10 問終了時に残額最多のプレイヤーが e モードで勝者として判別できる
---

# システム設計（クラウド WEB アプリ・アーキテクチャ概要）

## 1. Overview

本書は `save-money-switcher`（フジテレビ『賞金先渡しクイズ SAVE MONEY』方式を家族で遊ぶクイズ操作盤）の**システム設計**であり、要件 `req:save-money-switcher-requirements`（approved）と、それを統べる `governance:decision-records`・`test:acceptance-criteria` を唯一の真実源として、実装組み立てフェーズが従うアーキテクチャを確定する。ここに記す 🟦 確定値・不変条件に反する成果物は**リリース不可（release-blocking）**として扱う。

### 1.1 プロダクトの確定像

- **形態**: クラウド上で常時稼働する WEB アプリ。**制御盤**（司会者のノート PC・`/control-panel`）／**TV**（HDMI 拡張ディスプレイ・`/tv`）／**各解答者タブレット**（入力専用・`/tablet`）／**参加受付**（`/join`）はいずれも**クラウド公開 URL** へブラウザ接続し、**インターネット経由の WebSocket** でリアルタイム同期する。**ホスト PC はサーバにしない**（2026-08-08 確定・撤回済みオフライン LAN 前提の復活は禁止）。
- **ゲームルール（案 A・SAVE MONEY 準拠・個人戦）**: 先渡し **10,000 円** ／ 誤差 1 につき **−100 円** ／ ピタリ賞（誤差 0）で他プレイヤーから **+1,000 円** 横取り ／ **1 ゲーム 10 問** ／ 全問終了時の**残額最多が勝ち**。回答は **0〜100 の整数のみ**。**現金感を薄めない**（表示・内部表現とも「円」・ポイント/点への置換禁止）。
- **進行状態機**: 受付中（入力可）→ 司会者「そこまで」で**締切（全端末ロック）**→ 司会者「解答オープン！」で**一斉開示**。各問は **b（解答オープン）/ c（正解発表）/ d（得点精算）** のどこまで進んだかを保持する。
- **TV 5 モード（MC 切替）**: **a** 出題（動画 → 画像 → テキストの 3 段フォールバック）／ **b** 解答オープン ／ **c** 正解発表 ／ **d** 1 問ごとの得点精算（**氏名 / 解答 / 誤差 / 増減円 / ピタリ賞 / 残額**の 6 列全員表）／ **e** 全員の得点一覧（全問通算）。切替は制御盤から **①順送り「次へ」 ②「戻る」 ③各モード個別ジャンプ** の 3 系統。
- **タブレット**: 入力専用最小 UI（**問題番号 / 数値入力 / 送信済み表示 / 自分の残額**のみ）。入力は **+1 / −1 / +10 / −10 の 4 ボタン方式**。他者情報・出題内容・全体一覧は出さない。
- **参加登録**: 制御盤の QR をタブレットで読取り、**氏名を自己入力**。**1 人 = 1 台**。端末番号の固定割当は不採用。
- **同時接続上限**: 既定 **8 台**、**ハードコード禁止**、設定値で **8→16→32** へ非改修変更可。
- **問題データ**: 事前ファイルを読み込み **DB 登録**して保持。動画は問題ファイルにパス記載＋所定フォルダへ事前配置。進行中も問題・正解を**ライブ編集可**。
- **再採点**: 「c 正解発表」実行後に正解をライブ編集すると**自動再採点**し残額へ即時反映。d まで進んでいれば**残額の差分再計算**を伴い TV の d/e を同時更新する。
- **権限**: 締切・開示・取消の発動は**司会者（制御盤・`role: host`）のみ**。取消は初版から司会者権限操作として含む。

### 1.2 リリースブロッキング不変条件（本設計が具体化する制約）

| # | 対象 | 不変条件 | 本書での具体化箇所 |
|---|---|---|---|
| INV-1 | `module:realtime_sync` | クラウド上のサーバへ制御盤／TV／解答者端末を接続し、インターネット経由の WebSocket でリアルタイム同期。**ホスト PC をサーバにしない** | §2.1・§2.4・§2.11 |
| INV-2 | `db:questions` / `module:questions` | 問題は事前ファイル読込で **DB 登録・DB 保持**し、ランタイムは DB から供給（E-1/E-2） | §2.3・§2.8 |
| INV-3 | `module:config` / `module:participants` | 接続上限は既定 8・**ハードコード禁止**・設定変更で 32 台まで破綻しない同期基盤を選定 | §2.4・§2.7 |
| INV-4 | `module:participants` | 家族限定アクセス制御（URL 秘匿か認証か）を**設計責務として明示**し、未定でも設計分岐として抱える。**無制御公開はリリース不可** | §2.10・§3.1 |
| INV-5 | `module:control_panel` / `role:host` / `role:answerer` | 司会者・解答者・観客のロール境界と権限差を全体設計へ反映 | §2.5・§2.10・Operational Behavior Model |
| INV-6 | `module:scoring` / `module:tablet` | 回答・判定・スコアリングは **0〜100 の整数のみ受理**し、小数・負値・100 超は **UI とサーバ双方で拒否** | §2.6・§2.9 |
| INV-7 | `module:scoring` / `module:tv_display` | **円建て固定**（ポイント/点への置換禁止・現金感を薄めない） | §2.6・§2.9 |

### 1.3 実装・ツールチェーン前提（scaffold 固定・釈義不可）

- **実装言語 = TypeScript のみ。** 要件の選定軸「クラウドへデプロイでき WebSocket 等を扱える」の解として **TypeScript / Node** を採る。本書のファイルパス・モジュール構成・依存管理・ツールチェーン参照はすべて TypeScript 慣行のみを用い、他言語の拡張子・マニフェスト・ツールは例示・フォールバックとしても登場させない。
- **テストランナー = Vitest（固定・release-blocking のグラウンドトゥルース）。** verify コマンドが実際に走らせるのは Vitest であり、本書はこれを再解釈・上書きしない。全テストは Vitest 自身の宣言 API（`import { describe, it, expect } from "vitest";`）で記述する。「サードパーティ依存を最小化する」方針は**出荷コードのランタイム依存**にのみ及び、テストランナーには及ばない。依存数の哲学を根拠に別フレームワークや Node 組み込み `node:test` を用いてはならない。
- **モジュール解決 = NodeNext/Node16。** すべての相対 import 指定子は**出力される `.js` ファイル名を明示した拡張子**を伴う（`import { x } from "./x.js"`。`"./x"`・`"./x.ts"` は不可）。re-export（`export { x } from "./x.js"`）・default/namespace import・type-only import（`import type { T } from "./x.js"`）も同一規約。拡張子欠落は TS2835 でコンパイル不能。
- **レイアウト契約（output-path fence 強制）。** ソースは**必ず `src/` 配下**、テストは**必ず `tests/` 配下**（`test/`・`spec/`・`specs/` を発明しない）。`package.json`・`package-lock.json`・`tsconfig.json`・`vitest.config.ts` は harness scaffold 所有につき、本書はこれらを成果物として出力・宣言しない。

### 1.4 アクター向けサーフェス／コピー義務

要件が定めるロール（内部識別子 → 可視ラベル）: `role: host` → **司会者**、`role: answerer` → **解答者**、観客（TV 視聴者）。可視コピーには**可視ラベル**（司会者／解答者）を用い、内部識別子（host/answerer）や実装根拠・環境前提・権限境界の説明を露出させない。全サーフェス共通で `point`／`pt`／`点` を禁止パターンとし、金額は「円」で表す。

| サーフェス | ルート | 主対象アクター | 目的 | 許可アクション／ナビゲーション | 禁止アクション／ナビゲーション | 必須の可視コピー意図 | 禁止コピー |
|---|---|---|---|---|---|---|---|
| 制御盤 | `/control-panel` | 司会者 | 進行制御・ライブ編集・MC 切替・QR 提示 | 締切・開示・正解発表・得点精算・取消・問題/正解編集・TV モード切替（次へ/戻る/個別ジャンプ）・参加 QR 表示 | 解答者の入力操作面を出さない | 「そこまで」「解答オープン！」「正解発表」等の司会者向け操作語・参加用 QR | 内部 role 識別子・テスト/デモ/サンプル表記・`point`/`pt`/`点` |
| TV | `/tv` | 観客 | 5 モードの提示（a〜e） | 表示のみ（受動） | いかなる入力・操作要素も置かない | a 出題面／b 氏名＋解答／c 正解値／d 6 列表（氏名/解答/誤差/増減円/ピタリ賞/残額）・**円**表記／e 全問通算一覧 | 実装ノート・`point`/`pt`/`点` |
| タブレット | `/tablet` | 解答者 | 数値入力・送信・自分の残額確認 | 4 ボタン（+1/−1/+10/−10）で 0〜100 を増減・送信・送信済み確認・自分の残額閲覧 | 他者の残額/得点/解答・出題内容・全体一覧・締切/開示/取消の各操作を**出さない** | 問題番号・数値入力・送信済み表示・自分の残額（**円**） | 他者情報・司会者操作語・`point`/`pt`/`点` |
| 参加受付 | `/join` | 解答者 | QR 経由の参加・氏名自己入力 | 氏名入力・参加確定 | 事前氏名台帳／座席固定割当の提示、保護された制御盤ナビゲーションの露出 | 「お名前を入力してください」等の解答者向け参加導線 | ロール解決済みの曖昧な保護ナビ・環境前提 |

**エントリ／事前認証サーフェス**（`/join`・未認証時の到達点）は、アクセス状態に整合しない保護ナビ（制御盤操作等）を露出しない。認証方式は §3.1 の設計分岐に従い、導入時はログイン → 正しいリダイレクト → 期待コンテンツ描画のフローを備える。

---

## 2. Architecture

### 2.1 システムトポロジ（クラウド構成・INV-1 の具体化）

```
                        ┌─────────────────────── クラウド（常時稼働） ───────────────────────┐
                        │                                                                    │
  司会者 PC（制御盤）    │   ┌────────────────────────┐        ┌──────────────────────────┐   │
  ブラウザ /control-panel├──▶│ HTTP/WS サーバ         │◀──────▶│ DB（永続化）             │   │
                        │   │ src/realtime_sync/     │        │ questions / answers /    │   │
  TV（HDMI 拡張）        │   │  server.ts（WS 権威）  │        │ participants / balances /│   │
  ブラウザ /tv     ◀────┼──▶│  hub.ts（配信）        │        │ game_state               │   │
                        │   │ src/control_panel/     │        └──────────────────────────┘   │
  解答者タブレット×N     │   │ src/tv_display/        │                                        │
  ブラウザ /tablet ◀────┼──▶│ src/tablet/ ほか       │                                        │
                        │   └────────────────────────┘                                        │
                        └────────────────────────────────────────────────────────────────────┘
```

- **WebSocket サーバはクラウド側に一意に存在し**、`answers_locked`／`answers_opened`／`answer_revealed`／`settlement_computed`／`trigger_undone`／`tv_mode_changed`／`participant_joined`／`balance_updated` の各ドメインイベントを全接続へ配信する単一の権威となる。
- **制御盤ブラウザはサーバとして待受しない。** 制御盤を落としても TV・タブレット間の同期はクラウドサーバ経由で継続する（AC-03）。これは INV-1 を満たすための構造的保証であり、`localhost` LAN 完結・ホスト PC の AP 化を含む実装は本設計に反しリリース不可。
- 初期ロードおよび全 HTTP 応答は健全性ベースライン **`< 500`（5xx を出さない）** を満たす（AC-01・§2.11）。

### 2.2 モジュール構成とソース配置（`src/` 配下・snake_case）

`governance:decision-records` §1.5 の module→格納先マッピングを本設計の権威とする。DB テーブルは snake_case、URL ルートは kebab-case、環境変数は SCREAMING_SNAKE_CASE、ロール／ドメインイベントは snake_case を用いる。

| モジュール | 格納先 | 主担当 |
|---|---|---|
| `module:realtime_sync` | `src/realtime_sync/` | クラウド WebSocket 同期・進行イベントの全端末反映（INV-1/INV-3） |
| `module:scoring` | `src/scoring/` | 先渡し・減算・ピタリ賞・残額・差分再採点（INV-6/INV-7） |
| `module:config` | `src/config/` | 設定外出し（`MAX_TABLET_CONNECTIONS` 等）の単一解決点（INV-3） |
| `module:participants` | `src/participants/` | QR 参加・氏名自己入力・接続上限判定・アクセス制御（INV-3/INV-4） |
| `module:questions` | `src/questions/` | 事前ファイル読込→DB 登録・ライブ編集・動画/画像/テキスト解決（INV-2） |
| `module:game_flow`（`game_state`） | `src/game_state/` | 問題ごとの進行段階（b/c/d）保持・締切・開示・取消 |
| `module:control_panel` | `src/control_panel/` | 司会者操作盤・ライブ編集 UI・MC 切替・QR 提示（INV-5） |
| `module:tv_display` | `src/tv_display/` | TV 5 モード（a〜e）提示（INV-7） |
| `module:tablet` | `src/tablet/` | 入力専用最小 UI・4 ボタン入力・サーバ側と対のバリデーション（INV-6） |

相対 import は全モジュールで `.js` 拡張子を明示する。例:

```typescript
// src/scoring/apply_question_score.ts
import type { QuestionProgress } from "../game_state/progression.js";
import { assertIntegerAnswer } from "./validate_answer.js";
export { applyQuestionScore } from "./apply_question_score_impl.js";
```

### 2.3 データモデル（DB テーブル・INV-2 の具体化）

永続化は `questions`・`answers`・`participants`・`balances`・`game_state` の 5 テーブルを基本とする。DB の具体永続化技術は greenfield 選定（§3.1）だが、以下のスキーマ責務は確定である。

| テーブル | 主なカラム（責務） |
|---|---|
| `questions` | `id` / `question_number` / `text` / `image_path`（任意）/ `video_path`（任意）/ `correct_value`（**0〜100 整数**） |
| `answers` | `id` / `question_id` / `participant_id` / `value`（**0〜100 整数**）/ `submitted_at`（`answer_submitted` の永続） |
| `participants` | `id` / `name`（**自己入力**）/ `joined_at` / `connection_id`（1 人 = 1 台） |
| `balances` | `participant_id` / `amount`（**円・整数**。初期 10,000） |
| `game_state` | `question_id` / `stage`（`accepting`/`answers_locked`/`answers_opened`/`answer_revealed`/`settlement_computed`）/ `current_question_number` / `tv_mode`（a〜e） |

- **INV-2 準拠**: 問題は事前ファイルから読み込んで `questions` に登録し、ランタイムの出題はファイル再読込ではなく `questions` テーブルから供給する。ライブ編集は `questions` への DB 更新として反映され、再取得で読み戻せる。
- `game_state.stage` は各 `question_id` の到達段階を保持し、再採点範囲判定（§2.6）の唯一の前提となる。この段階保持なしに「開示済み（c 以降）」は判定できない。

### 2.4 リアルタイム同期設計（`module:realtime_sync`・INV-1/INV-3）

- **配信モデル**: `src/realtime_sync/server.ts` がクラウド上の WebSocket 権威。`hub.ts` が接続をロール（host / answerer / audience）別に束ね、状態遷移イベントを全端末へ push する。状態遷移（締切・開示・モード切替・再採点）は接続中の全端末へ**リアルタイム反映**する（AC-02）。
- **再接続復帰**: 回線断・再接続時、端末は最新のゲーム状態（現在問題番号・進行段階・TV モード・自分の残額）へ復帰する（AC-04）。復帰の権威はサーバ側 `game_state` と `balances`。
- **スケーラビリティ選定軸（INV-3）**: 同期基盤は既定 8 台を前提に最適化しつつ、`MAX_TABLET_CONNECTIONS` を **16/32** へ設定変更しても破綻しないこと（32 台程度までの同時接続で全端末反映が継続すること）を選定軸に含める。接続受け入れ判定は §2.7 の設定値を参照する。
- **同期反映の測定ゲート**: 状態遷移の全端末反映を **p95 ≤ 2,000ms** のテストゲートとして設定する。設計に固定 SLA が無いため本値は暫定ゲートであり、SLA 確定時に更新する（F-04・§3.3）。

### 2.5 進行状態機と権限境界（`module:game_state` / `module:control_panel`・INV-5）

- **状態遷移**: `accepting` →（司会者「そこまで」＝ `answers_locked`）→（司会者「解答オープン！」＝ `answers_opened`／b）→（正解発表＝ `answer_revealed`／c）→（得点精算＝ `settlement_computed`／d）。開示前（b 未実行）は他者解答をどの端末にも表示しない。
- **締切の効果**: `answers_locked` 後は**全解答者タブレットの入力がロック**され、以降の送信はサーバ側で拒否される（終端状態ガード・AC-13）。
- **権限境界（INV-5・release-blocking）**: `answers_locked`／`answers_opened`／`answer_revealed`／`trigger_undone` を発火できるのは **`role: host` セッションのみ**。`role: answerer`・副司会（制御盤以外）からの当該コマンドは**サーバ側で 401/403 拒否**し、非 host の UI には該当操作要素を置かない（AC-17/AC-18）。ロール判定はセッションのロール属性を単一の判定点とする。
- **取消**: 司会者による取消は初版から機能し、直近の対象操作を取り消す。取消の具体挙動（直近のみか／任意問題再開示か）が曖昧な範囲は推測実装せず F028 で殿判断を仰ぐ（§3.2・F-03）。

### 2.6 スコアリングと再採点（`module:scoring`・INV-6/INV-7）

- **確定値（改変禁止）**: 先渡し **10,000 円** ／ 誤差 = |解答 − 正解|（0〜100 整数）／ 増減円 = **誤差 × −100 円** ／ ピタリ賞（誤差 0）で他プレイヤーから **+1,000 円** ／ 10 問終了時**残額最多勝ち**。旧軍師推奨の「点化」「500 点」「現金感を薄める」は無効。
- **円建て固定（INV-7）**: 内部表現・表示ともに「円」を基調とし、`point`／`pt`／`点` への置換を禁止する。`applyQuestionScore` の戻り値は `currency: "円"` を保持する。
- **0〜100 整数の二重防衛（INV-6・release-blocking）**: 入力・判定・スコアリングの全経路で 0〜100 の整数のみ受理する。**UI（`src/tablet/`）とサーバ（`src/scoring/validate_answer.ts`）の双方**で、小数・負値・100 超・非数値を拒否する（境界: 0=可 / 100=可 / −1=不可 / 101=不可 / 50.5=不可）。片方でしか拒否しない実装はリリース不可。
- **自動再採点（E-3 残・release-blocking）**: 「c 正解発表」実行後（`stage >= answer_revealed`）に正解をライブ編集すると、`src/scoring/` が**自動再採点**して `balances` へ即時反映する。c 未到達の編集は再採点対象外（下＝境界外）。**d まで進んだ問題**の正解を直した場合は**残額の差分再計算**を行い、TV の **d（精算表示）・e（全員一覧）を同時更新**する。この再採点範囲は `game_state.stage` を参照して決定される。
- **派生状態チェーン**: 解答（producer）→ `answer_submitted`（durable）→ 誤差 × −100・残額（derived）→ TV d/e（consumer surface）。このチェーンを通しで整合させる。

受け入れは Vitest ユニットで固定する（`tests/scoring.test.ts`・`tests/rescoring.test.ts`）。相対 import は `.js` 付き:

```typescript
import { describe, it, expect } from "vitest";
import { applyQuestionScore } from "../src/scoring/apply_question_score.js";

describe("scoring", () => {
  it("誤差 5 は −500 円を減算し円建てを保つ", () => {
    const r = applyQuestionScore({ balance: 10_000, answer: 45, correct: 50 });
    expect(r.error).toBe(5);
    expect(r.delta).toBe(-500);
    expect(r.currency).toBe("円");
  });
  it("100 超の回答は受理しない（0〜100 整数のみ）", () => {
    expect(() => applyQuestionScore({ balance: 10_000, answer: 101, correct: 50 })).toThrow();
  });
});
```

### 2.7 参加登録と同時接続上限（`module:participants` / `module:config`・INV-3）

- **参加登録**: 制御盤が参加用**クラウド公開 URL の QR** を表示し、タブレットが `/join` へ接続して**氏名を自己入力**する（1 人 = 1 台）。参加は `participants` に登録され、制御盤・TV(e) へ反映される。端末番号の固定割当・事前氏名/座席登録の UI/API は持たない（AC-07）。
- **同時接続上限（release-blocking）**: 既定 **8 台**。上限値は**設定パラメータ `MAX_TABLET_CONNECTIONS`** として `src/config/` が単一解決し、**コードに定数リテラル `8` を埋め込まない**。`src/participants/admission.ts` はこの設定値を参照して上限超過接続を拒否し、既存接続は影響を受けない。上限は **16 / 32 へコード改修なしで変更可**（上限判定が設定値に追随）。設定の持ち方は環境変数を既定機構とする（§3.1）。

受け入れ（`tests/connection_limit.test.ts`・`tests/admission.test.ts`）:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { resolveMaxTabletConnections } from "../src/config/connection_limit.js";
import { admitTablet } from "../src/participants/admission.js";

describe("connection limit", () => {
  afterEach(() => { delete process.env.MAX_TABLET_CONNECTIONS; });
  it("未設定時の既定は 8（リテラル埋め込みではない）", () => {
    expect(resolveMaxTabletConnections()).toBe(8);
  });
  it("設定 32 を非改修で反映する", () => {
    process.env.MAX_TABLET_CONNECTIONS = "32";
    expect(resolveMaxTabletConnections()).toBe(32);
  });
  it("上限到達で接続を断る（判定は設定値参照）", () => {
    expect(() => admitTablet({ limit: 8, connected: 8 }, { name: "9人目" })).toThrow();
  });
});
```

### 2.8 問題データ・ライブ編集（`module:questions`・INV-2）

- **入稿**: 事前問題ファイルを読み込み、テキスト・任意の画像パス・任意の動画パス・正解値（0〜100 整数）を `questions` へ登録する。ランタイムは DB から供給する。
- **動画の実体**: 問題ファイルに**動画パスを記載**し、動画は**所定フォルダへ事前配置**する。当日その場入力の UI/API に依存しない。
- **出題面フォールバック（a モード）**: **動画 → 画像 → テキスト**の 3 段で解決（動画パス有→動画 / 動画無・画像有→画像 / 双方無→テキスト）。
- **ライブ編集**: 進行中も制御盤から**問題・正解の双方**を編集でき、DB 更新として永続化・読み戻せる。c 以降の正解編集は §2.6 の自動再採点を起動する。

### 2.9 TV 表示・タブレット UI（`module:tv_display` / `module:tablet`）

- **TV 5 モード**: **a** 出題（3 段フォールバック）／ **b** 氏名＋解答の一斉開示 ／ **c** 正解値（MVP は開示一覧＋正解値＋得点増減（円）まで。効果音・カウントダウン・アニメ・ランキング演出は不要）／ **d** 当該問の**6 列全員表**（氏名 / 解答 / 誤差 / 増減円 / ピタリ賞 / 残額。増減円・残額は §2.6 と一致・**円**表記）／ **e** 全問通算の全員一覧。d は当該問フォーカス、e は全問通算で役割が分かれる。
- **MC 切替**: 制御盤から **①順送り「次へ」 ②「戻る」 ③各モード個別ジャンプ** の 3 系統で行い、`tv_mode_changed` を配信して TV の表示モードを対応切替する。
- **タブレット最小 UI（INV-5/INV-6）**: 可視要素は**問題番号 / 数値入力 / 送信済み表示 / 自分の残額**に限る。入力は **+1 / −1 / +10 / −10 の 4 ボタン**で 0〜100 を増減し、境界で 0 未満・100 超へ振り切れない。**他者の残額/得点/解答・出題内容・全体一覧は表示しない**（禁止要素の不在をアサート）。

### 2.10 アクセス制御・セキュリティ・プライバシー（INV-4/INV-5）

- **権限境界（access control）**: 締切・開示・正解発表・取消は `role: host` のみ。API は host 以外に **401/403** を返し、非 host UI に該当操作要素を置かない（§2.5・AC-18）。TV モード切替も「操作盤側から」に限定し論点 7 と整合する。
- **家族限定アクセス制御（INV-4・設計分岐として明示）**: 参加ベクタは QR が指すクラウド公開 URL（`/join`）。**無制御公開はリリース不可**であり、以下 2 分岐のいずれかで抑制する。方式決定は §3.1 に保留するが、**いずれの分岐でも**判定は単一解決点（`src/config/` の上限・`role: host` チェック）を経由させる。
  - **分岐 A（URL 秘匿）**: 参加 URL を知得した者のみ接続。ブラスト半径抑制は **接続上限（既定 8）** と **トリガー権限の司会者限定** が担保する。
  - **分岐 B（認証導入）**: ログイン → 正しいリダイレクト → 期待コンテンツ描画のフローを備える。導入時も上限判定・権限判定の単一解決点を経由させる。
- **入力バリデーション（サーバ側最終防衛・INV-6）**: 0〜100 整数の検証を**サーバ側でも**行い、UI を迂回した不正値（負値・小数・100 超・非数値）を拒否する。
- **プライバシー / データ取扱い**: 収集する個人データは解答者が**自己入力した氏名と当日の解答・残額**に限る。タブレットは他者情報を保持・表示しない。氏名は当日その場参加を前提とし、**恒久的な事前氏名台帳を持たない**。

### 2.11 非機能要件（性能・可用性・観測）

- **健全性ベースライン**: 全 HTTP 応答は **`< 500`**（5xx を業務ステータスとして見逃さない）。ページ遷移は URL とともに遷移先の可視コンテンツを検証する。
- **同期反映**: 状態遷移の全端末反映は **p95 ≤ 2,000ms**（暫定テストゲート・F-04）。
- **可用性前提**: 本番当日の**インターネット接続を前提**とし、回線断はオフライン完結ではなく運用リスクとして扱う（バックアップ回線・テザリング等の当日回線確保で担保。コードは当日接続前提で組む）。ホスト PC をサーバ化する耐障害策は禁止（INV-1）。
- **起動シーケンス（検証環境）**: `npm ci` → `npm run build` → `npm run start`（クラウド WEB アプリ＋WebSocket ゆえサーバ常駐必須）。ベース URL（または `/healthz`）が `< 500` を返すまで**最大 60 秒**ポーリングしてから試験開始。`E2E_BASE_URL` でクラウド公開 URL を注入。
- **容量**: 同時接続は既定 8、設定で 16/32 まで（INV-3）。

### 2.12 テスト戦略との整合（Vitest / レイアウト / モジュール指定子）

- テストは**すべて `tests/` 配下**、ソースは**すべて `src/` 配下**に置く。`package.json`・`package-lock.json`・`tsconfig.json`・`vitest.config.ts` は harness 所有につき著さない。
- ユニットは `tests/*.test.ts`、E2E は API 統合 `tests/e2e/<domain>.spec.ts`／ブラウザ `tests/e2e/<domain>.browser.spec.ts` に分離する。ブラウザ操作は Playwright を**ライブラリ import**（`import { chromium } from "playwright";`）して駆動し、宣言・検証は Vitest（`describe/it/expect`）で行う。共有ヘルパは `tests/e2e/helpers/` に集約し `.js` 拡張子で参照する。
- Vitest 以外（`node:test` 等）をランナーに用いない。ランタイム依存最小化の方針はテストランナーに及ばない。

### Operational Behavior Model

以下の単一 YAML ブロックが、実装計画と E2E 生成が共有する運用挙動の権威的出典である。要件・設計に無い挙動は発明せず、未確定は `boundary_cases` または §3 のフラグへ回す。

```yaml
operation_flow:
  actors:
    - id: host
      label: 司会者（制御盤）
      surface: /control-panel
    - id: answerer
      label: 解答者（タブレット）
      surface: /tablet
    - id: audience
      label: 観客（TV）
      surface: /tv
    - id: system
      label: クラウドサーバ（realtime_sync）
  operations:
    - id: op_load_questions
      actor: host
      verb: load
      target: question_set
      trigger: 制御盤で事前問題ファイルの読込を実行
      route: /control-panel
      preconditions:
        - ゲーム未開始またはライブ編集フェーズ
      measurement_source: 事前問題ファイル
      durable_state: questions テーブル（text / image_path / video_path / correct_value）
      readback: ランタイム出題は questions テーブルから供給（ファイル再読込に依存しない）
      expected_outcomes:
        - 各問が questions テーブルへ登録される
        - correct_value が 0〜100 の整数で保持される
      dod_obligations:
        - id: dod_load_persist
          text: 読み込んだ全問が questions テーブルに登録され、再取得で登録時と同一の text と correct_value を返す
        - id: dod_load_runtime_from_db
          text: 出題面の解決元は questions テーブルであり、問題ファイルの再読込に依存しない
    - id: op_join_game
      actor: answerer
      verb: join
      target: game_session
      trigger: 制御盤の QR を読取り /join で氏名を自己入力して参加確定
      route: /join
      ui_pattern: qr_scan_then_name_input
      preconditions:
        - 接続数が MAX_TABLET_CONNECTIONS 未満
      durable_state: participants テーブル（name / connection_id）
      readback: 制御盤の参加者一覧と TV e モードに反映
      visible_to: [host, audience]
      expected_outcomes:
        - 自己入力した氏名で participants に 1 人 1 レコードが作られる
        - 参加が制御盤と TV(e) に反映される
      forbidden_actors: []
      dod_obligations:
        - id: dod_join_self_name
          text: 参加者が自己入力した氏名が participants に永続し、制御盤の参加者一覧に表示される
        - id: dod_join_no_seat_fixed
          text: 端末番号の固定割当や事前氏名台帳の UI/API を用いずに参加が成立する
    - id: op_enforce_connection_limit
      actor: system
      verb: reject
      target: tablet_connection
      trigger: 接続数が MAX_TABLET_CONNECTIONS に達した状態での新規接続試行
      measurement_source: 現在接続数と MAX_TABLET_CONNECTIONS 設定値
      threshold: MAX_TABLET_CONNECTIONS（既定 8）
      preconditions:
        - connected >= MAX_TABLET_CONNECTIONS
      durable_state: 既存接続は不変
      expected_outcomes:
        - 上限超過の接続は断られる
        - 既存接続は影響を受けない
      boundary_cases:
        - 既定 8: 8 台目は接続可・9 台目は拒否
        - 設定 16: 16 台目は接続可・17 台目は拒否
        - 設定 32: 32 台目は接続可・33 台目は拒否
      dod_obligations:
        - id: dod_limit_default_eight
          text: 設定未指定時に 8 台まで接続でき 9 台目が拒否される
        - id: dod_limit_config_follows
          text: MAX_TABLET_CONNECTIONS を 16/32 へ設定変更するとコード改修なしに上限がその値へ追随する
        - id: dod_limit_no_hardcode
          text: 上限判定は設定値を参照し、ソースに数値リテラル 8 のハードコードが存在しない
    - id: op_submit_answer
      actor: answerer
      verb: submit
      target: answer
      trigger: タブレットの 4 ボタン（+1/-1/+10/-10）で値を作り送信
      route: /tablet
      ui_pattern: four_button_stepper
      measurement_source: タブレット数値入力
      preconditions:
        - 当該問の game_state.stage が accepting
      durable_state: answers テーブル（value / submitted_at）
      readback: 送信済み表示と自分の残額のみ（他者情報は不可視）
      from_state: accepting
      to_state: accepting
      expected_outcomes:
        - 0〜100 の整数のみ answer_submitted として永続化される
      boundary_cases:
        - 0 は受理
        - 100 は受理
        - -1 は UI とサーバの双方で拒否
        - 101 は UI とサーバの双方で拒否
        - 50.5 は UI とサーバの双方で拒否
      dod_obligations:
        - id: dod_submit_persist
          text: 受付中に送信した 0〜100 整数の解答が answers に永続化され再表示できる
        - id: dod_submit_range_dual_guard
          text: 負値・小数・100 超・非数値は UI とサーバの双方で拒否され answers に入らない
    - id: op_lock_answers
      actor: host
      verb: lock
      target: answers
      trigger: 制御盤で「そこまで」を押下
      route: /control-panel
      forbidden_actors: [answerer]
      from_state: accepting
      to_state: answers_locked
      durable_state: game_state.stage = answers_locked
      consumer_surfaces: [answerer_tablets]
      expected_outcomes:
        - 全解答者タブレットの入力がロックされる
        - 締切後の送信は拒否される
      dod_obligations:
        - id: dod_lock_host_only
          text: 締切は role host のみ発動でき answerer からの締切コマンドは 401/403 で拒否される
        - id: dod_lock_blocks_submit
          text: 締切後に解答者が送信を試みても answers に追加されず拒否される
    - id: op_open_answers
      actor: host
      verb: open
      target: answers
      trigger: 制御盤で「解答オープン！」を押下
      route: /control-panel
      forbidden_actors: [answerer]
      from_state: answers_locked
      to_state: answers_opened
      durable_state: game_state.stage = answers_opened
      visible_to: [audience]
      consumer_surfaces: [tv_mode_b]
      expected_outcomes:
        - 開示前は他者解答が全端末で伏せられている
        - 開示後 TV(b) に氏名と解答が一斉表示される
      dod_obligations:
        - id: dod_open_hidden_before
          text: b 未実行の間はどの端末にも他者の解答が表示されない
        - id: dod_open_reveals_on_tv
          text: 開示後に TV(b) が全員の氏名と解答を表示する
    - id: op_reveal_correct
      actor: host
      verb: reveal
      target: correct_value
      trigger: 制御盤で正解発表を実行
      route: /control-panel
      forbidden_actors: [answerer]
      from_state: answers_opened
      to_state: answer_revealed
      durable_state: game_state.stage = answer_revealed
      consumer_surfaces: [tv_mode_c]
      expected_outcomes:
        - TV(c) に正解値が提示される
        - 以降の正解ライブ編集は自動再採点の対象となる
      dod_obligations:
        - id: dod_reveal_marks_disclosed
          text: 正解発表の実行で当該問が開示済み（c 以降）として game_state に記録される
    - id: op_compute_settlement
      actor: host
      verb: settle
      target: balances
      trigger: 制御盤で得点精算を実行
      route: /control-panel
      from_state: answer_revealed
      to_state: settlement_computed
      measurement_source: answers と questions.correct_value
      durable_state: balances（円・整数）
      consumer_surfaces: [tv_mode_d, tv_mode_e]
      expected_outcomes:
        - 誤差 = 絶対値(解答 - 正解) が 0〜100 整数で算出される
        - 増減円 = 誤差 × -100 で残額が更新される
        - 誤差 0 のピタリ賞は +1000 円が加算される
      boundary_cases:
        - 誤差 0 は +1000（丁度）
        - 誤差 1 は -100 のみ（直上）
      dod_obligations:
        - id: dod_settle_initial_grant
          text: ゲーム開始時に各プレイヤーの balances が 10000 円で初期化されている
        - id: dod_settle_delta
          text: 誤差 5 の精算後に当該プレイヤーの残額が精算前より 500 円少ない
        - id: dod_settle_pitari_add
          text: 誤差 0 のプレイヤーに +1000 円が反映される（拠出配分側は forbidden 未確定として fixme）
        - id: dod_settle_currency_yen
          text: d の 6 列表と API 応答が円建てで表され point/pt/点 の語が存在しない
    - id: op_live_edit_correct
      actor: host
      verb: edit
      target: question_or_correct_value
      trigger: 制御盤のライブ編集 UI で問題または正解を更新
      route: /control-panel
      durable_state: questions テーブル更新
      readback: DB 再取得で編集後の値を返す
      expected_outcomes:
        - 問題・正解の双方を進行中に編集でき DB に永続する
      dod_obligations:
        - id: dod_edit_persist
          text: 進行中に編集した問題文と正解値が questions に永続し再取得で読み戻せる
    - id: op_auto_rescore
      actor: system
      verb: rescore
      target: balances
      trigger: 開示済み（c 以降）の問題で正解をライブ編集
      preconditions:
        - 当該問の game_state.stage が answer_revealed 以降
      measurement_source: 編集後 correct_value と既存 answers
      durable_state: balances 差分更新
      consumer_surfaces: [tv_mode_d, tv_mode_e]
      from_state: answer_revealed
      to_state: answer_revealed
      expected_outcomes:
        - 正解訂正で全員の誤差・増減円・残額が自動再計算される
        - d 到達問は残額の差分再計算を伴い TV d/e が同時更新される
      boundary_cases:
        - c 到達問の正解訂正 → 再採点が走る
        - c 未到達の正解編集 → 再採点は走らない（境界外）
      dod_obligations:
        - id: dod_rescore_after_c
          text: c 実行後に正解を直すと自動再採点され各人の残額へ即時反映される
        - id: dod_rescore_no_before_c
          text: c 未到達の正解編集では再採点が起きない
        - id: dod_rescore_d_sync
          text: d 到達問の正解訂正で残額差分が再計算され TV の d と e が同時更新される
    - id: op_undo_trigger
      actor: host
      verb: undo
      target: last_trigger
      trigger: 制御盤で取消を実行
      route: /control-panel
      forbidden_actors: [answerer]
      durable_state: trigger_undone イベント
      expected_outcomes:
        - 直近の対象操作が取り消される
      boundary_cases:
        - 取消の具体挙動（直近のみか任意問題再開示か）は未確定（F-03・fixme）
      dod_obligations:
        - id: dod_undo_host_only
          text: 取消は role host のみ発動でき answerer からの取消コマンドは 401/403 で拒否される
    - id: op_switch_tv_mode
      actor: host
      verb: switch
      target: tv_mode
      trigger: 制御盤の「次へ」「戻る」または各モード個別ジャンプ
      route: /control-panel
      ui_pattern: next_back_jump
      durable_state: game_state.tv_mode
      consumer_surfaces: [tv_mode_a, tv_mode_b, tv_mode_c, tv_mode_d, tv_mode_e]
      expected_outcomes:
        - 3 系統の操作で TV の表示モードが対応して切り替わる
        - a モードは動画→画像→テキストの 3 段で出題面を解決する
      boundary_cases:
        - 動画パス有 → 動画
        - 動画無・画像有 → 画像
        - 双方無 → テキスト
      dod_obligations:
        - id: dod_tv_three_switch_systems
          text: 次へ・戻る・個別ジャンプの 3 系統いずれでも TV の表示モードが対応値へ切り替わる
        - id: dod_tv_a_fallback
          text: a モードが動画・画像・テキストの優先順で出題面を解決する
    - id: op_determine_winner
      actor: system
      verb: determine
      target: winner
      trigger: 10 問目の得点精算が完了
      preconditions:
        - 10 問すべてが settlement_computed
      measurement_source: 全問通算の balances
      consumer_surfaces: [tv_mode_e]
      from_state: settlement_computed
      to_state: game_finished
      expected_outcomes:
        - 残額最多のプレイヤーが e モードで勝者として判別可能に表示される
      dod_obligations:
        - id: dod_winner_most_balance
          text: 10 問終了時に残額最多のプレイヤーが e モードで勝者として判別できる
```

---

## 3. Open Questions

壁打ち（要件定義）フェーズはクローズ済で殿判断待ちの論点は残っていない。以下は実装組み立てフェーズで MAS が決める技術選定、推測実装せず殿判断を仰ぐ点、および検証ゲートで暫定運用中のフラグである。いずれも「推奨なし」「要検討」「TBD」の空白は残さず、確定した制約・既定機構・暫定ゲート値を明記する。

### 3.1 技術選定（MAS 決定・殿判断不要）

| 項目 | 決定/既定 | 制約・選定軸 |
|---|---|---|
| ホスティング / インフラ | クラウド常時稼働＋クラウド WebSocket 対応の構成を採る | **当日インターネット接続前提**で稼働。ホスト PC をサーバにしない（INV-1）。回線断は運用側でバックアップ回線/テザリング確保、コードは当日接続前提。 |
| DB 永続化技術 | `questions`/`answers`/`participants`/`balances`/`game_state` を保持する DB を選定 | クラウド実行と整合。ファイル読込→`questions` 登録、ライブ編集（DB 更新）、`game_state.stage` 保持を満たす（INV-2・E-3 残）。 |
| 実装言語 | **TypeScript / Node に確定** | テストランナーは Vitest 固定、モジュール解決は NodeNext/Node16（§1.3）。 |
| 家族限定アクセス制御 | **設計分岐 A（URL 秘匿）／B（認証）を保持**（§2.10・INV-4） | 無制御公開はリリース不可。方式決定まで **接続上限（既定 8）** と **トリガー権限の司会者限定** をブラスト半径抑制策とし、いずれの分岐でも `src/config/`・`role: host` の単一解決点を経由。 |
| 上限設定の持ち方 | 環境変数 `MAX_TABLET_CONNECTIONS` を既定機構とする | 環境変数／設定ファイル／DB 設定テーブルのいずれでも可だが `src/config/` が唯一の解決点。ハードコード禁止（INV-3）。 |

### 3.2 F028 エスカレーション（推測実装しない）

- **取消操作の具体挙動（論点 7・F-03）**: 直近操作のみ戻せるか／任意問題を再開示できるか等に曖昧が残る場合は、選択肢を添えて F028 で殿判断を仰ぐ。**発動権限＝制御盤（host）のみ**は確定ゆえ実装・検証し、挙動詳細は E2E で `test.fixme()`。
- **ピタリ賞の拠出配分（B・F-02）**: 「他プレイヤーから +1,000 円獲得」の**加算側 +1,000 は確定・検証必須**。拠出元と配分（総額 1,000 か各人からか、複数同時ピタリ時の扱い）が未確定な場合は F028 で選択肢提示。確定値（1,000 円・円建て・現金感を薄めない）は変更しない。

### 3.3 検証ゲートで暫定運用中のフラグ（設計義務の欠落・発明せず flag）

- **F-01（残額の下限・脱落）**: 確定要件は「誤差 × −100 円」「先渡し 10,000 円」のみで、残額の 0 下限・全額喪失での脱落は確定要件に無い。E2E は下限を仮定せず検証し、下限/脱落を導入する実装が現れた場合にフラグする。
- **F-04（同期レイテンシ SLA）**: 設計に固定 SLA が無いため、§2.4/§2.11 の **p95 ≤ 2,000ms** は暫定テストゲートとして設定し、SLA 確定時に更新する。
- **F-05（家族限定アクセス制御）**: §3.1 の分岐 A/B 未決につき、認証が実装されていればログイン→リダイレクト→描画フローを検証し、未実装なら該当ブラウザテストを `test.fixme()`。無制御公開のまま出荷はリリース不可（INV-4）。
