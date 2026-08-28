---
codd:
  node_id: design:data-model-design
  type: design
  depends_on:
  - id: design:system-design
    relation: depends_on
    semantic: technical
  depended_by:
  - id: detailed_design:shared-domain-model
    relation: depends_on
    semantic: technical
  - id: detailed_design:er-crud-model
    relation: depends_on
    semantic: technical
  - id: test:test-strategy
    relation: depends_on
    semantic: verification
  conventions:
  - targets:
    - db:questions
    - module:questions
    reason: 問題データは動画パス・画像パス（任意）・テキスト・正解値を保持し、ファイル読込で DB 登録・ゲーム中もライブ編集で DB 更新（E-2/E-3/N-2）。違反時リリース不可。
  - targets:
    - db:rounds
    - module:game_flow
    reason: 各問がどのモードまで進んだか（b/c/d）を保持し、再採点判定を可能にする進行状態を持つこと（E-3残）。違反時リリース不可。
  - targets:
    - module:scoring
    reason: 回答・誤差・増減円・残額はすべて 0〜100 整数前提の整数円で保持し、小数・ポイント表現を持たない（論点G・B）。違反時リリース不可。
  - targets:
    - db:config
    - module:config
    reason: 接続上限等の可変パラメータはハードコードせず設定として保持できる構造にする（論点10）。違反時リリース不可。
  modules:
  - questions
  - media
  - scoring
  - game_flow
  - participants
  - config
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
      - image_path / video_path は任意（NULL 許容）で保持される
      dod_obligations:
      - id: dod_load_persist
        text: 読み込んだ全問が questions に登録され、再取得で登録時と同一の text と correct_value を返す
      - id: dod_load_runtime_from_db
        text: 出題面の解決元は questions テーブルであり、問題ファイルの再読込に依存しない
      - id: dod_load_media_paths_optional
        text: image_path と video_path は未指定でも登録でき NULL として保持される
      - id: dod_load_correct_value_integer
        text: correct_value が 0〜100 の整数以外では登録が拒否される（DB CHECK を含む）
    - id: op_join_game
      actor: contestant
      verb: join
      target: game_session
      trigger: 制御盤の QR を読取り /join で氏名を自己入力して参加確定
      route: /join
      ui_pattern: qr_scan_then_name_input
      preconditions:
      - 接続数が MAX_TABLET_CONNECTIONS 未満
      durable_state: participants テーブル（name / connection_id）＋ balances 行の初期化
      readback: 制御盤の参加者一覧と TV e モードに反映
      visible_to:
      - host
      - audience
      expected_outcomes:
      - 自己入力した氏名で participants に 1 人 1 レコードが作られる
      - 当該参加者の balances が 10000 円で初期化される
      forbidden_actors: []
      dod_obligations:
      - id: dod_join_self_name
        text: 参加者が自己入力した氏名が participants に永続し、制御盤の参加者一覧に表示される
      - id: dod_join_no_seat_fixed
        text: 端末番号の固定割当や事前氏名台帳の列/API を用いずに参加が成立する
      - id: dod_join_one_device
        text: connection_id は一意で 1 人 1 台が担保される
    - id: op_submit_answer
      actor: contestant
      verb: submit
      target: answer
      trigger: タブレットの 4 ボタン（+1/-1/+10/-10）で値を作り送信
      route: /tablet
      ui_pattern: four_button_stepper
      measurement_source: タブレット数値入力
      preconditions:
      - 当該問の rounds.stage が accepting
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
      - id: dod_submit_one_row_per_player
        text: 同一問への再送信は unique(question_id, participant_id) により 1 行を更新する
    - id: op_lock_answers
      actor: host
      verb: lock
      target: answers
      trigger: 制御盤で「そこまで」を押下
      route: /control-panel
      forbidden_actors:
      - contestant
      from_state: accepting
      to_state: answers_locked
      durable_state: rounds.stage = answers_locked
      consumer_surfaces:
      - contestant_tablets
      expected_outcomes:
      - 全解答者タブレットの入力がロックされる
      - 締切後の answers への書込みは拒否される
      dod_obligations:
      - id: dod_lock_host_only
        text: 締切は role host のみ発動でき contestant からの締切コマンドは 401/403 で拒否される
      - id: dod_lock_blocks_submit
        text: rounds.stage が answers_locked 以降のとき answers への挿入/更新が拒否される
    - id: op_open_answers
      actor: host
      verb: open
      target: answers
      trigger: 制御盤で「解答オープン！」を押下
      route: /control-panel
      forbidden_actors:
      - contestant
      from_state: answers_locked
      to_state: answers_opened
      durable_state: rounds.stage = answers_opened
      visible_to:
      - audience
      consumer_surfaces:
      - tv_mode_b
      expected_outcomes:
      - 開示前は他者解答が全端末向け読みモデルに含まれない
      - 開示後 TV(b) に氏名（participants.name）と解答（answers.value）が一斉表示される
      dod_obligations:
      - id: dod_open_hidden_before
        text: rounds.stage が answers_opened 未満の間はどの端末向け読みモデルにも他者の解答が含まれない
      - id: dod_open_reveals_on_tv
        text: 開示後に TV(b) が全員の氏名と解答を表示する
    - id: op_reveal_correct
      actor: host
      verb: reveal
      target: correct_value
      trigger: 制御盤で正解発表を実行
      route: /control-panel
      forbidden_actors:
      - contestant
      from_state: answers_opened
      to_state: answer_revealed
      durable_state: rounds.stage = answer_revealed
      consumer_surfaces:
      - tv_mode_c
      expected_outcomes:
      - TV(c) に questions.correct_value が提示される
      - 以降の正解ライブ編集は自動再採点の対象となる
      dod_obligations:
      - id: dod_reveal_marks_disclosed
        text: 正解発表の実行で当該問の rounds.stage が answer_revealed（開示済み c 以降）として記録される
    - id: op_compute_settlement
      actor: host
      verb: settle
      target: balances
      trigger: 制御盤で得点精算を実行
      route: /control-panel
      from_state: answer_revealed
      to_state: settlement_computed
      measurement_source: answers.value と questions.correct_value
      durable_state: settlements（error / delta_yen / pitari_bonus_yen）＋ balances（円・整数）＋
        rounds.stage = settlement_computed
      consumer_surfaces:
      - tv_mode_d
      - tv_mode_e
      expected_outcomes:
      - 誤差 = 絶対値(answer - correct) が 0〜100 整数で settlements に記録される
      - 増減円 = 誤差 × -100（整数円）で delta_yen が記録され balances が更新される
      - 誤差 0 のピタリ賞 +1000 円が pitari_bonus_yen に記録され balances へ加算される
      boundary_cases:
      - 誤差 0 は +1000（丁度）
      - 誤差 1 は -100 のみ（直上）
      dod_obligations:
      - id: dod_settle_initial_grant
        text: ゲーム開始時に各プレイヤーの balances.amount が 10000 円で初期化されている
      - id: dod_settle_delta
        text: 誤差 5 の精算後に当該プレイヤーの balances.amount が精算前より 500 円少ない
      - id: dod_settle_pitari_add
        text: 誤差 0 のプレイヤーの pitari_bonus_yen が +1000 で balances に反映される（拠出配分側は F-02
          未確定として fixme）
      - id: dod_settle_currency_yen
        text: settlements と balances と API 応答と d の 6 列表が円建てで表され point/pt/点 の語が存在しない
      - id: dod_settle_integer_only
        text: error / delta_yen / pitari_bonus_yen / amount がすべて整数で小数値を持たない
    - id: op_live_edit_correct
      actor: host
      verb: edit
      target: question_or_correct_value
      trigger: 制御盤のライブ編集 UI で問題または正解を更新
      route: /control-panel
      durable_state: questions テーブル更新（text / image_path / video_path / correct_value）
      readback: DB 再取得で編集後の値を返す
      expected_outcomes:
      - 問題・正解の双方を進行中に編集でき questions に永続する
      dod_obligations:
      - id: dod_edit_persist
        text: 進行中に編集した問題文と正解値が questions に永続し再取得で読み戻せる
    - id: op_auto_rescore
      actor: system
      verb: rescore
      target: balances
      trigger: 開示済み（rounds.stage が answer_revealed 以降）の問題で正解をライブ編集
      preconditions:
      - 当該問の rounds.stage が answer_revealed 以降
      measurement_source: 編集後 questions.correct_value と既存 answers.value
      durable_state: settlements 再計算 ＋ balances 差分更新
      consumer_surfaces:
      - tv_mode_d
      - tv_mode_e
      from_state: answer_revealed
      to_state: answer_revealed
      expected_outcomes:
      - 正解訂正で当該問の全 settlements（誤差・delta_yen・pitari）が再計算される
      - balances が旧拠出との差分で更新される
      - rounds.stage が settlement_computed の問は TV d/e が同時更新される
      boundary_cases:
      - c 到達問の正解訂正 → 再採点が走る
      - c 未到達（isDisclosed 偽）の正解編集 → 再採点は走らない（境界外）
      dod_obligations:
      - id: dod_rescore_after_c
        text: rounds.stage が answer_revealed 以降で正解を直すと settlements と balances が再計算され各人の残額へ即時反映される
      - id: dod_rescore_no_before_c
        text: rounds.stage が answer_revealed 未満の正解編集では settlements と balances が変化しない
      - id: dod_rescore_d_sync
        text: rounds.stage が settlement_computed の問の正解訂正で balances 差分が再計算され TV の d
          と e が同時更新される
      - id: dod_rescore_matches_full_recompute
        text: 差分更新後の balances が answers と correct_value からの全再計算と一致する
    - id: op_enforce_connection_limit
      actor: system
      verb: reject
      target: tablet_connection
      trigger: 接続数が MAX_TABLET_CONNECTIONS に達した状態での新規接続試行
      measurement_source: 現在接続数と config の MAX_TABLET_CONNECTIONS 解決値
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
        text: 上限判定は config の解決値を参照し、判定経路に数値リテラル 8 が存在しない
    - id: op_determine_winner
      actor: system
      verb: determine
      target: winner
      trigger: 10 問目の得点精算が完了
      preconditions:
      - 10 問すべての rounds.stage が settlement_computed
      measurement_source: 全問通算の balances.amount
      consumer_surfaces:
      - tv_mode_e
      from_state: settlement_computed
      to_state: game_finished
      durable_state: game_state.phase = finished
      expected_outcomes:
      - balances.amount 最多のプレイヤーが e モードで勝者として判別可能に表示される
      dod_obligations:
      - id: dod_winner_most_balance
        text: 10 問終了時に balances.amount 最多のプレイヤーが e モードで勝者として判別できる
