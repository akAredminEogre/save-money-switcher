---
codd:
  node_id: design:scoring-engine-design
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
  - id: detailed_design:state-machines
    relation: depends_on
    semantic: technical
  - id: test:test-strategy
    relation: depends_on
    semantic: verification
  conventions:
  - targets:
    - module:scoring
    reason: 先渡し 10,000 円・誤差1=−100 円・ピタリ賞（誤差0）は他プレイヤーから 1,000 円獲得・10問・残額最多勝ちの確定ルールを厳守（A〜D）。違反時リリース不可。
  - targets:
    - module:scoring
    - module:tv_display
    reason: 現金感を薄めない＝円建て・ポイント置換禁止（表示・内部表現とも円）。違反時リリース不可。
  - targets:
    - module:scoring
    reason: 回答・誤差・減算額はすべて 0〜100 整数前提の整数円で計算する（論点G）。違反時リリース不可。
  - targets:
    - module:scoring
    - module:game_flow
    reason: c 正解発表後の正解訂正は自動再採点し、d 精算済みなら残額差分も再計算し TV d/e を同時更新する（E-3残）。違反時リリース不可。
  modules:
  - scoring
  - game_flow
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
    - id: op_join_game
      actor: answerer
      verb: join
      target: game_session
      trigger: 制御盤の QR を読取り /join で氏名を自己入力して参加確定
      route: /join
      ui_pattern: qr_scan_then_name_input
      preconditions:
      - 接続数が MAX_TABLET_CONNECTIONS 未満
      durable_state: participants テーブル ＋ balances 行の初期化（amount = 10000）
      readback: 制御盤の参加者一覧と TV e モードに反映
      visible_to:
      - host
      - audience
      expected_outcomes:
      - 当該参加者の balances.amount が 10000 円（賞金先渡し）で初期化される
      forbidden_actors: []
      dod_obligations:
      - id: dod_settle_initial_grant
        text: ゲーム開始時に各プレイヤーの balances.amount が 10000 円で初期化されている
    - id: op_compute_settlement
      actor: host
      verb: settle
      target: balances
      trigger: 制御盤で得点精算を実行
      route: /control-panel
      forbidden_actors:
      - answerer
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
      - id: dod_settle_delta
        text: 誤差 5 の精算後に当該プレイヤーの balances.amount が精算前より 500 円少ない
      - id: dod_settle_pitari_add
        text: 誤差 0 のプレイヤーの pitari_bonus_yen が +1000 で balances に反映される（拠出配分側は F-02
          未確定として fixme）
      - id: dod_settle_currency_yen
        text: settlements と balances と API 応答と d の 6 列表が円建てで表され point/pt/点 の語が存在しない
      - id: dod_settle_integer_only
        text: error / delta_yen / pitari_bonus_yen / amount がすべて整数で小数値を持たない
      - id: dod_settle_host_only
        text: 得点精算は role host のみ発動でき answerer からの精算コマンドは 401/403 で拒否される
    - id: op_live_edit_correct
      actor: host
      verb: edit
      target: question_or_correct_value
      trigger: 制御盤のライブ編集 UI で正解を更新
      route: /control-panel
      forbidden_actors:
      - answerer
      durable_state: questions.correct_value 更新
      readback: DB 再取得で編集後の正解値を返す
      expected_outcomes:
      - 進行中に編集した正解値が questions に永続する
      - 開示済み（c 以降）の問なら自動再採点の契機となる
      dod_obligations:
      - id: dod_edit_persist
        text: 進行中に編集した正解値が questions に永続し再取得で読み戻せる
    - id: op_auto_rescore
      actor: system
      verb: rescore
      target: balances
      trigger: 開示済み（rounds.stage が answer_revealed 以降）の問題で正解をライブ編集
      preconditions:
      - 当該問の rounds.stage が answer_revealed 以降（isDisclosed 真）
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
      boundary_cases:
      - 残額同点は複数の共同首位を勝者として提示（同点優先順位は確定要件に無く発明しない・F-06）
      dod_obligations:
      - id: dod_winner_most_balance
        text: 10 問終了時に balances.amount 最多のプレイヤーが e モードで勝者として判別できる
---

# 採点エンジン設計（賞金先渡し・誤差減算・ピタリ賞・自動再採点）

## 1. Overview

本書は `save-money-switcher`（フジテレビ『賞金先渡しクイズ SAVE MONEY』方式を家族で遊ぶクイズ操作盤）の **採点エンジン設計** であり、上位の `design:system-design`（クラウド WEB アプリ・アーキテクチャ）と `design:data-model-design`（永続構造・派生読みモデル）を技術的真実源として、`module:scoring` が担う **賞金先渡し・誤差減算・ピタリ賞・自動再採点** の計算規則、値の表現、派生状態連鎖、および正解訂正時の差分再計算と TV d/e 同時更新を確定する。ここに記す 🟦 確定値・不変条件に反する成果物は **リリース不可（release-blocking）** として扱う。

### 1.1 採点エンジンのスコープ

採点エンジンは、確定した答え（`answers.value`）と正解（`questions.correct_value`）から、問ごと・人ごとの精算（`settlements`）と集計残額（`balances`）を **整数円** で導出する純粋計算層である。担当する責務は次のとおり。

