---
codd:
  node_id: design:surface-copy-obligations
  type: design
  depends_on:
  - id: design:operational-behavior-model
    relation: depends_on
    semantic: technical
  - id: design:system-design
    relation: constrained_by
    semantic: governance
  depended_by:
  - id: test:test-strategy
    relation: depends_on
    semantic: verification
  conventions:
  - targets:
    - module:control_panel
    - role:host
    reason: 制御盤サーフェスの目的・対象（司会者）・許可導線（締切/開示/正解発表/精算/次へ・戻る・個別ジャンプ/問題・正解ライブ編集/取消）・禁止導線を定義し、文言は司会者の運用言語で表すこと（N-3・論点7）。違反時リリース不可。
  - targets:
    - module:tablet
    - role:contestant
    reason: タブレットは入力専用最小 UI（問題番号・数値入力・送信済み表示・自分の残額のみ）に限定し、出題内容・他者情報・全体一覧の提示を禁止する。文言は解答者向けで、内部処理・権限境界の説明やデモ/テスト用ラベルを載せないこと（N-1・第三要件）。違反時リリース不可。
  - targets:
    - module:tv_display
    reason: TV は MC 切替の 5 モード（a 出題[動画/画像/テキスト]／b 解答オープン／c 正解発表／d 当該問全員表[氏名/解答/誤差/増減円/ピタリ賞/残額]／e
      全問通算一覧）を観客向け文言で提示し、開示前は他者解答を伏せること（第三要件・N-2・N-4）。違反時リリース不可。
  - targets:
    - module:tv_display
    - module:scoring
    reason: 金額表示は円建てで現金感を薄めず、ポイント等への置換や点化文言を禁止する（論点B）。違反時リリース不可。
  modules:
  - control_panel
  - tablet
  - tv_display
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
      label: クラウドサーバ（realtime_sync 権威 / scoring / participants）
    operations:
    - id: op_render_control_panel_surface
      actor: host
      verb: render
      target: control_panel_surface
      trigger: 司会者が /control-panel を開く
      route: /control-panel
      ui_pattern: host_operational_console
      visible_to:
      - host
      forbidden_actors:
      - contestant
      - audience
      preconditions:
      - セッションのロールが host に確定している
      consumer_surfaces:
      - control_panel
      expected_outcomes:
      - 制御盤に §2.7 の全司会者トリガーが司会者向け操作語で表示される
      - 制御盤に参加者一覧（自己入力氏名）と接続「◯/◯台」が表示される
      - 制御盤に参加用 QR が表示される
      - 制御盤に解答者用の数値入力送信面が存在しない
      boundary_cases:
      - 状態ラベルは運用語で表示（内部イベント名 answers_locked 等を出さない）
      - 副司会ロール導線は発明しない
      dod_obligations:
      - id: dod_cp_visible_host_triggers
        text: 制御盤に「問題を読み込む」「そこまで」「解答オープン！」「正解発表」「精算」「次へ」「戻る」「取消」および各モード個別ジャンプの操作要素が司会者向け操作語で存在する
      - id: dod_cp_no_contestant_input_face
        text: 制御盤に解答者用の数値入力送信面（+1/-1/+10/-10 と送信）が存在しない
      - id: dod_cp_shows_join_qr_and_roster
        text: 制御盤に参加用 QR と参加者一覧（自己入力氏名）が表示される
      - id: dod_cp_no_internal_leak
        text: 制御盤の可視文言に内部ロール識別子（host/contestant）・内部イベント名（answers_locked 等）・設定キー名・point/pt/点・デモ/テスト/サンプル表記が存在しない
    - id: op_render_tablet_surface
      actor: contestant
      verb: render
      target: tablet_surface
      trigger: 参加確定後の解答者が /tablet を開く
      route: /tablet
      ui_pattern: input_only_minimal
      visible_to:
      - contestant
      forbidden_actors:
      - host
      - audience
      preconditions:
      - 参加確定済み（participants に自分のレコードが存在）
      consumer_surfaces:
      - contestant_tablets
      expected_outcomes:
      - /tablet の可視要素が問題番号・数値入力・送信・送信済み表示・自分の残額（円）に限られる
      - /tablet に他者情報・出題本文・全体一覧・司会者操作要素が存在しない
      boundary_cases:
      - ステッパは 0〜100 でクランプし 0 未満・100 超に振り切れない
      - 権限境界の説明文（なぜ操作できないか）は出さない
      dod_obligations:
      - id: dod_tablet_minimal_elements_only
        text: /tablet の可視要素が問題番号・数値入力（+1/-1/+10/-10）・送信・送信済み表示・自分の残額（円）に限られる
      - id: dod_tablet_no_others_info
        text: /tablet に他者の氏名・解答・残額・得点、出題本文、全体一覧が表示されない
      - id: dod_tablet_no_control_actions
        text: /tablet に締切・開示・正解発表・精算・モード切替・取消の操作要素が存在しない
      - id: dod_tablet_contestant_copy_only
        text: /tablet の可視文言が解答者向け（問題番号/送信/送信済み/あなたの残額◯◯円/受付中/締切）で、内部処理説明・権限境界説明・デモ/テスト用ラベル・内部イベント名・point/pt/点
          が存在しない
    - id: op_render_join_surface
      actor: contestant
      verb: render
      target: join_surface
      trigger: 解答者が QR 経由で /join を開く
      route: /join
      ui_pattern: name_input_then_join
      visible_to:
      - contestant
      preconditions:
      - 家族限定アクセス制御の判定結果が描画分岐に反映される
      consumer_surfaces:
      - join_page
      expected_outcomes:
      - /join に氏名入力欄と「参加する」が表示される
      - /join に事前氏名台帳・端末番号割当の入力要素が存在しない
      - 未認証・未参加の /join に保護ナビ（制御盤操作等）が露出しない
      - 満席時・アクセス不可時は job-to-be-done 平易文が表示される
      boundary_cases:
      - 満席時 → 「ただいま満席のため参加できません」等の平易文（設定キー名・接続数会計・ロール識別子を出さない）
      - 分岐B 未認証 → 保護ナビを露出せずログインへ誘導
      - アクセス不可 → アクセス制御方式（トークン/認証）を露出しない平易文
      dod_obligations:
      - id: dod_join_name_input_and_cta
        text: /join にお名前入力欄と「参加する」が表示される
      - id: dod_join_no_protected_nav
        text: 未認証・未参加の /join に制御盤操作等の保護ナビが露出しない
      - id: dod_join_no_seat_ledger_ui
        text: /join に事前氏名台帳・端末番号割当の入力要素が存在しない
      - id: dod_join_full_plain_copy
        text: 満席時の /join に job-to-be-done 平易文が表示され、設定キー名・接続数会計・ロール識別子が露出しない
      - id: dod_join_access_denied_plain_copy
        text: アクセス拒否時の /join にアクセス制御方式（トークン/認証）や内部会計を露出しない平易文が表示される
    - id: op_render_tv_surface
      actor: system
      verb: render
      target: tv_surface
      trigger: TV が現在の game_state.tv_mode を描画する
      route: /tv
      ui_pattern: passive_display_five_modes
      visible_to:
      - audience
      measurement_source: game_state.tv_mode と questions（a）と answers（b）と settlements/balances（d/e）
      consumer_surfaces:
      - tv_mode_a
      - tv_mode_b
      - tv_mode_c
      - tv_mode_d
      - tv_mode_e
      expected_outcomes:
      - TV が a 出題面／b 氏名＋解答／c 正解値／d 6 列表／e 全問通算一覧の 5 モードを観客向け文言で表示する
      - b（解答オープン）未配信の間、他者の解答が TV に表示されない
      - TV にいかなる入力・操作要素も存在しない
      boundary_cases:
      - a: 動画パス有→動画 / 動画無・画像有→画像 / 双方無→テキスト（生パスは表示しない）
      - d の 6 列は 氏名/解答/誤差/増減円/ピタリ賞/残額 で増減円・残額は円建て
      - e: 10 問精算完了で残額最多を勝者として判別可能に提示
      dod_obligations:
      - id: dod_tv_five_modes
        text: TV が a 出題面／b 氏名＋解答／c 正解値／d 6 列表（氏名/解答/誤差/増減円/ピタリ賞/残額）／e 全問通算一覧の 5 モードを表示する
      - id: dod_tv_hide_before_disclosure
        text: b（解答オープン）未配信の間、TV に他者の解答が表示されない
      - id: dod_tv_no_path_or_internal_leak
        text: TV の表示に生ファイルパス（image_path/video_path の値）や fallback 等の内部語・内部イベント名が露出しない
      - id: dod_tv_audience_copy_no_control
        text: TV にいかなる入力・操作要素も存在せず、可視文言が観客向けで司会者操作語を含まない
      - id: dod_tv_winner_visible_e
        text: e モードで残額最多のプレイヤーが勝者として判別可能に表示される
    - id: op_enforce_currency_yen_copy
      actor: system
      verb: enforce
      target: currency_copy
      trigger: 金額を含む面・応答（TV d/e・タブレット残額・API）を描画/生成する
      measurement_source: formatYen() と settlements/balances の整数円値
      consumer_surfaces:
      - tv_mode_d
      - tv_mode_e
      - contestant_tablets
      expected_outcomes:
      - 金額はすべて円建てで表示され point/pt/点 の語が存在しない
      - 得点を点数化・ポイント化する文言が存在しない
      boundary_cases:
      - 増減 -100/-500 も円建て（例 -100円 / -500円）
      - ピタリ賞 +1000 も円建て（+1000円）
      dod_obligations:
      - id: dod_currency_yen_all_surfaces
        text: TV(d/e) の金額表示・タブレットの自残額表示・API 応答・settlements/balances がすべて円建てで表示される
      - id: dod_currency_no_point_token
        text: 全サーフェスの可視文言と API 応答に point/pt/点 の語が存在しない
      - id: dod_currency_no_pointization_phrase
        text: 得点を点数化・ポイント化する文言（◯◯点・◯◯pt 等）が存在せず現金感を薄めない
    - id: op_map_role_labels_in_copy
      actor: system
      verb: map
      target: role_labels
      trigger: 可視文言にロール名を表示する
      measurement_source: src/game_state/role_labels.ts の ROLE_LABELS
      consumer_surfaces:
      - control_panel
      - tv_display
      - contestant_tablets
      - join_page
      expected_outcomes:
      - ロールは司会者/解答者/観客の可視ラベルで表示される
      - 内部識別子 host/contestant/audience が可視文言に露出しない
      dod_obligations:
      - id: dod_labels_business_facing
        text: 全サーフェスの可視文言でロールが司会者/解答者/観客の可視ラベルで表され、内部識別子 host/contestant/audience が露出しない
      - id: dod_labels_single_source
        text: 可視ロールラベルが単一のラベル定義（src/game_state/role_labels.ts）から供給される
