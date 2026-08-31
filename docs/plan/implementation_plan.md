---
codd:
  node_id: plan:implementation-plan
  type: plan
  depends_on:
  - id: detailed_design:sequence-flows
    relation: depends_on
    semantic: technical
  - id: detailed_design:state-machines
    relation: depends_on
    semantic: technical
  - id: detailed_design:er-crud-model
    relation: depends_on
    semantic: technical
  - id: design:operational-behavior-model
    relation: constrained_by
    semantic: governance
  depended_by:
  - id: test:test-strategy
    relation: depends_on
    semantic: verification
  conventions:
  - targets:
    - module:tv_display
    - module:scoring
    reason: MVP 正解発表は開示一覧＋正解値＋得点増減（円）まで。効果音・カウントダウン・アニメ・ランキング演出は MVP 後で、過剰実装しない（論点F）。違反時リリース不可。
  - targets:
    - module:control_panel
    - role:host
    reason: 取消は初版から司会者権限の操作として含める。具体挙動に曖昧が残れば推測実装せず F028 で殿判断を仰ぐ（論点7）。違反時リリース不可。
  - targets:
    - module:config
    - module:participants
    reason: 接続上限のハードコード禁止・設定外出しを実装順序に組み込む（論点10）。違反時リリース不可。
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

# 実装計画（MVP マイルストーン・順序・過剰実装禁止）

## 1. Overview

本書は `save-money-switcher`（クラウド WEB アプリ版『賞金先渡しクイズ SAVE MONEY』を家族で遊ぶ操作盤）の **MVP 実装計画** であり、四つの上流 —— `design:operational-behavior-model`（運用挙動モデル）・`detailed_design:sequence-flows`（主要シーケンス）・`detailed_design:state-machines`（状態機械）・`detailed_design:er-crud-model`（ER・CRUD）—— を統合し、**何を・どの順序で・どこまで作るか**を確定する。運用挙動モデルは本書に対して `constrained_by`（governance）で作用し、そこに刻まれた確定値・不変条件・`dod_obligations` は本書のマイルストーン受入基準の上位規範である。ここに定める順序・MVP スコープ境界・単一所有・過剰実装禁止に反する成果物は **リリース不可（release-blocking）** として扱う。

### 1.1 目的・スコープ・非スコープ

- **本書がカバーする**: MVP のマイルストーン分割（M0〜M8）、各マイルストーンの成果物ファイル・受入 DoD・Vitest 検証・依存順序・MVP スコープ境界（作る／作らない）、F028 エスカレーションと暫定フラグの実装上の取り回し。
- **カバーしない（上流へ委譲）**: 状態遷移 topology の定義（`detailed_design:state-machines`）、シーケンス順序契約（`detailed_design:sequence-flows`）、テーブル・CRUD 境界（`detailed_design:er-crud-model`）、採点式・同期プロトコルの内部（各兄弟設計）。本書はそれらを **どの順で組み上げるか** のみを所有する。
- **MVP の到達点**: 10 問を通して「QR 参加 → タブレット数値入力 → 締切 → 解答オープン（b）→ 正解発表（c）→ 精算（d: 開示一覧＋正解値＋得点増減の円建て 6 列表）→ 通算（e）→ 残額最多の勝者判別」までを、クラウド WS 権威・司会者専権・接続上限外出し・0〜100 整数多層防衛・円建て固定・プライバシー投影・再接続整合の全不変条件を満たして通す。

### 1.2 リリースブロッキング規約と本書での具体化

本書に課された 3 規約を、マイルストーン設計へ次のとおり織り込む。違反時リリース不可。

| # | 対象 | 不変条件（要旨） | 本書での具体化箇所 |
|---|---|---|---|
| IMPL-F | `module:tv_display` / `module:scoring` | MVP の正解発表は **開示一覧＋正解値＋得点増減（円）まで**。効果音・カウントダウン・アニメ・ランキング演出は MVP 後で **過剰実装しない**（論点F） | §1.4（MVP スコープ境界）・§2 の M5/M6（TV a〜e は静的描画のみ・scoring は確定値のみ）・§3.3（過剰実装リスク） |
| IMPL-7 | `module:control_panel` / `role:host` | **取消は初版から司会者権限の操作として含める**。具体挙動に曖昧が残れば推測実装せず F028 で殿判断を仰ぐ（論点7） | §2 の M4（`op_undo` の host-only ガード＋`trigger_undone` 配信＋`previousStage` topology を実装／巻き戻し durable 副作用は非実装）・§3.1（F-03 エスカレーション） |
| IMPL-10 | `module:config` / `module:participants` | **接続上限のハードコード禁止・設定外出しを実装順序に組み込む**（論点10） | §2 の **M0 で `src/config/connection_limit.ts` を最初に実装**・M3/M5 の `admitTablet` は解決値のみ参照・§3.3（ハードコード混入リスク） |