- **賞金先渡し**: ゲーム開始（参加確定）時に各プレイヤーの残額を **10,000 円** で初期化する。
- **誤差減算**: 誤差 = |解答 − 正解|（0〜100 整数）を求め、増減円 = 誤差 × **−100 円** で残額を減らす。
- **ピタリ賞**: 誤差 0 のプレイヤーに **+1,000 円** を加算する（拠出配分の下側は §2.11・F-02 で確定待ち、加算側 +1,000 は確定・実装必須）。
- **勝敗判定**: 1 ゲーム **10 問** 全問の得点精算完了時、通算 **残額最多** のプレイヤーを勝者として e モードへ供給する。
- **自動再採点**: 正解発表（c）以降にライブ編集された正解に対し、当該問の全 `settlements` と `balances` を自動で再計算する。得点精算（d）まで進んだ問は **残額の差分再計算** を行い、TV の **d（精算表）と e（全員通算）を同時更新** する。
- **二重防衛の一翼**: 0〜100 整数のサーバ側最終検証（`src/scoring/validate_answer.ts`）を担い、UI（`src/tablet/`）と対で不正値の混入を拒む。データモデル側の DB `CHECK` が三層目となる。

採点エンジンは計算・検証を担い、進行段階（受付中／締切／開示／発表／精算）の**遷移権限**そのものは `module:game_flow`（`src/game_state/`）と `module:control_panel` が保持する。採点エンジンは進行段階（`rounds.stage`）を**読取り**、`isDisclosed` / `isSettled` によって再採点範囲を判定する（§2.8）。

### 1.2 リリースブロッキング規約と本書での具体化

| # | 対象 | 不変条件（要旨） | 本書での具体化箇所 |
|---|---|---|---|
| SC-1 | `module:scoring` | 先渡し 10,000 円 ／ 誤差 1 = −100 円 ／ ピタリ賞（誤差 0）は他プレイヤーから 1,000 円獲得 ／ 10 問 ／ 残額最多勝ち を確定ルールとして厳守（A〜D） | §2.1・§2.3・§2.4・§2.10 |
| SC-2 | `module:scoring`・`module:tv_display` | 現金感を薄めない＝**円建て固定**・ポイント／点への置換禁止（表示・内部表現とも円） | §1.4・§2.6・§2.9 |
| SC-3 | `module:scoring` | 回答・誤差・減算額はすべて **0〜100 整数前提の整数円** で計算する（論点 G） | §2.2・§2.5 |
| SC-4 | `module:scoring`・`module:game_flow` | c 正解発表後の正解訂正は **自動再採点**、d 精算済みなら **残額差分も再計算** し TV d/e を同時更新する（E-3 残） | §2.7・§2.8・§2.9 |

上位から継承する不変条件も本エンジンで担保する: **ホスト PC をサーバにしない**（採点は権威サーバ側の純粋計算・§2.12 継承）、**ロール境界**（精算・再採点を起こすトリガー発火は `role: host` のみ・§2.10 継承）、**0〜100 整数の二重防衛**（UI ＋サーバ、DB `CHECK` が三層目・§2.5）。

### 1.3 実装・ツールチェーン前提（scaffold 固定・釈義不可）

- **実装言語 = TypeScript のみ。** 本書のドメイン型・純関数・リポジトリ参照・ファイルパス・依存参照はすべて TypeScript 慣行のみを用いる。他言語の拡張子・マニフェスト・ツールは例示・フォールバックとしても登場させない。
- **テストランナー = Vitest（固定・release-blocking のグラウンドトゥルース）。** 採点規則の受け入れは Vitest 自身の宣言 API（`import { describe, it, expect } from "vitest";`）で記述する。「ランタイム依存を最小化する」方針は **出荷コードのランタイム依存** にのみ及び、テストランナーには及ばない。依存数の哲学を根拠に別フレームワークや Node 組み込み `node:test` を用いてはならない。verify が実際に走らせるのは Vitest である。
- **モジュール解決 = NodeNext/Node16。** すべての相対 import は **出力される `.js` ファイル名を明示した拡張子** を伴う（`import { assertYen } from "./yen.js";`。`"./yen"`・`"./yen.ts"` は不可）。default/namespace import・re-export（`export { applyQuestionScore } from "./apply_question_score.js";`）・type-only import（`import type { AnswerScore } from "./answer_score.js";`）も同一規約。拡張子欠落は TS2835 でコンパイル不能。
- **レイアウト契約（output-path fence 強制）。** 採点エンジンのソースは **必ず `src/scoring/` 配下**、進行段階判定は `src/game_state/` 配下、テストは **必ず `tests/` 配下**（`test/`・`spec/`・`specs/` を発明しない。サブディレクトリ `tests/scoring/` 等は可）。`package.json`・`package-lock.json`・`tsconfig.json`・`vitest.config.ts` は harness scaffold 所有につき、本書はこれらを成果物として出力・宣言しない。

### 1.4 採点結果を表示するサーフェスへのコピー義務

採点エンジンが値を供給するサーフェスとロール（内部識別子 → 可視ラベル）: `role: host` → **司会者**、`role: answerer` → **解答者**、観客（TV 視聴者）。可視コピーには **可視ラベル** を用い、内部識別子（host/answerer）・実装根拠・環境前提を露出させない。全サーフェス共通で `point`／`pt`／`点` を **禁止パターン** とし、金額は「円」で表す（SC-2）。