---

# 画面・導線・文言 設計義務（制御盤／タブレット／TV5モード）

## 1. Overview

本書は `save-money-switcher`（クラウド WEB アプリ版『賞金先渡しクイズ SAVE MONEY』を家族で遊ぶ操作盤）の **画面・導線・文言 設計義務（Actor-Facing Surface / Navigation / Copy Obligations）** を確定する権威文書である。上位の `design:system-design`（constrained_by・governance）と兄弟の `design:operational-behavior-model` を真実源として統合し、四つのアクター向けサーフェス —— **制御盤（`/control-panel`）／タブレット（`/tablet`）／TV（`/tv`）／参加受付（`/join`）** —— の各々について、**目的・主対象アクター・許可導線／ナビゲーション・禁止導線／ナビゲーション・必須の可視コピー意図・禁止コピーパターン** を実装計画・E2E 生成に先立って設計時に固定する。ここに記す義務に反する成果物は **リリース不可（release-blocking）** として扱う。

運用挙動（誰が・何を・どの状態から・どの結果へ）は `design:operational-behavior-model` が所有し、本書はその挙動が **どのサーフェスにどのラベルで可視化され、どの導線から到達でき、何を露出してはならないか** の「見え方の契約」を所有する。両者は `### Operational Behavior Model` の単一 YAML（`operation_flow:`）で ID を共有し、CoDD がメタデータへ lift して実装フェーズと E2E 生成フェーズが同一の真実源を参照する。本書は E2E シナリオ集ではなく、E2E は本書の `dod_obligations` から後段生成される **証跡** に過ぎない。

### 1.1 リリースブロッキング設計義務と本書での具体化

| # | 対象 | 義務（要旨） | 本書での具体化箇所 |
|---|---|---|---|
| SCO-1 | `module:control_panel` / `role:host` | 制御盤サーフェスの目的・対象（司会者）・許可導線（締切／開示／正解発表／精算／次へ・戻る・個別ジャンプ／問題・正解ライブ編集／取消）・禁止導線を定義し、文言は司会者の運用言語で表す（N-3・論点7） | §2.2・§2.7・OBM `op_render_control_panel_surface` |
| SCO-2 | `module:tablet` / `role:contestant` | タブレットは入力専用最小 UI（問題番号・数値入力・送信済み表示・自分の残額のみ）に限定し、出題内容・他者情報・全体一覧の提示を禁止。文言は解答者向けで、内部処理・権限境界の説明やデモ/テスト用ラベルを載せない（N-1・第三要件） | §2.3・§2.8・OBM `op_render_tablet_surface` |
| SCO-3 | `module:tv_display` | TV は MC 切替の 5 モード（a 出題[動画/画像/テキスト]／b 解答オープン／c 正解発表／d 当該問全員表[氏名/解答/誤差/増減円/ピタリ賞/残額]／e 全問通算一覧）を観客向け文言で提示し、開示前は他者解答を伏せる（第三要件・N-2・N-4） | §2.4・§2.8・OBM `op_render_tv_surface` |
| SCO-4 | `module:tv_display` / `module:scoring` | 金額表示は円建てで現金感を薄めず、ポイント等への置換や点化文言を禁止する（論点B） | §2.5・OBM `op_enforce_currency_yen_copy` |

