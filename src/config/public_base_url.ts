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
 * 参加リンク（`/join`）組立の基底となるクラウド公開 URL（環境変数 `PUBLIC_BASE_URL`）の
 * 単一解決点。
 *
 * participation_connection_design §2.2 / §2.4.1 / §3.1 の確定に従い、制御盤が提示する参加 QR と
 * `buildJoinUrl()`（`src/participants/join_link.ts`）は、本モジュールが解決したクラウド公開 URL を
 * 唯一の基底として `/join` を組み立てる。`op_display_join_qr` の precondition
 * 「PUBLIC_BASE_URL が設定済み」を実行時に強制し、未設定・空・不正な基底のまま参加 QR や
 * 参加リンクを生成させない。
 *
 * 設計は解決関数と環境変数キーのみを宣言し、未設定・空・不正時の挙動は本ユニットに委ねている。
 * 解決挙動は消費者 `buildJoinUrl()` が戻り値を `new URL("/join", base)` の base として用いる事実へ
 * 整合させる:
 *   - 正常時は必ず `new URL(path, base)` の base として有効な **絶対 URL（http/https）** を返す。
 *   - 未設定・空文字・空白のみ → {@link PublicBaseUrlNotConfiguredError} を送出する。基底が無い状態を
 *     既定値（ホスト PC の localhost 等）で代替しない ── ホスト PC をサーバ/基底にしない
 *     PC-INV-6 と整合させ、無基底のまま公開参加導線を成立させない。
 *   - 絶対 URL として解釈できない／http・https 以外のスキーム → {@link InvalidPublicBaseUrlError} を
 *     送出する。解決値は QR/リンクの基底となるため、`javascript:` 等の非 Web スキームを基底へ
 *     通さないデータ境界の防衛でもある。
 *
 * これにより不正な設定は、消費側 `new URL(...)` の不透明な `TypeError` ではなく、解決点で意味の
 * 明確なドメインエラーとして早期検出される（設定不備の監査・運用診断が容易）。設定の持ち方は
 * 環境変数 `PUBLIC_BASE_URL` を既定機構とし（§3.1）、テスト・呼び出し側は {@link PublicBaseUrlSource}
 * で env を注入できる。
 */

/** クラウド公開 URL を与える環境変数名（SCREAMING_SNAKE_CASE）。 */
export const PUBLIC_BASE_URL_ENV = "PUBLIC_BASE_URL";

/**
 * 基底 URL に許可するスキーム。クラウド公開の Web アプリゆえ http/https に限定する。
 * 解決値は参加 QR と参加リンクの基底になるため、非 Web スキームを基底へ通さない
 * データ境界の制御として働く。
 */
const ALLOWED_PROTOCOLS: readonly string[] = ["http:", "https:"];

/** 上限解決（`ConnectionLimitSource`）と同型の env 注入ソース。既定は実行環境の `process.env`。 */
export interface PublicBaseUrlSource {
  /** 環境変数ソース。未指定時は `process.env` を用いる。 */
  readonly env?: Record<string, string | undefined>;
}

/**
 * `PUBLIC_BASE_URL` が未設定（または空・空白のみ）のときのエラー。
 *
 * 参加リンクの基底が無ければ `/join` の QR/URL を組み立てられないため、既定値で代替せず
 * 参加導線の構成不備として即座に失敗させる（無基底の公開参加を成立させない・PC-INV-6）。
 */
export class PublicBaseUrlNotConfiguredError extends Error {
  constructor() {
    super(
      `${PUBLIC_BASE_URL_ENV} が設定されていません。` +
        `参加リンク（/join）の基底となるクラウド公開 URL を設定してください。`,
    );
    this.name = "PublicBaseUrlNotConfiguredError";
  }
}

/**
 * `PUBLIC_BASE_URL` が絶対 URL（http/https）として解釈できないときのエラー。
 *
 * 解決値は `new URL("/join", base)` の base として消費されるため、絶対 URL でない値・
 * 非対応スキームの値はここで拒否し、消費側の不透明な例外へ化けさせない。
 */
export class InvalidPublicBaseUrlError extends Error {
  /** 拒否された生の設定値（trim 済み）。 */
  readonly rawValue: string;

  constructor(rawValue: string) {
    super(
      `${PUBLIC_BASE_URL_ENV} は http または https の絶対 URL でなければなりませんが、` +
        `${JSON.stringify(rawValue)} が与えられました。`,
    );
    this.name = "InvalidPublicBaseUrlError";
    this.rawValue = rawValue;
  }
}

/** ソースから `PUBLIC_BASE_URL` の生値を読み取る（未設定は `undefined`）。 */
function readRawPublicBaseUrl(source: PublicBaseUrlSource): string | undefined {
  const env = source.env ?? process.env;
  return env[PUBLIC_BASE_URL_ENV];
}

/**
 * 生値（trim 済み）を `new URL(path, base)` の base として有効な絶対 http/https URL として
 * 検証し、妥当ならその値を返す。解釈不能・非対応スキームは {@link InvalidPublicBaseUrlError}
 * を送出する。
 */
function assertUsableBaseUrl(rawTrimmed: string): string {
  let protocol: string;
  try {
    protocol = new URL(rawTrimmed).protocol;
  } catch {
    throw new InvalidPublicBaseUrlError(rawTrimmed);
  }
  if (!ALLOWED_PROTOCOLS.includes(protocol)) {
    throw new InvalidPublicBaseUrlError(rawTrimmed);
  }
  return rawTrimmed;
}

/**
 * 参加リンク組立の基底となるクラウド公開 URL を解決する単一の入口。
 *
 * `PUBLIC_BASE_URL` を（既定では `process.env`、注入時は `source.env` から）読み取り、
 * `buildJoinUrl()` が `new URL("/join", base)` の base として用いる絶対 http/https URL である
 * ことを保証して返す。
 *
 * @throws {PublicBaseUrlNotConfiguredError} `PUBLIC_BASE_URL` が未設定・空・空白のみの場合。
 * @throws {InvalidPublicBaseUrlError} 値が絶対 URL（http/https）として解釈できない場合。
 */
export function resolvePublicBaseUrl(source: PublicBaseUrlSource = {}): string {
  const raw = readRawPublicBaseUrl(source);
  if (raw === undefined) {
    throw new PublicBaseUrlNotConfiguredError();
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new PublicBaseUrlNotConfiguredError();
  }
  return assertUsableBaseUrl(trimmed);
}
