---
codd:
  node_id: design:question-media-intake-design
  type: design
  depends_on:
  - id: design:system-design
    relation: depends_on
    semantic: technical
  - id: design:data-model-design
    relation: depends_on
    semantic: technical
  depended_by:
  - id: design:operational-behavior-model
    relation: depends_on
    semantic: technical
  - id: test:test-strategy
    relation: depends_on
    semantic: verification
  conventions:
  - targets:
    - module:questions
    reason: 問題は事前ファイル読込で DB 登録・保持し、当日その場入力方式は採らない（E-1）。違反時リリース不可。
  - targets:
    - module:media
    reason: a 出題面の解決は『動画 →（無ければ）画像 →（無ければ）テキスト』の3段フォールバック順を厳守する（N-2）。違反時リリース不可。
  - targets:
    - module:questions
    - module:scoring
    - module:game_flow
    reason: ゲーム進行中も問題・正解の双方をライブ編集でき、編集は DB 更新として反映され、開示済み問題では自動再採点を誘発する（E-3/E-3残）。違反時リリース不可。
  modules:
  - questions
  - media
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
      trigger: 制御盤で事前問題ファイル（JSON）の読込を実行
      route: /control-panel
      ui_pattern: file_pick_then_load
      forbidden_actors:
      - contestant
      preconditions:
      - game_state.phase が lobby またはライブ編集フェーズ（in_progress のライブ編集中）
      - 参照される全メディアが所定フォルダ（QUESTION_MEDIA_ROOT）配下に事前配置済み
      measurement_source: 事前問題ファイル（JSON 配列 QuestionIntakeRecord[]）
      durable_state: questions テーブル（text / image_path / video_path / correct_value）
      readback: ランタイム出題は questions テーブルから供給（ファイル再読込に依存しない）
      visible_to:
      - host
      expected_outcomes:
      - 各問が questions テーブルへ登録される
      - correct_value が 0〜100 の整数で保持される
      - image_path / video_path は任意（NULL 許容）で保持される
      - 検証エラーが 1 件でもあれば 1 問も登録されない（全 or 無）
      boundary_cases:
      - correct_value 0/100 は登録可
      - correct_value -1/101/50.5 は登録拒否
      - image_path/video_path 未指定 → NULL で登録可
      - 宣言された動画/画像パスに所定フォルダ配下の実体が無い → 当該入稿は拒否
      dod_obligations:
      - id: dod_load_persist
        text: 読み込んだ全問が questions に登録され、再取得で登録時と同一の text と correct_value を返す
      - id: dod_load_runtime_from_db
        text: 出題面の解決元は questions テーブルであり、問題ファイルの再読込に依存しない
      - id: dod_load_media_paths_optional
        text: image_path と video_path は未指定でも登録でき NULL として保持される
      - id: dod_load_correct_value_integer
        text: correct_value が 0〜100 の整数以外では登録が拒否される（入稿検証とサーバ検証と DB CHECK を含む）
      - id: dod_load_no_adhoc_entry
        text: 出題内容の初期入稿は事前ファイル読込のみで、当日その場で問題集をゼロから手入力する UI/API が存在しない
      - id: dod_load_media_prevalidated
        text: 宣言された image_path/video_path に所定フォルダ配下の実体が無い場合は問題番号を添えて入稿が拒否され questions
          に入らない
      - id: dod_load_all_or_nothing
        text: 検証エラーが 1 件でもある入稿では questions が 1 行も追加されない
      - id: dod_load_host_only
        text: 読込は role host のみ発動でき contestant からの読込コマンドは 401/403 で拒否される
    - id: op_switch_tv_mode
      actor: host
      verb: switch
      target: tv_mode
      trigger: 制御盤の「次へ」「戻る」または各モード個別ジャンプで a モードへ切替
      route: /control-panel
      ui_pattern: next_back_jump
      forbidden_actors:
      - contestant
      measurement_source: questions.video_path / image_path / text（当該問）
      durable_state: game_state.tv_mode
      consumer_surfaces:
      - tv_mode_a
      expected_outcomes:
      - a モードは動画→画像→テキストの 3 段で出題面を解決する
      - メディアパスのライブ編集後は次の a モード描画に反映される
      boundary_cases:
      - 動画パス有 → 動画（画像有無に関わらず動画優先）
      - 動画無・画像有 → 画像
      - 双方無 → テキスト
      dod_obligations:
      - id: dod_tv_a_fallback
        text: a モードが video_path→image_path→text の優先順で出題面を解決する
      - id: dod_tv_a_reflects_live_edit
        text: メディアパスのライブ編集後に a モードを再描画すると解決される出題面が編集後の規定順に従う
      - id: dod_tv_a_no_path_leak
        text: a モードの表示に生のファイルパス文字列や fallback 等の内部語が露出しない
    - id: op_live_edit_correct
      actor: host
      verb: edit
      target: question_or_correct_value
      trigger: 制御盤のライブ編集 UI で問題文・正解値・画像/動画パスを更新
      route: /control-panel
      ui_pattern: inline_edit_then_save
      forbidden_actors:
      - contestant
      preconditions:
      - 対象問が questions に存在する
      durable_state: questions テーブル更新（text / image_path / video_path / correct_value）
      readback: DB 再取得で編集後の値を返す
      visible_to:
      - host
      expected_outcomes:
      - 問題文・正解・メディアパスを進行中に編集でき questions に永続する
      - 画像/動画パスの編集は a モードの出題面解決に反映される
      - correct_value の編集かつ開示済み（c 以降）のときのみ自動再採点を誘発する
      boundary_cases:
      - text のみ編集 → 再採点は走らない
      - image_path/video_path のみ編集 → 再採点は走らない・a モード解決のみ変化
      - correct_value 編集かつ c 未到達 → 再採点は走らない
      - correct_value 編集かつ c 以降 → 再採点が走る
      dod_obligations:
      - id: dod_edit_persist
        text: 進行中に編集した問題文と正解値が questions に永続し再取得で読み戻せる
      - id: dod_edit_media_persist
        text: 進行中に編集した image_path/video_path が questions に永続し再取得で読み戻せる
      - id: dod_edit_media_face_follows
        text: 動画パスを付与/除去すると当該問の a モード出題面が規定順（video→image→text）で切り替わる
      - id: dod_edit_correct_range_guard
        text: 正解値の編集も 0〜100 整数のみ受理し範囲外はサーバと DB CHECK で拒否される
      - id: dod_edit_host_only
        text: ライブ編集は role host のみ発動でき contestant からの編集コマンドは 401/403 で拒否される
    - id: op_auto_rescore
      actor: system
      verb: rescore
      target: balances
      trigger: 開示済み（rounds.stage が answer_revealed 以降）の問題で correct_value をライブ編集
      preconditions:
      - 当該問の rounds.stage が answer_revealed 以降
      - ライブ編集の patch が correctValue を含む
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
      - c 到達問の correct_value 訂正 → 再採点が走る
      - c 未到達（isDisclosed 偽）の correct_value 編集 → 再採点は走らない（境界外）
      - text/メディアのみ編集 → 再採点は走らない（correct_value 不変）
      dod_obligations:
      - id: dod_rescore_after_c
        text: rounds.stage が answer_revealed 以降で正解を直すと settlements と balances が再計算され各人の残額へ即時反映される
      - id: dod_rescore_no_before_c
        text: rounds.stage が answer_revealed 未満の正解編集では settlements と balances が変化しない
      - id: dod_rescore_only_on_correct_value
        text: text または image_path/video_path のみの編集では再採点が走らず balances が不変である
      - id: dod_rescore_d_sync
        text: rounds.stage が settlement_computed の問の正解訂正で balances 差分が再計算され TV の d
          と e が同時更新される
      - id: dod_rescore_matches_full_recompute
        text: 差分更新後の balances が answers と correct_value からの全再計算と一致する