---

# データモデル設計（問題・プレイヤー・回答・進行・精算）

## 1. Overview

本書は `save-money-switcher`（フジテレビ『賞金先渡しクイズ SAVE MONEY』方式を家族で遊ぶクイズ操作盤）の**データモデル設計**であり、`design:system-design`（クラウド WEB アプリ・アーキテクチャ）を上位の技術的真実源として、**問題・プレイヤー（参加者）・回答・進行・精算**の永続構造と派生読みモデル、そのアクセス・整合・再採点連鎖を確定する。上位設計 §2.3 が定めた 5 テーブル（`questions`/`answers`/`participants`/`balances`/`game_state`）を本書が正規化・精密化し、進行状態を独立した `rounds`（問＝ラウンドごとの到達段階）へ、設定を `config` へ外出しして、リリースブロッキング規約 4 件を具体化する。ここに記す 🟦 確定値・不変条件に反する成果物は**リリース不可（release-blocking）**として扱う。

### 1.1 本書がカバーするデータ領域

- **問題（`questions`）**: 事前ファイル読込で DB 登録し、ランタイムは DB から供給。テキスト・画像パス（任意）・動画パス（任意）・正解値（0〜100 整数）を保持し、進行中もライブ編集で DB 更新する（規約 1・E-1/E-2/E-3/N-2）。
- **プレイヤー（`participants`）**: QR 参加・氏名自己入力・1 人 1 台の接続を保持。恒久台帳を持たない当日その場参加。
- **回答（`answers`）**: 受付中に送信された 0〜100 整数の解答を `answer_submitted` として永続。UI とサーバの二重防衛に加え DB CHECK を三層目とする（規約 3）。
- **進行（`rounds` ＋ `game_state`）**: 各問がどのモード段階（b/c/d）まで進んだかを `rounds.stage` に保持し、再採点範囲判定を可能にする（規約 2・E-3 残）。セッション横断のポインタ（現在問題番号・TV モード・フェーズ）は `game_state` に分離。
- **精算（`settlements` ＋ `balances`）**: 回答・誤差・増減円・残額をすべて**整数円**で保持し、小数・ポイント/点表現を持たない。`settlements` を問ごとの拠出台帳、`balances` を集計読みモデルとし、正解訂正時の**差分再採点**を成立させる（規約 3・論点 G/B）。
- **設定（`config`）**: 接続上限 `MAX_TABLET_CONNECTIONS` 等の可変パラメータをハードコードせず設定として保持できる構造にする（規約 4・論点 10）。

### 1.2 リリースブロッキング規約と本書での具体化

| # | 対象 | 不変条件（要旨） | 本書での具体化箇所 |
|---|---|---|---|
| DM-1 | `db:questions` / `module:questions` | 問題は動画パス・画像パス（任意）・テキスト・正解値を保持。ファイル読込で DB 登録、ゲーム中もライブ編集で DB 更新（E-2/E-3/N-2） | §2.2・§2.9・§2.10 |
| DM-2 | `db:rounds` / `module:game_flow` | 各問がどのモードまで進んだか（b/c/d）を保持し、再採点判定を可能にする進行状態を持つ（E-3 残） | §2.5・§2.9 |
| DM-3 | `module:scoring` | 回答・誤差・増減円・残額はすべて 0〜100 整数前提の整数円で保持し、小数・ポイント表現を持たない（論点 G・B） | §2.4・§2.6・§2.7 |
| DM-4 | `db:config` / `module:config` | 接続上限等の可変パラメータはハードコードせず設定として保持できる構造にする（論点 10） | §2.8 |

上位設計から継承する不変条件も本データモデルで担保する: **円建て固定**（`point`/`pt`/`点` 禁止・§2.7）、**0〜100 整数の二重防衛**（UI＋サーバ、本書は DB CHECK を三層目に追加・§2.4）、**ロール境界**（`role: host` のみが進行段階を遷移させる書込みを起こす・§2.11）、**ホスト PC をサーバにしない**（永続化はクラウド DB・§2.10）。

### 1.3 実装・ツールチェーン前提（scaffold 固定・釈義不可）

