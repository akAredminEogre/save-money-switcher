---
codd:
  node_id: infra:deployment-setup
  type: document
  depends_on:
  - id: design:system-design
    relation: depends_on
    semantic: technical
  - id: design:realtime-sync-design
    relation: depends_on
    semantic: technical
  - id: design:participation-connection-design
    relation: constrained_by
    semantic: governance
  depended_by:
  - id: test:test-strategy
    relation: depends_on
    semantic: verification
  conventions:
  - targets:
    - module:realtime_sync
    reason: クラウドへデプロイでき WebSocket 等のリアルタイム通信を扱える構成とし、ホスト PC をサーバにしない（2026-08-08 確定）。違反時リリース不可。
  - targets:
    - module:config
    - module:participants
    reason: 接続上限は起動時/デプロイ時に与えられる設定パラメータ（環境変数等）として外出しし、32 台程度まで破綻しないこと（論点10）。違反時リリース不可。
  - targets:
    - module:participants
    reason: 家族限定アクセス制御（URL 秘匿か認証か）のデプロイ時方式を確定し、無制御公開でリリースしないこと。違反時リリース不可。
  modules:
  - realtime_sync
  - config
  - participants
---

# インフラ・CI/CD・デプロイ設計（クラウド・WebSocket・設定外出し）

## 1. Overview

本書は `save-money-switcher`（クラウド WEB アプリ版『賞金先渡しクイズ SAVE MONEY』家族用操作盤）における **`infra:deployment-setup` の設計**であり、上位の `design:system-design`（`docs/design/system_design.md`）・`design:realtime-sync-design`（`docs/design/realtime_sync_design.md`）を技術的親、`design:participation-connection-design`（`docs/design/participation_connection_design.md`）を governance 制約源として、**クラウドへのデプロイ／CI・CD パイプライン／設定外出し（環境変数）／家族限定アクセス制御のデプロイ時確定**を権威をもって定める。ここに記す 🟦 確定値・不変条件に反する成果物は**リリース不可（release-blocking）**として扱う。

### 1.1 本設計のスコープ

上位 3 設計が `infra` へ委ねた次の 4 領域を本書が確定する。

1. **クラウドデプロイと WebSocket 対応ホスティング（`module:realtime_sync`）** — 制御盤／TV／解答者端末をインターネット経由でクラウド上の唯一の WebSocket 権威へ接続させる、**永続プロセス型**のホスティング構成とデプロイ手順。**ホスト PC をサーバにしない**（2026-08-08 確定）。
2. **設定外出し（`module:config` / `module:participants`）** — 接続上限をはじめとする稼働パラメータを**起動時／デプロイ時に注入される環境変数**として外出しし、`src/config/` の単一解決点でのみ解決する。**32 台程度まで破綻しない**容量とインスタンス構成。
3. **家族限定アクセス制御のデプロイ時確定（`module:participants`）** — 分岐 A（URL 秘匿）／分岐 B（認証）のいずれかを**デプロイ時に必ず構成**し、**無制御公開のまま出荷しない**ことを起動時ゲートとポストデプロイ検証で強制する。
4. **CI/CD パイプラインと検証ゲート** — `npm ci → npm run build → npm test` を release-blocking のグラウンドトゥルースとする CI と、コンテナビルド→デプロイ→プリフライト→ヘルスチェックの CD。

問題メディア解決の詳細（`design:question-media-intake-design`）、スコア計算式（`design:scoring-engine-design`）、DB 物理設計（`design:data-model-design`）、参加受入の決定ロジック（`design:participation-connection-design`）は各設計に委ね、本書はそれらを**どこへ・どう配備し・どの設定で・どう検証して稼働させるか**のみを確定する。

### 1.2 リリースブロッキング不変条件（本書が具体化する制約）

| # | 対象 | 不変条件 | 本書での具体化箇所 |
|---|---|---|---|
| INFRA-INV-1 | `module:realtime_sync` | クラウドへデプロイでき WebSocket 等のリアルタイム通信を扱える構成とし、**ホスト PC をサーバにしない**（2026-08-08 確定） | §2.1・§2.2・§2.3 |
| INFRA-INV-2 | `module:config` / `module:participants` | 接続上限は起動時／デプロイ時に与えられる**設定パラメータ（環境変数等）として外出し**し、**32 台程度まで破綻しない**（論点10） | §2.4・§2.5 |
| INFRA-INV-3 | `module:participants` | 家族限定アクセス制御（URL 秘匿か認証か）の**デプロイ時方式を確定**し、**無制御公開でリリースしない** | §2.6・§2.10 |
| INFRA-INV-4（継承） | `module:realtime_sync` | 回線断は運用リスク（当日インターネット接続前提・バックアップ回線／テザリングで担保）。オフライン完結・ホスト PC のサーバ化で吸収しない | §2.2・§2.12 |
| INFRA-INV-5（継承） | `db:questions` / `module:questions` | 問題は事前ファイル読込で DB 登録・DB 保持し、ランタイムは DB から供給。DB とメディア資産は再起動・再デプロイを跨いで**永続**する | §2.7 |
| INFRA-INV-6（継承） | `role:host` / privacy / 円建て | 権限境界（host のみのトリガー）・自己入力氏名の当日限りの取扱い（恒久台帳なし）・`point`/`pt`/`点` 禁止を、認証構成・シークレット管理・ログ／監視でも侵さない | §2.6・§2.11 |
| INFRA-INV-7（継承） | 全 HTTP／WS | 健全性ベースライン `< 500`（5xx を出さない）、状態遷移の全端末反映 **p95 ≤ 2,000ms**（暫定ゲート・F-04） | §2.12 |