上位から継承する不変条件も本書のサーフェス層で担保する: **エントリ／事前認証面に保護ナビを露出しない**（無制御公開・ロール解決済みの曖昧ナビの露出はリリース不可・§2.6）、**プライバシー投影**（他者情報を解答者端末へ露出しない・自己入力氏名のみ・恒久台帳なし・§2.8）、**生ファイルパス・内部語の非露出**（TV に `video_path` 値・`fallback` 等を出さない・§2.4）。

### 1.2 実装・ツールチェーン前提（scaffold 固定・釈義不可）

- **実装言語 = TypeScript のみ。** 本書のサーフェス実装ファイル（`src/control_panel/*.ts`・`src/tablet/*.ts`・`src/tv_display/*.ts` 等）・可視ラベル/文言辞書・型・モジュール構成・依存管理・ツールチェーン参照はすべて TypeScript 慣行のみを用い、他言語の拡張子・マニフェスト・ツールは例示・フォールバックとしても登場させない。
- **テストランナー = Vitest（固定・release-blocking のグラウンドトゥルース）。** 本書の全テスト例は Vitest 自身の宣言 API（`import { describe, it, expect } from "vitest";`）で記述する。「ランタイム依存を最小化する」方針は **出荷コードのランタイム依存**（`ws`／`qrcode` 等）にのみ及び、テストランナーには及ばない。依存数の哲学を根拠に別フレームワークや Node 組み込み `node:test` を用いてはならない。verify が実際に走らせるのは Vitest である。ブラウザ描画・禁止要素/禁止コピーの走査は Playwright を **ライブラリ import**（`import { chromium } from "playwright";`）で駆動し、宣言・検証は Vitest（`describe`/`it`/`expect`）で行う。
- **モジュール解決 = NodeNext/Node16。** すべての相対 import は **出力される `.js` ファイル名を明示した拡張子** を伴う（`import { ROLE_LABELS } from "./role_labels.js";`。`"./role_labels"`・`"./role_labels.ts"` は不可）。default/namespace import・re-export（`export { formatYen } from "./currency.js";`）・type-only import（`import type { Role } from "./role_labels.js";`）も同一規約。拡張子欠落は TS2835 でコンパイル不能。
- **レイアウト契約（output-path fence 強制）。** サーフェス実装ソースは **必ず `src/` 配下**（可視ラベル `src/game_state/`、金額文言 `src/scoring/`、各面 `src/control_panel/`・`src/tablet/`・`src/tv_display/`・`src/participants/`）、テストは **必ず `tests/` 配下**（`test/`・`spec/`・`specs/` を発明しない。サブディレクトリ `tests/game_state/`・`tests/e2e/` 等は可）。`package.json`・`package-lock.json`・`tsconfig.json`・`vitest.config.ts` は harness scaffold 所有につき、本書はこれらを成果物として出力・宣言しない。

### 1.3 アクター・ロール・可視ラベル対応（内部識別子 → 可視ラベル）

要件は内部ロール識別子と業務／ユーザ向け役割名の双方を持つ。**可視コピーには可視ラベルのみを用い**、内部識別子・内部イベント名・設定キー名・実装根拠・環境前提・権限境界の説明・デモ/テスト/サンプル表記を露出させない。可視ラベルは **単一のラベル定義**（`src/game_state/role_labels.ts`）から供給し、全サーフェスで一貫させる。

| 内部識別子 | 可視ラベル | 主サーフェス | サーフェスの役割 |
|---|---|---|---|
| `role: host` | **司会者** | `/control-panel` | 進行制御・入稿・ライブ編集・QR 提示（当該境界の管理者。運用言語で操作語を可視化してよい唯一の面） |
| `role: contestant` | **解答者** | `/join`→`/tablet` | 参加・数値入力・送信（入力専用最小面） |
| （TV 視聴者） | **観客** | `/tv` | 5 モードの受動表示のみ |
| `system` | （非可視） | クラウド権威 | 配信・投影・整合復帰（可視化しない） |

内部イベント名 → 可視表現の対応（可視コピーに内部名を出さない）: `accepting`→「受付中」、`answers_locked`→「締切／そこまで」、`answers_opened`→「解答オープン」、`answer_revealed`→「正解発表」、`settlement_computed`→「精算」、`tv_mode a〜e`→各モードの観客向け提示。金額は全経路で **円**（`point`／`pt`／`点` を型・スキーマ・派生・可視コピーのいずれにも持たせない）。

---

## 2. Architecture

### 2.1 サーフェス一覧と設計義務マトリクス

4 サーフェスの **目的・主対象・許可／禁止アクション・許可／禁止ナビ・必須の可視コピー意図・禁止コピー** を単一マトリクスで固定する。可視コピーは各面の監査対象アクターの job-to-be-done 言語に限り、実装根拠・内部処理名・環境前提・テスト/デモ/サンプル表記を露出させない。