- **実装言語 = TypeScript のみ。** 本書のドメイン型・リポジトリ・マイグレーション・ファイルパス・依存参照はすべて TypeScript 慣行のみを用いる。他言語の拡張子・マニフェスト・ツールは例示・フォールバックとしても登場させない。
- **テストランナー = Vitest（固定・release-blocking のグラウンドトゥルース）。** データモデルの受け入れは Vitest 自身の宣言 API（`import { describe, it, expect } from "vitest";`）で記述する。「ランタイム依存を最小化する」方針は**出荷コードのランタイム依存**にのみ及び、テストランナーには及ばない。依存数の哲学を根拠に別フレームワークや Node 組み込み `node:test` を用いてはならない。
- **モジュール解決 = NodeNext/Node16。** すべての相対 import は**出力される `.js` ファイル名を明示した拡張子**を伴う（`import type { AnswerScore } from "../scoring/answer_score.js";`。`"./x"`・`"./x.ts"` は不可）。type-only import・re-export も同一規約。拡張子欠落は TS2835 でコンパイル不能。
- **レイアウト契約（output-path fence 強制）。** ドメイン型・リポジトリ・スキーマ定義は**必ず `src/` 配下**、テストは**必ず `tests/` 配下**（`test/`・`spec/`・`specs/` を発明しない。サブディレクトリ `tests/scoring/` 等は可）。`package.json`・`package-lock.json`・`tsconfig.json`・`vitest.config.ts` は harness scaffold 所有につき、本書はこれらを成果物として出力・宣言しない。

### 1.4 データ表現に対するアクター向けコピー義務

データが供給するサーフェスとロール（内部識別子 → 可視ラベル）: `role: host` → **司会者**、`role: contestant` → **解答者**、観客（TV 視聴者）。可視コピーには**可視ラベル**を用い、内部識別子（host/contestant）・実装根拠・環境前提を露出させない。

- **氏名（`participants.name`）**: 解答者が自己入力した氏名をそのまま提示する。「端末 1」「席番号」等の内部割当ラベルへ置換しない（座席固定を持たない・§2.3）。
- **金額（`balances.amount` / `settlements.delta_yen` / `settlements.pitari_bonus_yen`）**: 内部表現・API 応答・TV 表示のいずれでも**「円」**で表す。`point`/`pt`/`点` を格納・派生・表示のどこにも出さない（§2.7 で型レベルに固定）。
- **他者情報の非露出**: `/tablet` へ供給するのは当該解答者自身の `answers` と `balances` のみ。他者の `answers`/`balances`/`settlements` をタブレット向け読みモデルに含めない（§2.11）。

---

## 2. Architecture

### 2.1 エンティティ関係の全体像

永続エンティティは **8 テーブル**（`questions`・`participants`・`answers`・`rounds`・`game_state`・`settlements`・`balances`・`config`）。DB テーブル/カラムは snake_case、TypeScript ドメイン型のフィールドは camelCase とし、その対応を各節で明示する。

```
config(key/value) ── 単一解決点 src/config/ ── MAX_TABLET_CONNECTIONS 等

questions 1 ─────< answers >───── 1 participants
    │  1                              │ 1
    │                                 │
    │ 1                               │ 1
  rounds(問=ラウンド進行 b/c/d)    balances(集計読みモデル: 10000 + Σ settlements)
    │                                 ▲ 差分更新
    └── correct_value ──▶ settlements(問×人の拠出台帳: error/delta_yen/pitari) ──┘
                                      │
game_state(セッションポインタ: current_question_number / tv_mode / phase)
```

- `questions (1) ─< answers`：1 問に対し参加者ごとに 1 解答（`unique(question_id, participant_id)`）。
- `participants (1) ─< answers`：1 参加者は各問に高々 1 解答。
- `questions (1) ── (1) rounds`：`rounds` は問ごとの到達段階を 1 行で保持（`rounds.question_id` は `questions.id` への FK かつ PK）。
- `participants (1) ── (1) balances`：残額集計を 1 行で保持。
- `questions × participants ── settlements`：問ごと・人ごとの精算拠出行（`unique(question_id, participant_id)`）。
- `game_state`：ゲーム全体で 1 行のセッションポインタ（現在問題番号・TV モード・フェーズ）。

**上位設計との整合（正規化の明示）**: `design:system-design` §2.3 は各問の到達段階を `game_state.stage` として概念記述したが、本データモデルはそれを `db:rounds`（問＝ラウンドごとに 1 行の進行状態）へ正規化して規約 DM-2 を満たし、再採点範囲を問単位で問い合わせ可能にする。`game_state` はセッション横断のポインタ（`current_question_number` / `tv_mode` / `phase`）を保持する役割へ限定する。両者は矛盾せず、`rounds.stage`（問単位）＋`game_state`（セッション単位）で上位設計の進行状態機を完全に表現する。

### 2.2 `questions` テーブル（規約 DM-1）

| カラム（snake_case） | 型 | 制約・責務 |
|---|---|---|
| `id` | text (PK) | 問の安定識別子 |
| `question_number` | integer | 1〜10、`unique` |
| `text` | text | 問題文 |
| `image_path` | text NULL | 任意。所定フォルダ配下の相対パス |
| `video_path` | text NULL | 任意。問題ファイル記載・所定フォルダへ事前配置 |
| `correct_value` | integer | **0〜100 整数**（`CHECK 0<=correct_value<=100`） |

- **DM-1 準拠**: 事前問題ファイルの各問を `questions` へ一括登録（`bulkInsert`）し、ランタイム出題はファイル再読込ではなく `questions` から供給（`getByNumber` / `listAll`）。ライブ編集は `updateContent` による DB 更新として永続し、再取得で読み戻せる（§2.9・op_live_edit_correct）。
- **出題面フォールバック（a モード）**: `video_path` 有→動画 / `video_path` 無・`image_path` 有→画像 / 双方 NULL→`text`。この 3 段解決は `questions` の 3 カラムのみで決まり、外部状態に依存しない。

```typescript
// src/questions/question.ts
import type { AnswerScore } from "../scoring/answer_score.js";

export interface Question {
  id: string;
  questionNumber: number;      // 1..10
  text: string;
  imagePath: string | null;    // 任意
  videoPath: string | null;    // 任意
  correctValue: AnswerScore;   // 0..100 整数
}
```

```typescript
// src/questions/questions_repository.ts
import type { Question } from "./question.js";

export type QuestionContentPatch = Partial<
  Pick<Question, "text" | "imagePath" | "videoPath" | "correctValue">
>;

export interface QuestionsRepository {
  bulkInsert(questions: readonly Question[]): Promise<void>;
  getByNumber(questionNumber: number): Promise<Question | null>;
  listAll(): Promise<readonly Question[]>;
  updateContent(id: string, patch: QuestionContentPatch): Promise<Question>;
}
```

### 2.3 ~~`participants` テーブル~~（**2026-08-28 殿裁可 案A により改定**・§2.3a を参照）

> **改定**: 身元の権威は `accounts`（恒久アカウント・§2.3a）へ移り、`participants`（当日その場参加）は
> 用いない。エピソードごとの参加者は P2 で `episode_participants` として表し、既存 QC 済みドメイン
> （scoring / game_state / realtime_sync / render_*）が鍵とする `participantId` には
> `episode_participants.id` を渡す（ドメイン側は無改変）。以下は履歴として残す。


| カラム | 型 | 制約・責務 |
|---|---|---|
| `id` | text (PK) | 参加者識別子 |
| `name` | text | **自己入力**の氏名（空文字禁止） |
| `joined_at` | text | ISO-8601 |
| `connection_id` | text | **1 人 = 1 台**（`unique`） |

- 端末番号の固定割当・事前氏名/座席台帳の列を持たない（AC-07）。参加登録は `connection_id` の一意性で 1 人 1 台を担保する。参加確定時に `balances` 行を初期額で生成する（§2.6）。