各不変条件は該当節の「遵守の言明」で本書がどう遵守するかを明示する。

### 1.3 実装・ツールチェーン前提（scaffold 固定・釈義不可）

- **実装言語 = TypeScript のみ。** 本書のソースパス（`src/config/*.ts`・`src/main.ts`・`src/realtime_sync/server.ts` 等）・モジュール構成・依存管理・ツールチェーン参照はすべて TypeScript／Node 慣行のみを用い、他言語の拡張子・マニフェスト・ツールは例示・フォールバックとしても登場させない。稼働ランタイムは Node（LTS 20）で、ビルドは `tsc` が `dist/`（NodeNext・`.js` 出力）へ emit する。WebSocket サーバは `ws`、QR 生成は `qrcode`（いずれも npm・出荷ランタイム依存）を用いる。
- **テストランナー = Vitest（固定・release-blocking のグラウンドトゥルース）。** CI の verify 段が実際に走らせるのは Vitest（`vitest run`）であり、本書はこれを再解釈・上書きしない。本書の全テスト例は Vitest 自身の宣言 API（`import { describe, it, expect } from "vitest";`）で記述する。「ランタイム依存を最小化する」方針は**出荷コードのランタイム依存**（`ws`・`qrcode` の採否）にのみ及び、テストランナーには及ばない。依存数の哲学を根拠に別フレームワークや Node 組み込み `node:test` を CI ランナーに用いてはならない。
- **モジュール解決 = NodeNext/Node16。** すべての相対 import 指定子は**出力される `.js` ファイル名を明示した拡張子**を伴う（`import { x } from "./x.js"`。`"./x"`・`"./x.ts"` は不可）。re-export・default/namespace import・type-only import も同一規約。拡張子欠落は `tsc`（＝ `npm run build`）で **TS2835** となりコンパイル不能で、CI のビルド段が落ちる（§2.8）。
- **レイアウト契約（output-path fence 強制）。** 本書が宣言するコード成果物のソースは**必ず `src/` 配下**、テストは**必ず `tests/` 配下**（`test/`・`spec/`・`specs/` を発明しない）。`package.json`・`package-lock.json`・`tsconfig.json`・`vitest.config.ts` は harness scaffold 所有につき、本書はこれらを成果物として出力・宣言しない。`npm run build`／`npm run start`／`npm test` は scaffold 提供のスクリプトとして参照するのみで再定義しない。コンテナ／CI 定義（`Dockerfile`・`.github/workflows/*.yml`）は**言語非依存の運用資産**でありリポジトリルートに置く（`src/`／`tests/` のフェンス対象でも harness 所有の runner/tool 設定でもない）。

**レイアウト契約遵守の言明**: 本書のコード例はすべて `src/**/*.ts`（ソース）と `tests/**/*.ts`（Vitest テスト）のみを宣言し、`test/`／`spec/` 等の兄弟テストディレクトリを発明しない。runner/tool 設定 4 ファイルは一切出力・宣言しない。相対 import はすべて `.js` 拡張子を明示する。

---

## 2. Details

### 2.1 デプロイトポロジ（クラウド常時稼働・WebSocket 権威・INFRA-INV-1）

```
        ┌──────────── クラウド（常時稼働・唯一の HTTP/WS 権威プロセス） ────────────┐
        │                                                                          │
  制御盤 │  ┌──────────────────────────────────┐        ┌───────────────────────┐  │
 /control-panel ◀─┼─▶│ Node ランタイム: node dist/main.js  │◀──────▶│ 永続 DB（DATABASE_URL）│  │
        │  │  src/main.ts                       │        │ questions/answers/    │  │
   TV   │  │   assertReleaseReady()（起動時ゲート）│        │ participants/balances/│  │
  /tv  ◀─┼─▶│   ensureSchema()                   │        │ game_state            │  │
        │  │  src/realtime_sync/server.ts (ws)   │        └───────────────────────┘  │
 タブレット│  │  HTTP: /healthz /control-panel /tv  │        ┌───────────────────────┐  │
 /tablet◀─┼─▶│        /tablet /join /media/*       │◀──────▶│ メディア資産(MEDIA_ROOT)│  │
 /join  │  │  WS upgrade: ロール別 fan-out        │        │ image_path/video_path │  │
        │  └──────────────────────────────────┘        └───────────────────────┘  │
        │  環境変数注入: PUBLIC_BASE_URL / MAX_TABLET_CONNECTIONS / JOIN_ACCESS_*    │
        │             / DATABASE_URL / PORT / MEDIA_ROOT / HEARTBEAT_*              │
        └──────────────────────────────────────────────────────────────────────────┘
```

- **単一の永続プロセスがクラウド側で常時稼働**し、HTTP（各ルート・`/healthz`・静的メディア配信）と WebSocket 昇格の双方を同一オリジンで受ける。制御盤・TV・タブレットのブラウザは**クライアント接続**であり、待受ソケットを持たない。
- **ホスト PC 非サーバ化（release-blocking）**: `localhost` 待受・ホスト PC の AP 化・LAN 完結・オフライン完結を含む配備は本設計に反しリリース不可。制御盤 PC が落ちても TV／タブレット間の同期はクラウド権威経由で継続する（`dod_conn_cloud_authority`／`dod_reconnect_control_panel_resilient`）。

