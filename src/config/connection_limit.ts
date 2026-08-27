// @generated-by: codd implement
// @generated-from: docs/design/participation_connection_design.md (design:participation-connection-design)
// @design-node: docs/design/participation_connection_design.md
// @output-paths: src, tests
// @generated-from: docs/design/realtime_sync_design.md (design:realtime-sync-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

/**
 * 同時接続タブレット上限（`MAX_TABLET_CONNECTIONS`）の単一解決点。
 *
 * 論点10（decision_records ADR-論点10 / system_design §2.7 /
 * participation_connection_design §2.5 / data_model_design §2.8・DM-4 /
 * detailed_design:state-machines §4.4・SM-3 / 不変条件3）で確定した
 * release-blocking 制約を具体化する:
 *   - 既定値は 8 台。ただし接続受け入れ判定（enforcement）側に数値リテラル `8` を
 *     埋め込まない。`8` は本モジュールの既定値定数
 *     {@link DEFAULT_MAX_TABLET_CONNECTIONS} にのみ存在し、判定経路はここが解決した
 *     値だけを参照する。
 *   - 上限は設定パラメータ `MAX_TABLET_CONNECTIONS` として外出しし、8→16→32 等へ
 *     コード改修なし（非改修）で追随する。
 *   - 明示注入された設定値が正の整数として解釈できないときは {@link RangeError} の
 *     一種（{@link InvalidConnectionLimitError}）を送出する（「正整数以外は RangeError」
 *     の単一契約・§4.4）。
 *
 * 解決順は env → config → default。本モジュールは 2 通りの設定ソース抽象を受け付ける:
 *   - {@link ConnectionLimitSource}: 環境変数マップ（`env`）と設定ストア読取値
 *     （`configured`）を個別に受け取り、env → configured → default の優先順で解決する。
 *     環境変数 `MAX_TABLET_CONNECTIONS` の読取りは participation_connection_design §2.5 に
 *     従い寛容であり、未設定・空・空白のみ・非整数・1 未満はいずれも
 *     {@link DEFAULT_MAX_TABLET_CONNECTIONS} へフォールバックする（例外を投げない）。
 *     一方、設定ストアから明示注入された `configured` 値が正の整数として解釈できない
 *     ときは {@link InvalidConnectionLimitError}（{@link RangeError} の一種）を送出し、
 *     設定ストアの誤設定を早期に検出する。
 *   - {@link ConfigSource}: `read(key)` で env か `config` テーブルかを内側に隠蔽した
 *     汎用リーダ（設計 §2.8）。解決順の合成はソース側が担い、本関数は読取値へ
 *     既定フォールバックのみを適用する。未設定・非正・非整数はいずれも
 *     {@link DEFAULT_MAX_TABLET_CONNECTIONS} へフォールバックする（例外を投げない）。
 *
 * いずれの経路でも既定値 `8` の定義は 1 箇所きり（{@link DEFAULT_MAX_TABLET_CONNECTIONS}）
 * であり、上限判定はここが解決した値だけを参照する。
 */

/** 上限を与える環境変数名（SCREAMING_SNAKE_CASE）。 */
export const MAX_TABLET_CONNECTIONS_ENV = "MAX_TABLET_CONNECTIONS";

/**
 * 上限の既定値。接続上限の数値リテラル `8` を持つ唯一の場所であり、
 * 接続受け入れ判定側はこの値を参照するのみでリテラルを持たない。
 */
export const DEFAULT_MAX_TABLET_CONNECTIONS = 8;

/** 受理する上限の下限（1 台未満の上限は設定ミスとして拒否/フォールバックする）。 */
const MIN_TABLET_CONNECTIONS = 1;

/** 上限解決に用いる入力ソース。既定は実行環境の `process.env`。 */
export interface ConnectionLimitSource {
  /** 環境変数ソース。未指定時は `process.env` を用いる。 */
  readonly env?: Record<string, string | undefined>;
  /**
   * 設定ストア（DB 設定テーブル等）由来の値。環境変数が未設定のときに参照する。
   * `src/config/` を単一解決点に保つため、設定ストアの読み取り結果を注入する
   * （本モジュールは設定ストアを直接 import しない＝config はリーフに保つ）。
   */
  readonly configured?: number | string | null;
}

/**
 * 設定値の汎用リーダ抽象（設計 §2.8・DM-4）。`read(key)` は環境変数か `config`
 * テーブルかを内側に隠蔽し、解決順の合成をソース側へ委ねる。`src/config/` を単一解決点に
 * 保つため、{@link resolveMaxTabletConnections} は本抽象を介して読み取り、設定ストアを
 * 直接 import しない（config リポジトリ側が本抽象のアダプタを供給する）。
 */
export interface ConfigSource {
  /** 設定キーの生値を返す。未設定なら `undefined`（環境変数 or config テーブルを抽象化）。 */
  read(key: string): string | undefined;
}

/**
 * `MAX_TABLET_CONNECTIONS` が正の整数として解釈できないときの設定エラー。
 *
 * 明示注入された設定値（{@link ConnectionLimitSource} の `configured`）が範囲外の
 * とき送出する。数値レンジ違反を表すため {@link RangeError} を継承し、上限値の
 * 解釈失敗を「正整数以外は RangeError」という単一の契約
 * （detailed_design:state-machines §4.4・SM-3）へ揃える。`instanceof Error` /
 * `instanceof RangeError` / `instanceof InvalidConnectionLimitError` のいずれも
 * 真となり、拒否した生値を {@link rawValue} に保持して監査可能にする。
 */