```typescript
// src/participants/participant.ts
export interface Participant {
  id: string;
  name: string;         // 自己入力
  joinedAt: string;     // ISO-8601
  connectionId: string; // 1 人 = 1 台
}
```

### 2.3a `accounts` テーブル（**2026-08-28 殿裁可 案A・P1 実装済**）

| カラム | 型 | 制約・責務 |
|---|---|---|
| `id` | text (PK) | 内部識別子（画面へ表示しない） |
| `login_id` | text | ログイン ID（`unique`・空白を含まない 64 文字以内） |
| `password_hash` | text | scrypt 導出鍵（16 進 128 文字）。**平文は保存しない** |
| `password_salt` | text | scrypt ソルト（16 進） |
| `role` | text | `admin` \| `contestant` |
| `display_name` | text | 画面表示名（既存 `isValidDisplayName` / 上限 20 を再利用） |
| `created_at` | text | ISO-8601 |
| `updated_at` | text | ISO-8601 |

- パスワードは **`node:crypto` の scrypt** のみで扱う（外部依存を増やさない）。平文は保存・記録・表示の
  いずれもしない（AC-A8）。
- 一意性（`login_id`）は永続境界 `AccountStore.insertIfLoginIdAbsent` の原子的 insert-if-absent が担保する。
- 認可ロールへの写像は `toSessionRole`（`admin → host` / `contestant → contestant`）が唯一の変換点である。

```typescript
// src/accounts/account.ts
export interface Account {
  readonly id: string;
  readonly loginId: string;
  readonly passwordHash: string;   // scrypt（平文は持たない）
  readonly passwordSalt: string;
  readonly role: "admin" | "contestant";
  readonly displayName: string;
  readonly createdAt: string;      // ISO-8601
  readonly updatedAt: string;      // ISO-8601
}
```

### 2.3b エピソード系テーブル（**案A・P2 実装済**）

案A の 4 表は P2（cmd_2553）で実装済みである（`src/episodes/`）。永続は §2.3c のとおり
`DATA_DIR/episodes.json`（JSON ＋ アトミック書込）で、境界は `episodes/episode_store.ts`
（`EpisodeStore`）が持つ。業務規則（受理境界・招待の有無・参加の冪等・問の上書き編集）は
`episodes/episode_service.ts` が単一の置き場である。

| テーブル | 主なカラム | 役割 |
|---|---|---|
| `episodes` | `id` / `title` / `status`(`draft`\|`live`\|`finished`) / `created_by` / 時刻 | 1 回の収録・開催 |
| `episode_invitations` | `episode_id` / `account_id` / `invited_at`（PK は 2 列） | 回への参加権（招待） |
| `episode_participants` | `id` / `episode_id` / `account_id` / `joined_at`（`unique(episode_id, account_id)`） | 実際に参加した解答者。**`id` を既存ドメインの `participantId` として渡す** |
| `episode_questions` | `id` / `episode_id` / `question_number` / `text` / `correct_value` / `image_path` / `video_path` | 回ごとの問題・正解 |

- **既存ドメインとの接続（実装済の規約）**: `episode_participants.id` をそのまま
  `participantId` として既存 QC 済みドメイン（scoring / game_state / realtime_sync / render_*）へ渡す。
  写像点は `server/episode_session.ts` の 1 箇所であり、ドメイン側は無改変である。
- 出題は `episode_questions` を `questions/question.ts` の `Question` へ写して進行セッションへ載せる
  （写像点は `episodes/episode.ts` の `toQuestion` 一点）。回に問が 1 問も無ければ出題を始められない。
- 一意性: 招待は (`episode_id`, `account_id`)、参加は同じ組（冪等・二度参加しても識別子は増えない）、
  問は (`episode_id`, `question_number`)（同じ番号への再登録は行 `id` を保った上書き編集）。

### 2.3c 永続方式（**案A・設計 D7**）

- 実行環境は Node **v20.20.0** ゆえ `node:sqlite`（Node 22+）は使えない。家族規模（アカウント数〜十数）
  では **JSON ファイル ＋ アトミック書込**（一時ファイルへ書いて rename）で足りるため、初手は
  zero-dependency の JSON 永続とする（`src/persistence/json_file.ts` / `src/accounts/json_account_store.ts`）。
- 置き場は `DATA_DIR`（既定 `./data`）が単一の解決点である（`src/config/data_dir.ts`）。
- 境界（`AccountStore` / `EpisodeStore`）と実装を分けてあるため、規模が増えたら Store 実装の
  差し替えだけで SQLite 等へ移せる。その際は本節の表定義を `src/persistence/schema.ts`（DDL の
  単一定義点）へ追加する（JSON 永続の現時点では DDL を先取りしない）。

### 2.4 `answers` テーブル（規約 DM-3・0〜100 整数）

| カラム | 型 | 制約・責務 |
|---|---|---|
| `id` | text (PK) | 解答識別子 |
| `question_id` | text (FK→questions.id) | |
| `participant_id` | text (FK→participants.id) | |
| `value` | integer | **0〜100 整数**（`CHECK 0<=value<=100`） |
| `submitted_at` | text | ISO-8601、`answer_submitted` の永続 |

- 一意制約 `unique(question_id, participant_id)`：受付中の再送信は同一行の upsert（最新値で更新）。
- **二重防衛＋三層目**: UI（`src/tablet/`）とサーバ（`src/scoring/validate_answer.ts`）の**双方**で 0〜100 整数を強制（上位設計 INV-6・release-blocking）。本データモデルはさらに DB の `CHECK` 制約を**三層目の防衛**として置き、UI・サーバいずれをも迂回した不正値の永続を拒む。境界は 0=可 / 100=可 / −1=不可 / 101=不可 / 50.5=不可。
- **受付中のみ書込み可**: 当該問の `rounds.stage = accepting` のときのみ挿入/更新を許可し、締切後（`answers_locked` 以降）の書込みはサーバで拒否する（§2.5・終端状態ガード）。

```typescript
// src/game_state/answer.ts
import type { AnswerScore } from "../scoring/answer_score.js";

export interface Answer {
  id: string;
  questionId: string;
  participantId: string;
  value: AnswerScore;   // 0..100 整数
  submittedAt: string;  // ISO-8601
}
```

### 2.5 `rounds` ＋ `game_state`（進行状態・規約 DM-2）

**`rounds`（問＝ラウンドごとの到達段階）**

| カラム | 型 | 制約・責務 |
|---|---|---|
| `question_id` | text (PK, FK→questions.id) | 問＝ラウンド 1 行 |
| `question_number` | integer | 1〜10 |
| `stage` | text (enum) | `accepting`/`answers_locked`/`answers_opened`/`answer_revealed`/`settlement_computed` |

- `stage` は上位設計の進行段階を保持し、**モード対応**は `answers_opened`＝b / `answer_revealed`＝c / `settlement_computed`＝d。
- **再採点範囲判定の唯一の前提（DM-2）**: 「開示済み（c 以降）」は `stage ∈ {answer_revealed, settlement_computed}` で判定し、`isDisclosed(stage)` が真の問のみ正解ライブ編集が自動再採点対象になる（§2.9）。「d 到達」は `stage = settlement_computed`（`isSettled`）で判定し、差分再採点＋TV d/e 同時更新の対象を確定する。この段階保持なしに再採点範囲は決められない。

**`game_state`（セッションポインタ・1 行）**

| カラム | 型 | 制約・責務 |
|---|---|---|
| `id` | text (PK) | 固定シングルトンキー |
| `current_question_number` | integer | 現在問題番号 |
| `tv_mode` | text (enum) | `a`/`b`/`c`/`d`/`e`（MC 切替の対象） |
| `phase` | text (enum) | `lobby`/`in_progress`/`finished` |