**INFRA-INV-1 遵守の言明**: WebSocket 権威を「クラウド上で常時稼働する単一 Node プロセス（`node dist/main.js`）」に一意化し、ホスティング要件（§2.2）で永続プロセス・WS 昇格・耐久データパスを必須化することで、ホスト PC をサーバにしない構造をデプロイ層で保証する。

### 2.2 ホスティング要件と選定軸（INFRA-INV-1 / INFRA-INV-4）

デプロイ先は次の**必須要件**をすべて満たすクラウドランタイムに限る。1 つでも欠く形態はリリース不可。

| 要件 | 内容 | 不適格な形態 |
|---|---|---|
| 永続プロセス | 長時間稼働する Node プロセスを保持し、リクエスト単位で終了しない | 純 FaaS（AWS Lambda 単体）・エッジ関数のみ・静的ホスティング |
| WebSocket 昇格 | サーバ起点の双方向 WS（`ws`）の Upgrade を透過・維持できる | WS 非対応 CDN・短時間タイムアウトで WS を切る構成 |
| 単一権威整合 | 単一インスタンス、または sticky ルーティングで in-memory hub の権威を一貫させる | ステートレス横スケールで hub を跨る配信を想定した構成（§3.3 で flag） |
| 耐久データパス | `DATABASE_URL` の永続 DB と `MEDIA_ROOT` の永続資産に到達でき、再デプロイで消失しない | 揮発ローカルディスクのみに DB/メディアを置く構成 |
| 当日回線前提 | インターネット接続前提で稼働。回線断は運用リスク | オフライン完結を前提化した構成 |

- **既定構成**: コンテナ化した単一プロセスを、永続プロセス型 PaaS（`Fly.io`／`Render`／`Railway`／`Google Cloud Run`（WS 対応・最小インスタンス 1）等の候補）へ **1 インスタンス**でデプロイする。MVP 容量（タブレット ≤ 32＋制御盤＋TV）では単一インスタンスが hub の in-memory ロール別レジストリの権威を最も単純に保証する。最終プロバイダ選定は §3.1（MAS 決定）。
- **可用性前提（INFRA-INV-4）**: 当日インターネット接続を前提とし、回線断は運用側でバックアップ回線／テザリングを確保する。ホスト PC のサーバ化による耐障害策は禁止。プラットフォームのヘルスチェック（`/healthz`）失敗時は自動再起動／直前リリースへロールバックする（§2.9）。

**INFRA-INV-4 遵守の言明**: 回線断をコード側でオフライン吸収せず、クラウド権威 + 運用側回線冗長で担保する方針を選定要件へ明記した。

### 2.3 プロセス起動・ビルド・実行（起動時ゲート）

- **ビルド**: `npm run build`（scaffold 提供）が `tsc` を起動し、NodeNext で `src/**/*.ts` → `dist/**/*.js` を emit する。相対 import の `.js` 欠落は TS2835 でビルド失敗（§2.8）。
- **起動**: `npm run start`（scaffold 提供）が `node dist/main.js` を実行する。エントリポイント `src/main.ts` は**起動時ゲート**を通してから待受を開始する。

```typescript
// src/main.ts
import { assertReleaseReady } from "./config/deploy_preflight.js";
import { resolvePort } from "./config/server_runtime.js";
import { ensureSchema } from "./db/schema.js";
import { startRealtimeServer } from "./realtime_sync/server.js";

async function main(): Promise<void> {
  assertReleaseReady();            // 無制御公開・上限未解決・公開 URL 欠落を起動時に拒否（§2.10）
  await ensureSchema();            // 永続 DB のスキーマ適用（design:data-model-design 所有の src/db/）
  startRealtimeServer({ port: resolvePort() });
}

void main();
```

- `assertReleaseReady()` が投げた場合、プロセスは非 0 終了し、PaaS はデプロイ失敗として扱い直前リリースを維持する（無制御公開を「起動させない」）。

### 2.4 設定外出しカタログ（環境変数・INFRA-INV-2）

すべての稼働パラメータは**環境変数**として起動時／デプロイ時に注入し、`src/config/`（SCREAMING_SNAKE_CASE キー）の**単一解決点**でのみ解決する。判定コード（`admission.ts`・`server.ts`・`src/tablet/` 等）に数値・URL・トークンのリテラルを撒かない。