| サーフェス | ルート | 主対象アクター | 目的 | 許可表示 | 禁止表示 | 必須の可視コピー意図 | 禁止コピー |
|---|---|---|---|---|---|---|---|
| TV d（1 問精算表） | `/tv` | 観客 | 当該問の 6 列全員表を提示 | **氏名 / 解答 / 誤差 / 増減円 / ピタリ賞 / 残額** の 6 列（受動表示のみ） | いかなる入力・操作要素 | 増減円・残額を **円** で表す。氏名は `participants.name`（自己入力） | `point`/`pt`/`点`・「端末 1」等の座席割当ラベル・実装ノート |
| TV e（通算一覧） | `/tv` | 観客 | 全問通算の全員残額と勝者判別 | `balances` 全員通算・残額最多の勝者判別（受動表示のみ） | いかなる入力・操作要素 | 通算残額を **円** で表示。勝者を判別可能に提示 | `point`/`pt`/`点`・内部 role 識別子 |
| タブレット（自分の残額） | `/tablet` | 解答者 | 自分の残額のみ確認 | **自分の残額のみ**（円） | 他者の残額／得点／解答・全体一覧・司会者操作語 | 「あなたの残額 ◯◯円」等の解答者向け語 | 他者情報・`point`/`pt`/`点` |

採点エンジンは、タブレット向け読みモデルへ **当該解答者自身の残額のみ** を渡し、他者の `settlements`／`balances`／`answers` を含めない（クロスアクター可視性・§2.9）。d の 6 列表と e の通算、および API 応答は円建てで表し、`point`/`pt`/`点` をスキーマ・派生・表示のどこにも持たせない。

---

## 2. Architecture

### 2.1 スコアリングの確定ルール（SC-1・改変禁止）

以下は要件裁可（案 A・SAVE MONEY 準拠・個人戦）で確定した値であり、本エンジンはこれを唯一の計算規則とする。旧軍師推奨の「点化」「500 点」「現金感を薄める」は無効であり、採用しない。

| 規則 | 確定値 | 計算式 | 境界 |
|---|---|---|---|
| 賞金先渡し | 10,000 円 | 開始時 `balance = 10000` | 全員一律 |
| 誤差 | 0〜100 整数 | `error = |answer − correct|` | 0=丁度 / 100=最大 |
| 誤差減算 | 誤差 1 につき −100 円 | `deltaYen = error × -100` | 誤差 1 → −100 のみ（ピタリ賞なし） |
| ピタリ賞 | 誤差 0 で +1,000 円 | `pitariBonusYen = (error === 0) ? +1000 : 0` | 誤差 0 → +1000（丁度） |
| ゲーム長 | 10 問 | `QUESTION_COUNT = 10` | 10 問全問 `settlement_computed` で終了 |
| 勝敗 | 残額最多勝ち | `max(balances.amount)` | §2.10 |

- **1 問あたりの残額増減** = `deltaYen + pitariBonusYen`。誤差 0 のみ純増（+1,000）、誤差 1 以上は純減（誤差 × −100）。誤差 0 と誤差 1 の間に不連続（+1,000 と −100）があることを境界として明示する。
- ピタリ賞の **加算側 +1,000 は確定・実装必須**。「他プレイヤーから獲得」の **拠出（減算）側** は F-02 未確定のため現段階では拠出減算を 0 とし、加算側のみ反映する（§2.11）。

### 2.2 ドメイン値型（0〜100 整数・整数円・SC-3 の型固定）

回答レンジと通貨を型レベルで固定し、`module:scoring` 内外の全経路で共有する。データモデル §2.7 の値型定義を本採点エンジンの唯一の基盤型とする。

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
export type Yen = number;                   // 整数円（point/pt/点 への置換禁止）
export const CURRENCY = "円" as const;
export const INITIAL_GRANT: Yen = 10_000;   // 賞金先渡し
export const YEN_PER_ERROR: Yen = -100;     // 誤差 1 あたりの増減円
export const PITARI_BONUS: Yen = 1_000;     // 誤差 0 の加算側
export const QUESTION_COUNT = 10;           // 1 ゲームの問数

export function assertYen(v: number): Yen {
  if (!Number.isInteger(v)) {
    throw new TypeError("金額は整数円のみ（小数・point/pt/点 禁止）");
  }
  return v;
}
```

- **SC-3 準拠**: 回答・誤差・減算額はすべて `AnswerScore`（0〜100 整数）と `Yen`（整数円）で表す。計算途中の小数化は `assertYen` の実行時アサートと `Number.isInteger` で排除し、小数・ポイントを持つ経路を型と実行時の双方で禁じる。
- **SC-2 準拠**: `CURRENCY = "円"` を単一定義とし、`point`/`pt`/`点` を定数・型・派生・表示のどこにも持たせない。

### 2.3 精算コア `applyQuestionScore`（SC-1・SC-3）

1 プレイヤー・1 問の精算を行う純関数。誤差・増減円・ピタリ賞・更新後残額・通貨を返す。

```typescript
// src/scoring/apply_question_score.ts
import { assertAnswerScore, type AnswerScore } from "./answer_score.js";
import { assertYen, CURRENCY, YEN_PER_ERROR, PITARI_BONUS, type Yen } from "./yen.js";

export interface ScoreInput {
  balance: Yen;
  answer: AnswerScore;
  correct: AnswerScore;
}