export class InvalidConnectionLimitError extends RangeError {
  /** 拒否された生の設定値。 */
  readonly rawValue: number | string;

  constructor(rawValue: number | string) {
    super(
      `${MAX_TABLET_CONNECTIONS_ENV} は 1 以上の整数でなければなりませんが、` +
        `${JSON.stringify(rawValue)} が与えられました。`,
    );
    this.name = "InvalidConnectionLimitError";
    this.rawValue = rawValue;
  }
}

/**
 * 明示注入された設定値を上限値へ解釈する（{@link ConnectionLimitSource} の `configured`
 * 経路・厳格方式）。
 * - `undefined` / `null` / 空文字 / 空白のみ → `null`（未設定として次の解決段へ委ねる）
 * - 1 以上の安全な整数 → その値
 * - それ以外（負値・小数・非数値・範囲外） → {@link InvalidConnectionLimitError}
 *   （{@link RangeError} の一種）
 */
function interpretLimit(raw: number | string | null | undefined): number | null {
  if (raw === undefined || raw === null) {
    return null;
  }

  if (typeof raw === "number") {
    if (!Number.isSafeInteger(raw) || raw < MIN_TABLET_CONNECTIONS) {
      throw new InvalidConnectionLimitError(raw);
    }
    return raw;
  }

  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new InvalidConnectionLimitError(raw);
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < MIN_TABLET_CONNECTIONS) {
    throw new InvalidConnectionLimitError(raw);
  }
  return parsed;
}

/**
 * 環境変数 `MAX_TABLET_CONNECTIONS` から読み取った生文字列を上限値へ寛容に解釈する
 * （participation_connection_design §2.5 の env 読取り規約）。未設定・空・空白のみ・
 * 非整数・1 未満はいずれも `null`（＝未設定として次段へ委ね、最終的に
 * {@link DEFAULT_MAX_TABLET_CONNECTIONS} へフォールバックする）を返し、例外は投げない。
 * 環境変数はデプロイ/OS 由来の soft な設定であり、誤設定でアプリを落とさず既定の安全値へ
 * 収束させる。
 */
function interpretEnvLimit(raw: string | undefined): number | null {
  if (raw === undefined) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < MIN_TABLET_CONNECTIONS) {
    return null;
  }
  return parsed;
}

/**
 * `ConfigSource.read` が返した生値を上限値へ解釈する（{@link ConfigSource} 経路・
 * フォールバック方式）。設計 §2.8 / DM-4 のとおり、未設定・非正・非整数はいずれも
 * {@link DEFAULT_MAX_TABLET_CONNECTIONS} へフォールバックし、例外は投げない。
 */
function interpretLimitOrDefault(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_MAX_TABLET_CONNECTIONS;
  }
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < MIN_TABLET_CONNECTIONS) {
    return DEFAULT_MAX_TABLET_CONNECTIONS;
  }
  return n;
}

/** 入力ソースが {@link ConfigSource}（`read` を持つ汎用リーダ）かを判別する。 */
function isConfigSource(
  source: ConnectionLimitSource | ConfigSource,
): source is ConfigSource {
  return typeof (source as Partial<ConfigSource>).read === "function";
}

/**
 * 同時接続タブレット上限を解決する単一の入口。
 *
 * {@link ConfigSource}（`read` を持つ）を渡した場合は `read(MAX_TABLET_CONNECTIONS)` の
 * 値へ既定フォールバックのみを適用する（解決順の合成はソース側が担う）。
 * {@link ConnectionLimitSource} を渡した（または省略した）場合は env
 * （`MAX_TABLET_CONNECTIONS`）→ config（注入された設定ストア値）→ default
 * （{@link DEFAULT_MAX_TABLET_CONNECTIONS}）の優先順で解決する。環境変数の読取りは
 * participation_connection_design §2.5 に従い寛容であり、不正値（空・空白のみ・非整数・
 * 1 未満）は既定へフォールバックする。明示注入された `configured` の不正値のみ
 * {@link InvalidConnectionLimitError}（{@link RangeError} の一種）を送出する。
 *
 * @throws {InvalidConnectionLimitError} {@link ConnectionLimitSource} 経路で明示注入された
 *   `configured` 値が正の整数として解釈できない場合（{@link RangeError} の一種）。
 */
export function resolveMaxTabletConnections(
  source: ConnectionLimitSource | ConfigSource = {},
): number {
  if (isConfigSource(source)) {
    return interpretLimitOrDefault(source.read(MAX_TABLET_CONNECTIONS_ENV));
  }

  const env = source.env ?? process.env;

  const fromEnv = interpretEnvLimit(env[MAX_TABLET_CONNECTIONS_ENV]);
  if (fromEnv !== null) {
    return fromEnv;
  }

  const fromConfig = interpretLimit(source.configured);
  if (fromConfig !== null) {
    return fromConfig;
  }

  return DEFAULT_MAX_TABLET_CONNECTIONS;
}