| 環境変数 | 解決点（`src/config/`） | 既定 | 区分 | 役割 |
|---|---|---|---|---|
| `MAX_TABLET_CONNECTIONS` | `connection_limit.ts` : `resolveMaxTabletConnections()` | 8 | 非機密 | タブレット同時接続上限（16/32 へ非改修追随・§2.5） |
| `PUBLIC_BASE_URL` | `public_base_url.ts` : `resolvePublicBaseUrl()` | 必須（既定なし・未設定は起動拒否） | 非機密 | 参加 QR／`/join` リンクの基底クラウド公開 URL |
| `JOIN_ACCESS_MODE` | `access_control_config.ts` : `resolveAccessMode()` | undefined（→プリフライトで拒否） | 非機密 | 家族限定制御の方式 `url_secret`／`authenticated` |
| `JOIN_ACCESS_TOKEN` | `access_control_config.ts` : `resolveJoinAccessToken()` | undefined | **機密** | 分岐 A（URL 秘匿）の秘匿トークン |
| `DATABASE_URL` | `server_runtime.ts` : `resolveDatabaseUrl()` | 必須（未設定は起動拒否） | **機密** | 永続 DB 接続文字列（INFRA-INV-5） |
| `PORT` | `server_runtime.ts` : `resolvePort()` | 8080 | 非機密 | HTTP/WS 待受ポート |
| `MEDIA_ROOT` | `media_config.ts` : `resolveMediaRoot()` | `/data/media` | 非機密 | 画像／動画資産の所定配置ルート（§2.7） |
| `HEARTBEAT_PING_INTERVAL_MS` | `heartbeat_config.ts` : `resolvePingIntervalMs()` | 15000 | 非機密 | WS ping 間隔（realtime_sync §2.7） |
| `HEARTBEAT_PONG_TIMEOUT_MS` | `heartbeat_config.ts` : `resolvePongTimeoutMs()` | 30000 | 非機密 | pong 無応答での切断確定・スロット解放 |
| `E2E_BASE_URL` | 検証ハーネス | 検証時注入 | 非機密 | E2E のクラウド公開 URL（§2.12） |
| `NODE_ENV` | ランタイム標準 | `production` | 非機密 | 実行モード |

`MAX_DISPLAY_NAME_LENGTH = 20`（`src/participants/name.ts`）は TV 表示安定のための**コード定数**であり環境変数化しない（設計選択値・参加設計 §3.1）。

```typescript
// src/config/server_runtime.ts
const DEFAULT_PORT = 8080;

export function resolvePort(): number {
  const raw = process.env.PORT;
  if (raw === undefined || raw.trim() === "") return DEFAULT_PORT;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

export function resolveDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (raw === undefined || raw.trim() === "") {
    throw new Error("DATABASE_URL is required"); // 永続 DB 必須（INFRA-INV-5）
  }
  return raw;
}
```

```typescript
// src/config/heartbeat_config.ts
const DEFAULT_PING_INTERVAL_MS = 15_000;
const DEFAULT_PONG_TIMEOUT_MS = 30_000;

export function resolvePingIntervalMs(): number { return positiveIntEnv("HEARTBEAT_PING_INTERVAL_MS", DEFAULT_PING_INTERVAL_MS); }
export function resolvePongTimeoutMs(): number { return positiveIntEnv("HEARTBEAT_PONG_TIMEOUT_MS", DEFAULT_PONG_TIMEOUT_MS); }

function positiveIntEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
```

### 2.5 同時接続上限のデプロイ時注入と容量（INFRA-INV-2）

- **上限の外出しと追随**: `MAX_TABLET_CONNECTIONS` は `src/config/connection_limit.ts` の `resolveMaxTabletConnections()` のみが解決し、既定 8 は同ファイルの単一定数 `DEFAULT_MAX_TABLET_CONNECTIONS` としてのみ宣言する（参加設計 §2.5 と同一関数境界）。デプロイ時に `MAX_TABLET_CONNECTIONS=16` または `=32` を注入すると、`server.ts` が接続受理時に毎回 `resolveMaxTabletConnections()` を取り直して `admitTablet` へ渡すため、**コード改修なしに上限がその値へ追随**する（`dod_limit_config_follows`／`dod_limit_no_hardcode`）。
- **容量とインスタンスサイジング（32 台まで破綻しない）**: 単一インスタンスは **タブレット最大 32 ＋ 制御盤 1 ＋ TV 数台**の同時 WebSocket を保持できるサイズ（目安: 1 vCPU / 512MB–1GB RAM）で確保する。状態遷移イベントの fan-out は接続数 N（≤ 約 34）に対し O(N) の投影配信であり、この規模で **p95 ≤ 2,000ms**（§2.12）を満たす。上限を 32 へ引き上げてデプロイする場合はインスタンスのメモリ／接続数上限もその容量へ合わせて設定する（プラットフォーム側の同時接続・ファイルディスクリプタ上限を 32＋ に確保）。
- **境界**: 既定 8 で 8 台目可・9 台目拒否、設定 16 で 16/17、設定 32 で 32/33 の可否を機械可検に固定（§2.13 のテスト・`dod_limit_default_eight`）。上限超過は 5xx を出さず、`connection_rejected` ＋ WS `close(4001)` と `/join` の満席平易文で表す（既存接続・`participants`／`answers`／`balances` は不変・`dod_limit_existing_unaffected`）。

**INFRA-INV-2 遵守の言明**: 接続上限を環境変数 `MAX_TABLET_CONNECTIONS` として起動時／デプロイ時注入に外出しし、`src/config/` の単一解決点でのみ解決・判定を設定値参照に一元化した。単一インスタンスを 32 同時 WS まで破綻しない容量で確保し、上限引き上げをコード改修なしに反映する。

### 2.6 家族限定アクセス制御のデプロイ時確定（INFRA-INV-3）

参加ベクタは QR が指すクラウド公開 `/join` である。**無認証の無制限公開はリリース不可**であり、デプロイ時に次のいずれかを**必ず構成**する。

- **分岐 A（URL 秘匿）**: `JOIN_ACCESS_MODE=url_secret` ＋ `JOIN_ACCESS_TOKEN=<不透明トークン>` を注入。`buildJoinUrl()` がトークンをクエリ `t` として QR に符号化し、`checkJoinAccess` が提示トークン一致時のみ参加を許可する。ブラスト半径抑制は**接続上限（既定 8）**と**トリガー権限の司会者限定**が担保する。
- **分岐 B（認証導入）**: `JOIN_ACCESS_MODE=authenticated` を注入。セッション認証済のときのみ許可し、ログイン → 正しいリダイレクト → `/join` 氏名入力描画のフローを備える。未認証の `/join` は制御盤操作等の保護ナビを露出しない。