```typescript
// src/game_state/progression.ts
export type Stage =
  | "accepting"
  | "answers_locked"
  | "answers_opened"       // b
  | "answer_revealed"      // c
  | "settlement_computed"; // d

export interface Round {
  questionId: string;
  questionNumber: number;
  stage: Stage;
}

const DISCLOSED: readonly Stage[] = ["answer_revealed", "settlement_computed"];

export function isDisclosed(stage: Stage): boolean {
  return DISCLOSED.includes(stage);
}
export function isSettled(stage: Stage): boolean {
  return stage === "settlement_computed";
}
```

```typescript
// src/game_state/game_state.ts
export type TvMode = "a" | "b" | "c" | "d" | "e";

export interface GameState {
  currentQuestionNumber: number;
  tvMode: TvMode;
  phase: "lobby" | "in_progress" | "finished";
}
```

- **権限境界**: `stage` を前進させる書込み（`answers_locked`/`answers_opened`/`answer_revealed`/`settlement_computed`）と `game_state.tv_mode` の切替は `role: host` セッションのみ（§2.11）。`role: contestant` からの当該コマンドはサーバで 401/403 拒否。

### 2.6 `settlements` ＋ `balances`（精算・規約 DM-3・整数円）

**`settlements`（問×人の拠出台帳）**

| カラム | 型 | 制約・責務 |
|---|---|---|
| `question_id` | text (FK→questions.id) | `unique(question_id, participant_id)` |
| `participant_id` | text (FK→participants.id) | |
| `answer_value` | integer | 0〜100 整数（精算時点の解答スナップショット） |
| `error` | integer | **誤差 = |answer − correct|**、0〜100 整数（`CHECK 0<=error<=100`） |
| `delta_yen` | integer | **増減円 = error × −100**（整数円・0 以下） |
| `pitari_awarded` | boolean | 誤差 0 のとき真 |
| `pitari_bonus_yen` | integer | ピタリ賞加算（0 または **+1000**、整数円） |

**`balances`（集計読みモデル）**

| カラム | 型 | 制約・責務 |
|---|---|---|
| `participant_id` | text (PK, FK→participants.id) | |
| `amount` | integer | **整数円**。`= 10000 + Σ(delta_yen) + Σ(pitari_bonus_yen − 拠出)` |

- **確定値（改変禁止・🟦）**: 先渡し **10,000 円** ／ 増減円 = 誤差 × **−100 円** ／ ピタリ賞（誤差 0）**+1,000 円** ／ 10 問終了時**残額最多勝ち**。誤差 0 は +1000（丁度）、誤差 1 は −100 のみ（直上）。
- **整数円のみ（DM-3・release-blocking）**: `answer_value`・`error`・`delta_yen`・`pitari_bonus_yen`・`amount` はすべて `integer`。小数・ポイント/点を格納するカラムを持たない。型は §2.7 の `Yen`／`AnswerScore` で TypeScript レベルにも固定する。
- **初期化**: 参加確定または `phase = in_progress` 開始時に各 `balances.amount = 10000`（`settlements` 皆無で Σ=0 のため一致）。
- **拠出配分の未確定部分**: ピタリ賞の**加算側 +1,000 は確定・実装必須**。**拠出元と配分**（総額 1,000 か各人からか、複数同時ピタリの扱い）は F-02 未確定のため、`balances.amount` の拠出減算は現段階で 0 とし、確定後に `settlements` へ拠出行（負の `pitari_bonus_yen` 相当）を追加する拡張余地を残す（§3.1）。この間も加算側 +1000 は反映する。

```typescript
// src/scoring/settlement.ts
import type { AnswerScore } from "./answer_score.js";
import type { Yen } from "./yen.js";

export interface QuestionSettlement {
  questionId: string;
  participantId: string;
  answerValue: AnswerScore; // 0..100
  error: AnswerScore;       // |answer - correct|
  deltaYen: Yen;            // error * -100
  pitariAwarded: boolean;
  pitariBonusYen: Yen;      // 0 または +1000
}
```

```typescript
// src/scoring/balance.ts
import type { Yen } from "./yen.js";

export interface Balance {
  participantId: string;
  amount: Yen; // 10000 + Σ settlements
}
```

### 2.7 ドメイン値型（0〜100 整数・整数円・DM-3 の型固定）

回答レンジと通貨を型レベルで固定し、`module:scoring` 内外の全経路で共有する。

```typescript
// src/scoring/answer_score.ts
export type AnswerScore = number; // 0..100 の整数
export const ANSWER_MIN = 0;
export const ANSWER_MAX = 100;

export function isAnswerScore(v: unknown): v is AnswerScore {
  return typeof v === "number" && Number.isInteger(v)
    && v >= ANSWER_MIN && v <= ANSWER_MAX;
}
export function assertAnswerScore(v: unknown): AnswerScore {
  if (!isAnswerScore(v)) {
    throw new RangeError("回答は 0〜100 の整数のみ");
  }
  return v;
}
```

```typescript
// src/scoring/yen.ts
export type Yen = number;                  // 整数円（point/pt/点 への置換禁止）
export const CURRENCY = "円" as const;
export const INITIAL_GRANT: Yen = 10_000;  // 先渡し
export const YEN_PER_ERROR: Yen = -100;    // 誤差 1 あたり
export const PITARI_BONUS: Yen = 1_000;    // 誤差 0 の加算側

export function assertYen(v: number): Yen {
  if (!Number.isInteger(v)) {
    throw new TypeError("金額は整数円のみ（小数・point/pt/点 禁止）");
  }
  return v;
}
```

- **円建て固定（INV-7 継承）**: `CURRENCY = "円"` を単一定義とし、精算結果・API 応答・TV d/e 供給用読みモデルはすべて円で表す。`point`/`pt`/`点` の語をスキーマ・派生・表示のどこにも持たせない。
- 誤差計算・増減円・残額更新は `assertYen` を通した整数値のみを扱い、途中の小数化を型と実行時アサートの双方で排除する。

### 2.8 `config` テーブルと単一解決点（規約 DM-4）

| カラム | 型 | 制約・責務 |
|---|---|---|
| `key` | text (PK) | 設定キー（例: `MAX_TABLET_CONNECTIONS`） |
| `value` | text | 文字列格納（型付きアクセサで解釈） |
| `updated_at` | text | ISO-8601 |

- **ハードコード禁止（DM-4・release-blocking）**: 接続上限等の可変パラメータは `config` テーブルまたは環境変数として保持し、`src/config/` を**唯一の解決点**とする。上限判定を行う `src/participants/admission.ts` は解決済み値のみを参照し、判定経路に数値リテラル `8` を埋め込まない。
- **既定 8 の単一定義**: 既定値 `DEFAULT_MAX_TABLET_CONNECTIONS = 8` は `src/config/` にのみ定義し、未設定時のフォールバックとして解決する。16/32 への変更はコード改修なしに追随する。
- **解決優先順**: 環境変数 `MAX_TABLET_CONNECTIONS` を既定機構とし、`config` テーブルにも同一キーを保持できる構造を用意する。両方存在時の優先は環境変数 → `config` テーブル → 既定 8 の順で単一解決点が決める。