export interface ScoreResult {
  error: AnswerScore;
  deltaYen: Yen;            // error × -100
  pitariAwarded: boolean;
  pitariBonusYen: Yen;     // 0 または +1000
  balance: Yen;            // input.balance + deltaYen + pitariBonusYen
  currency: typeof CURRENCY;
}

export function applyQuestionScore(input: ScoreInput): ScoreResult {
  const answer = assertAnswerScore(input.answer);
  const correct = assertAnswerScore(input.correct);
  const error = Math.abs(answer - correct) as AnswerScore;
  const deltaYen = assertYen(error * YEN_PER_ERROR);       // error × -100
  const pitariAwarded = error === 0;
  const pitariBonusYen = assertYen(pitariAwarded ? PITARI_BONUS : 0);
  const balance = assertYen(input.balance + deltaYen + pitariBonusYen);
  return { error, deltaYen, pitariAwarded, pitariBonusYen, balance, currency: CURRENCY };
}
```

問全体の精算は、当該問の全解答に対して `applyQuestionScore` を適用し `QuestionSettlement[]` を生成する。集計残額は `INITIAL_GRANT` に全問の `deltaYen + pitariBonusYen` を積み上げて求める。

```typescript
// src/scoring/settle_question.ts
import { applyQuestionScore } from "./apply_question_score.js";
import type { AnswerScore } from "./answer_score.js";
import type { QuestionSettlement } from "./settlement.js";

export interface AnswerRow {
  participantId: string;
  value: AnswerScore;
}

export function settleQuestion(
  questionId: string,
  correct: AnswerScore,
  answers: readonly AnswerRow[],
): readonly QuestionSettlement[] {
  return answers.map((a) => {
    const r = applyQuestionScore({ balance: 0, answer: a.value, correct });
    return {
      questionId,
      participantId: a.participantId,
      answerValue: a.value,
      error: r.error,
      deltaYen: r.deltaYen,
      pitariAwarded: r.pitariAwarded,
      pitariBonusYen: r.pitariBonusYen,
    };
  });
}
```

```typescript
// src/scoring/aggregate_balance.ts
import { INITIAL_GRANT, assertYen, type Yen } from "./yen.js";
import type { QuestionSettlement } from "./settlement.js";

// balances.amount = 10000 + Σ(deltaYen) + Σ(pitariBonusYen)（拠出減算は F-02 未確定のため現状 0）
export function aggregateBalance(settlements: readonly QuestionSettlement[]): Yen {
  const sum = settlements.reduce((acc, s) => acc + s.deltaYen + s.pitariBonusYen, 0);
  return assertYen(INITIAL_GRANT + sum);
}
```

### 2.4 データモデル連携（`settlements` / `balances`）

採点エンジンは、データモデル §2.6 の 2 テーブルへ書込む値を生成する純関数群を提供し、永続化そのものはリポジトリ（`src/persistence/`）が担う。型はデータモデルと同一定義を共有する。

- **`settlements`（問×人の拠出台帳）**: `question_id` / `participant_id` / `answer_value` / `error`（0〜100）/ `delta_yen`（誤差 × −100・0 以下）/ `pitari_awarded` / `pitari_bonus_yen`（0 または +1000）。一意制約 `unique(question_id, participant_id)`。
- **`balances`（集計読みモデル）**: `participant_id` / `amount`（整数円 = 10000 + Σ settlements）。

```typescript
// src/scoring/settlement.ts
import type { AnswerScore } from "./answer_score.js";
import type { Yen } from "./yen.js";