いずれの分岐でも受入は `src/config/` の上限解決点（§2.5）と `role: host` 判定の単一経路を経由する（`dod_access_single_resolution`）。方式の最終決定は §3.1（デプロイ時 MAS 決定）だが、**どちらも未構成のままデプロイすることは起動時ゲートで拒否する**（下記）。

```typescript
// src/config/deploy_preflight.ts
import { resolveAccessMode, resolveJoinAccessToken } from "./access_control_config.js";
import { resolveMaxTabletConnections } from "./connection_limit.js";
import { resolvePublicBaseUrl } from "./public_base_url.js";

export interface PreflightResult { ready: boolean; violations: string[]; }

export function checkReleaseReadiness(): PreflightResult {
  const violations: string[] = [];

  const mode = resolveAccessMode(); // "url_secret" | "authenticated" | undefined
  if (mode === undefined) {
    violations.push("access_control_unconfigured");      // 無制御公開はリリース不可（INFRA-INV-3）
  } else if (mode === "url_secret" && resolveJoinAccessToken() === undefined) {
    violations.push("url_secret_without_token");
  }

  if (!Number.isInteger(resolveMaxTabletConnections())) {
    violations.push("connection_limit_unresolvable");    // INFRA-INV-2
  }

  try { resolvePublicBaseUrl(); } catch { violations.push("public_base_url_missing"); } // クラウド前提（INFRA-INV-1）

  return { ready: violations.length === 0, violations };
}

export function assertReleaseReady(): void {
  const r = checkReleaseReadiness();
  if (!r.ready) throw new Error(`deploy preflight failed: ${r.violations.join(", ")}`);
}
```

**INFRA-INV-3 遵守の言明**: アクセス制御方式を環境変数（`JOIN_ACCESS_MODE`／`JOIN_ACCESS_TOKEN`）でデプロイ時に確定させ、未構成（`resolveAccessMode()===undefined`）の場合は `assertReleaseReady()` が起動を拒否する。無制御公開は構成上も実行時にも成立せず（`dod_access_no_open_public`）、CD のポストデプロイ検証（§2.9・§2.10）でも二重に確認する。

### 2.7 永続化・メディア資産・問題ファイル読込のインフラ（INFRA-INV-5）

- **DB 永続化**: `questions`／`answers`／`participants`／`balances`／`game_state` を保持する永続 DB を `DATABASE_URL` で外部注入する。既定は managed PostgreSQL。ランタイムが**耐久ボリューム**を保証する場合に限り SQLite（ファイル）も可。DB は再起動・再デプロイを跨いで永続し、`game_state`／`balances`／`answers` を権威とする再接続復帰（realtime_sync の recovery）とゲーム中の再デプロイ耐性を支える。スキーマ適用は起動時 `ensureSchema()`（`design:data-model-design` 所有の `src/db/`）で行う。
- **問題ファイル読込（INFRA-INV-5）**: ランタイム出題は**常に `questions` テーブルから供給**し、問題ファイルの再読込に依存しない。事前問題ファイルの読込（`op_load_questions`）は制御盤（`/control-panel`）からの操作で `questions` へ登録する。デプロイ資産としては、問題ファイルとメディアを運用者が事前にステージングできる経路を確保する。
- **メディア資産**: `questions.image_path`／`video_path` が指す画像・動画は `MEDIA_ROOT`（耐久ボリュームまたは S3 互換オブジェクトストレージの基底）へ**事前配置**する。サーバは `/media/*` で静的配信し、TV a モードは動画 → 画像 → テキストの優先で出題面を解決する（`design:question-media-intake-design` 所有）。メディアは揮発ローカルディスクに置かず、再デプロイで消失しない配置とする。

```typescript
// src/config/media_config.ts
const DEFAULT_MEDIA_ROOT = "/data/media";

export function resolveMediaRoot(): string {
  const raw = process.env.MEDIA_ROOT;
  return raw && raw.trim() !== "" ? raw : DEFAULT_MEDIA_ROOT;
}
```

**INFRA-INV-5 遵守の言明**: DB とメディアを耐久ストレージへ配備し、ランタイム出題を DB 供給に固定することで、事前ファイル読込 → DB 登録 → DB 保持の不変を配備層で保証する。

### 2.8 CI パイプライン（build・typecheck・Vitest）

CI は GitHub Actions で構成し、`pull_request` と `main` への `push` で verify を実行する。`Dockerfile`・`.github/workflows/*.yml` は言語非依存の運用資産（リポジトリルート・フェンス外）であり、`src/`／`tests/` のソース／テストや harness 所有の runner/tool 設定 4 ファイルには一切追加しない。

```yaml
# .github/workflows/ci.yml （リポジトリルートの CI 定義・言語非依存の運用資産）
name: ci
on:
  pull_request:
  push:
    branches: [main]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build        # tsc: NodeNext の .js 指定子欠落は TS2835 で失敗（モジュール指定子コヒーレンス強制）
      - run: npm test             # vitest run（release-blocking のグラウンドトゥルース）
```