| サーフェス | ルート | 主対象 | 目的 | 許可アクション／ナビ | 禁止アクション／ナビ | 必須の可視コピー意図 | 禁止コピー |
|---|---|---|---|---|---|---|---|
| 制御盤 | `/control-panel` | 司会者 | 進行制御・入稿・ライブ編集・MC 切替・QR 提示・接続把握 | §2.7 の全トリガー／参加者一覧／参加 QR 提示／「◯/◯台」把握 | 解答者の数値入力送信面の露出 | 「問題を読み込む」「そこまで」「解答オープン！」「正解発表」「精算」「次へ／戻る／個別ジャンプ」「取消」「問題・正解を編集」等の司会者向け操作語 | 内部ロール識別子（host/contestant）・内部イベント名（`answers_locked` 等）・設定キー名・`point`/`pt`/`点`・デモ/テスト/サンプル表記 |
| タブレット | `/tablet` | 解答者 | 数値入力・送信・自分の残額確認 | `−10/−1/+1/+10` で 0〜100 を作る／「送信」／送信済み確認／自分の残額（円）閲覧／受付中・締切表示 | 締切・開示・正解発表・精算・モード切替・取消の各操作、他者の氏名/解答/残額/得点、出題本文、全体一覧 | 問題番号・数値入力・「送信」「送信済み」「あなたの残額 ◯◯円」「受付中」「締切」 | 他者情報・司会者操作語・内部処理説明・権限境界の説明・内部イベント名・デモ/テスト用ラベル・`point`/`pt`/`点` |
| TV | `/tv` | 観客 | 5 モード（a〜e）の受動提示 | 表示のみ | いかなる入力・操作要素、生ファイルパス表示、内部語表示 | a 出題面／b 氏名＋解答／c 正解値／d 6 列表（氏名/解答/誤差/増減円/ピタリ賞/残額・**円**）／e 全問通算＋勝者判別 | 内部語（`fallback`/`video_path`/`image_path` 値）・生ファイルパス・内部イベント名・接続/復帰デバッグ・司会者操作語・`point`/`pt`/`点` |
| 参加受付 | `/join` | 解答者 | QR 経由の参加・氏名自己入力 | 氏名入力／「参加する」 | 事前氏名台帳／端末番号割当の入力、保護された制御盤ナビの露出、他者情報閲覧 | 「お名前を入力してください」「参加する」。満席時「ただいま満席のため参加できません」。アクセス不可時は平易文 | 保護ナビの露出・設定キー名・接続数会計・ロール識別子・アクセス制御方式（トークン/認証）の説明・`point`/`pt`/`点` |

### 2.2 制御盤サーフェス（SCO-1・N-3・論点7）

- **目的／主対象**: 司会者が進行を制御し、入稿・ライブ編集・MC 切替・QR 提示・接続把握を行う唯一の面。司会者は **当該権限境界の管理者** であり、権限操作トリガーを運用言語で可視化してよい唯一のアクターである（他面はこれらを露出しない）。
- **許可導線（可視トリガー）**: 「問題を読み込む」（`op_load_questions`）／参加用 QR 提示（`op_display_join_qr`）／「そこまで」（`op_propagate_deadline`）／「解答オープン！」（`op_propagate_disclosure`）／「正解発表」（`op_reveal_answer`）／「精算」（`op_compute_settlement`）／「次へ」「戻る」「個別ジャンプ」（`op_propagate_mode_switch`／`op_switch_tv_mode`）／各問インライン編集（`op_live_edit_correct`）／「取消」（`op_undo`）／参加者一覧（自己入力氏名）と「◯/◯台」の接続把握。
- **禁止導線**: 解答者の数値入力送信面（`−10/−1/+1/+10` と「送信」）を制御盤に露出しない。副司会という別ロール導線を発明しない。
- **必須の可視コピー意図**: 上記トリガーは **司会者の運用言語**（操作語）で表す。内部イベント名（`answers_locked`／`answers_opened` 等）を **ボタン・ラベル・状態表示に露出しない**（「締切」「解答オープン」のように運用語で表す）。
- **禁止コピー**: 内部ロール識別子（host/contestant）・内部イベント名・設定キー名（`MAX_TABLET_CONNECTIONS`／`JOIN_ACCESS_TOKEN`）・`point`/`pt`/`点`・デモ/テスト/サンプル表記。
- **配置**: `src/control_panel/`。SCO-1 遵守は OBM `op_render_control_panel_surface` の `dod_cp_*` で機械可検化する。

### 2.3 タブレットサーフェス（SCO-2・N-1・第三要件）

- **目的／主対象**: 解答者の **入力専用最小 UI**。可視要素は **問題番号 / 数値入力（`−10/−1/+1/+10`）/ 送信・送信済み表示 / 自分の残額（円）** に限る。
- **許可アクション**: `+1/−1/+10/−10` のステッパで 0〜100 に **クランプ**して値を作り（0 未満・100 超に振り切れない）、「送信」で確定。送信後は自分にのみ「送信済み」を表示。受付中／締切の状態表示、自分の残額（円）の閲覧。
- **禁止アクション／禁止提示**: 締切・開示・正解発表・精算・モード切替・取消のいずれの操作要素も置かない。**他者の氏名・解答・残額・得点、出題本文（問題内容の埋め込み）、全体一覧を一切提示しない**（禁止要素の不在をアサート）。
- **必須の可視コピー意図**: 解答者向け（「問題番号」「送信」「送信済み」「あなたの残額 ◯◯円」「受付中」「締切」）。
- **禁止コピー**: 他者情報・司会者操作語・**内部処理の説明・権限境界の説明**（「なぜ操作できないか」の解説を出さない）・内部イベント名・**デモ/テスト/サンプル用ラベル**・`point`/`pt`/`点`。
- **配置**: `src/tablet/`。SCO-2 遵守は OBM `op_render_tablet_surface` の `dod_tablet_*` で機械可検化する。

### 2.4 TV5モードサーフェス（SCO-3・第三要件・N-2・N-4）

- **目的／主対象**: 観客向けに MC 切替の **5 モード** を受動提示する面。いかなる入力・操作要素も持たない。
- **5 モードの提示内容（観客向け文言）**:

| モード | 名称 | 提示内容 | 出典 |
|---|---|---|---|
| **a** | 出題 | 出題面を **動画→画像→テキスト** の 3 段で解決して提示（`resolveQuestionFace`）。生パス文字列や `fallback` 等の内部語は出さない。 | `op_switch_tv_mode`／`op_live_edit_correct` |
| **b** | 解答オープン | **開示後のみ** 全員の氏名＋解答を一斉提示。**開示前（b 未配信）は他者解答を伏せる**。 | `op_propagate_disclosure` |
| **c** | 正解発表 | 当該問の正解値を提示。 | `op_reveal_answer` |
| **d** | 当該問全員表 | **6 列表（氏名 / 解答 / 誤差 / 増減円 / ピタリ賞 / 残額）** を当該問フォーカスで提示。増減円・残額は **円**。 | `op_compute_settlement` |
| **e** | 全問通算一覧 | 全員の全問通算残額を一覧提示。10 問精算完了で **残額最多**を勝者として判別可能に提示。 | `op_determine_winner` |

- **開示前伏せ（N-2・N-4）**: b（解答オープン）が配信されるまで、TV に他者の解答を表示しない。これは配信ロール投影（`op_broadcast_state_transition` の `dod_broadcast_role_projection`）と TV 面の描画契約の両輪で担保する。
- **禁止提示**: 入力・操作要素、生ファイルパス（`image_path`／`video_path` の値）、`fallback` 等の内部語、内部イベント名、接続/復帰デバッグ表示、司会者操作語、`point`/`pt`/`点`。
- **配置**: `src/tv_display/`。SCO-3 遵守は OBM `op_render_tv_surface` の `dod_tv_*` で機械可検化する。

### 2.5 金額文言・円建て固定（SCO-4・論点B）