上流から継承する不変条件も各マイルストーンの受入で担保する：**ホスト PC をサーバにしない**（WS 待受はクラウドのみ・M3）、**host-only 進行トリガー**（非 host は `command_denied` 403／未認証 401・M4）、**ロール投影による他者情報の非配信**（`projectForRole` 必須・M3）、**円建て固定**（`point`/`pt`/`点` 禁止・M1/M6）、**0〜100 整数の三層防衛**（UI＋サーバ＋DB `CHECK`・M0/M2/M5）、**家族限定アクセス制御**（無制御公開不可・M5）、**接続上限外出し**（既定 8・設定 16/32 追随・M0/M5）、**自己入力氏名のみ・恒久台帳/座席固定なし**（M2/M5）。

### 1.3 実装・ツールチェーン前提（scaffold 固定・釈義不可・本書の遵守宣言）

- **実装言語 = TypeScript のみ。** 本書のマイルストーン成果物・ファイルパス（`src/game_state/progression.ts`・`src/scoring/settle_question.ts`・`tests/config/connection_limit.test.ts` 等）・依存参照はすべて TypeScript 慣行のみを用い、他言語の拡張子・マニフェスト・ツールは例示・フォールバックとしても登場させない。WebSocket サーバは Node 上の `ws`、QR 生成は `qrcode`、ブラウザ検証は Playwright を **ライブラリ import** で駆動する。
- **テストランナー = Vitest（固定・release-blocking のグラウンドトゥルース）。** 全マイルストーンの受入テストは Vitest 自身の宣言 API（`import { describe, it, expect } from "vitest";`）で記述する。「ランタイム依存を最小化する」方針は **出荷コードのランタイム依存**（`ws`／`qrcode` 等）にのみ及び、テストランナーには及ばない。依存数の哲学を根拠に別フレームワークや Node 組み込み `node:test` を用いてはならない。verify が実際に走らせるのは Vitest である。
- **モジュール解決 = NodeNext/Node16。** すべての相対 import は **出力される `.js` ファイル名を明示した拡張子** を伴う（`import { isDisclosed } from "./progression.js";`。`"./progression"`・`"./progression.ts"` は不可）。default/namespace import・re-export（`export { stageToTvMode } from "./tv_mode.js";`）・type-only import（`import type { Stage } from "./progression.js";`）も同一規約。拡張子欠落は TS2835 でコンパイル不能。テストから src を参照する相対 import も `.js` 明示（`import { admitTablet } from "../../src/participants/connection_machine.js";`）。
- **レイアウト契約（output-path fence 強制）。** すべてのソースは **必ず `src/` 配下**、すべてのテストは **必ず `tests/` 配下**（`test/`・`spec/`・`specs/` を発明しない。サブディレクトリ `tests/game_state/`・`tests/e2e/helpers/` 等は可）。`package.json`・`package-lock.json`・`tsconfig.json`・`vitest.config.ts` は harness scaffold 所有につき、本書はこれらを成果物として出力・宣言せず、いかなるマイルストーンの deliverable にも含めない（emit しても fence で drop され verify の走り方も変わらない）。

### 1.4 過剰実装禁止の原則（MVP スコープ境界・IMPL-F の中核）

MVP は **確定要件で outcome が固定されたものだけを実装** し、確定要件に無い演出・機構を発明しない。以下を **MVP 境界** として全マイルストーンの合否判定に用いる。

**MVP で作る（IN）**

- TV 5 モードの **静的描画のみ**：a（出題面 `video→image→text` 解決）／b（全員の氏名＋解答）／c（正解値）／d（**6 列精算表**＝氏名/解答/誤差/増減円/ピタリ賞/残額・円建て）／e（全問通算残額＋残額最多の勝者判別）。
- 採点の **確定値のみ**：賞金先渡し `INITIAL_GRANT=10000` 円、`error=|answer−correct|`（0〜100 整数）、`delta_yen=error×−100`、ピタリ賞 **加算側 `PITARI_BONUS=+1000`**（誤差 0）、`QUESTION_COUNT=10`、残額最多勝ち。
- 司会者専権の進行制御（締切・開示・正解発表・精算・モード切替・入稿・ライブ編集・**取消**）、解答者の数値入力（`+1/−1/+10/−10` ステッパ＋送信）、接続上限拒否、開示済み正解ライブ編集の自動再採点、再接続整合。

**MVP で作らない（OUT・過剰実装＝リリース不可）**

- **効果音**（audio 再生）、**カウントダウン**（残時間タイマー演出）、**アニメーション**（トランジション・数値カウントアップ・紙吹雪等）、**ランキング演出**（順位付けの段階表示・煽り演出・順位変動アニメ）。
- 上記の内部語露出（`fallback`・生ファイルパス・内部イベント名・設定キー名）や、確定要件に無い付記（同名区別の連番・残額下限/脱落・同点優先順位）を **発明しない**（各々 §3 のフラグ／F028 で扱う）。

`module:tv_display` は「配信された `tv_mode` に応じた読みモデルを素朴に描くだけ」の受動サーフェスに留め、`module:scoring` は「確定式で `settlements`/`balances` を出すだけ」に留める。演出は MVP 後の別マイルストーンとし、本計画には含めない。

### 1.5 依存順序と単一所有（ビルド順の根拠）

独立生成されるファイル間の再実装ドリフトを避けるため、**純粋ドメイン型・述語を最下層に単一所有として先に確定**し、上位（状態機械・採点・永続・同期・サーフェス）はそれを `import` するだけとする。単一所有の対応（上流 §3 と一致）：