---

# 問題・出題メディア入稿設計（ファイル読込→DB・動画/画像/テキスト・ライブ編集）

## 1. Overview

本書は `save-money-switcher`（フジテレビ『賞金先渡しクイズ SAVE MONEY』方式を家族で遊ぶクイズ操作盤）の**問題・出題メディア入稿設計**であり、`design:system-design`（クラウド WEB アプリ・アーキテクチャ）と `design:data-model-design`（データモデル）を上位の技術的真実源として、**事前問題ファイルの読込 → DB 登録**、**出題メディア（動画／画像／テキスト）の 3 段フォールバック解決**、**ゲーム進行中のライブ編集と開示済み問題の自動再採点連携**を確定する。対象モジュールは `module:questions`（`src/questions/`）・`module:media`（`src/media/`）と、再採点連携で連結する `module:scoring`（`src/scoring/`）・`module:game_flow`（`src/game_state/`）である。ここに記す確定値・不変条件に反する成果物は**リリース不可（release-blocking）**として扱う。

### 1.1 本書がカバーする範囲

- **入稿（`module:questions`・E-1）**: 出題内容の初期入稿は**事前問題ファイル読込のみ**。当日その場で問題集をゼロから手入力する UI/API は持たない。読み込んだ各問は `questions` テーブルへ登録し、**ランタイム出題は DB から供給**する（ファイル再読込に依存しない）。
- **出題メディア解決（`module:media`・N-2）**: TV a モードの出題面は**動画 →（無ければ）画像 →（無ければ）テキスト**の 3 段フォールバックを**順序厳守**で解決する。動画・画像は問題ファイルにパスを記載し、所定フォルダへ事前配置する。
- **ライブ編集＋自動再採点（`module:questions` / `module:scoring` / `module:game_flow`・E-3/E-3 残）**: 進行中も**問題文・正解値・メディアパスの双方**を制御盤から編集でき、編集は `questions` への DB 更新として永続・読み戻せる。**開示済み（c 正解発表以降）の問題で正解値を編集**すると `module:scoring` の自動再採点を誘発し、`settlements`・`balances` を差分再計算して TV d/e を同時更新する。

### 1.2 リリースブロッキング規約と本書での具体化

| # | 対象 | 不変条件（要旨） | 本書での具体化箇所 | 準拠の要点 |
|---|---|---|---|---|
| QM-1 | `module:questions` | 問題は事前ファイル読込で DB 登録・保持し、当日その場入力方式は採らない（E-1） | §2.1・§2.2・§2.3・§2.9 | 入稿は事前ファイル→`questions`。ランタイムは DB から供給し、ファイル再読込に依存しない。ゼロから手入力する初期入稿 UI/API を持たない。 |
| QM-2 | `module:media` | a 出題面の解決は『動画 →（無ければ）画像 →（無ければ）テキスト』の 3 段フォールバック順を厳守（N-2） | §2.4・§2.7 | `resolveQuestionFace` が `videoPath → imagePath → text` の順で必ず解決。順序入替・段飛ばしを許さない純関数として固定。 |
| QM-3 | `module:questions` / `module:scoring` / `module:game_flow` | ゲーム進行中も問題・正解の双方をライブ編集でき、DB 更新として反映され、開示済み問題では自動再採点を誘発（E-3/E-3 残） | §2.5・§2.6・§2.7 | `applyLiveEdit` が `questions.updateContent` を永続化し、`correct_value` 変更かつ `isDisclosed(rounds.stage)` 真のときのみ `module:scoring` の再採点を起動する。 |

上位設計・データモデルから継承する不変条件も本書で担保する: **DB 保持のランタイム供給**（INV-2/DM-1）、**0〜100 整数の三層防衛**（UI＋サーバ＋DB `CHECK`。正解値の入稿・編集にも適用）、**円建て固定**（`point`/`pt`/`点` 禁止・再採点結果も円で表す）、**ロール境界**（`role: host` のみが入稿・編集を起こす・§2.9）、**ホスト PC をサーバ／DB にしない**（永続化はクラウド DB・メディアはクラウド側配信）。

### 1.3 実装・ツールチェーン前提（scaffold 固定・釈義不可）

- **実装言語 = TypeScript のみ。** 本書のドメイン型・パーサ・リポジトリ・ファイルパス・依存参照はすべて TypeScript 慣行のみを用いる。他言語の拡張子・マニフェスト・ツールは例示・フォールバックとしても登場させない。入稿ファイル形式は **JSON** を既定とし（`src/questions/intake_reader.ts` が読取り）、これは Node ランタイムがネイティブに解釈できるデータ形式であって別言語ツールチェーンではない。
- **テストランナー = Vitest（固定・release-blocking のグラウンドトゥルース）。** 入稿・メディア解決・ライブ編集・再採点の受け入れは Vitest 自身の宣言 API（`import { describe, it, expect } from "vitest";`）で記述する。「ランタイム依存を最小化する」方針は**出荷コードのランタイム依存**にのみ及び、テストランナーには及ばない。依存数の哲学を根拠に別フレームワークや Node 組み込み `node:test` を用いてはならない。ブラウザ検証（TV a モード描画）は Playwright を**ライブラリ import**（`import { chromium } from "playwright";`）して駆動し、宣言・検証は Vitest で行う。
- **モジュール解決 = NodeNext/Node16。** すべての相対 import は**出力される `.js` ファイル名を明示した拡張子**を伴う（`import { resolveQuestionFace } from "../media/resolve_question_face.js";`。`"./x"`・`"./x.ts"` は不可）。default/namespace import・re-export・type-only import（`import type { Question } from "../questions/question.js";`）も同一規約。拡張子欠落は TS2835 でコンパイル不能。
- **レイアウト契約（output-path fence 強制）。** 入稿パーサ・メディア解決・ライブ編集オーケストレータ等のソースは**必ず `src/` 配下**（サブディレクトリ `src/questions/`・`src/media/` 等）、テストは**必ず `tests/` 配下**（`test/`・`spec/`・`specs/` を発明しない。サブディレクトリ `tests/questions/`・`tests/media/` は可）。`package.json`・`package-lock.json`・`tsconfig.json`・`vitest.config.ts` は harness scaffold 所有につき、本書はこれらを成果物として出力・宣言しない。