- **円建て固定**: TV(d) の 6 列表・TV(e) の通算一覧・タブレットの自残額表示・API 応答・`settlements`／`balances` はすべて **円** で表す。金額文言を **点数化・ポイント化しない**（「◯◯点」「◯◯pt」等の点化文言を出さない）。現金感を薄める語（ポイント／点への置換）を型・スキーマ・派生・可視コピーのいずれにも持たせない。
- **確定値（変更禁止・`design:operational-behavior-model` §2.5 と一致）**: 賞金先渡し **10,000 円** ／ 誤差 = |解答 − 正解|（0〜100 整数）／ 増減円 = 誤差 × **−100 円** ／ ピタリ賞（誤差 0）**+1,000 円** ／ 10 問終了時 **残額最多勝ち**。金額はすべて整数円。
- **単一の金額整形点**: 金額整形と円建て不変式を `src/scoring/currency.ts` に単一化し、TV・タブレットの表示はこれを経由する。

```typescript
// src/scoring/currency.ts
export const CURRENCY_UNIT = "円" as const;

// 金額は整数円のみ。小数・非整数は文言化しない（円建て・点化禁止）。
export function formatYen(amount: number): string {
  if (!Number.isInteger(amount)) {
    throw new Error("amount must be an integer number of yen");
  }
  return `${amount.toLocaleString("ja-JP")}${CURRENCY_UNIT}`;
}
```

SCO-4 遵守は OBM `op_enforce_currency_yen_copy` の `dod_currency_*` で機械可検化する（全サーフェスの可視文言と API 応答に `point`/`pt`/`点` が存在しないことを走査）。

### 2.6 参加受付・エントリ／事前認証サーフェス（保護ナビ非露出）

- **目的／主対象**: 解答者が QR 経由で `/join` に到達し、**氏名を自己入力**して参加確定する面。
- **許可アクション／ナビ**: 氏名入力欄・「参加する」。
- **禁止アクション／ナビ**: 事前氏名台帳・端末番号（座席）固定割当の入力要素を置かない。**アクセス状態に整合しない保護ナビ（制御盤操作等）を露出しない**。他者情報を閲覧させない。
- **エントリ／事前認証面の言明**: `/join`（および分岐 B〔認証〕未認証時の到達点）は、**ロール解決済みの曖昧な保護ナビ**を露出しない。ナビはサーフェス目的と現在のアクセス状態に一致させる。分岐 B 導入時は「ログイン → 正しいリダイレクト → `/join` 氏名入力描画」のフローを備える。
- **必須の可視コピー意図（job-to-be-done 平易文）**:
  - 通常時: 「お名前を入力してください」「参加する」。
  - **満席時**: 「ただいま満席のため参加できません」等の平易文。**設定キー名（`MAX_TABLET_CONNECTIONS`）・接続数会計（現在数/上限数）・ロール識別子を露出しない**。
  - **アクセス不可時**: アクセス制御方式（URL 秘匿トークン／認証）や内部会計を露出しない平易文。
- **禁止コピー**: 保護ナビの露出・設定キー名・接続数会計・ロール識別子・アクセス制御方式の説明・`point`/`pt`/`点`。
- **配置**: `/join` 面は `src/participants/`。SCO の遵守は OBM `op_render_join_surface` の `dod_join_*` で機械可検化する。

### 2.7 導線（Reachability）とナビゲーション整合

各サーフェスへ至る可視トリガーの経路を、アクターごとに閉じた集合として固定する。導線外からの発動（副司会ロールの発明・解答者端末からの司会操作面・観客端末の操作要素）を可視化しない。

**司会者（`/control-panel` の可視トリガーのみ）**

```
制御盤:[ 問題を読み込む ][ 参加用QR ][ そこまで ][ 解答オープン！ ][ 正解発表 ][ 精算 ]
        [ 次へ ][ 戻る ][ 個別ジャンプ:a b c d e ][ 取消 ]  各問:[ 問題・正解を編集 ]
        参加者一覧（自己入力氏名） / 接続「◯/◯台」
```

**解答者（QR 参加→氏名入力→入力画面のみ）**

```
QR 読取り → /join（家族限定アクセス通過）→「お名前を入力してください」→[ 参加する ]
        → /tablet:問題番号 / [ −10 ][ −1 ][ +1 ][ +10 ]→0〜100 /[ 送信 ]/「送信済み」
        / 「あなたの残額 ◯◯円」/「受付中」「締切」
```

**観客（受動のみ）**: `/tv` はいかなる入力・操作要素も持たず、配信された TV モード（a〜e）を表示するだけ。到達可能なコマンドは無い。

**ナビゲーション整合**: 各面のナビはサーフェス目的と現在のアクセス状態に一致する。`/join`・未認証面に制御盤等の保護ナビを混ぜない。タブレット・TV に司会者操作語のナビを混ぜない。

### 2.8 文言ガバナンス・可視ラベル・プライバシー投影

- **可視ラベルの単一供給**: ロールは全サーフェスで **司会者／解答者／観客** の可視ラベルで表し、内部識別子（host/contestant/audience）を露出しない。ラベルは単一定義から供給する。

```typescript
// src/game_state/role_labels.ts
export type Role = "host" | "contestant" | "audience";

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  host: "司会者",
  contestant: "解答者",
  audience: "観客",
};
```

- **禁止コピーパターン（全サーフェス共通）**: ①内部ロール識別子（host/contestant/audience）②内部イベント名（`accepting`／`answers_locked`／`answers_opened`／`answer_revealed`／`settlement_computed`／`tv_mode_changed` 等）③設定キー名（`MAX_TABLET_CONNECTIONS`／`JOIN_ACCESS_TOKEN`／`PUBLIC_BASE_URL`）④実装根拠・内部処理注記・環境前提⑤**権限境界の説明**（監査対象アクターの task が当該境界の管理でない面では露出しない。管理者は司会者のみ）⑥デモ/テスト/サンプル表記⑦生ファイルパス・`fallback` 等の内部語⑧接続数会計⑨`point`/`pt`/`点`。
- **プライバシー投影（クロスアクター可視性・サーフェス層強制）**: 解答者端末（`/tablet`）へ **他者の解答・残額・得点、出題本文、全体一覧を投影しない**（自分の残額と自分の送信済み状態のみ）。開示前（b 未配信）は他者解答をどのロールの端末にも表示しない。収集・表示する個人データは自己入力氏名と当日の解答・残額に限り、恒久的な事前氏名台帳を持たない。