| 所有物 | 単一所有ファイル | 消費側（import のみ・再宣言禁止） | 確定マイルストーン |
|---|---|---|---|
| `Stage`・`isDisclosed`・`isSettled`・`Round` | `src/game_state/progression.ts` | scoring・realtime_sync・participants | M0 |
| `TvMode`・`stageToTvMode`・`GameState` | `src/game_state/tv_mode.ts`・`game_state.ts` | tv_display・realtime_sync | M0/M1 |
| `GamePhase`・`derivePhase`・`QUESTION_COUNT` | `src/game_state/phase.ts` | scoring・realtime_sync | M0 |
| `AnswerScore`・`isAnswerScore`・`assertAnswerScore` | `src/scoring/answer_score.ts` | questions・game_state・scoring | M0 |
| `Yen`・`CURRENCY="円"`・`INITIAL_GRANT`・`YEN_PER_ERROR`・`PITARI_BONUS` | `src/scoring/yen.ts` | scoring・金額を出す全 API 層 | M0 |
| `DEFAULT_MAX_TABLET_CONNECTIONS=8`・`resolveMaxTabletConnections` | `src/config/connection_limit.ts` | participants（R のみ） | **M0（IMPL-10）** |
| `nextStage`・`previousStage` | `src/game_state/round_machine.ts` | control_panel・realtime_sync | M1 |
| `nextMode`・`backMode`・`jumpMode` | `src/game_state/tv_machine.ts` | control_panel | M1 |
| `planRescore` | `src/game_state/rescore_trigger.ts` | scoring 起動側 | M1 |
| `admitTablet`・接続状態集合 | `src/participants/connection_machine.ts` | realtime_sync（accept/close 実行） | M1 |
| `settleQuestion`・`rescoreQuestion`・`aggregateBalance` | `src/scoring/`（settle_question.ts 等） | game_state は起動可否のみ判定 | M1 |

---

## 2. Milestones

MVP を 9 マイルストーン（M0〜M8）に分割する。**下から積む**（純粋層→機械/採点→永続→同期→サーフェス→統合）。各マイルストーンは「ソースは `src/` 配下・テストは `tests/` 配下・相対 import は `.js` 明示・ランナーは Vitest」を満たさなければ完了しない。各 DoD は上流 OBM の安定 `dod_*` ID を受入基準として引く。

### M0 — ドメイン基盤：純粋型・述語・**設定解決点**（IMPL-10 を最初に据える）

**目的**: 上位すべてが import する単一所有の純粋層を確定。副作用・I/O なし。**接続上限の設定外出しをここで先に完了**させ、以後どのモジュールも数値リテラル `8` を判定に撒けないようにする（IMPL-10）。

**成果物**:
- `src/game_state/progression.ts`（`Stage` 5 状態・`isDisclosed`・`isSettled`）
- `src/game_state/phase.ts`（`GamePhase`・`derivePhase`・`QUESTION_COUNT=10`）
- `src/game_state/tv_mode.ts`（`TvMode` a〜e・`stageToTvMode`）
- `src/scoring/answer_score.ts`（`AnswerScore` 0..100 整数・`isAnswerScore`・`assertAnswerScore`）
- `src/scoring/yen.ts`（`Yen`・`CURRENCY="円"`・`INITIAL_GRANT=10000`・`YEN_PER_ERROR=-100`・`PITARI_BONUS=1000`・`assertYen`）
- `src/config/connection_limit.ts`（`DEFAULT_MAX_TABLET_CONNECTIONS=8` の **単一定義**・`resolveMaxTabletConnections`）

**受入 DoD**: `dod_limit_default_eight`・`dod_limit_config_follows`・`dod_limit_no_hardcode`（既定 8、16/32 追随、判定経路に `8` を置かない）／`dod_settle_currency_yen`・`dod_settle_integer_only`（円建て・整数の型固定）／`dod_submit_range_guard` の型基盤（0/100 可・-1/101/50.5 不可）。

**Vitest（`tests/config/connection_limit.test.ts`・`tests/game_state/progression.test.ts`）**:

```typescript
// tests/config/connection_limit.test.ts
import { describe, it, expect } from "vitest";
import { resolveMaxTabletConnections } from "../../src/config/connection_limit.js";

describe("接続上限の設定外出し（IMPL-10）", () => {
  it("未設定の既定は 8（9台目拒否の基準）", () => {
    expect(resolveMaxTabletConnections({})).toBe(8);
  });
  it("16/32 へコード改修なしに追随する", () => {
    expect(resolveMaxTabletConnections({ MAX_TABLET_CONNECTIONS: "16" })).toBe(16);
    expect(resolveMaxTabletConnections({ MAX_TABLET_CONNECTIONS: "32" })).toBe(32);
  });
});
```

**MVP 境界**: 型と純関数のみ。演出・整形・I/O を持ち込まない。

### M1 — 状態機械と採点エンジン（純粋・単一所有）

**目的**: `rounds.stage` 前進／不正遷移拒否、TV ナビ、再採点起動可否、接続受入判定、精算/再採点/全再計算を純関数で確定。**計算内容は scoring、起動可否は game_state** の分界を固定（SM-2）。