### 1.4 アクター向けサーフェス／コピー義務

本書が供給・変更するサーフェスとロール（内部識別子 → 可視ラベル）: `role: host` → **司会者**、`role: contestant` → **解答者**、観客（TV 視聴者）。可視コピーには**可視ラベル**（司会者／解答者）を用い、内部識別子（host/contestant）・実装根拠・環境前提・入稿の内部処理名を露出させない。全サーフェス共通で `point`／`pt`／`点` を禁止パターンとし、金額は「円」で表す。

| サーフェス | ルート | 主対象アクター | 目的 | 許可アクション | 禁止アクション | 必須の可視コピー意図 | 禁止コピー |
|---|---|---|---|---|---|---|---|
| 制御盤（入稿・ライブ編集面） | `/control-panel` | 司会者 | 問題ファイル読込・問題文/正解値/画像パス/動画パスのライブ編集 | ファイル選択と読込実行・各問の編集と保存・入稿検証結果の確認 | 解答者の入力操作面の露出・入稿検証の生スタックトレース出力 | 「問題ファイルを読み込む」「問題を編集」「正解を編集」等の司会者向け操作語・**未配置メディアを問題番号で示す**検証結果（例: 「問題3の動画が所定フォルダに未配置です」） | 内部 role 識別子(host/contestant)・`intake_validator` 等の内部処理名・テスト/デモ/サンプル問題ラベル・`point`/`pt`/`点` |
| TV（a 出題面） | `/tv` | 観客 | 解決された出題面（動画 or 画像 or テキスト）の提示 | 表示のみ（受動） | いかなる入力・操作要素・生パス文字列・フォールバック内部理由の露出 | 解決された出題面そのもの（動画再生 / 画像 / テキスト本文） | 実装ノート・`fallback`/`video_path` 等の内部語・生のファイルパス文字列・`point`/`pt`/`点` |
| タブレット | `/tablet` | 解答者 | 数値入力（**出題内容は出さない**） | 自分の数値入力・送信・自分の残額閲覧 | **出題内容（問題文・メディア）の表示/埋め込み/リンク**・他者情報の表示 | 問題番号・数値入力・送信済み表示・自分の残額（**円**） | 出題本文・出題メディア・他者情報・司会者操作語・`point`/`pt`/`点` |

- **入稿検証結果のコピー**: メディア未配置・正解値レンジ外等の検証エラーは、司会者の job-to-be-done（配置を直す・値を直す）に沿った文言で**問題番号を添えて**提示する。例外オブジェクトや内部関数名を生出力しない。
- **TV a モードの非露出**: 出題面は解決結果（動画・画像・テキスト）のみを描画し、どの段で解決したか・元パス文字列・「fallback」等の内部語を露出しない。
- **タブレットへの出題内容非流出（プライバシー境界）**: タブレット向け読みモデルは出題内容とメディアを一切含めない。メディア資産は TV／制御盤サーフェスの範囲でのみ参照される（§2.9）。

---

## 2. Architecture

### 2.1 入稿パイプライン全体像（`module:questions`・QM-1）

事前問題ファイル（JSON）を読み、検証し、`questions` テーブルへ一括登録する単一方向のパイプラインとする。ランタイム出題は**常に `questions` から供給**し、ファイル再読込に依存しない。

```
事前問題ファイル(JSON 配列)
        │  src/questions/intake_reader.ts        … ファイル読取り→QuestionIntakeRecord[]
        ▼
   検証(src/questions/intake_validator.ts)       … 問題番号1-10/重複・text非空・
        │                                          correct_value 0-100整数・
        │                                          宣言メディアの所定フォルダ実体確認
        ▼  （全 or 無：1件でもエラーなら0問登録）
   登録(src/questions/questions_repository.ts)    … bulkInsert → questions テーブル
        │
        ├──▶ ランタイム出題: getByNumber / listAll （DB から供給・ファイル非依存）
        │        └─ src/media/resolve_question_face.ts（a モード: 動画→画像→テキスト）
        │
        └──▶ ライブ編集: updateContent（進行中の DB 更新・§2.5）
                 └─ correct_value 変更 かつ 開示済み → src/scoring 自動再採点（§2.6）
```

- **QM-1 準拠（当日その場入力の不採用）**: 初期入稿の唯一の機構は事前ファイル読込であり、問題集をゼロから手入力する UI/API を提供しない。動画・画像は当日その場アップロードではなく、問題ファイルへのパス記載＋所定フォルダへの事前配置に依存する。
- **全 or 無の入稿**: 検証エラーが 1 件でも出た入稿は `questions` を 1 行も変更しない。これによりランタイムが常に一貫した DB から出題できる（部分登録による欠落問を防ぐ）。
- **再読込の冪等性**: `op_load_questions` の前提は「ゲーム未開始またはライブ編集フェーズ」であり、進行中の再読込も許す。再読込は `question_number`（`unique`）をキーとした upsert として振る舞い、重複行を作らない。再読込により**開示済み問題の `correct_value` が変わる**場合は、手動ライブ編集と同一の再採点ゲート（§2.6）を通す。

### 2.2 事前問題ファイル形式と入稿検証（QM-1・0〜100 整数の一層目）

入稿ファイルは `QuestionIntakeRecord` の JSON 配列とする。フィールドは TypeScript ドメインと同じ camelCase で、DB カラム（snake_case）へ §2.3 のとおり対応させる。

```json
[
  { "questionNumber": 1, "text": "日本の都道府県の数は？", "correctValue": 47 },
  { "questionNumber": 2, "text": "この映像の最高速度は時速何km？", "correctValue": 80, "videoPath": "q02-speed.mp4" },
  { "questionNumber": 3, "text": "この写真の人数は？", "correctValue": 12, "imagePath": "q03-crowd.png" }
]
```

```typescript
// src/questions/intake_record.ts
export interface QuestionIntakeRecord {
  questionNumber: number;      // 1..10（DB: question_number）
  text: string;                // 問題文（DB: text）
  correctValue: number;        // 0..100 整数（DB: correct_value）
  imagePath?: string | null;   // 任意・所定フォルダ配下の相対パス（DB: image_path）
  videoPath?: string | null;   // 任意・所定フォルダ配下の相対パス（DB: video_path）
}
```

- **検証項目**: `questionNumber` は 1〜10 の整数かつ一意、`text` は非空、`correctValue` は `isAnswerScore`（0〜100 整数）、宣言された `imagePath`／`videoPath` は**所定フォルダ配下に実体が存在**すること。宣言パスに実体が無い場合、a モードのフォールバックは「パスの有無」で分岐するため、そのまま登録すると a モードが空画面になる。これを防ぐため**入稿時に実体存在を検証**し、未配置は問題番号を添えて拒否する。
- **正解値の一層目防衛**: 入稿検証は `src/scoring/answer_score.ts` の `isAnswerScore` を共有し、-1/101/50.5 等を拒否する（UI／サーバ／DB `CHECK` の三層防衛と整合。§2.9）。