| ロール | サーフェスで見える情報 | サーフェスで見せない情報 |
|---|---|---|
| 司会者 | 全進行状態・参加者一覧・全員の解答/残額・接続「◯/◯台」 | —（管理者面。ただし可視コピーは運用語で内部識別子/イベント名は出さない） |
| 観客 | 現 `tv_mode` の提示（b 以降のみ氏名＋解答、d/e で円建て残額表） | 開示前（b 未配信）の他者解答・生パス・内部語 |
| 解答者 | 問題番号・受付中/締切・自分の送信済み・**自分の残額（円）のみ** | **他者の解答/残額/得点・出題本文・全体一覧**（一切投影しない） |

### 2.9 サーフェス実装配置・モジュール指定子

- **格納先**: 制御盤面 `src/control_panel/`、タブレット面 `src/tablet/`、TV 面 `src/tv_display/`、参加受付面 `src/participants/`。可視ラベル `src/game_state/role_labels.ts`、金額文言 `src/scoring/currency.ts`。TV a モードの出題面解決（video→image→text）は `src/questions/`／`src/media/` の純関数（`resolveQuestionFace`）を経由し、TV 面は解決済み値のみ描画する（生パスを描画しない）。
- **モジュール指定子**: 全相対 import は `.js` 拡張子明示。type-only import・re-export も同一。例:

```typescript
// src/tv_display/render_settlement_table.ts
import { formatYen } from "../scoring/currency.js";
import { ROLE_LABELS } from "../game_state/role_labels.js";
import type { Role } from "../game_state/role_labels.js";
export { renderTvModeE } from "./render_totals.js";
```

- **config 出力禁止**: `package.json`・`package-lock.json`・`tsconfig.json`・`vitest.config.ts` は harness 所有につき本書は著さない。

### 2.10 非機能・検証ゲート整合

- **健全性ベースライン**: 全 HTTP 応答は **`< 500`**。満席・アクセス拒否・締切後送信・非 host 操作は 5xx ではなく業務ステータス（平易文／`connection_rejected`／`command_denied`）で表す。
- **同期反映**: 状態遷移の全端末反映（TV/タブレットの表示切替）は **p95 ≤ 2,000ms**（F-04 暫定ゲート）。
- **起動シーケンス（検証環境）**: `npm ci` → `npm run build` → `npm run start`。ベース URL（または `/healthz`）が `< 500` を返すまで **最大 60 秒**ポーリングしてから試験開始。`E2E_BASE_URL`（WS 昇格可能オリジン）・`PUBLIC_BASE_URL`・`MAX_TABLET_CONNECTIONS`・アクセス制御設定を検証環境値で注入。ブラウザ描画・禁止要素/禁止コピー走査は Playwright を import 駆動し、宣言・検証は Vitest。

### Operational Behavior Model