**成果物**:
- `src/game_state/round_machine.ts`（`nextStage`・`previousStage`＝取消の巻き戻し先 topology）
- `src/game_state/tv_machine.ts`（`nextMode`／`backMode`／`jumpMode`）
- `src/game_state/rescore_trigger.ts`（`planRescore(stage, patch)`＝`patch.correctValue` 有 ∧ `isDisclosed(stage)` の論理積で `{rescore,syncTvDE}`）
- `src/participants/connection_machine.ts`（`admitTablet(connectedContestants, env)`・`resolveMaxTabletConnections` を R のみ）
- `src/scoring/validate_answer.ts`（0〜100 整数のサーバ検証）
- `src/scoring/settle_question.ts`（`error`・`delta_yen`・`pitari_bonus_yen` 算出）
- `src/scoring/rescore_question.ts`（開示済み問の全 settlements 再計算・balances 差分）
- `src/scoring/aggregate_balance.ts`（`10000 + Σdelta_yen + Σpitari_bonus_yen` の全再計算＝監査基準）
- `src/scoring/determine_winner.ts`（残額最多・同点は共同首位）

**受入 DoD**: `dod_settle_delta`（誤差 5 で −500 円）・`dod_settle_pitari_add`（誤差 0 で +1000・拠出配分は F-02 fixme）／`dod_rescore_after_c`・`dod_rescore_no_before_c`・`dod_rescore_only_on_correct_value`・`dod_rescore_matches_full_recompute`（差分＝全再計算）／`dod_reveal_marks_disclosed`（`isDisclosed` 真化）／`dod_winner_most_balance`。不正遷移（`answers_opened` 未到達での `reveal` 等）は `nextStage` が `RangeError` を投げる。

```typescript
// tests/scoring/rescore_boundary.test.ts
import { describe, it, expect } from "vitest";
import { planRescore } from "../../src/game_state/rescore_trigger.js";

describe("自動再採点の起動分界（SM-2 / IMPL 未満での非誘発）", () => {
  it("c 以降の correct_value 編集で走る・d 到達なら TV d/e 同時更新", () => {
    expect(planRescore("answer_revealed", { correctValue: 40 })).toEqual({ rescore: true, syncTvDE: false });
    expect(planRescore("settlement_computed", { correctValue: 40 })).toEqual({ rescore: true, syncTvDE: true });
  });
  it("c 未到達・text/メディアのみは走らず balances 不変", () => {
    expect(planRescore("answers_opened", { correctValue: 40 })).toEqual({ rescore: false });
    expect(planRescore("settlement_computed", { text: "改題" })).toEqual({ rescore: false });
  });
});
```

**MVP 境界**: 純関数のみ。演出・タイマー・音を採点/機械に混ぜない。ピタリ賞は加算側 +1000 のみ（拠出減算は 0・F-02 まで発明しない）。

### M2 — 永続層：8 テーブル・制約・リポジトリ契約

**目的**: `questions`／`participants`／`answers`／`rounds`／`game_state`／`settlements`／`balances`／`config` を DB へ定義し、**三層目防衛**（`CHECK 0<=x<=100`・金額 integer・`unique(question_id, participant_id)`・FK）を強制。カラム(snake_case)↔型(camelCase) をリポジトリで固定。

**成果物**:
- `src/persistence/` 配下のスキーマ/マイグレーション（8 テーブル・`answers`/`settlements` の複合一意・`ROUNDS.question_id` PK＝FK・`BALANCES.participant_id` PK＝FK・`participants` に **`seat_number`/事前台帳列を持たない**）
- `src/questions/questions_repository.ts`（`bulkInsert`・`getByNumber`・`listAll`・`updateContent`）
- `src/game_state/answers_repository.ts`（`upsertDuringAccepting`＝accepting ゲート・`getOwn`・`listForRevealedQuestion`）
- `src/scoring/settlements_repository.ts`・`src/scoring/balances_repository.ts`（`initialize`=10000・`applyDelta`・`listAll`）
- `src/config/config_repository.ts`（`read`／`upsert`）

**受入 DoD**: `dod_load_persist`・`dod_load_runtime_from_db`・`dod_load_media_paths_optional`・`dod_load_correct_value_integer`（DB CHECK 含む）／`dod_submit_persist`・`dod_submit_one_row_per_player`（upsert 単一行）／`dod_edit_persist`／`dod_join_no_seat_fixed`（台帳/座席列不在）／`dod_settle_initial_grant`（10000 初期化）。解決順は **環境変数 → `config` テーブル → 既定 8** を `resolveMaxTabletConnections` が担い、`admission` は R のみ。

**MVP 境界**: 確定 8 テーブルのみ。**削除(D)を設けない**（取消は `rounds.stage` の巻き戻し U であって行削除ではない）。DB は integer/CHECK/unique/FK を強制でき、クラウドサーバ常時稼働と整合し **ホスト PC を DB/サーバにしない** ものを選定する。

### M3 — リアルタイム同期核（クラウド WS 権威・ロール投影・再接続）