```typescript
// src/questions/intake_validator.ts
import type { QuestionIntakeRecord } from "./intake_record.js";
import { isAnswerScore } from "../scoring/answer_score.js";

export interface MediaPresence {
  exists(relativePath: string): boolean; // 所定フォルダ配下の実体確認（fs 抽象・テスト差替可）
}
export interface IntakeIssue {
  questionNumber: number;
  field: "question_number" | "text" | "correct_value" | "image_path" | "video_path";
  reason: string;
}

export function validateIntake(
  records: readonly QuestionIntakeRecord[],
  media: MediaPresence,
): IntakeIssue[] {
  const issues: IntakeIssue[] = [];
  const seen = new Set<number>();
  for (const r of records) {
    if (!Number.isInteger(r.questionNumber) || r.questionNumber < 1 || r.questionNumber > 10) {
      issues.push({ questionNumber: r.questionNumber, field: "question_number", reason: "1〜10 の整数のみ" });
    }
    if (seen.has(r.questionNumber)) {
      issues.push({ questionNumber: r.questionNumber, field: "question_number", reason: "問題番号が重複" });
    }
    seen.add(r.questionNumber);
    if (typeof r.text !== "string" || r.text.trim() === "") {
      issues.push({ questionNumber: r.questionNumber, field: "text", reason: "問題文は空にできない" });
    }
    if (!isAnswerScore(r.correctValue)) {
      issues.push({ questionNumber: r.questionNumber, field: "correct_value", reason: "正解値は 0〜100 の整数のみ" });
    }
    if (r.videoPath != null && !media.exists(r.videoPath)) {
      issues.push({ questionNumber: r.questionNumber, field: "video_path", reason: "動画が所定フォルダに未配置" });
    }
    if (r.imagePath != null && !media.exists(r.imagePath)) {
      issues.push({ questionNumber: r.questionNumber, field: "image_path", reason: "画像が所定フォルダに未配置" });
    }
  }
  return issues;
}
```

```typescript
// src/questions/load_questions.ts
import type { QuestionsRepository } from "./questions_repository.js";
import type { Question } from "./question.js";
import type { QuestionIntakeRecord } from "./intake_record.js";
import { validateIntake, type MediaPresence, type IntakeIssue } from "./intake_validator.js";

export interface LoadResult { loaded: number; issues: readonly IntakeIssue[]; }

export async function loadQuestions(
  records: readonly QuestionIntakeRecord[],
  media: MediaPresence,
  repo: QuestionsRepository,
  newId: () => string,
): Promise<LoadResult> {
  const issues = validateIntake(records, media);
  if (issues.length > 0) return { loaded: 0, issues }; // 全 or 無：1 件でも問題があれば 0 問登録
  const questions: Question[] = records.map((r) => ({
    id: newId(),
    questionNumber: r.questionNumber,
    text: r.text,
    imagePath: r.imagePath ?? null,
    videoPath: r.videoPath ?? null,
    correctValue: r.correctValue,
  }));
  await repo.bulkInsert(questions);
  return { loaded: questions.length, issues: [] };
}
```

### 2.3 `questions` テーブルとリポジトリ（データモデル継承・QM-1）

永続構造は `design:data-model-design` §2.2 の `questions` を本書の入稿・編集の権威とする。camelCase ドメイン ↔ snake_case カラムの対応を明示する。

| ドメイン（camelCase） | DB カラム（snake_case） | 型 | 制約・責務 |
|---|---|---|---|
| `id` | `id` | text (PK) | 問の安定識別子 |
| `questionNumber` | `question_number` | integer | 1〜10、`unique` |
| `text` | `text` | text | 問題文 |
| `imagePath` | `image_path` | text NULL | 任意・所定フォルダ配下の相対パス |
| `videoPath` | `video_path` | text NULL | 任意・問題ファイル記載＋所定フォルダへ事前配置 |
| `correctValue` | `correct_value` | integer | **0〜100 整数**（`CHECK 0<=correct_value<=100`） |

```typescript
// src/questions/questions_repository.ts
import type { Question } from "./question.js";

export type QuestionContentPatch = Partial<
  Pick<Question, "text" | "imagePath" | "videoPath" | "correctValue">
>;

export interface QuestionsRepository {
  bulkInsert(questions: readonly Question[]): Promise<void>;   // 入稿（upsert by question_number）
  getByNumber(questionNumber: number): Promise<Question | null>; // ランタイム出題供給
  listAll(): Promise<readonly Question[]>;
  updateContent(id: string, patch: QuestionContentPatch): Promise<Question>; // ライブ編集
}
```

- **QM-1 準拠（DB 供給）**: ランタイム出題は `getByNumber`／`listAll` を通じ `questions` からのみ供給する。問題ファイルは登録の入力に過ぎず、出題時にファイルを再読込しない。
- **image_path/video_path 任意（NULL 許容）**: メディア無しの問題は両カラム NULL で登録・出題でき、a モードはテキストへフォールバックする（§2.4）。

### 2.4 メディア配置と 3 段フォールバック解決（`module:media`・QM-2）

出題メディアの実体は**所定フォルダ（メディアルート）**へ事前配置し、`questions.image_path`／`video_path` はそのルート配下の相対パスを保持する。ルートは `src/config/` の単一解決点（環境変数 `QUESTION_MEDIA_ROOT`、既定 `./question-media`）で解決し、ハードコードしない（config 規約と整合）。

```typescript
// src/config/media_root.ts
import type { ConfigSource } from "./connection_limit.js"; // 既存の config 抽象を共有

export const DEFAULT_QUESTION_MEDIA_ROOT = "./question-media";

export function resolveQuestionMediaRoot(source: ConfigSource): string {
  const raw = source.read("QUESTION_MEDIA_ROOT");
  return raw !== undefined && raw.trim() !== "" ? raw : DEFAULT_QUESTION_MEDIA_ROOT;
}
```

**3 段フォールバック（N-2・順序厳守・純関数）**: a モードの出題面は `videoPath → imagePath → text` の順で必ず解決する。順序入替・段飛ばしを許さない。解決は `questions` の 3 フィールドのみで決まり、外部状態に依存しない。

```typescript
// src/media/resolve_question_face.ts
import type { Question } from "../questions/question.js";

export type QuestionFaceKind = "video" | "image" | "text";
export interface QuestionFace { kind: QuestionFaceKind; source: string; }

// N-2: 動画 →（無ければ）画像 →（無ければ）テキスト。順序を入れ替えない。
export function resolveQuestionFace(question: Question): QuestionFace {
  if (question.videoPath !== null) return { kind: "video", source: question.videoPath };
  if (question.imagePath !== null) return { kind: "image", source: question.imagePath };
  return { kind: "text", source: question.text };
}
```