以下の単一 YAML ブロックが本書のサーフェス／導線／文言義務の権威的出典であり、実装計画と E2E 生成が共有する。運用状態遷移（`op_load_questions`／`op_propagate_deadline`／`op_compute_settlement` 等の安定 ID）は兄弟 `design:operational-behavior-model` が所有し、本書はそれらの「見え方」を検証する surface/copy 専用オペレーションを ID 一致で追加する。未確定は `boundary_cases` または §3 のフラグへ回し、発明しない。

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
      label: クラウドサーバ（realtime_sync 権威 / scoring / participants）
  operations:
    - id: op_render_control_panel_surface
      actor: host
      verb: render
      target: control_panel_surface
      trigger: 司会者が /control-panel を開く
      route: /control-panel
      ui_pattern: host_operational_console
      visible_to: [host]
      forbidden_actors: [contestant, audience]
      preconditions:
        - セッションのロールが host に確定している
      consumer_surfaces: [control_panel]
      expected_outcomes:
        - 制御盤に §2.7 の全司会者トリガーが司会者向け操作語で表示される
        - 制御盤に参加者一覧（自己入力氏名）と接続「◯/◯台」が表示される
        - 制御盤に参加用 QR が表示される
        - 制御盤に解答者用の数値入力送信面が存在しない
      boundary_cases:
        - 状態ラベルは運用語で表示（内部イベント名 answers_locked 等を出さない）
        - 副司会ロール導線は発明しない
      dod_obligations:
        - id: dod_cp_visible_host_triggers
          text: 制御盤に「問題を読み込む」「そこまで」「解答オープン！」「正解発表」「精算」「次へ」「戻る」「取消」および各モード個別ジャンプの操作要素が司会者向け操作語で存在する
        - id: dod_cp_no_contestant_input_face
          text: 制御盤に解答者用の数値入力送信面（+1/-1/+10/-10 と送信）が存在しない
        - id: dod_cp_shows_join_qr_and_roster
          text: 制御盤に参加用 QR と参加者一覧（自己入力氏名）が表示される
        - id: dod_cp_no_internal_leak
          text: 制御盤の可視文言に内部ロール識別子（host/contestant）・内部イベント名（answers_locked 等）・設定キー名・point/pt/点・デモ/テスト/サンプル表記が存在しない
    - id: op_render_tablet_surface
      actor: contestant
      verb: render
      target: tablet_surface
      trigger: 参加確定後の解答者が /tablet を開く
      route: /tablet
      ui_pattern: input_only_minimal
      visible_to: [contestant]
      forbidden_actors: [host, audience]
      preconditions:
        - 参加確定済み（participants に自分のレコードが存在）
      consumer_surfaces: [contestant_tablets]
      expected_outcomes:
        - /tablet の可視要素が問題番号・数値入力・送信・送信済み表示・自分の残額（円）に限られる
        - /tablet に他者情報・出題本文・全体一覧・司会者操作要素が存在しない
      boundary_cases:
        - ステッパは 0〜100 でクランプし 0 未満・100 超に振り切れない
        - 権限境界の説明文（なぜ操作できないか）は出さない
      dod_obligations:
        - id: dod_tablet_minimal_elements_only
          text: /tablet の可視要素が問題番号・数値入力（+1/-1/+10/-10）・送信・送信済み表示・自分の残額（円）に限られる
        - id: dod_tablet_no_others_info
          text: /tablet に他者の氏名・解答・残額・得点、出題本文、全体一覧が表示されない
        - id: dod_tablet_no_control_actions
          text: /tablet に締切・開示・正解発表・精算・モード切替・取消の操作要素が存在しない
        - id: dod_tablet_contestant_copy_only
          text: /tablet の可視文言が解答者向け（問題番号/送信/送信済み/あなたの残額◯◯円/受付中/締切）で、内部処理説明・権限境界説明・デモ/テスト用ラベル・内部イベント名・point/pt/点 が存在しない
    - id: op_render_join_surface
      actor: contestant
      verb: render
      target: join_surface
      trigger: 解答者が QR 経由で /join を開く
      route: /join
      ui_pattern: name_input_then_join
      visible_to: [contestant]
      preconditions:
        - 家族限定アクセス制御の判定結果が描画分岐に反映される
      consumer_surfaces: [join_page]
      expected_outcomes:
        - /join に氏名入力欄と「参加する」が表示される
        - /join に事前氏名台帳・端末番号割当の入力要素が存在しない
        - 未認証・未参加の /join に保護ナビ（制御盤操作等）が露出しない
        - 満席時・アクセス不可時は job-to-be-done 平易文が表示される
      boundary_cases:
        - 満席時 → 「ただいま満席のため参加できません」等の平易文（設定キー名・接続数会計・ロール識別子を出さない）
        - 分岐B 未認証 → 保護ナビを露出せずログインへ誘導
        - アクセス不可 → アクセス制御方式（トークン/認証）を露出しない平易文
      dod_obligations:
        - id: dod_join_name_input_and_cta
          text: /join にお名前入力欄と「参加する」が表示される
        - id: dod_join_no_protected_nav
          text: 未認証・未参加の /join に制御盤操作等の保護ナビが露出しない
        - id: dod_join_no_seat_ledger_ui
          text: /join に事前氏名台帳・端末番号割当の入力要素が存在しない
        - id: dod_join_full_plain_copy
          text: 満席時の /join に job-to-be-done 平易文が表示され、設定キー名・接続数会計・ロール識別子が露出しない
        - id: dod_join_access_denied_plain_copy
          text: アクセス拒否時の /join にアクセス制御方式（トークン/認証）や内部会計を露出しない平易文が表示される
    - id: op_render_tv_surface
      actor: system
      verb: render
      target: tv_surface
      trigger: TV が現在の game_state.tv_mode を描画する
      route: /tv
      ui_pattern: passive_display_five_modes
      visible_to: [audience]
      measurement_source: game_state.tv_mode と questions（a）と answers（b）と settlements/balances（d/e）
      consumer_surfaces: [tv_mode_a, tv_mode_b, tv_mode_c, tv_mode_d, tv_mode_e]
      expected_outcomes:
        - TV が a 出題面／b 氏名＋解答／c 正解値／d 6 列表／e 全問通算一覧の 5 モードを観客向け文言で表示する
        - b（解答オープン）未配信の間、他者の解答が TV に表示されない
        - TV にいかなる入力・操作要素も存在しない
      boundary_cases:
        - a: 動画パス有→動画 / 動画無・画像有→画像 / 双方無→テキスト（生パスは表示しない）
        - d の 6 列は 氏名/解答/誤差/増減円/ピタリ賞/残額 で増減円・残額は円建て
        - e: 10 問精算完了で残額最多を勝者として判別可能に提示
      dod_obligations:
        - id: dod_tv_five_modes
          text: TV が a 出題面／b 氏名＋解答／c 正解値／d 6 列表（氏名/解答/誤差/増減円/ピタリ賞/残額）／e 全問通算一覧の 5 モードを表示する
        - id: dod_tv_hide_before_disclosure
          text: b（解答オープン）未配信の間、TV に他者の解答が表示されない
        - id: dod_tv_no_path_or_internal_leak
          text: TV の表示に生ファイルパス（image_path/video_path の値）や fallback 等の内部語・内部イベント名が露出しない
        - id: dod_tv_audience_copy_no_control
          text: TV にいかなる入力・操作要素も存在せず、可視文言が観客向けで司会者操作語を含まない
        - id: dod_tv_winner_visible_e
          text: e モードで残額最多のプレイヤーが勝者として判別可能に表示される
    - id: op_enforce_currency_yen_copy
      actor: system
      verb: enforce
      target: currency_copy
      trigger: 金額を含む面・応答（TV d/e・タブレット残額・API）を描画/生成する
      measurement_source: formatYen() と settlements/balances の整数円値
      consumer_surfaces: [tv_mode_d, tv_mode_e, contestant_tablets]
      expected_outcomes:
        - 金額はすべて円建てで表示され point/pt/点 の語が存在しない
        - 得点を点数化・ポイント化する文言が存在しない
      boundary_cases:
        - 増減 -100/-500 も円建て（例 -100円 / -500円）
        - ピタリ賞 +1000 も円建て（+1000円）
      dod_obligations:
        - id: dod_currency_yen_all_surfaces
          text: TV(d/e) の金額表示・タブレットの自残額表示・API 応答・settlements/balances がすべて円建てで表示される
        - id: dod_currency_no_point_token
          text: 全サーフェスの可視文言と API 応答に point/pt/点 の語が存在しない
        - id: dod_currency_no_pointization_phrase
          text: 得点を点数化・ポイント化する文言（◯◯点・◯◯pt 等）が存在せず現金感を薄めない
    - id: op_map_role_labels_in_copy
      actor: system
      verb: map
      target: role_labels
      trigger: 可視文言にロール名を表示する
      measurement_source: src/game_state/role_labels.ts の ROLE_LABELS
      consumer_surfaces: [control_panel, tv_display, contestant_tablets, join_page]
      expected_outcomes:
        - ロールは司会者/解答者/観客の可視ラベルで表示される
        - 内部識別子 host/contestant/audience が可視文言に露出しない
      dod_obligations:
        - id: dod_labels_business_facing
          text: 全サーフェスの可視文言でロールが司会者/解答者/観客の可視ラベルで表され、内部識別子 host/contestant/audience が露出しない
        - id: dod_labels_single_source
          text: 可視ロールラベルが単一のラベル定義（src/game_state/role_labels.ts）から供給される