**目的**: WebSocket 待受を **クラウドサーバのみ** に置き、接続確立でロール確定、host コマンドの単一ロール判定点、ドメインイベントの `seq` 付きロール投影配信、切断検知/スロット解放、再接続 `state_snapshot` 復帰を実装。**ホスト PC をサーバにしない**を構造で担保。

**成果物**:
- `src/realtime_sync/server.ts`（`ws` 待受・accept/close(4001)）
- `src/realtime_sync/hub.ts`（host/contestant/audience レジストリ・**ロール単一判定点**）
- `src/realtime_sync/fanout.ts`（`projectForRole`＝可視範囲外フィールド除去）
- `src/realtime_sync/recovery.ts`（`buildSnapshot`＝サーバ権威 `game_state`/`balances`/`answers` から再構成）
- `src/realtime_sync/heartbeat.ts`（ping 15 秒／pong 猶予 30 秒→切断確定・contestant スロット解放）
- `src/realtime_sync/rejoin.ts`（不透明 resume トークン検証・失効は新規参加として上限判定再通過）

**受入 DoD**: `dod_conn_cloud_authority`・`dod_conn_role_scoped_session`／`dod_broadcast_all_role_endpoints`・`dod_broadcast_role_projection`（解答者へ他者の解答/残額/得点を配信しない）・`dod_broadcast_latency_gate`（p95 ≤ 2,000ms）／`dod_reconnect_progression`・`dod_reconnect_own_balance`・`dod_reconnect_server_authority`・`dod_reconnect_control_panel_resilient`／`dod_answer_preserved_across_reconnect`・`dod_answer_no_duplicate`／`dod_limit_existing_unaffected`（上限拒否時に既存不変）。上限拒否は `connection_rejected`＋WS `close(4001)`、host/audience は上限に数えない別チャネル。

**MVP 境界**: 配信・投影・復帰まで。配信ペイロードに演出フラグ（音/カウントダウン/アニメ）を持たせない。

### M4 — 制御盤・ゲーム進行結線（司会者専権・**取消は初版から host 権限**・IMPL-7）

**目的**: `/control-panel` の可視トリガーから host 操作を発火し、状態機械（M1）＋永続（M2）＋配信（M3）を結線。**非 host は `command_denied`（403／未認証 401）**。取消を初版から司会者権限として含める。

**成果物**:
- `src/control_panel/`（可視トリガー UI＝「問題を読み込む」「そこまで」「解答オープン！」「正解発表」「精算」「次へ/戻る/個別ジャンプ」「取消」、参加者一覧、「◯/◯台」把握・QR 提示面）
- `src/questions/`・`src/media/resolveQuestionFace`（入稿 全 or 無・メディア事前配置検証・a モードの `video→image→text` 解決）
- game_flow 適用点：`op_load_questions`（`phase=lobby`/ライブ編集中のみ・10 `rounds`=accepting と `game_state` シングルトン初期化）／`op_propagate_deadline`（lock）／`op_propagate_disclosure`（open・b）／`op_reveal_answer`（reveal・c）／`op_compute_settlement`（settle・d）／`op_propagate_mode_switch`・`op_switch_tv_mode`（a〜e）／`op_live_edit_correct`＋`op_auto_rescore` 起動／`op_display_join_qr`（`qrcode`）／`op_undo`
- `op_determine_winner`（10 問 settled で `phase=finished`・e に勝者）

**受入 DoD**: `dod_deadline_host_only`・`dod_disclosure_hidden_before`・`dod_disclosure_reveals_on_tv`・`dod_reveal_host_only`・`dod_reveal_tv_c`・`dod_settle_host_only`・`dod_mode_switch_host_only`・`dod_mode_switch_sync_tv`・`dod_edit_host_only`・`dod_edit_correct_range_guard`・`dod_edit_media_face_follows`・`dod_load_host_only`・`dod_load_no_adhoc_entry`・`dod_load_media_prevalidated`・`dod_load_all_or_nothing`・`dod_tv_a_fallback`／**`dod_undo_host_only`**。

**IMPL-7 の実装取り回し（取消）**: 初版で **実装するもの**＝`op_undo` の host-only ガード＋`trigger_undone` 配信＋`previousStage` の巻き戻し先 topology（`settlement_computed→answer_revealed→answers_opened→answers_locked→accepting`）。**推測実装しないもの**＝`settlements`/`balances` の durable な巻き戻し、任意問題の再開示可否（F-03）。曖昧が残る挙動は発明せず選択肢を添えて F028 で殿判断を仰ぎ、当該挙動の E2E は `test.fixme()` で保留する（§3.1）。

### M5 — 参加受付・タブレット入力（家族限定アクセス・接続上限拒否・入力専用最小 UI）

**目的**: QR → `/join`（家族限定アクセス通過）→ 氏名自己入力 → `/tablet` の `+1/−1/+10/−10` ステッパ＋送信を結線。接続上限拒否を **`admitTablet`（解決値 R のみ）** で行い、**0〜100 整数の多層防衛** を UI＋サーバ＋DB で完成。