- **メディア配信と TV a モード**: 所定フォルダは HTTP サーバがルート `/media`（kebab-case）配下で配信し、TV a モードは `resolveQuestionFace` の `kind` に応じて動画（`<video>`）・画像（`<img>`）・テキストを描画する。`source`（相対パス）は配信 URL 構築にのみ用い、可視コピーに生パス文字列を露出しない（§1.4）。
- **配信のアクセス境界**: メディア資産の配信はアプリ全体と同じ家族限定アクセス境界（URL 秘匿 or 認証・上位設計 §2.10・§3.3）の内側でのみ到達可能とし、タブレット UI はメディアを埋め込まない（§2.9）。

### 2.5 ライブ編集（`module:questions`・QM-3 の編集面）

進行中も制御盤から**問題文・正解値・画像パス・動画パスの双方（すべて）**を編集でき、`updateContent` による `questions` の DB 更新として永続・読み戻せる。編集は既存問の行更新であり、当日その場でゼロから問題を作る入稿ではない（QM-1 と両立）。

```typescript
// src/questions/live_edit.ts
import type { QuestionsRepository, QuestionContentPatch } from "./questions_repository.js";
import type { Question } from "./question.js";

export interface StageReader { isDisclosed(questionId: string): Promise<boolean>; } // rounds.stage 由来
export interface RescoreTrigger { rescoreQuestion(questionId: string): Promise<void>; } // module:scoring

export async function applyLiveEdit(
  questionId: string,
  patch: QuestionContentPatch,
  repo: QuestionsRepository,
  stage: StageReader,
  rescore: RescoreTrigger,
): Promise<Question> {
  const updated = await repo.updateContent(questionId, patch);
  // QM-3: correct_value を触り、かつ当該問が開示済み（c 以降）のときだけ自動再採点を誘発
  if (patch.correctValue !== undefined && (await stage.isDisclosed(questionId))) {
    await rescore.rescoreQuestion(questionId);
  }
  return updated;
}
```

- **編集がメディア解決へ及ぶ**: `videoPath`／`imagePath` の付与・除去は次の a モード描画で `resolveQuestionFace` の結果を規定順（§2.4）に従って切り替える。
- **正解値編集の三層防衛**: 編集経路の `correctValue` も 0〜100 整数のみ受理し、範囲外は UI・サーバ・DB `CHECK` で拒否する（§2.9）。
- **再採点ゲートは 2 条件の論理積**: 「`correctValue` が patch に含まれる」かつ「`isDisclosed(rounds.stage)` が真」のときのみ再採点する。`text`／メディアのみの編集、あるいは c 未到達での正解編集では再採点は走らない（§2.6 の境界）。

### 2.6 自動再採点連携（`module:scoring` / `module:game_flow`・QM-3・E-3 残）

開示済み問題の正解ライブ編集が `module:scoring` の再採点を起動する連携をここで確定する。再採点範囲判定の唯一の前提は `module:game_flow` の `rounds.stage`（`design:data-model-design` §2.5）である。

- **開示判定**: `isDisclosed(stage)` は `stage ∈ {answer_revealed, settlement_computed}`（c 以降）で真。`isSettled(stage)` は `stage === settlement_computed`（d 到達）で真。
- **再採点手順**: 編集後 `questions.correct_value` と既存 `answers.value` から当該問の全 `settlements`（`error = |value − correct|`、`delta_yen = error × −100`、`pitari_bonus_yen`）を再計算し、`balances.amount` を**旧拠出との差分**で更新する。`isSettled`（d 到達）問では TV d（当該問 6 列表）と e（全員通算）を同時更新する。
- **境界（走る／走らない）**: c 到達問の正解訂正 → 再採点が走る。c 未到達（`isDisclosed` 偽）の正解編集 → 走らない（境界外）。`text`／メディアのみの編集 → 走らない（`correct_value` 不変）。
- **不変式**: 差分更新後の `balances` は `answers`＋`correct_value` からの全再計算と一致する（差分更新は最適化であり、監査時は全再計算と一致することを不変式とする）。

```typescript
// src/scoring/rescore_question.ts
import { applyQuestionScore } from "./apply_question_score.js";
import type { AnswerScore } from "./answer_score.js";
import type { Yen } from "./yen.js";

export interface AnswerRow { participantId: string; value: AnswerScore; }
export interface OldSettlement { participantId: string; deltaYen: Yen; pitariBonusYen: Yen; }
export interface BalanceDelta { participantId: string; deltaYen: Yen; } // balances へ加算する差分

// correct_value 訂正時の差分再計算（開示済み問のみ呼ばれる）。純関数として全再計算と一致させる。
export function rescoreDiff(
  answers: readonly AnswerRow[],
  oldSettlements: readonly OldSettlement[],
  newCorrect: AnswerScore,
): BalanceDelta[] {
  const old = new Map(oldSettlements.map((s) => [s.participantId, s]));
  return answers.map((a) => {
    const now = applyQuestionScore({ balance: 0, answer: a.value, correct: newCorrect });
    const prev = old.get(a.participantId);
    const prevTotal = (prev?.deltaYen ?? 0) + (prev?.pitariBonusYen ?? 0);
    const nowTotal = now.delta + now.pitariBonus;
    return { participantId: a.participantId, deltaYen: (nowTotal - prevTotal) as Yen };
  });
}
```

- **円建て固定の継承**: 再採点結果も円で表し、`point`/`pt`/`点` を格納・派生・表示のどこにも出さない（`applyQuestionScore` は `currency: "円"` を保持）。

### 2.7 派生状態・読みモデル連鎖（メディア解決／再採点）

本書が関与する 2 本の派生連鎖を単一方向で確定する。

1. **出題メディア解決連鎖（QM-2）**: `questions.video_path/image_path/text`（durable） → `resolveQuestionFace`（derived, 純関数） → **TV a モード**（consumer surface）。メディアパスのライブ編集は durable を更新し、次の a モード描画で derived が規定順に追随する。
2. **正解訂正 → 再採点連鎖（QM-3）**: `questions.correct_value`（durable, ライブ編集） → `settlements`（`error`/`delta_yen`/`pitari_bonus_yen`, derived） → `balances.amount`（集計 read-model） → **TV d / e**（consumer surfaces）。この連鎖は `isDisclosed(rounds.stage)` 真のときのみ起動し、`isSettled` 真の問で d/e を同時更新する。

### 2.8 ソース配置・モジュール指定子（レイアウト契約・NodeNext）