export interface QuestionSettlement {
  questionId: string;
  participantId: string;
  answerValue: AnswerScore; // 0..100
  error: AnswerScore;       // |answer - correct|
  deltaYen: Yen;            // error × -100
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

- **初期化（SC-1）**: 参加確定（`op_join_game`）または `phase = in_progress` 開始時に各 `balances.amount = 10000`。`settlements` 皆無で Σ=0 のため `aggregateBalance([]) === 10000` と一致する。
- **整合不変式**: `balances.amount` は当該プレイヤーの `settlements` からの全再計算（`aggregateBalance`）と常に一致する。差分更新（§2.7）はこの不変式を破らない最適化として扱う。

### 2.5 0〜100 整数の二重防衛とサーバ側最終検証（SC-3・INV-6 継承）

採点・判定・入力の全経路で 0〜100 の整数のみを受理する。**UI（`src/tablet/`）とサーバ（`src/scoring/validate_answer.ts`）の双方** で、小数・負値・100 超・非数値を拒否する。片方でしか拒否しない実装はリリース不可。データモデル側の DB `CHECK` が三層目の防衛となる。

```typescript
// src/scoring/validate_answer.ts
import { assertAnswerScore, type AnswerScore } from "./answer_score.js";

// サーバ側最終防衛（UI と対）: 受信した解答が 0〜100 整数であることを保証する。
// UI を迂回した -1 / 101 / 50.5 / 非数値は answers に入れない。
export function validateSubmittedAnswer(raw: unknown): AnswerScore {
  return assertAnswerScore(raw);
}
```

境界（release-blocking）: **0=受理 / 100=受理 / −1=拒否 / 101=拒否 / 50.5=拒否**。`applyQuestionScore` も入力を `assertAnswerScore` で検証するため、精算経路に不正値が混入しても計算前に `RangeError` で弾かれる。

### 2.6 円建て固定（SC-2）

- 精算結果・API 応答・TV d/e 供給用読みモデル・タブレット自残額表示は **すべて円** で表す。`ScoreResult.currency` は常に `CURRENCY = "円"` を保持する。
- `point`／`pt`／`点` の語を、スキーマ列・ドメイン型・派生値・可視コピーのいずれにも持たせない（§1.4 の禁止コピー・データモデル §2.7 の型固定と一致）。
- 「現金感を薄めない」意図に反する換算（点化・ポイント化）は導入しない。増減円・残額は §2.1 の確定値どおり円で表示し、TV d の 6 列表・TV e の通算一覧で円建てを崩さない。

### 2.7 自動再採点と差分再計算（SC-4・E-3 残・release-blocking）

正解のライブ編集（`op_live_edit_correct`）が **開示済み（c 以降）の問** に対して起きたとき、採点エンジンが自動再採点（`op_auto_rescore`）する。

- **契機**: `isDisclosed(rounds.stage)` が真の問で `questions.correct_value` を編集。`isDisclosed` 偽（c 未到達）の編集では再採点は起きない（境界外・§2.8）。
- **再計算**: 当該問の全 `settlements` を編集後 `correct_value` と既存 `answers.value` から再計算し（`settleQuestion`）、`balances.amount` を **旧拠出との差分**（`(新 deltaYen + 新 pitariBonusYen) − (旧 deltaYen + 旧 pitariBonusYen)`）で更新する。
- **TV d/e 同時更新**: 当該問が `isSettled`（d 到達＝`settlement_computed`）なら、残額の差分再計算を伴い TV の **d（当該問精算表）と e（全員通算）を同時更新** する。
- **監査不変式**: 差分更新後の `balances.amount` は、`answers` ＋ 編集後 `correct_value` からの全再計算（`aggregateBalance`）と一致する（`dod_rescore_matches_full_recompute`）。差分更新は最適化であり、正しさの基準は全再計算である。

```typescript
// src/scoring/rescore_question.ts
import { settleQuestion, type AnswerRow } from "./settle_question.js";
import { assertYen, type Yen } from "./yen.js";
import type { AnswerScore } from "./answer_score.js";
import type { QuestionSettlement } from "./settlement.js";

export interface BalanceDelta {
  participantId: string;
  deltaYen: Yen; // この問での (新拠出 − 旧拠出)
}

export interface RescoreResult {
  settlements: readonly QuestionSettlement[];
  balanceDeltas: readonly BalanceDelta[];
}

export function rescoreQuestion(
  questionId: string,
  newCorrect: AnswerScore,
  answers: readonly AnswerRow[],
  oldSettlements: readonly QuestionSettlement[],
): RescoreResult {
  const next = settleQuestion(questionId, newCorrect, answers);
  const oldByParticipant = new Map(oldSettlements.map((s) => [s.participantId, s]));
  const balanceDeltas = next.map((s) => {
    const old = oldByParticipant.get(s.participantId);
    const oldContribution = old ? old.deltaYen + old.pitariBonusYen : 0;
    const newContribution = s.deltaYen + s.pitariBonusYen;
    return {
      participantId: s.participantId,
      deltaYen: assertYen(newContribution - oldContribution),
    };
  });
  return { settlements: next, balanceDeltas };
}
```

### 2.8 進行段階との連携（`isDisclosed` / `isSettled`・SC-4）

再採点範囲は進行段階（`rounds.stage`）に依存する。採点エンジンは `src/game_state/progression.ts` の判定関数を **読取り** に用い、遷移権限は持たない（遷移は `role: host` のみ・§2.10）。

```typescript
// src/game_state/progression.ts
export type Stage =
  | "accepting"
  | "answers_locked"
  | "answers_opened"       // b
  | "answer_revealed"      // c
  | "settlement_computed"; // d

const DISCLOSED: readonly Stage[] = ["answer_revealed", "settlement_computed"];

export function isDisclosed(stage: Stage): boolean {
  return DISCLOSED.includes(stage);
}

export function isSettled(stage: Stage): boolean {
  return stage === "settlement_computed";
}
```

- **`isDisclosed`（c 以降）が真の問のみ** 正解ライブ編集が自動再採点対象になる。c 未到達（`accepting`/`answers_locked`/`answers_opened`）の正解編集では再採点を起こさない。
- **`isSettled`（d 到達）** の問は、正解訂正時に残額差分の再計算と TV d/e 同時更新を伴う。

### 2.9 派生状態・読みモデル連鎖（producer → durable → derived → consumer）

採点エンジンは以下の単一方向連鎖の derived / read-model 段を担う。

1. **producer**: `answers.value`（受付中に解答者が送信・`module:tablet` / `module:game_flow`）。
2. **durable**: `answer_submitted`（`answers` 行、`submitted_at`）。
3. **問単位の derived（採点エンジン）**: `settlements`（`error = |value − correct_value|`、`deltaYen = error × −100`、`pitariBonusYen`）。`op_compute_settlement` で生成、`op_auto_rescore` で再計算。
4. **集計 read-model（採点エンジン）**: `balances.amount = 10000 + Σ deltaYen + Σ pitariBonusYen`。
5. **consumer surfaces**: TV d（当該問の 6 列表＝`participants.name` / `answers.value` / `settlements.error` / `settlements.delta_yen` / `settlements.pitari_bonus_yen` / `balances.amount`）、TV e（`balances` 全員通算）、タブレット（自分の `balances.amount` のみ）。

**クロスアクター可視性**: タブレット向け読みモデルには当該解答者自身の `balances`（と自分の `answers`）のみを含め、他者の `settlements`／`balances`／`answers` を含めない。他者の解答は b（`answers_opened`）到達前はどの端末向け読みモデルにも含めない。d/e への供給値は円建てを崩さない（SC-2）。

### 2.10 勝敗判定（SC-1）と権限境界

- **勝敗判定**: 10 問すべてが `settlement_computed`（`op_determine_winner` の前提）で、通算 `balances.amount` **最多** のプレイヤーを勝者として e モードへ供給する。

```typescript
// src/scoring/determine_winner.ts
import type { Balance } from "./balance.js";

// 残額最多のプレイヤー（同点なら複数）を返す。同点時の優先順位は確定要件に無いため発明しない（§3.3 参照）。
export function determineWinners(balances: readonly Balance[]): readonly Balance[] {
  if (balances.length === 0) return [];
  const max = Math.max(...balances.map((b) => b.amount));
  return balances.filter((b) => b.amount === max);
}
```

- **権限境界（INV-5 継承・release-blocking）**: 得点精算（`op_compute_settlement`）・正解ライブ編集による再採点（`op_auto_rescore` の起点 `op_live_edit_correct`）・取消を起こすトリガー発火は **`role: host` セッションのみ**。`role: answerer` からの当該コマンドはサーバ側で **401/403 拒否** する。採点エンジン自体は計算純関数であり、呼出し側（`src/game_state/` / `src/control_panel/`）がロール判定の単一判定点を通した後に呼び出す。
- 採点はクラウド権威サーバ側で行い、ホスト PC をサーバ／計算主体にしない（INV-1 継承）。

### 2.11 ピタリ賞の拠出配分（F-02・確定部分と保留部分の分離）

- **確定・実装必須**: 誤差 0 のプレイヤーへの **加算側 +1,000 円**（`pitari_bonus_yen = +1000`）は反映する。
- **F-02 未確定（発明せず保留）**: 「他プレイヤーから 1,000 円獲得」の **拠出元と配分**（総額 1,000 か各人からか、複数同時ピタリ時の扱い）は確定していない。この間は `balances.amount` の **拠出減算を 0** とし、加算側 +1,000 のみ反映する。確定後は `settlements` へ拠出行（負の拠出）を追加する拡張余地を残し（`aggregateBalance` の Σ に負の拠出が加わる形）、`rescoreQuestion` の差分計算も同経路で拠出差分を扱えるようにする。加算側 +1,000・円建て・現金感を薄めない各確定値は変更しない。

### 2.12 ソース配置・モジュール指定子・テスト戦略

- **格納先（`src/` 配下・snake_case ファイル）**: 採点・値型 `src/scoring/`（`answer_score.ts`・`yen.ts`・`apply_question_score.ts`・`settle_question.ts`・`aggregate_balance.ts`・`rescore_question.ts`・`determine_winner.ts`・`validate_answer.ts`・`settlement.ts`・`balance.ts`）、進行段階判定 `src/game_state/progression.ts`。上位設計 §2.2 の module→格納先マッピング（`module:scoring` → `src/scoring/`、`module:game_flow` → `src/game_state/`）に従う。
- **モジュール指定子**: 全相対 import は `.js` 拡張子明示。type-only import・re-export も同一。例:

```typescript
// src/scoring/index.ts
export { applyQuestionScore } from "./apply_question_score.js";
export { settleQuestion } from "./settle_question.js";
export { aggregateBalance } from "./aggregate_balance.js";
export { rescoreQuestion } from "./rescore_question.js";
export { determineWinners } from "./determine_winner.js";
export { validateSubmittedAnswer } from "./validate_answer.js";
export type { QuestionSettlement } from "./settlement.js";
export type { Balance } from "./balance.js";
export type { AnswerScore } from "./answer_score.js";
export type { Yen } from "./yen.js";
```

- **テスト（Vitest・`tests/` 配下・`.js` 指定子）**: ユニットは `tests/scoring/*.test.ts` と `tests/game_state/progression.test.ts` に置く。`package.json`・`package-lock.json`・`tsconfig.json`・`vitest.config.ts` は harness 所有につき著さない。Vitest 以外（`node:test` 等）をランナーに用いない。

```typescript
// tests/scoring/apply_question_score.test.ts
import { describe, it, expect } from "vitest";
import { applyQuestionScore } from "../../src/scoring/apply_question_score.js";

describe("精算コア（整数円・SC-1/SC-2/SC-3）", () => {
  it("賞金先渡し 10000 円から誤差 5 は −500 円で残額 9500 円・円建てを保つ", () => {
    const r = applyQuestionScore({ balance: 10_000, answer: 45, correct: 50 });
    expect(r.error).toBe(5);
    expect(r.deltaYen).toBe(-500);
    expect(r.balance).toBe(9_500);
    expect(r.currency).toBe("円");
  });

  it("誤差 0 はピタリ賞 +1000 を加算する（誤差 1 は −100 のみ）", () => {
    const pitari = applyQuestionScore({ balance: 10_000, answer: 50, correct: 50 });
    expect(pitari.pitariAwarded).toBe(true);
    expect(pitari.pitariBonusYen).toBe(1_000);
    expect(pitari.balance).toBe(11_000);

    const off = applyQuestionScore({ balance: 10_000, answer: 51, correct: 50 });
    expect(off.pitariAwarded).toBe(false);
    expect(off.deltaYen).toBe(-100);
    expect(off.balance).toBe(9_900);
  });

  it("100 超・小数・負値は受理しない（0〜100 整数のみ・二重防衛のサーバ側）", () => {
    expect(() => applyQuestionScore({ balance: 10_000, answer: 101, correct: 50 })).toThrow();
    expect(() => applyQuestionScore({ balance: 10_000, answer: 50.5, correct: 50 })).toThrow();
    expect(() => applyQuestionScore({ balance: 10_000, answer: -1, correct: 50 })).toThrow();
  });
});
```

```typescript
// tests/scoring/rescore_question.test.ts
import { describe, it, expect } from "vitest";
import { rescoreQuestion } from "../../src/scoring/rescore_question.js";
import { settleQuestion } from "../../src/scoring/settle_question.js";
import { aggregateBalance } from "../../src/scoring/aggregate_balance.js";

describe("自動再採点・差分再計算（SC-4）", () => {
  const answers = [
    { participantId: "p1", value: 40 },
    { participantId: "p2", value: 50 },
  ];

  it("正解訂正の差分更新は全再計算と一致する（監査不変式）", () => {
    const old = settleQuestion("q1", 50, answers);       // p1 誤差10=-1000, p2 誤差0=+1000
    const { balanceDeltas } = rescoreQuestion("q1", 40, answers, old); // 正解 50→40 に訂正
    const nextFull = settleQuestion("q1", 40, answers);

    // 差分適用後 = 旧集計 + 差分、全再計算 = 新集計。両者一致を確認。
    const p1OldBalance = aggregateBalance(old.filter((s) => s.participantId === "p1"));
    const p1Delta = balanceDeltas.find((d) => d.participantId === "p1")!.deltaYen;
    const p1NewFull = aggregateBalance(nextFull.filter((s) => s.participantId === "p1"));
    expect(p1OldBalance + p1Delta).toBe(p1NewFull);
  });
});
```

```typescript
// tests/scoring/determine_winner.test.ts
import { describe, it, expect } from "vitest";
import { determineWinners } from "../../src/scoring/determine_winner.js";

describe("勝敗判定（残額最多勝ち・SC-1）", () => {
  it("残額最多のプレイヤーを勝者として返す", () => {
    const winners = determineWinners([
      { participantId: "p1", amount: 8_400 },
      { participantId: "p2", amount: 11_000 },
      { participantId: "p3", amount: 9_500 },
    ]);
    expect(winners.map((w) => w.participantId)).toEqual(["p2"]);
  });
});
```

```typescript
// tests/game_state/progression.test.ts
import { describe, it, expect } from "vitest";
import { isDisclosed, isSettled } from "../../src/game_state/progression.js";

describe("進行段階（再採点範囲判定・SC-4）", () => {
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

### 2.13 非機能・整合ゲート

- **整数円のみ**: `error` / `delta_yen` / `pitari_bonus_yen` / `amount` がすべて整数で小数値を持たない（`assertYen` ＋ DB `integer`／`CHECK`）。
- **同期反映**: 再採点による `balances` 更新の全端末反映は上位設計 §2.4/§2.11 の **p95 ≤ 2,000ms** を暫定テストゲートとして扱う（F-04・§3.3）。
- **健全性ベースライン**: 採点系 API 応答は `< 500`（5xx を業務ステータスとして見逃さない）。

### Operational Behavior Model

以下の単一 YAML ブロックが、採点エンジンの精算・再採点・勝敗判定に関する運用挙動の権威的出典であり、実装計画と E2E 生成が共有する。上位設計・データモデルの `operation_flow` と ID を一致させ、本書は採点側の `measurement_source`／`durable_state`／派生連鎖と、規約 SC-1〜SC-4 に対応する `dod_obligations` を明示する。未確定は `boundary_cases` または §3 のフラグへ回し、発明しない。

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
    - id: op_join_game
      actor: answerer
      verb: join
      target: game_session
      trigger: 制御盤の QR を読取り /join で氏名を自己入力して参加確定
      route: /join
      ui_pattern: qr_scan_then_name_input
      preconditions:
        - 接続数が MAX_TABLET_CONNECTIONS 未満
      durable_state: participants テーブル ＋ balances 行の初期化（amount = 10000）
      readback: 制御盤の参加者一覧と TV e モードに反映
      visible_to: [host, audience]
      expected_outcomes:
        - 当該参加者の balances.amount が 10000 円（賞金先渡し）で初期化される
      forbidden_actors: []
      dod_obligations:
        - id: dod_settle_initial_grant
          text: ゲーム開始時に各プレイヤーの balances.amount が 10000 円で初期化されている
    - id: op_compute_settlement
      actor: host
      verb: settle
      target: balances
      trigger: 制御盤で得点精算を実行
      route: /control-panel
      forbidden_actors: [answerer]
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
        - id: dod_settle_delta
          text: 誤差 5 の精算後に当該プレイヤーの balances.amount が精算前より 500 円少ない
        - id: dod_settle_pitari_add
          text: 誤差 0 のプレイヤーの pitari_bonus_yen が +1000 で balances に反映される（拠出配分側は F-02 未確定として fixme）
        - id: dod_settle_currency_yen
          text: settlements と balances と API 応答と d の 6 列表が円建てで表され point/pt/点 の語が存在しない
        - id: dod_settle_integer_only
          text: error / delta_yen / pitari_bonus_yen / amount がすべて整数で小数値を持たない
        - id: dod_settle_host_only
          text: 得点精算は role host のみ発動でき answerer からの精算コマンドは 401/403 で拒否される
    - id: op_live_edit_correct
      actor: host
      verb: edit
      target: question_or_correct_value
      trigger: 制御盤のライブ編集 UI で正解を更新
      route: /control-panel
      forbidden_actors: [answerer]
      durable_state: questions.correct_value 更新
      readback: DB 再取得で編集後の正解値を返す
      expected_outcomes:
        - 進行中に編集した正解値が questions に永続する
        - 開示済み（c 以降）の問なら自動再採点の契機となる
      dod_obligations:
        - id: dod_edit_persist
          text: 進行中に編集した正解値が questions に永続し再取得で読み戻せる
    - id: op_auto_rescore
      actor: system
      verb: rescore
      target: balances
      trigger: 開示済み（rounds.stage が answer_revealed 以降）の問題で正解をライブ編集
      preconditions:
        - 当該問の rounds.stage が answer_revealed 以降（isDisclosed 真）
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
      boundary_cases:
        - 残額同点は複数の共同首位を勝者として提示（同点優先順位は確定要件に無く発明しない・F-06）
      dod_obligations:
        - id: dod_winner_most_balance
          text: 10 問終了時に balances.amount 最多のプレイヤーが e モードで勝者として判別できる
```

---

## 3. Open Questions

壁打ち（要件定義）フェーズはクローズ済で殿判断待ちの論点は残っていない。以下は採点エンジンに関して実装組み立てフェーズで MAS が決める選定、推測実装せず殿判断を仰ぐ点、検証ゲートで暫定運用中のフラグである。いずれも「推奨なし」「要検討」「TBD」の空白は残さず、確定した制約・既定機構・暫定ゲート値を明記する。

### 3.1 採点実装の選定（MAS 決定・殿判断不要）

| 項目 | 決定/既定 | 制約・選定軸 |
|---|---|---|
| 差分再採点 vs 全再計算 | 実行時は差分更新（`rescoreQuestion`）、正しさの基準は全再計算（`aggregateBalance`） | 差分更新後の `balances` が全再計算と一致する監査不変式を満たすこと（SC-4）。 |
| 残額集計の持ち方 | `balances` を集計読みモデル、`settlements` を問×人の拠出 durable | `balances.amount = 10000 + Σ settlements` を不変式とする（SC-1）。 |
| 値の表現 | `AnswerScore`（0〜100 整数）・`Yen`（整数円）を型固定 | 小数・ポイント／点を型と実行時アサートの双方で排除（SC-2/SC-3）。 |
| ピタリ加算の反映範囲 | 加算側 +1,000 を即実装、拠出減算は F-02 確定後に `settlements` へ負の拠出行で追加 | 加算側・円建て・現金感の各確定値は変更しない（§2.11）。 |

### 3.2 F028 エスカレーション（推測実装しない）

- **ピタリ賞の拠出配分（B・F-02）**: `settlements.pitari_bonus_yen` の **加算側 +1,000 は確定・実装必須**。**拠出元と配分**（総額 1,000 か各人からか、複数同時ピタリ時の扱い）が未確定な間は `balances` の拠出減算を 0 とし、確定後に拠出行を追加する拡張余地を残す。挙動詳細は E2E で `test.fixme()`。選択肢を添えて F028 で殿判断を仰ぐ。
- **取消操作の採点への影響（論点 7・F-03）**: `trigger_undone` が `settlement_computed` を 1 段戻して `settlements`／`balances` を巻き戻すのか、任意問題を再開示（`answer_revealed` へ戻し再採点）するのか等、直近のみ／任意問題再開示の別が曖昧な範囲は推測実装せず、選択肢を添えて F028 で殿判断を仰ぐ。**発動権限＝制御盤（host）のみ** は確定ゆえ実装・検証し、状態遷移の詳細は E2E で `test.fixme()`。

### 3.3 検証ゲートで暫定運用中のフラグ（設計義務の欠落・発明せず flag）

- **F-01（残額の下限・脱落）**: 確定要件は「誤差 × −100 円」「賞金先渡し 10,000 円」のみで、`balances.amount` の 0 下限や全額喪失での脱落は確定要件に無い。採点エンジンは `amount` に下限を課さず負残高も表現可能とする（`assertYen` は整数性のみ検証し下限を強制しない）。下限／脱落を導入する実装が現れた場合にフラグする。
- **F-04（同期レイテンシ SLA）**: 設計に固定 SLA が無いため、再採点による `balances` 更新の全端末反映は上位設計 §2.4/§2.11 の **p95 ≤ 2,000ms** を暫定テストゲートとして扱い、SLA 確定時に更新する。
- **F-06（残額同点時の勝者優先順位）**: 「残額最多勝ち」は確定だが、同点時の優先順位（先着・問別勝率等）は確定要件に無い。`determineWinners` は同点を **複数の共同首位** として返し、優先順位を発明しない。同点タイブレークを導入する実装が現れた場合にフラグし、必要なら F028 で選択肢を提示する。