**成果物**:
- `src/participants/admission.ts`（`admitTablet` 呼出し・over_limit で参加不成立）
- `src/config`（`checkJoinAccess`＝分岐 A: `JOIN_ACCESS_TOKEN` 一致／分岐 B: 認証・**未構成なら `granted:false`**）
- `/join` 面（氏名入力・「参加する」・満席平易文「ただいま満席のため参加できません」・**事前台帳/座席/保護ナビ/接続数会計/設定キー名を露出しない**）
- `/tablet` 面（入力専用・自分の残額（円）・受付中/締切/送信済み表示・**締切/開示/モード切替/他者情報の操作要素を置かない**）
- 適用点：`op_guard_family_access`／`op_join_game`（participants 1 レコード＋`balances=10000`・connection_id 紐付け）／`op_enforce_connection_limit`／`op_submit_answer`（accepting のみ upsert・締切後拒否）／`op_preserve_answer_across_reconnect`

**受入 DoD**: `dod_access_no_open_public`（無制御公開不成立）・`dod_access_single_resolution`・`dod_access_no_protected_nav`／`dod_qr_encodes_public_join_url`・`dod_qr_no_seat_ledger`／`dod_join_self_name`・`dod_join_one_device`・`dod_join_reflected`・`dod_join_name_validation`（空/空白/上限長超過を UI＋サーバで拒否）／`dod_limit_join_full_copy`（満席平易文・内部語非露出）／`dod_submit_stepper_only`・`dod_submit_range_guard`・`dod_submit_accepting_only`・`dod_submit_upsert_once`・`dod_submit_own_ack_only`。

**MVP 境界**: ステッパは 0〜100 クランプで範囲外を作れず、送信時にサーバ再検証・DB CHECK が第三層。演出・振動・効果音を入力面に足さない。

### M6 — TV 表示（a〜e・**静的描画のみ**・IMPL-F）

**目的**: 観客 `/tv` を **受動表示のみ** で実装。配信された `tv_mode` に応じて a〜e を素朴に描く。**演出を作らない**（IMPL-F の適用点）。

**成果物**:
- `src/tv_display/`（a: `resolveQuestionFace` の解決面／b: 全員の氏名＋解答／c: 正解値／d: **6 列精算表**＝氏名/解答/誤差/増減円/ピタリ賞/残額・円建て／e: 全問通算残額＋残額最多の勝者判別）
- 読みモデル供給は `stageToTvMode`／`balances`／`settlements`／`questions` を R するのみ

**受入 DoD**: `dod_disclosure_reveals_on_tv`・`dod_reveal_tv_c`・`dod_rescore_d_sync`（d/e 同時更新）・`dod_winner_most_balance`・`dod_tv_a_fallback`・`dod_tv_a_reflects_live_edit`・`dod_tv_a_no_path_leak`（生パス/`fallback` 等の内部語を出さない）・`dod_settle_currency_yen`（`point`/`pt`/`点` を TV 表示に出さない）。

**IMPL-F の実装取り回し（過剰実装禁止）**: 本マイルストーンで **作らない** ＝効果音・カウントダウン・アニメ・ランキング演出。d/e は数値表・勝者判別を静的に描くだけで、順位段階演出・カウントアップ・紙吹雪・BGM を実装しない。TV は入力・操作要素を一切持たない。演出はスコープ外の後続として本計画に含めない（§3.3）。

### M7 — 統合・非機能ゲート（起動・レイテンシ・健全性）

**目的**: M0〜M6 を結合し、起動シーケンスと非機能ゲートを満たす。

**成果物・受入**:
- 起動：`npm ci` → `npm run build` → `npm run start`（クラウド WEB アプリ＋WebSocket ゆえサーバ常駐必須）。`/healthz`（またはベース URL）が **`< 500`** を返すまで最大 **60 秒**ポーリングしてから試験開始。`E2E_BASE_URL`（WS 昇格可能オリジン）・`PUBLIC_BASE_URL`・`MAX_TABLET_CONNECTIONS`・アクセス制御設定を検証環境値で注入。
- 非機能ゲート：状態遷移の全端末反映 **p95 ≤ 2,000ms**（F-04 暫定・`dod_broadcast_latency_gate`）、入稿（10 問）**p95 ≤ 1,000ms**、全 HTTP 応答 **`< 500`**（上限拒否/非 host/締切後送信/不正遷移は 5xx でなく業務ステータス＝`connection_rejected`／WS `close(4001)`／`command_denied` 403・401／満席平易文／`RangeError` の業務エラー写像で表す）、接続数 既定 8・設定 16/32、切断検知 ping 15 秒/pong 猶予 30 秒。

### M8 — E2E 証跡（Vitest 宣言・Playwright ライブラリ駆動・MECE 7 軸）

**目的**: 上流 OBM から生成される E2E を、6 主要シーケンス（参加・回答・締切/開示/モード切替・正解発表/精算・正解ライブ編集/再採点・再接続整合）に沿って通す。宣言・検証は **Vitest**、ブラウザ駆動は **Playwright を import**。

**成果物**: API/WS 統合 `tests/e2e/*.spec.ts`、ブラウザ `tests/e2e/*.browser.spec.ts`、共有ヘルパ `tests/e2e/helpers/`（`.js` 参照）。