- **ビルド段（`npm run build`）が NodeNext のモジュール指定子コヒーレンスを強制**する。相対 import の `.js` 欠落は TS2835 で失敗し、独立生成ファイル間の規約不一致を CI で検出する。
- **テスト段は Vitest（`npm test` = `vitest run`）**が唯一のランナー。`node:test` 等を CI ランナーに用いない。ユニット（`tests/config/*`・`tests/participants/*`・`tests/realtime_sync/*` 等）と API/WS 統合を実行する。
- **E2E ゲート（任意・gated ジョブ）**: `npm run start` を検証 env で起動し、`/healthz` が `< 500` を返すまで**最大 60 秒**（2 秒間隔）ポーリング後、`E2E_BASE_URL=http://127.0.0.1:8080` を注入して `tests/e2e/*` を実行する。ブラウザ操作は Playwright を**ライブラリ import**（`import { chromium } from "playwright";`）で駆動し、宣言・検証は Vitest（`describe/it/expect`）で行う。

### 2.9 CD パイプライン（コンテナビルド・デプロイ・ポストデプロイ検証）

CI が green の後、`main` マージ／リリースタグで CD を実行する。

```dockerfile
# Dockerfile （リポジトリルート・言語非依存のデプロイ資産。src/ でも tests/ でも harness 所有 scaffold でもない）
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build                     # tsc → dist/（NodeNext・.js 出力）

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# PUBLIC_BASE_URL / MAX_TABLET_CONNECTIONS / JOIN_ACCESS_* / DATABASE_URL / PORT / MEDIA_ROOT はデプロイ時注入
CMD ["node", "dist/main.js"]
```

CD ステージ:

1. **イメージビルド**: 上記 `Dockerfile`（マルチステージ）でビルドし、`ghcr.io`（GitHub Container Registry）へ push する。
2. **デプロイ**: 永続プロセス型 PaaS（§2.2 既定）へ **1 インスタンス**でリリースし、環境変数（§2.4）をプラットフォームのシークレットストア／CI 暗号化シークレットから注入する。機密（`JOIN_ACCESS_TOKEN`・`DATABASE_URL`）はリポジトリにコミットせずシークレットストア経由でのみ供給する。
3. **起動時プリフライト**: `src/main.ts` の `assertReleaseReady()`（§2.6）が無制御公開・上限未解決・公開 URL 欠落を検知すると非 0 終了し、PaaS はデプロイ失敗として直前リリースを維持する（自動ロールバック）。
4. **ポストデプロイスモーク**: `PUBLIC_BASE_URL/healthz` を **2 秒間隔で最大 60 秒**ポーリングし、`< 500` を確認する。到達しなければリリースを失敗扱いにして直前へロールバックする。

### 2.10 デプロイ時プリフライト検証（リリースゲートチェックリスト）

デプロイを許可する前に、次の release-blocking 条件を機械的に検証する。1 つでも不合格ならデプロイを中止（またはロールバック）する。

| ゲート | 条件 | 根拠 | 検証点 |
|---|---|---|---|
| G1 アクセス制御構成 | `JOIN_ACCESS_MODE` が `url_secret`（トークン付き）または `authenticated` | INFRA-INV-3 | `checkReleaseReadiness()`（§2.6）・CD 検証 |
| G2 接続上限解決 | `resolveMaxTabletConnections()` が整数（既定 8／設定 16・32） | INFRA-INV-2 | 同上・`tests/config/*` |
| G3 公開 URL | `PUBLIC_BASE_URL` が設定済（QR/参加リンク基底） | INFRA-INV-1 | 同上 |
| G4 永続 DB | `DATABASE_URL` が設定済で `ensureSchema()` 成功 | INFRA-INV-5 | 起動時 |
| G5 WS 昇格 | デプロイ先が WS Upgrade を透過・維持 | INFRA-INV-1 | §2.2 選定要件・E2E |
| G6 ヘルス | `/healthz` が 60 秒以内に `< 500` | INFRA-INV-7 | ポストデプロイスモーク |

**INFRA-INV-3 遵守の言明（再掲・ゲート化）**: G1 により、アクセス制御を構成しないデプロイは起動時・CD 検証の双方で失敗し、無制御公開のまま稼働に到達できない。

### 2.11 シークレット管理・プライバシー・データライフサイクル（INFRA-INV-6）

- **シークレット管理**: `JOIN_ACCESS_TOKEN`・`DATABASE_URL` は機密として PaaS のシークレットストア／GitHub Actions 暗号化シークレットにのみ保持し、リポジトリ・ログ・QR 表示面・クライアント配信ペイロードへ露出しない。QR は公開 `/join` URL（分岐 A 時は秘匿トークン付き）を符号化するのみで、DB 資格情報等は含めない。
- **権限境界の配備（INFRA-INV-6）**: 締切・開示・正解発表・得点精算・取消・モード切替の発火は `role: host` セッションのみ。分岐 B（認証）導入時も、認証基盤が host セッションのロール属性を単一判定点として供給する構成とし、非 host には `command_denied`（403／未認証 401）を返す。
- **プライバシー／データライフサイクル**: 収集する個人データは解答者が自己入力した氏名と当日の解答・残額に限る。`participants` は**当日その場参加**を前提とし恒久的な事前氏名台帳を持たない。ゲームセッション終了後のレコードは破棄対象とし、運用手順で当日データを保持し続けない。ログ・監視ダッシュボードは他者解答・残額を解答者ロールへ露出させず、金額表記に `point`／`pt`／`点` を用いない（円建て固定）。