```typescript
// src/config/connection_limit.ts
export const DEFAULT_MAX_TABLET_CONNECTIONS = 8; // 既定値の単一定義（判定経路には置かない）

export interface ConfigSource {
  read(key: string): string | undefined; // 環境変数 or config テーブルを抽象化
}

export function resolveMaxTabletConnections(source: ConfigSource): number {
  const raw = source.read("MAX_TABLET_CONNECTIONS");
  if (raw === undefined) return DEFAULT_MAX_TABLET_CONNECTIONS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return DEFAULT_MAX_TABLET_CONNECTIONS;
  return n;
}
```

### 2.9 派生状態・読みモデル連鎖と再採点

**producer → durable → derived → consumer** の連鎖を単一方向で確定する。

1. **producer**: `answers.value`（受付中に解答者が送信）。
2. **durable**: `answer_submitted`（`answers` 行、`submitted_at`）。
3. **問単位の derived**: `settlements`（`error = |value − correct_value|`、`delta_yen = error × −100`、`pitari_bonus_yen`）。`op_compute_settlement` で生成、`op_auto_rescore` で再計算。
4. **集計 read-model**: `balances.amount = 10000 + Σ delta_yen + Σ pitari_bonus_yen`。
5. **consumer surfaces**: TV d（当該問の 6 列表＝`participants.name` / `answers.value` / `settlements.error` / `settlements.delta_yen` / `settlements.pitari_bonus_yen` / `balances.amount`）、TV e（`balances` 全員通算）。

**自動再採点（差分再計算・DM-2 の帰結・release-blocking）**

- 契機: `isDisclosed(rounds.stage)` が真の問で `questions.correct_value` をライブ編集（op_live_edit_correct → op_auto_rescore）。`isDisclosed` 偽（c 未到達）の編集では再採点は起きない（境界外）。
- 手順: 当該問の全 `settlements` を編集後 `correct_value` と既存 `answers.value` から再計算し、`balances.amount` を**旧拠出との差分**（`newDeltaYen − oldDeltaYen` ＋ ピタリ差分）で更新する。`isSettled`（d 到達）問では TV d と e を同時更新する。
- 純関数として `src/scoring/` に置き、`answers`＋`correct_value` から `settlements`・`balances` を導出可能にする（全再計算でも同一結果を得るため、差分更新は最適化であり、監査時は全再計算と一致することを不変式とする）。

```typescript
// src/scoring/apply_question_score.ts
import type { AnswerScore } from "./answer_score.js";
import { assertYen, YEN_PER_ERROR, PITARI_BONUS, CURRENCY, type Yen } from "./yen.js";
import { assertAnswerScore } from "./answer_score.js";

export interface ScoreInput { balance: Yen; answer: AnswerScore; correct: AnswerScore; }
export interface ScoreResult {
  error: AnswerScore; delta: Yen; pitariBonus: Yen; balance: Yen; currency: typeof CURRENCY;
}

export function applyQuestionScore(input: ScoreInput): ScoreResult {
  const answer = assertAnswerScore(input.answer);
  const correct = assertAnswerScore(input.correct);
  const error = Math.abs(answer - correct) as AnswerScore;
  const delta = assertYen(error * -YEN_PER_ERROR * -1); // error * -100
  const pitariBonus = assertYen(error === 0 ? PITARI_BONUS : 0);
  const balance = assertYen(input.balance + delta + pitariBonus);
  return { error, delta, pitariBonus, balance, currency: CURRENCY };
}
```

**受け入れ（Vitest・`tests/` 配下・`.js` 指定子）**

```typescript
// tests/scoring/apply_question_score.test.ts
import { describe, it, expect } from "vitest";
import { applyQuestionScore } from "../../src/scoring/apply_question_score.js";

describe("精算（整数円）", () => {
  it("誤差 5 は −500 円で残額を減らし円建てを保つ", () => {
    const r = applyQuestionScore({ balance: 10_000, answer: 45, correct: 50 });
    expect(r.error).toBe(5);
    expect(r.delta).toBe(-500);
    expect(r.balance).toBe(9_500);
    expect(r.currency).toBe("円");
  });
  it("誤差 0 はピタリ賞 +1000 を加算する", () => {
    const r = applyQuestionScore({ balance: 10_000, answer: 50, correct: 50 });
    expect(r.pitariBonus).toBe(1_000);
    expect(r.balance).toBe(11_000);
  });
  it("100 超・小数・負値は受理しない（0〜100 整数のみ）", () => {
    expect(() => applyQuestionScore({ balance: 10_000, answer: 101, correct: 50 })).toThrow();
    expect(() => applyQuestionScore({ balance: 10_000, answer: 50.5, correct: 50 })).toThrow();
    expect(() => applyQuestionScore({ balance: 10_000, answer: -1, correct: 50 })).toThrow();
  });
});
```

```typescript
// tests/game_state/progression.test.ts
import { describe, it, expect } from "vitest";
import { isDisclosed, isSettled } from "../../src/game_state/progression.js";

describe("進行段階（再採点範囲判定）", () => {
  it("c 到達（answer_revealed 以降）を開示済みと判定する", () => {
    expect(isDisclosed("answers_opened")).toBe(false);
    expect(isDisclosed("answer_revealed")).toBe(true);
    expect(isDisclosed("settlement_computed")).toBe(true);
  });
  it("d 到達は settlement_computed のみ", () => {
    expect(isSettled("answer_revealed")).toBe(false);
    expect(isSettled("settlement_computed")).toBe(true);
  });
});
```

```typescript
// tests/config/connection_limit.test.ts
import { describe, it, expect } from "vitest";
import { resolveMaxTabletConnections } from "../../src/config/connection_limit.js";

const source = (v?: string) => ({ read: (_k: string) => v });

describe("接続上限（設定・非ハードコード）", () => {
  it("未設定時の既定は 8", () => {
    expect(resolveMaxTabletConnections(source(undefined))).toBe(8);
  });
  it("設定 32 を非改修で反映する", () => {
    expect(resolveMaxTabletConnections(source("32"))).toBe(32);
  });
});
```

### 2.10 ソース配置・モジュール指定子・永続化技術

- **格納先（`src/` 配下・snake_case ファイル）**: 問題 `src/questions/`、参加者 `src/participants/`、回答・進行 `src/game_state/`、精算・値型 `src/scoring/`、設定 `src/config/`。上位設計 §2.2 の module→格納先マッピングに従う（`module:game_flow` → `src/game_state/`）。
- **モジュール指定子**: 全相対 import は `.js` 拡張子明示（`import type { Round } from "../game_state/progression.js";`）。type-only import・re-export も同一。
- **永続化技術（greenfield 選定）**: 具体 DB は実装組み立てフェーズで選定するが、本データモデルは**リポジトリインタフェース**（`QuestionsRepository` 等）を `src/` に置き、DB 実装を差し替え可能にする。選定 DB は上表の `integer` 型・範囲 `CHECK`・`unique`・FK を defense-in-depth として強制できることを要件とする。スキーマ/マイグレーション定義も `src/`（例 `src/persistence/`）配下に置き、`tests/`・runner 設定ファイルには置かない。クラウド常時稼働と整合し、ホスト PC をサーバ/DB にしない（INV-1 継承）。

### 2.11 データ層のアクセス制御・整合・プライバシー