```

### 2.11 テスト戦略との整合（Vitest / レイアウト / モジュール指定子）

- ユニット（可視ラベル・金額文言）は `tests/game_state/*.test.ts`・`tests/scoring/*.test.ts`。サーフェス描画・禁止要素/禁止コピー走査の E2E は `tests/e2e/*.browser.spec.ts`（Playwright を import 駆動・宣言/検証は Vitest）、共有ヘルパは `tests/e2e/helpers/`（`.js` 参照）。`package.json`・`package-lock.json`・`tsconfig.json`・`vitest.config.ts` は harness 所有につき著さない。Vitest 以外（`node:test` 等）をランナーに用いない。

```typescript
// tests/game_state/role_labels.test.ts
import { describe, it, expect } from "vitest";
import { ROLE_LABELS } from "../../src/game_state/role_labels.js";

describe("可視ロールラベル（SCO・内部識別子非露出）", () => {
  it("内部識別子を司会者/解答者/観客の可視ラベルへ写す", () => {
    expect(ROLE_LABELS.host).toBe("司会者");
    expect(ROLE_LABELS.contestant).toBe("解答者");
    expect(ROLE_LABELS.audience).toBe("観客");
  });
  it("可視ラベルに内部識別子 host/contestant/audience を含まない", () => {
    for (const label of Object.values(ROLE_LABELS)) {
      expect(label).not.toMatch(/host|contestant|audience/i);
    }
  });
});
```

```typescript
// tests/scoring/currency.test.ts
import { describe, it, expect } from "vitest";
import { formatYen } from "../../src/scoring/currency.js";

describe("金額文言（SCO-4・円建て固定・点化禁止）", () => {
  it("整数円を円で整形し point/pt/点 を含まない", () => {
    const shown = [10_000, -100, -500, 1_000].map(formatYen).join(" ");
    expect(shown).toContain("円");
    expect(shown).not.toMatch(/point|pt|点/i);
  });
  it("非整数の金額は文言化しない（整数円のみ）", () => {
    expect(() => formatYen(50.5)).toThrow();
  });
});
```

```typescript
// tests/e2e/tablet_surface.browser.spec.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "playwright";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); });

describe("タブレット面の禁止要素・禁止コピー（SCO-2）", () => {
  it("入力専用要素のみで他者情報・司会者操作語・点化文言が無い", async () => {
    const page = await browser.newPage();
    await page.goto(`${BASE_URL}/tablet`);
    const body = (await page.textContent("body")) ?? "";
    // 禁止コピー: 司会者操作語・内部イベント名・point/pt/点
    expect(body).not.toMatch(/そこまで|解答オープン|正解発表|精算|answers_locked/);
    expect(body).not.toMatch(/point|pt|点/i);
    // 禁止導線: 締切/開示/モード切替の操作要素が無い
    expect(await page.locator('[data-op="lock"],[data-op="open"],[data-op="switch"]').count()).toBe(0);
    await page.close();
  });
});
```

**MECE サーフェス／コピー義務の網羅**: 本書は 4 面を次の軸で網羅する — 目的整合（各面の purpose と allowed/forbidden の一致）、可視トリガー（`dod_cp_visible_host_triggers`）、禁止要素の不在（`dod_tablet_no_control_actions`／`dod_tablet_no_others_info`／`dod_tv_audience_copy_no_control`）、開示前伏せ（`dod_tv_hide_before_disclosure`）、内部露出の禁止（`dod_cp_no_internal_leak`／`dod_tv_no_path_or_internal_leak`）、エントリ面の保護ナビ非露出（`dod_join_no_protected_nav`）、平易文（`dod_join_full_plain_copy`／`dod_join_access_denied_plain_copy`）、可視ラベル写像（`dod_labels_business_facing`／`dod_labels_single_source`）、円建て・点化禁止（`dod_currency_no_point_token`／`dod_currency_no_pointization_phrase`）。

---

## 3. Open Questions

壁打ち（要件定義）フェーズはクローズ済で殿判断待ちの論点は残っていない。以下は画面・導線・文言に関して実装組み立てフェーズで MAS が決める選定、推測実装せず殿判断を仰ぐ点、検証ゲートで暫定運用中のフラグである。いずれも「推奨なし」「要検討」「TBD」の空白は残さず、確定した制約・既定機構・暫定ゲート値を明記する。

### 3.1 実装組み立てフェーズの選定（MAS 決定・殿判断不要）

| 項目 | 決定/既定 | 制約・選定軸 |
|---|---|---|
| 可視ラベルの単一供給 | ロールラベルは `src/game_state/role_labels.ts` の `ROLE_LABELS` から全サーフェスへ供給 | 内部識別子非露出（`dod_labels_single_source`）。司会者/解答者/観客の 3 語で固定。 |
| 金額整形の単一点 | `src/scoring/currency.ts` の `formatYen` を TV(d/e)・タブレット残額の唯一の整形点とする | 円建て固定・点化禁止（`dod_currency_*`）。整数円のみ受理。 |
| 禁止コピー走査の実装方式 | ブラウザ描画テキストを Playwright で取得し Vitest で正規表現走査（`point|pt|点`／内部イベント名／設定キー名） | UI 実装に依らず面ごとに走査。宣言/検証は Vitest（`node:test` 不使用）。 |
| 状態表示の運用語化 | 制御盤・タブレットの状態表示は運用語（受付中/締切/解答オープン/正解発表/精算）で表し内部イベント名を出さない | `dod_cp_no_internal_leak`／`dod_tablet_contestant_copy_only`。 |
| TV a の出題面描画 | `resolveQuestionFace`（`src/questions/`・`src/media/`）が解決した値のみ TV 面へ渡し生パスを描画しない | `dod_tv_no_path_or_internal_leak`。動画優先→画像→テキスト。 |

### 3.2 F028 エスカレーション（推測実装しない）

- **取消操作の可視表現（論点7・F-03）**: 「取消」ボタンは制御盤（host）のみに存置し初版から可視化する（`dod_undo_host_only`・確定）。取消後に **どの面のどの表示が巻き戻るか**（TV を直前モードへ戻すか／タブレットの締切表示を解除するか）は巻き戻し範囲（F-03）に従属して未確定ゆえ発明せず、選択肢を添えて F028。可視ボタンの存在と host 限定は確定として実装・検証し、巻き戻し後の面表示は E2E で `test.fixme()`。
- **満席・アクセス不可の文面確定（周辺）**: 平易文の意図（設定キー名・接続数会計・アクセス方式を出さない）は確定だが、正確な最終文言（例「ただいま満席のため参加できません」）は掲示テキストの確定を要する場合に選択肢を添えて F028。禁止コピーの不在（`dod_join_full_plain_copy`）は文言差に依らず検証必須。

### 3.3 検証ゲートで暫定運用中のフラグ（設計義務の欠落・発明せず flag）

- **F-04（同期反映レイテンシ SLA）**: サーフェス表示切替（TV モード同期・タブレット締切同期）の全端末反映は **p95 ≤ 2,000ms** を暫定テストゲートとして扱い、SLA 確定時に更新する。
- **F-05（家族限定アクセス制御の面挙動）**: 分岐 A（`JOIN_ACCESS_TOKEN`）実装時はトークン不一致で `/join` に平易な参加不可文を検証、分岐 B（認証）実装時は未認証で保護ナビを露出せずログイン→リダイレクト→氏名入力描画を検証、いずれも未実装なら該当ブラウザテストを `test.fixme()`。**未構成時に参加を許可しない**（無制御公開を成立させない）ことと **保護ナビ非露出** は値に依らず検証必須。無制御公開のまま出荷はリリース不可。
- **F-06'（TV a 動画の再生可否表示）**: 動画パス存在検証までを義務とし、本番ブラウザで再生不可なコンテナ/コーデックが混入した場合の TV a のフォールバック表示（動画不可→画像/テキストへ退避するか、静止コマ表示か）は本設計に固定値が無いため発明せず、入稿検証の拡張対象としてフラグする。現時点では `<video>` が再生可能な形式の選定を軸とし、生パス・内部語の非露出（`dod_tv_no_path_or_internal_leak`）は形式に依らず検証必須。