### 2.12 非機能要件（健全性・レイテンシ・可用性・検証環境起動）

- **健全性ベースライン（INFRA-INV-7）**: `/healthz`・`/control-panel`・`/tv`・`/tablet`・`/join`・`/media/*` を含む全 HTTP 応答は **`< 500`**（5xx を出さない）。WS 昇格失敗・上限拒否・アクセス拒否は 5xx ではなく業務ステータス（`connection_rejected` ＋ WS `close(4001)`・`/join` 平易文・`command_denied`）で表す。
- **同期反映レイテンシ**: 状態遷移の全端末反映は **p95 ≤ 2,000ms**（暫定テストゲート・F-04）。§2.5 の単一インスタンス構成で 32 同時 WS までこのゲートを満たす。
- **切断検知パラメータ**: WS ping **15,000ms**／pong 無応答 **30,000ms** で切断確定しスロット解放（`HEARTBEAT_PING_INTERVAL_MS`／`HEARTBEAT_PONG_TIMEOUT_MS`・§2.4）。当日ネットワーク実測で調整余地があるが判定は `src/config/` 経由の設定値とし、値に依らず整合を成立させる（§3.3）。
- **可用性前提**: 当日インターネット接続を前提とし、回線断は運用リスクとして扱う。ホスト PC のサーバ化による耐障害策は禁止（INFRA-INV-1／INFRA-INV-4）。
- **起動シーケンス（検証環境）**: `npm ci` → `npm run build` → `npm run start`（クラウド WEB アプリ＋WebSocket ゆえサーバ常駐必須）。`/healthz` が `< 500` を返すまで**最大 60 秒**（2 秒間隔）ポーリングしてから試験開始。`E2E_BASE_URL` にクラウド公開 URL（WS 昇格可能なオリジン）を、`PUBLIC_BASE_URL`・`MAX_TABLET_CONNECTIONS`・`JOIN_ACCESS_MODE`／`JOIN_ACCESS_TOKEN`・`DATABASE_URL`・`MEDIA_ROOT` を検証環境の値で注入する。

### 2.13 インフラ関連ソース配置とテスト（レイアウト契約・Vitest）

本書が宣言するコード成果物は次のとおり。ソースは `src/` 配下、テストは `tests/` 配下に限る。

| ファイル | 配置 | 責務 |
|---|---|---|
| `src/main.ts` | `src/` | 起動時ゲート → スキーマ適用 → サーバ起動のエントリポイント |
| `src/config/server_runtime.ts` | `src/config/` | `PORT`／`DATABASE_URL` の解決 |
| `src/config/heartbeat_config.ts` | `src/config/` | ping／pong 間隔の解決 |
| `src/config/media_config.ts` | `src/config/` | `MEDIA_ROOT` の解決 |
| `src/config/deploy_preflight.ts` | `src/config/` | リリース準備検証（無制御公開・上限未解決・公開 URL 欠落の拒否） |
| `src/config/connection_limit.ts`／`public_base_url.ts`／`access_control_config.ts` | `src/config/` | 参加設計から継承する単一解決点（本書はデプロイ時注入元を確定） |

相対 import は全ファイルで `.js` 拡張子を明示する（例: `import { resolveMaxTabletConnections } from "./connection_limit.js";`）。`package.json`・`package-lock.json`・`tsconfig.json`・`vitest.config.ts` は harness 所有につき著さない。

デプロイ時プリフライト（無制御公開を出荷させない・INFRA-INV-3）の受け入れ:

```typescript
// tests/config/deploy_preflight.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { checkReleaseReadiness } from "../../src/config/deploy_preflight.js";

describe("デプロイ時プリフライト（無制御公開を出荷させない）", () => {
  afterEach(() => {
    delete process.env.JOIN_ACCESS_MODE;
    delete process.env.JOIN_ACCESS_TOKEN;
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.MAX_TABLET_CONNECTIONS;
  });

  it("アクセス制御未構成なら ready=false（INFRA-INV-3）", () => {
    process.env.PUBLIC_BASE_URL = "https://save-money.example.com";
    const r = checkReleaseReadiness();
    expect(r.ready).toBe(false);
    expect(r.violations).toContain("access_control_unconfigured");
  });

  it("URL 秘匿トークン構成なら ready=true", () => {
    process.env.PUBLIC_BASE_URL = "https://save-money.example.com";
    process.env.JOIN_ACCESS_MODE = "url_secret";
    process.env.JOIN_ACCESS_TOKEN = "family-secret";
    expect(checkReleaseReadiness().ready).toBe(true);
  });
});
```

接続上限のデプロイ時注入が設定値へ追随すること（INFRA-INV-2・§2.5 と同一関数境界）:

```typescript
// tests/config/connection_limit_deploy.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { resolveMaxTabletConnections } from "../../src/config/connection_limit.js";

describe("接続上限のデプロイ時注入", () => {
  afterEach(() => { delete process.env.MAX_TABLET_CONNECTIONS; });

  it("未注入時の既定は 8（リテラル埋め込みではない）", () => {
    expect(resolveMaxTabletConnections()).toBe(8);
  });

  it("デプロイ時に 32 を注入すると非改修で 32 へ追随する", () => {
    process.env.MAX_TABLET_CONNECTIONS = "32";
    expect(resolveMaxTabletConnections()).toBe(32);
  });
});
```

Vitest 以外（`node:test` 等）を CI ランナーに用いない。ランタイム依存最小化の方針はテストランナーに及ばない。