- **格納先（`src/` 配下・snake_case ファイル）**: 入稿・編集 `src/questions/`（`intake_reader.ts`／`intake_record.ts`／`intake_validator.ts`／`load_questions.ts`／`question.ts`／`questions_repository.ts`／`live_edit.ts`）、メディア解決 `src/media/`（`resolve_question_face.ts`）、メディアルート解決 `src/config/`（`media_root.ts`）、再採点 `src/scoring/`（`rescore_question.ts`／`apply_question_score.ts`）、進行段階判定 `src/game_state/`（`progression.ts`）。上位設計 §2.2 の module→格納先マッピング（`module:game_flow` → `src/game_state/`）に従う。`module:media` は上位設計のモジュール一覧に含まれ、本書で `src/media/` を割当てる。
- **モジュール指定子**: 全相対 import は `.js` 拡張子明示。type-only import・re-export も同一（例: `import type { Question } from "../questions/question.js";`、`export { resolveQuestionFace } from "./resolve_question_face.js";`）。
- **runner/tool 設定の非著作**: `package.json`・`package-lock.json`・`tsconfig.json`・`vitest.config.ts` は harness 所有につき本書は出力・宣言しない。マイグレーション／スキーマ定義を要する場合も `src/`（例 `src/persistence/`）配下に置き、`tests/`・runner 設定へ置かない。

### 2.9 アクセス制御・整合・プライバシー

- **入稿・編集の権限境界（INV-5 継承・release-blocking）**: 問題ファイル読込（`op_load_questions`）とライブ編集（`op_live_edit_correct`）は制御盤（`role: host`）サーフェスの操作であり、`role: host` セッションのみが `questions` への書込みを起こせる。`role: contestant` からの読込・編集コマンドはサーバ側で **401/403 拒否**し、非 host UI に該当操作要素を置かない。ロール判定はセッションのロール属性を単一判定点とする。
- **0〜100 整数の三層防衛（INV-6 継承）**: 正解値は入稿検証（`isAnswerScore`）・サーバ検証・DB `CHECK(0<=correct_value<=100)` の三層で 0〜100 整数のみ受理する。入稿・ライブ編集いずれの経路でも -1/101/50.5 は拒否され `questions` に入らない。
- **メディア未配置の事前防衛**: 宣言されたメディアパスは入稿時に所定フォルダ配下の実体存在を検証し、未配置は問題番号を添えて拒否する（a モードの空画面を本番前に排除）。
- **プライバシー / データ取扱い**: 出題内容（問題文・メディア）とメディア資産はタブレット向け読みモデルに含めない。メディア配信は家族限定アクセス境界（URL 秘匿 or 認証・上位設計 §2.10・§3.3）の内側でのみ到達可能とする。収集する個人データは解答者の自己入力氏名・当日の解答・残額に限り、本書の入稿・編集は問題データのみを扱う。恒久的な事前氏名台帳を持たない前提を侵さない。

### 2.10 非機能要件（性能・観測）

- **入稿性能**: 10 問（想定最大）の読込 → 検証 → `bulkInsert` は **p95 ≤ 1,000ms**（クラウド DB 前提の暫定テストゲート・SLA 確定時に更新）。
- **メディア解決性能**: `resolveQuestionFace` は O(1) の純関数で外部 I/O を伴わない。a モード切替時の出題面決定は同期反映ゲート **p95 ≤ 2,000ms**（上位設計 F-04 継承）の内側に収める。
- **ライブ編集→反映**: ライブ編集の DB 永続・読み戻し、開示済み時の再採点、TV d/e への反映は同 **p95 ≤ 2,000ms** ゲートで測定する。
- **健全性ベースライン**: 入稿・編集・メディア配信の全 HTTP 応答は `< 500`（5xx を業務ステータスとして見逃さない）。

### 2.11 テスト戦略との整合（Vitest / レイアウト / モジュール指定子）

ユニットは `tests/questions/`・`tests/media/`・`tests/scoring/` 配下の `*.test.ts`、E2E は API 統合 `tests/e2e/question-intake.spec.ts`・ライブ編集/再採点 `tests/e2e/live-edit-rescore.spec.ts`、ブラウザ（TV a モード描画）`tests/e2e/media-fallback.browser.spec.ts` に置く。ブラウザ操作は Playwright を import して駆動し、宣言・検証は Vitest で行う。

```typescript
// tests/media/resolve_question_face.test.ts
import { describe, it, expect } from "vitest";
import { resolveQuestionFace } from "../../src/media/resolve_question_face.js";

const base = { id: "q1", questionNumber: 1, text: "問題文", correctValue: 50 };

describe("出題面の3段フォールバック（N-2・順序厳守）", () => {
  it("動画パス有なら動画（画像が有っても動画優先）", () => {
    const f = resolveQuestionFace({ ...base, videoPath: "q1.mp4", imagePath: "q1.png" });
    expect(f).toEqual({ kind: "video", source: "q1.mp4" });
  });
  it("動画無・画像有なら画像", () => {
    const f = resolveQuestionFace({ ...base, videoPath: null, imagePath: "q1.png" });
    expect(f).toEqual({ kind: "image", source: "q1.png" });
  });
  it("双方無ならテキスト", () => {
    const f = resolveQuestionFace({ ...base, videoPath: null, imagePath: null });
    expect(f).toEqual({ kind: "text", source: "問題文" });
  });
});
```

```typescript
// tests/questions/load_questions.test.ts
import { describe, it, expect, vi } from "vitest";
import { loadQuestions } from "../../src/questions/load_questions.js";
import type { QuestionsRepository } from "../../src/questions/questions_repository.js";

const repo = (): QuestionsRepository => ({
  bulkInsert: vi.fn(async () => {}),
  getByNumber: vi.fn(async () => null),
  listAll: vi.fn(async () => []),
  updateContent: vi.fn(async () => { throw new Error("unused"); }),
});
const allPresent = { exists: (_p: string) => true };
let seq = 0;
const newId = () => `q-${++seq}`;

describe("入稿（ファイル→DB）", () => {
  it("正常入稿で全問が bulkInsert され correct_value を保持する", async () => {
    const r = repo();
    const res = await loadQuestions(
      [{ questionNumber: 1, text: "都道府県の数", correctValue: 47 }],
      allPresent, r, newId,
    );
    expect(res.loaded).toBe(1);
    expect(r.bulkInsert).toHaveBeenCalledOnce();
  });
  it("correct_value 範囲外は入稿拒否・全 or 無で 0 問登録", async () => {
    const r = repo();
    const res = await loadQuestions(
      [{ questionNumber: 1, text: "ok", correctValue: 50 },
       { questionNumber: 2, text: "ng", correctValue: 101 }],
      allPresent, r, newId,
    );
    expect(res.loaded).toBe(0);
    expect(r.bulkInsert).not.toHaveBeenCalled();
    expect(res.issues.some((i) => i.field === "correct_value")).toBe(true);
  });
  it("宣言メディアが所定フォルダに未配置なら問題番号付きで拒否", async () => {
    const r = repo();
    const res = await loadQuestions(
      [{ questionNumber: 3, text: "映像問題", correctValue: 80, videoPath: "missing.mp4" }],
      { exists: (_p) => false }, r, newId,
    );
    expect(res.loaded).toBe(0);
    expect(res.issues[0]).toMatchObject({ questionNumber: 3, field: "video_path" });
  });
});
```