**MECE 7 軸の網羅**: happy path（`op_join_game`／`op_submit_answer`／`op_compute_settlement`）、persistence/readback（`dod_load_persist`／`dod_edit_persist`／`dod_answer_preserved_across_reconnect`）、permission boundary（`dod_*_host_only`／`dod_submit_stepper_only`）、terminal-state guard（`dod_submit_accepting_only`／`dod_rescore_no_before_c`）、cross-actor reflection（`dod_join_reflected`／`dod_disclosure_reveals_on_tv`／`dod_broadcast_role_projection`）、derived-state/read-model chain（`dod_tv_a_fallback`／`dod_rescore_matches_full_recompute`／`dod_winner_most_balance`）、threshold/boundary（`dod_limit_default_eight`／`dod_submit_range_guard`／`dod_broadcast_latency_gate`）。**F-02/F-03/F-05 に関わる未確定挙動は `test.fixme()`** で保留（§3）。

### マイルストーン依存・操作対応の総覧

| マイルストーン | 主モジュール | 代表操作 | 前提 |
|---|---|---|---|
| M0 | game_state・scoring・**config** | 純粋型・`resolveMaxTabletConnections`（IMPL-10） | scaffold のみ |
| M1 | game_state・scoring・participants | `nextStage`・`planRescore`・`admitTablet`・`settleQuestion` | M0 |
| M2 | questions・game_flow・scoring・config | `op_load_questions`（永続）・upsert・初期化 | M0 |
| M3 | realtime_sync | `op_establish_connection`・`op_broadcast_state_transition`・`op_recover_on_reconnect` | M0–M2 |
| M4 | control_panel・game_flow・questions・media | lock/open/reveal/settle/switch/edit/**undo**（IMPL-7） | M1–M3 |
| M5 | participants・config・tablet | `op_guard_family_access`・`op_join_game`・`op_enforce_connection_limit`・`op_submit_answer` | M1–M3 |
| M6 | **tv_display**・scoring | a〜e 静的描画（IMPL-F） | M2–M4 |
| M7 | 全体 | 起動・非機能ゲート | M3–M6 |
| M8 | tests/e2e | 6 シーケンス・7 軸 | M0–M7 |

---

## 3. Risks

壁打ち（要件定義）フェーズはクローズ済で殿判断待ちの論点は残っていない。以下は実装計画に関して実装組み立てフェーズで MAS が決める選定、推測実装せず殿判断を仰ぐ点、検証ゲートで暫定運用中のフラグである。いずれも「推奨なし」「要検討」「TBD」の空白は残さず、確定した制約・既定機構・暫定ゲート値・封じ込め方を明記する。

### 3.1 F028 エスカレーション（推測実装しない・実装計画上の封じ込め）

- **取消の巻き戻し範囲（論点7・F-03／IMPL-7）**: M4 で **確定分（host-only ガード・`trigger_undone` 配信・`previousStage` topology）は実装・検証** する（`dod_undo_host_only`）。一方、`trigger_undone` が 1 段だけ戻すのか、任意問題を `answer_revealed` へ戻して再採点するのか、d 到達問の `settlements`/`balances` 差分をどこまで巻き戻すのかという **durable 副作用は曖昧につき推測実装せず**、選択肢を添えて F028 で殿判断を仰ぐ。巻き戻し副作用の E2E は `test.fixme()`（M8）。**リスク=先行実装が巻き戻しセマンティクスを勝手に確定させること**。封じ込め＝M4 で副作用を書かず topology とガードに留める。
- **ピタリ賞の拠出配分（B・F-02）**: M1 で **加算側 +1,000 円は確定・実装必須**（`dod_settle_pitari_add`）。**拠出（減算）側と配分**（総額 1,000 か各人からか、複数同時ピタリの扱い）は未確定につき `balances` の拠出減算を **0** とし、確定後に `settlements` へ負の拠出行を追加する拡張余地を残す（加算側 +1000 は変更しない）。挙動詳細の E2E は `test.fixme()`。**リスク=拠出方式を発明して balances 保存則を壊すこと**。封じ込め＝`settlements` に拠出行を追加できる形にしつつ現段階は 0 拠出。
- **同名参加者の識別表示（論点9改の周辺）**: 「同名の別人」を許容（氏名は一意キーでなく identity は `participants.id`）は確定だが、TV(e)・制御盤一覧で同名を区別する付記（連番・参加順）は要件に無いため **発明しない**。必要判明時は選択肢を添えて F028。

### 3.2 実装組み立てフェーズの選定（MAS 決定・殿判断不要）

| 項目 | 決定/既定 | 制約・選定軸 |
|---|---|---|
| ビルド順 | 純粋層(M0)→機械/採点(M1)→永続(M2)→同期(M3)→サーフェス(M4/M5/M6)→統合(M7)→E2E(M8) | 単一所有を先に確定し再実装ドリフトを排除（§1.5） |
| DB 永続化技術 | 8 テーブルを integer/CHECK/unique/FK で強制できる DB を選定 | クラウドサーバ常時稼働と整合・ホスト PC を DB/サーバにしない |
| host 判定点 | 接続確立時の `role` を全 host コマンドの単一判定点として参照 | 副司会を発明せず非 host は 403／未認証 401 |
| 再採点の実行方式 | 実行時は差分更新、正しさの基準は `aggregateBalance` の全再計算 | 差分後 `balances` が全再計算と一致（`dod_rescore_matches_full_recompute`） |
| 上限の持ち方 | 環境変数 `MAX_TABLET_CONNECTIONS`→`config`→既定 8、`src/config` が唯一の解決点 | 判定経路に `8` を置かない（IMPL-10・`dod_limit_no_hardcode`） |
| 削除(D) | スコープに D なし。取消は `rounds.stage` 巻き戻し U | soft-no-delete・監査可能性保持 |
| マイグレーション配置 | `src/persistence/` 配下 | `tests/`・runner 設定に置かない（output-path fence） |

### 3.3 実装計画固有のリスクと封じ込め

- **過剰実装（IMPL-F・最重要）**: 効果音・カウントダウン・アニメ・ランキング演出を MVP に混入させると即リリース不可。**封じ込め**＝M6 の `module:tv_display` は配信 `tv_mode` の静的描画のみ、`module:scoring` は確定式のみ。演出は本計画のマイルストーンに一切含めず、d/e は数値表・勝者判別を静的に描くだけとする。§1.4 の OUT リストをコードレビューのチェック項目にする。
- **接続上限のハードコード混入（IMPL-10）**: 判定コードに数値リテラル `8` を撒くと違反。**封じ込め**＝M0 で `DEFAULT_MAX_TABLET_CONNECTIONS` を `src/config/connection_limit.ts` に単一定義し、`admitTablet`（M1）は解決値 R のみ。`dod_limit_no_hardcode` を M0/M5 の受入で機械検証。
- **司会者専権の逸脱（IMPL-7 継承・OBM-1）**: 非 host 経路から進行遷移・取消が成立すると違反。**封じ込め**＝M3 の hub 単一ロール判定点を全 host コマンドが経由、M4/M5 で非 host サーフェスに操作要素を置かず API 直叩きも同判定点で 403/401。
- **再実装ドリフト**: `isDisclosed`/`isSettled`/`Stage`/`stageToTvMode`/`AnswerScore`/`Yen`/`resolveMaxTabletConnections` を複数モジュールで再宣言すると採点/機械の判定が食い違う。**封じ込め**＝§1.5 の単一所有表どおり `src/game_state/`・`src/scoring/`・`src/config/` にのみ定義し、他は `.js` 明示 import のみ。
- **レイアウト/モジュール指定子違反**: `test/`/`spec/` へのテスト配置、`src/` 外のソース、`.js` 拡張子欠落（TS2835）、runner 設定ファイルの emit は fence で drop され「未生成」としてビルド失敗。**封じ込め**＝全マイルストーンで `src/`・`tests/` 遵守と `.js` 明示を CI 前提とし、`package.json`/`tsconfig.json`/`vitest.config.ts`/`package-lock.json` を成果物に含めない。
- **プライバシー投影漏れ**: 解答者端末へ他者の解答/残額/得点が渡ると違反。**封じ込め**＝M3 の `projectForRole` を全 fan-out・再接続 `buildSnapshot` の唯一経路とし、`dod_broadcast_role_projection`・`dod_reconnect_own_balance` を検証。

### 3.4 検証ゲートで暫定運用中のフラグ（設計義務の欠落・発明せず flag）

- **F-01（残額の下限・脱落）**: 確定要件は「誤差 × −100 円」「先渡し 10,000 円」のみで、`balances.amount` の 0 下限や全額喪失での脱落は確定要件に無い。**下限 `CHECK` を課さず負残高も表現可能**とし、`in_progress→finished` は 10 問精算完了でのみ導出する（残額に絡めない）。下限/脱落を導入する実装が現れた場合にフラグ。
- **F-04（同期レイテンシ SLA）**: 固定 SLA が無いため、状態遷移の全端末反映は **p95 ≤ 2,000ms**、入稿は **p95 ≤ 1,000ms** を暫定テストゲート（M7）とし、SLA 確定時に更新（`dod_broadcast_latency_gate`）。
- **F-05（家族限定アクセス制御）**: M5 で分岐 A（`JOIN_ACCESS_TOKEN` 一致）／分岐 B（認証時のログイン→リダイレクト→氏名入力描画）を評価し、未実装なら該当ブラウザテストを `test.fixme()`。ただし `checkJoinAccess` の **未構成時 `granted:false`**（無制御公開を成立させない）は値に依らず検証必須。無制御公開のまま出荷はリリース不可。
- **F-06（残額同点時の勝者優先順位）**: 「残額最多勝ち」は確定だが、同点時の優先順位（先着・問別勝率等）は確定要件に無い。`determineWinner`（M1）は同点を **複数の共同首位** として返し、優先順位を発明しない。導入実装が現れた場合にフラグし、必要なら F028。
- **F-06'（動画コーデック/配信方式）**: 動画実体は問題ファイル記載＋所定フォルダ事前配置で確定だが、TV a モードで確実に再生できるコンテナ/コーデックの固定値は設計に無い。M4/M6 では `<video>` が本番ブラウザで再生可能な形式を選定軸とし、**現時点ではパス存在検証までを義務**とする。再生不可形式の混入は入稿検証の拡張対象としてフラグ。