---

## 3. Open Questions

壁打ち（要件定義）フェーズはクローズ済で殿判断待ちの論点は残っていない。以下は実装組み立てフェーズで MAS が決めるデプロイ技術選定、推測実装せず殿判断を仰ぐ点、検証ゲートで暫定運用中のフラグである。「推奨なし」「要検討」「TBD」の空白は残さず、確定した制約・既定機構・暫定ゲート値を明記する。

### 3.1 技術選定（MAS 決定・殿判断不要）

| 項目 | 決定／既定 | 制約・選定軸 |
|---|---|---|
| ホスティングプラットフォーム | **永続プロセス型 PaaS へ単一インスタンスをコンテナデプロイ**（`Fly.io`／`Render`／`Railway`／`Google Cloud Run`〈最小 1〉等の WS 対応候補から選定）。既定はコンテナ化単一プロセス | §2.2 の必須要件（永続プロセス・WS 昇格・単一権威整合・耐久データパス・当日回線前提）をすべて満たすこと。純 FaaS・静的ホスティング・ホスト PC は不可（INFRA-INV-1） |
| コンテナレジストリ | `ghcr.io`（GitHub Container Registry） | CI（GitHub Actions）と同一エコシステム。イメージは `Dockerfile` マルチステージビルド |
| CI/CD | **GitHub Actions**（`ci.yml` で `npm ci`→`npm run build`→`npm test`、CD でイメージ build/push/deploy/スモーク） | verify ランナーは Vitest 固定。ビルド段が NodeNext の `.js` 指定子を TS2835 で強制（§2.8） |
| DB 永続化技術 | 既定 **managed PostgreSQL**（`DATABASE_URL` 注入）。耐久ボリューム保証時のみ SQLite 可 | 再起動・再デプロイを跨いで `questions`/`answers`/`participants`/`balances`/`game_state` が永続（INFRA-INV-5） |
| メディアストレージ | `MEDIA_ROOT` に耐久ボリュームまたは S3 互換オブジェクトストレージ | 画像／動画を事前配置し `/media/*` で配信。揮発ディスクに置かない（§2.7） |
| 家族限定アクセス制御方式 | **分岐 A（`JOIN_ACCESS_MODE=url_secret`＋`JOIN_ACCESS_TOKEN`）／B（`JOIN_ACCESS_MODE=authenticated`）をデプロイ時に必ず確定** | 未構成デプロイは `assertReleaseReady()` で起動拒否（INFRA-INV-3）。方式決定まで接続上限（既定 8）と host 限定トリガーをブラスト半径抑制策とする |
| 上限設定の持ち方 | 環境変数 `MAX_TABLET_CONNECTIONS` を既定機構 | `src/config/connection_limit.ts` が唯一の解決点。ハードコード禁止（INFRA-INV-2） |

### 3.2 F028 エスカレーション（推測実装しない）

- **家族限定アクセス制御の最終方式（分岐 A／B の確定・F-05 と連動）**: 分岐 A（URL 秘匿）と分岐 B（認証）の**いずれをデプロイ時に採るか**は運用上の判断を要する。**未構成での出荷はリリース不可**（`assertReleaseReady()` が起動拒否）である点は確定・検証必須。方式の最終選択に殿の意向確認が必要な場合は、両分岐の運用差（QR トークン配布 vs ログイン基盤）を選択肢として添えて F028 で仰ぐ。分岐 B 採用時の認証基盤（自前セッション／外部 ID プロバイダ）の詳細が要件に無い範囲は発明せず、必要と判明した時点で F028。

### 3.3 検証ゲートで暫定運用中のフラグ（設計義務の欠落・発明せず flag）

- **F-04（同期レイテンシ SLA）**: 設計に固定 SLA が無いため、§2.5／§2.12 の **p95 ≤ 2,000ms** は暫定テストゲートとして運用し、SLA 確定時に更新する。デプロイ後の実測が閾値を超える場合はインスタンスサイジングを見直す。
- **F-05（家族限定アクセス制御）**: 分岐 A/B 未決につき、分岐 A（`JOIN_ACCESS_TOKEN`）が構成されていればトークン一致判定を、分岐 B（認証）が実装されていればログイン → リダイレクト → 描画フローを検証し、いずれも未実装なら該当ブラウザテストを `test.fixme()`。ただしプリフライト G1（未構成なら起動拒否）は値に依らず検証必須。無制御公開のまま出荷はリリース不可（INFRA-INV-3）。
- **切断検知パラメータ（ping 15 秒／pong 猶予 30 秒）**: 当日ネットワーク実測に基づき運用側で調整余地があるが、判定は `HEARTBEAT_PING_INTERVAL_MS`／`HEARTBEAT_PONG_TIMEOUT_MS`（`src/config/heartbeat_config.ts`）経由の設定値とし、無応答検知 → スロット解放 → 再接続復帰の整合は値に依らず成立させる。未計測段階でも既定値で検証を通し、実測後に更新する。
- **水平スケール時の単一権威整合**: MVP は単一インスタンス（in-memory hub が権威）を既定とする。将来 32 台を超える規模で横スケールする場合は、sticky セッション＋共有 pub/sub（例: Redis）による hub 跨ぎ配信が必要になるため、その導入は容量要件が現れた時点で flag し、現段階では単一インスタンス構成で 32 台までの破綻しなさ（INFRA-INV-2）を担保する。