```typescript
// tests/questions/live_edit.test.ts
import { describe, it, expect, vi } from "vitest";
import { applyLiveEdit } from "../../src/questions/live_edit.js";
import type { QuestionsRepository } from "../../src/questions/questions_repository.js";

const q = { id: "q1", questionNumber: 1, text: "t", imagePath: null, videoPath: null, correctValue: 50 };
const repo = (): QuestionsRepository => ({
  bulkInsert: vi.fn(async () => {}),
  getByNumber: vi.fn(async () => q),
  listAll: vi.fn(async () => [q]),
  updateContent: vi.fn(async (_id, patch) => ({ ...q, ...patch })),
});

describe("ライブ編集と再採点ゲート（QM-3）", () => {
  it("開示済みで correct_value を編集すると再採点が走る", async () => {
    const rescore = { rescoreQuestion: vi.fn(async () => {}) };
    await applyLiveEdit("q1", { correctValue: 60 }, repo(), { isDisclosed: async () => true }, rescore);
    expect(rescore.rescoreQuestion).toHaveBeenCalledWith("q1");
  });
  it("c 未到達の correct_value 編集では再採点は走らない", async () => {
    const rescore = { rescoreQuestion: vi.fn(async () => {}) };
    await applyLiveEdit("q1", { correctValue: 60 }, repo(), { isDisclosed: async () => false }, rescore);
    expect(rescore.rescoreQuestion).not.toHaveBeenCalled();
  });
  it("text/メディアのみの編集では再採点は走らない", async () => {
    const rescore = { rescoreQuestion: vi.fn(async () => {}) };
    await applyLiveEdit("q1", { videoPath: "new.mp4" }, repo(), { isDisclosed: async () => true }, rescore);
    expect(rescore.rescoreQuestion).not.toHaveBeenCalled();
  });
});
```

Vitest 以外（`node:test` 等）をランナーに用いない。ランタイム依存最小化の方針はテストランナーに及ばない。

### Operational Behavior Model

以下の単一 YAML ブロックが、入稿・メディア解決・ライブ編集・自動再採点に関する運用挙動の権威的出典であり、実装計画と E2E 生成が共有する。上位設計・データモデルの `operation_flow` と ID を一致させ、本書は入稿／メディア／ライブ編集側の `durable_state`／`readback`／`measurement_source`／派生連鎖と、規約 QM-1〜QM-3 に対応する `dod_obligations` を明示する。未確定は `boundary_cases` または §3 のフラグへ回し、発明しない。

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
      trigger: 制御盤で事前問題ファイル（JSON）の読込を実行
      route: /control-panel
      ui_pattern: file_pick_then_load
      forbidden_actors: [contestant]
      preconditions:
        - game_state.phase が lobby またはライブ編集フェーズ（in_progress のライブ編集中）
        - 参照される全メディアが所定フォルダ（QUESTION_MEDIA_ROOT）配下に事前配置済み
      measurement_source: 事前問題ファイル（JSON 配列 QuestionIntakeRecord[]）
      durable_state: questions テーブル（text / image_path / video_path / correct_value）
      readback: ランタイム出題は questions テーブルから供給（ファイル再読込に依存しない）
      visible_to: [host]
      expected_outcomes:
        - 各問が questions テーブルへ登録される
        - correct_value が 0〜100 の整数で保持される
        - image_path / video_path は任意（NULL 許容）で保持される
        - 検証エラーが 1 件でもあれば 1 問も登録されない（全 or 無）
      boundary_cases:
        - correct_value 0/100 は登録可
        - correct_value -1/101/50.5 は登録拒否
        - image_path/video_path 未指定 → NULL で登録可
        - 宣言された動画/画像パスに所定フォルダ配下の実体が無い → 当該入稿は拒否
      dod_obligations:
        - id: dod_load_persist
          text: 読み込んだ全問が questions に登録され、再取得で登録時と同一の text と correct_value を返す
        - id: dod_load_runtime_from_db
          text: 出題面の解決元は questions テーブルであり、問題ファイルの再読込に依存しない
        - id: dod_load_media_paths_optional
          text: image_path と video_path は未指定でも登録でき NULL として保持される
        - id: dod_load_correct_value_integer
          text: correct_value が 0〜100 の整数以外では登録が拒否される（入稿検証とサーバ検証と DB CHECK を含む）
        - id: dod_load_no_adhoc_entry
          text: 出題内容の初期入稿は事前ファイル読込のみで、当日その場で問題集をゼロから手入力する UI/API が存在しない
        - id: dod_load_media_prevalidated
          text: 宣言された image_path/video_path に所定フォルダ配下の実体が無い場合は問題番号を添えて入稿が拒否され questions に入らない
        - id: dod_load_all_or_nothing
          text: 検証エラーが 1 件でもある入稿では questions が 1 行も追加されない
        - id: dod_load_host_only
          text: 読込は role host のみ発動でき contestant からの読込コマンドは 401/403 で拒否される
    - id: op_switch_tv_mode
      actor: host
      verb: switch
      target: tv_mode
      trigger: 制御盤の「次へ」「戻る」または各モード個別ジャンプで a モードへ切替
      route: /control-panel
      ui_pattern: next_back_jump
      forbidden_actors: [contestant]
      measurement_source: questions.video_path / image_path / text（当該問）
      durable_state: game_state.tv_mode
      consumer_surfaces: [tv_mode_a]
      expected_outcomes:
        - a モードは動画→画像→テキストの 3 段で出題面を解決する
        - メディアパスのライブ編集後は次の a モード描画に反映される
      boundary_cases:
        - 動画パス有 → 動画（画像有無に関わらず動画優先）
        - 動画無・画像有 → 画像
        - 双方無 → テキスト
      dod_obligations:
        - id: dod_tv_a_fallback
          text: a モードが video_path→image_path→text の優先順で出題面を解決する
        - id: dod_tv_a_reflects_live_edit
          text: メディアパスのライブ編集後に a モードを再描画すると解決される出題面が編集後の規定順に従う
        - id: dod_tv_a_no_path_leak
          text: a モードの表示に生のファイルパス文字列や fallback 等の内部語が露出しない
    - id: op_live_edit_correct
      actor: host
      verb: edit
      target: question_or_correct_value
      trigger: 制御盤のライブ編集 UI で問題文・正解値・画像/動画パスを更新
      route: /control-panel
      ui_pattern: inline_edit_then_save
      forbidden_actors: [contestant]
      preconditions:
        - 対象問が questions に存在する
      durable_state: questions テーブル更新（text / image_path / video_path / correct_value）
      readback: DB 再取得で編集後の値を返す
      visible_to: [host]
      expected_outcomes:
        - 問題文・正解・メディアパスを進行中に編集でき questions に永続する
        - 画像/動画パスの編集は a モードの出題面解決に反映される
        - correct_value の編集かつ開示済み（c 以降）のときのみ自動再採点を誘発する
      boundary_cases:
        - text のみ編集 → 再採点は走らない
        - image_path/video_path のみ編集 → 再採点は走らない・a モード解決のみ変化
        - correct_value 編集かつ c 未到達 → 再採点は走らない
        - correct_value 編集かつ c 以降 → 再採点が走る
      dod_obligations:
        - id: dod_edit_persist
          text: 進行中に編集した問題文と正解値が questions に永続し再取得で読み戻せる
        - id: dod_edit_media_persist
          text: 進行中に編集した image_path/video_path が questions に永続し再取得で読み戻せる
        - id: dod_edit_media_face_follows
          text: 動画パスを付与/除去すると当該問の a モード出題面が規定順（video→image→text）で切り替わる
        - id: dod_edit_correct_range_guard
          text: 正解値の編集も 0〜100 整数のみ受理し範囲外はサーバと DB CHECK で拒否される
        - id: dod_edit_host_only
          text: ライブ編集は role host のみ発動でき contestant からの編集コマンドは 401/403 で拒否される
    - id: op_auto_rescore
      actor: system
      verb: rescore
      target: balances
      trigger: 開示済み（rounds.stage が answer_revealed 以降）の問題で correct_value をライブ編集
      preconditions:
        - 当該問の rounds.stage が answer_revealed 以降
        - ライブ編集の patch が correctValue を含む
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
        - c 到達問の correct_value 訂正 → 再採点が走る
        - c 未到達（isDisclosed 偽）の correct_value 編集 → 再採点は走らない（境界外）
        - text/メディアのみ編集 → 再採点は走らない（correct_value 不変）
      dod_obligations:
        - id: dod_rescore_after_c
          text: rounds.stage が answer_revealed 以降で正解を直すと settlements と balances が再計算され各人の残額へ即時反映される
        - id: dod_rescore_no_before_c
          text: rounds.stage が answer_revealed 未満の正解編集では settlements と balances が変化しない
        - id: dod_rescore_only_on_correct_value
          text: text または image_path/video_path のみの編集では再採点が走らず balances が不変である
        - id: dod_rescore_d_sync
          text: rounds.stage が settlement_computed の問の正解訂正で balances 差分が再計算され TV の d と e が同時更新される
        - id: dod_rescore_matches_full_recompute
          text: 差分更新後の balances が answers と correct_value からの全再計算と一致する