- **書込み権限境界（INV-5 継承・release-blocking）**: `rounds.stage` の前進、`game_state.tv_mode` 切替、`trigger_undone` の発火を起こす書込みは `role: host` セッションのみ。ロール判定はセッションのロール属性を単一判定点とし、`role: contestant` からの当該書込みコマンドは 401/403 で拒否する。`answers` への書込みは `role: contestant` が自分の 1 レコードに対してのみ、かつ `rounds.stage = accepting` の間だけ許可する。
- **終端状態ガード**: `answers_locked` 以降は `answers` の挿入/更新をサーバで拒否（DB 側の書込みも stage 検査を経由）。締切後の送信は `answers` に入らない。
- **クロスアクター可視性**: `/tablet` 供給読みモデルは当該解答者の `answers` と自分の `balances` のみを含み、他者の `answers`/`balances`/`settlements` を含めない。他者解答は `rounds.stage`（b 実行）到達前はどの端末向け読みモデルにも含めない。制御盤・TV(e) には `participants` 一覧を反映する。
- **整合制約**: `unique(question_id, participant_id)`（answers・settlements）、FK（answers/settlements/rounds/balances → 親）、`CHECK`（`value`・`correct_value`・`error` の 0〜100、金額の integer）。`balances.amount` は `settlements` からの全再計算と常に一致する不変式を持つ。
- **プライバシー / データ取扱い**: 収集する個人データは解答者が自己入力した氏名（`participants.name`）と当日の解答・残額に限る。恒久的な事前氏名台帳を持たず、当日その場参加を前提とする。タブレット向け読みモデルは他者情報を保持しない。家族限定アクセス制御（URL 秘匿 or 認証）は上位設計 §2.10・§3.1 の設計分岐に従い、無制御公開はリリース不可。

### Operational Behavior Model

以下の単一 YAML ブロックが、データモデルの永続・読戻し・派生連鎖・境界に関する運用挙動の権威的出典であり、実装計画と E2E 生成が共有する。上位設計 `operation_flow` と ID を一致させ、本書はデータモデル側の `durable_state`／`readback`／`measurement_source`／派生連鎖と、規約 DM-1〜DM-4 に対応する `dod_obligations` を明示する。未確定は `boundary_cases` または §3 のフラグへ回し、発明しない。

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
        - image_path / video_path は任意（NULL 許容）で保持される
      dod_obligations:
        - id: dod_load_persist
          text: 読み込んだ全問が questions に登録され、再取得で登録時と同一の text と correct_value を返す
        - id: dod_load_runtime_from_db
          text: 出題面の解決元は questions テーブルであり、問題ファイルの再読込に依存しない
        - id: dod_load_media_paths_optional
          text: image_path と video_path は未指定でも登録でき NULL として保持される
        - id: dod_load_correct_value_integer
          text: correct_value が 0〜100 の整数以外では登録が拒否される（DB CHECK を含む）
    - id: op_join_game
      actor: contestant
      verb: join
      target: game_session
      trigger: 制御盤の QR を読取り /join で氏名を自己入力して参加確定
      route: /join
      ui_pattern: qr_scan_then_name_input
      preconditions:
        - 接続数が MAX_TABLET_CONNECTIONS 未満
      durable_state: participants テーブル（name / connection_id）＋ balances 行の初期化
      readback: 制御盤の参加者一覧と TV e モードに反映
      visible_to: [host, audience]
      expected_outcomes:
        - 自己入力した氏名で participants に 1 人 1 レコードが作られる
        - 当該参加者の balances が 10000 円で初期化される
      forbidden_actors: []
      dod_obligations:
        - id: dod_join_self_name
          text: 参加者が自己入力した氏名が participants に永続し、制御盤の参加者一覧に表示される
        - id: dod_join_no_seat_fixed
          text: 端末番号の固定割当や事前氏名台帳の列/API を用いずに参加が成立する
        - id: dod_join_one_device
          text: connection_id は一意で 1 人 1 台が担保される
    - id: op_submit_answer
      actor: contestant
      verb: submit
      target: answer
      trigger: タブレットの 4 ボタン（+1/-1/+10/-10）で値を作り送信
      route: /tablet
      ui_pattern: four_button_stepper
      measurement_source: タブレット数値入力
      preconditions:
        - 当該問の rounds.stage が accepting
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
        - id: dod_submit_one_row_per_player
          text: 同一問への再送信は unique(question_id, participant_id) により 1 行を更新する
    - id: op_lock_answers
      actor: host
      verb: lock
      target: answers
      trigger: 制御盤で「そこまで」を押下
      route: /control-panel
      forbidden_actors: [contestant]
      from_state: accepting
      to_state: answers_locked
      durable_state: rounds.stage = answers_locked
      consumer_surfaces: [contestant_tablets]
      expected_outcomes:
        - 全解答者タブレットの入力がロックされる
        - 締切後の answers への書込みは拒否される
      dod_obligations:
        - id: dod_lock_host_only
          text: 締切は role host のみ発動でき contestant からの締切コマンドは 401/403 で拒否される
        - id: dod_lock_blocks_submit
          text: rounds.stage が answers_locked 以降のとき answers への挿入/更新が拒否される
    - id: op_open_answers
      actor: host
      verb: open
      target: answers
      trigger: 制御盤で「解答オープン！」を押下
      route: /control-panel
      forbidden_actors: [contestant]
      from_state: answers_locked
      to_state: answers_opened
      durable_state: rounds.stage = answers_opened
      visible_to: [audience]
      consumer_surfaces: [tv_mode_b]
      expected_outcomes:
        - 開示前は他者解答が全端末向け読みモデルに含まれない
        - 開示後 TV(b) に氏名（participants.name）と解答（answers.value）が一斉表示される
      dod_obligations:
        - id: dod_open_hidden_before
          text: rounds.stage が answers_opened 未満の間はどの端末向け読みモデルにも他者の解答が含まれない
        - id: dod_open_reveals_on_tv
          text: 開示後に TV(b) が全員の氏名と解答を表示する
    - id: op_reveal_correct
      actor: host
      verb: reveal
      target: correct_value
      trigger: 制御盤で正解発表を実行
      route: /control-panel
      forbidden_actors: [contestant]
      from_state: answers_opened
      to_state: answer_revealed
      durable_state: rounds.stage = answer_revealed
      consumer_surfaces: [tv_mode_c]
      expected_outcomes:
        - TV(c) に questions.correct_value が提示される
        - 以降の正解ライブ編集は自動再採点の対象となる
      dod_obligations:
        - id: dod_reveal_marks_disclosed
          text: 正解発表の実行で当該問の rounds.stage が answer_revealed（開示済み c 以降）として記録される
    - id: op_compute_settlement
      actor: host
      verb: settle
      target: balances
      trigger: 制御盤で得点精算を実行
      route: /control-panel
      from_state: answer_revealed
      to_state: settlement_computed
      measurement_source: answers.value と questions.correct_value
      durable_state: settlements（error / delta_yen / pitari_bonus_yen）＋ balances（円・整数）＋ rounds.stage = settlement_computed
      consumer_surfaces: [tv_mode_d, tv_mode_e]
      expected_outcomes:
        - 誤差 = 絶対値(answer - correct) が 0〜100 整数で settlements に記録される
        - 増減円 = 誤差 × -100（整数円）で delta_yen が記録され balances が更新される
        - 誤差 0 のピタリ賞 +1000 円が pitari_bonus_yen に記録され balances へ加算される
      boundary_cases:
        - 誤差 0 は +1000（丁度）
        - 誤差 1 は -100 のみ（直上）
      dod_obligations:
        - id: dod_settle_initial_grant
          text: ゲーム開始時に各プレイヤーの balances.amount が 10000 円で初期化されている
        - id: dod_settle_delta
          text: 誤差 5 の精算後に当該プレイヤーの balances.amount が精算前より 500 円少ない
        - id: dod_settle_pitari_add
          text: 誤差 0 のプレイヤーの pitari_bonus_yen が +1000 で balances に反映される（拠出配分側は F-02 未確定として fixme）
        - id: dod_settle_currency_yen
          text: settlements と balances と API 応答と d の 6 列表が円建てで表され point/pt/点 の語が存在しない
        - id: dod_settle_integer_only
          text: error / delta_yen / pitari_bonus_yen / amount がすべて整数で小数値を持たない
    - id: op_live_edit_correct
      actor: host
      verb: edit
      target: question_or_correct_value
      trigger: 制御盤のライブ編集 UI で問題または正解を更新
      route: /control-panel
      durable_state: questions テーブル更新（text / image_path / video_path / correct_value）
      readback: DB 再取得で編集後の値を返す
      expected_outcomes:
        - 問題・正解の双方を進行中に編集でき questions に永続する
      dod_obligations:
        - id: dod_edit_persist
          text: 進行中に編集した問題文と正解値が questions に永続し再取得で読み戻せる
    - id: op_auto_rescore
      actor: system
      verb: rescore
      target: balances
      trigger: 開示済み（rounds.stage が answer_revealed 以降）の問題で正解をライブ編集
      preconditions:
        - 当該問の rounds.stage が answer_revealed 以降
      measurement_source: 編集後 questions.correct_value と既存 answers.value
      durable_state: settlements 再計算 ＋ balances 差分更新
      consumer_surfaces: [tv_mode_d, tv_mode_e]
      from_state: answer_revealed
      to_state: answer_revealed
      expected_outcomes:
        - 正解訂正で当該問の全 settlements（誤差・delta_yen・pitari）が再計算される
        - balances が旧拠出との差分で更新される
        - rounds.stage が settlement_computed の問は TV d/e が同時更新される
      boundary_cases:
        - c 到達問の正解訂正 → 再採点が走る
        - c 未到達（isDisclosed 偽）の正解編集 → 再採点は走らない（境界外）
      dod_obligations:
        - id: dod_rescore_after_c
          text: rounds.stage が answer_revealed 以降で正解を直すと settlements と balances が再計算され各人の残額へ即時反映される
        - id: dod_rescore_no_before_c
          text: rounds.stage が answer_revealed 未満の正解編集では settlements と balances が変化しない
        - id: dod_rescore_d_sync
          text: rounds.stage が settlement_computed の問の正解訂正で balances 差分が再計算され TV の d と e が同時更新される
        - id: dod_rescore_matches_full_recompute
          text: 差分更新後の balances が answers と correct_value からの全再計算と一致する
    - id: op_enforce_connection_limit
      actor: system
      verb: reject
      target: tablet_connection
      trigger: 接続数が MAX_TABLET_CONNECTIONS に達した状態での新規接続試行
      measurement_source: 現在接続数と config の MAX_TABLET_CONNECTIONS 解決値
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
          text: 上限判定は config の解決値を参照し、判定経路に数値リテラル 8 が存在しない
    - id: op_determine_winner
      actor: system
      verb: determine
      target: winner
      trigger: 10 問目の得点精算が完了
      preconditions:
        - 10 問すべての rounds.stage が settlement_computed
      measurement_source: 全問通算の balances.amount
      consumer_surfaces: [tv_mode_e]
      from_state: settlement_computed
      to_state: game_finished
      durable_state: game_state.phase = finished
      expected_outcomes:
        - balances.amount 最多のプレイヤーが e モードで勝者として判別可能に表示される
      dod_obligations:
        - id: dod_winner_most_balance
          text: 10 問終了時に balances.amount 最多のプレイヤーが e モードで勝者として判別できる
```

---

## 3. Open Questions

壁打ち（要件定義）フェーズはクローズ済で殿判断待ちの論点は残っていない。以下はデータモデルに関して実装組み立てフェーズで MAS が決める選定、推測実装せず殿判断を仰ぐ点、検証ゲートで暫定運用中のフラグである。いずれも「推奨なし」「要検討」「TBD」の空白は残さず、確定した制約・既定機構・暫定ゲート値を明記する。

### 3.1 データ永続・スキーマの選定（MAS 決定・殿判断不要）

| 項目 | 決定/既定 | 制約・選定軸 |
|---|---|---|
| DB 永続化技術 | 8 テーブル（`questions`/`participants`/`answers`/`rounds`/`game_state`/`settlements`/`balances`/`config`）を保持できる DB を選定 | クラウド常時稼働と整合。`integer` 型・範囲 `CHECK`・`unique`・FK を defense-in-depth として強制できること。ホスト PC を DB/サーバにしない（INV-1 継承）。 |
| 進行状態の正規化 | `rounds`（問＝ラウンド単位の `stage`）＋`game_state`（セッションポインタ）へ分離 | 上位設計の `game_state.stage` 概念を `db:rounds` へ正規化して DM-2 を満たし、再採点範囲を問単位で問い合わせ可能にする。 |
| 精算の持ち方 | `settlements`（問×人の拠出台帳）を durable、`balances` を集計読みモデルとする | 差分再採点を成立させる。`balances = 10000 + Σ settlements` を不変式とし、差分更新は全再計算と一致すること。 |
| 上限設定の持ち方 | 環境変数 `MAX_TABLET_CONNECTIONS` を既定機構、`config` テーブルも保持可能 | 解決順は 環境変数 → `config` → 既定 8。`src/config/` が唯一の解決点。ハードコード禁止（DM-4）。 |
| マイグレーション配置 | スキーマ/マイグレーション定義は `src/`（例 `src/persistence/`）配下 | runner 設定ファイル・`tests/` には置かない。output-path fence 遵守。 |

### 3.2 F028 エスカレーション（推測実装しない）

- **ピタリ賞の拠出配分（B・F-02）**: `settlements.pitari_bonus_yen` の**加算側 +1,000 は確定・実装必須**。**拠出元と配分**（総額 1,000 か各人からか、複数同時ピタリ時の扱い）が未確定な間は `balances` の拠出減算を 0 とし、確定後に拠出行（負の拠出）を `settlements` へ追加する拡張余地を残す。加算側 +1000 は変更しない。挙動詳細は E2E で `test.fixme()`。
- **取消操作のデータ影響（論点 7・F-03）**: `trigger_undone` が `rounds.stage` を 1 段戻すのか、任意問題を再開示（`answer_revealed` へ戻し再採点）するのか等、直近のみ/任意問題再開示の別が曖昧な範囲は推測実装せず、選択肢を添えて F028 で殿判断を仰ぐ。**発動権限＝制御盤（host）のみ**は確定ゆえ実装・検証し、状態遷移の詳細は E2E で `test.fixme()`。

### 3.3 検証ゲートで暫定運用中のフラグ（設計義務の欠落・発明せず flag）

- **F-01（残額の下限・脱落）**: 確定要件は「誤差 × −100 円」「先渡し 10,000 円」のみで、`balances.amount` の 0 下限や全額喪失での脱落は確定要件に無い。データモデルは `amount` に下限 `CHECK` を課さず、負残高も表現可能とする。下限/脱落を導入する実装が現れた場合にフラグする。
- **F-04（同期レイテンシ SLA）**: 設計に固定 SLA が無いため、状態遷移（`rounds.stage` 前進・`balances` 更新）の全端末反映は上位設計 §2.4/§2.11 の **p95 ≤ 2,000ms** を暫定テストゲートとして扱い、SLA 確定時に更新する。
- **F-05（家族限定アクセス制御）**: `participants` へ書き込める参加ベクタは QR が指すクラウド公開 URL（`/join`）。認証導入時は `participants` 書込み前にログイン→リダイレクト→描画フローを検証し、未実装なら該当ブラウザテストを `test.fixme()`。無制御公開のまま出荷はリリース不可（INV-4 継承）。