```

---

## 3. Open Questions

壁打ち（要件定義）フェーズはクローズ済で殿判断待ちの論点は残っていない。以下は入稿・メディア・ライブ編集に関して実装組み立てフェーズで MAS が決める技術選定、推測実装せず殿判断を仰ぐ点、検証ゲートで暫定運用中のフラグである。いずれも「推奨なし」「要検討」「TBD」の空白は残さず、確定した制約・既定機構・暫定ゲート値を明記する。

### 3.1 技術選定（MAS 決定・殿判断不要）

| 項目 | 決定/既定 | 制約・選定軸 |
|---|---|---|
| 入稿ファイル形式 | **JSON 配列（`QuestionIntakeRecord[]`）を既定** | Node ネイティブに解釈でき TypeScript ドメインへ直写できる。`questionNumber`/`text`/`correctValue`/`imagePath?`/`videoPath?` を保持。他言語フォーマット/ツールは用いない。 |
| メディアルートの持ち方 | 環境変数 `QUESTION_MEDIA_ROOT`（既定 `./question-media`）を `src/config/media_root.ts` で単一解決 | ハードコード禁止。`image_path`/`video_path` はルート配下の相対パスとして DB 保持。配信ルートは `/media`。 |
| メディア実体存在の検証時点 | **入稿時に所定フォルダ配下の実体存在を検証** | a モードのフォールバックは「パスの有無」で分岐するため、未配置パスは本番前に問題番号付きで拒否する。 |
| 入稿の原子性 | **全 or 無**（検証エラー 1 件で 0 問登録） | 部分登録による欠落問を防ぎ、ランタイムが常に一貫した DB から出題できるようにする。 |
| 再読込のキー | `question_number`（`unique`）による upsert | 進行中再読込で重複行を作らない。開示済み問の `correct_value` 変化は手動編集と同一の再採点ゲートを通す。 |
| DB 永続化技術 | データモデル §3.1 の選定に従う（`integer`/`CHECK`/`unique`/FK を強制できる DB） | クラウド常時稼働と整合。ホスト PC を DB/サーバにしない（INV-1 継承）。 |

### 3.2 F028 エスカレーション（推測実装しない）

- **取消操作の問題データへの影響（論点 7・F-03）**: `trigger_undone` が正解ライブ編集・入稿を戻す対象に含むか、`rounds.stage` を 1 段戻して再採点を巻き戻すか等の具体挙動に曖昧が残る場合は、選択肢を添えて F028 で殿判断を仰ぐ。**発動権限＝制御盤（host）のみ**は確定ゆえ実装・検証し、挙動詳細は E2E で `test.fixme()`。
- **正解訂正時のピタリ賞拠出配分（B・F-02）**: 開示済み問の正解訂正で誤差 0 が新たに発生/消滅した場合の**加算側 +1,000 の反映は確定・実装必須**。拠出元と配分（総額 1,000 か各人からか、複数同時ピタリの扱い）が未確定な間は拠出減算を 0 とし、確定後に `settlements` へ拠出行を追加する拡張余地を残す（データモデル §3.2 と整合）。加算側 +1,000・円建て・現金感を薄めない確定値は変更しない。

### 3.3 検証ゲートで暫定運用中のフラグ（設計義務の欠落・発明せず flag）

- **F-04（同期レイテンシ SLA）**: 設計に固定 SLA が無いため、メディア解決・ライブ編集反映・再採点の全端末反映は §2.10 の **p95 ≤ 2,000ms**、入稿は **p95 ≤ 1,000ms** を暫定テストゲートとして扱い、SLA 確定時に更新する。
- **F-05（家族限定アクセス制御とメディア配信）**: メディア資産の配信は家族限定アクセス境界（URL 秘匿 or 認証・上位設計 §2.10・§3.1）の内側でのみ到達可能とする。認証導入時はメディア到達前にログイン→リダイレクト→描画フローを検証し、未実装なら該当ブラウザテストを `test.fixme()`。無制御公開のまま出荷はリリース不可（INV-4 継承）。
- **F-06（動画コーデック/配信方式）**: 動画の実体は問題ファイル記載＋所定フォルダ事前配置で確定だが、TV a モードで確実に再生できるコンテナ/コーデックの具体制約は本設計に固定値が無い。実装時は `<video>` が本番ブラウザで再生可能な形式を選定軸とし、再生不可形式の混入は入稿検証の拡張対象としてフラグする（現時点ではパス存在検証までを義務とする）。
