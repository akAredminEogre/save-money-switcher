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
 * 参加 URL の QR 符号化（`module:participants`・PC-INV-1 / op_display_join_qr）。
 *
 * participation_connection_design §2.4.1 / §3.1 が確定した release-blocking 制約を具体化する:
 * 制御盤（/control-panel）は buildJoinUrl() が解決したクラウド公開の /join URL を、本モジュールの
 * {@link renderJoinQrSvg} で QR（SVG）へ符号化して可視提示し、読取りで /join 公開 URL へ到達させる
 * （dod_qr_encodes_public_join_url）。
 *
 * 設計の責務境界（§1.1・§2.4.1）に従い、本モジュールは QR 符号化のみを所有し、外部の `qrcode`
 * （npm・§3.1）だけに依存する。参加 URL の組立（buildJoinUrl）とは import で結合せず、解決済みの
 * 参加 URL を入力として受け取る（制御盤サーフェスが buildJoinUrl から取得して渡す）。QR は公開 URL の
 * 符号化に留まり参加の権威源にはならない（PC-INV-6）。
 *
 * 符号化する値は QR を読取ったカメラ／ブラウザが遷移先として開くため、http/https の絶対 URL のみを
 * 受け付け、空・非 Web スキーム・URL として解釈不能な入力は符号化せず {@link InvalidJoinUrlError} で
 * 拒否する（QR へ `javascript:` 等の非 Web スキームを通さないデータ境界防衛）。
 */

import QRCode from "qrcode";

/** QR 符号化を許可する URL スキーム。読取り先として開く公開 Web URL に限定する。 */
const ALLOWED_JOIN_URL_PROTOCOLS: readonly string[] = ["http:", "https:"];

/**
 * QR の誤り訂正レベル。読取り耐性（提示画面の反射・距離）と情報密度の均衡点として M（約 15%）を
 * 用いる。設計は QR の描画パラメータを固定しておらず、本値は実装上の既定である。
 */
const QR_ERROR_CORRECTION_LEVEL = "M" as const;

/** QR 周囲のクワイエットゾーン（モジュール単位）。読取り安定のための静的余白。 */
const QR_QUIET_ZONE_MARGIN = 4;

/**
 * 参加 URL が QR へ符号化可能な http/https の絶対 URL でないときのエラー。
 *
 * 解決済みの参加 URL を受け取る契約のため通常経路では発生しないが、空・非 Web スキーム・解釈不能な値を
 * QR へ通さないサーバ側の最終防衛として送出する。拒否された生値を保持し監査・診断で原因を追える。
 */
export class InvalidJoinUrlError extends Error {
  /** 拒否された生の入力値。 */
  readonly rawValue: string;

  constructor(rawValue: string) {
    super(
      `参加 URL の QR 符号化には http または https の絶対 URL が必要ですが、` +
        `${JSON.stringify(rawValue)} が与えられました。`,
    );
    this.name = "InvalidJoinUrlError";
    this.rawValue = rawValue;
  }
}

/**
 * 入力が QR へ符号化可能な http/https の絶対 URL であることを検証し、符号化する値（trim 済み）を返す。
 * 空・空白のみ・非対応スキーム・URL として解釈不能な値は {@link InvalidJoinUrlError} を送出する。
 */
function assertEncodableJoinUrl(joinUrl: string): string {
  const trimmed = joinUrl.trim();
  if (trimmed === "") {
    throw new InvalidJoinUrlError(joinUrl);
  }
  let protocol: string;
  try {
    protocol = new URL(trimmed).protocol;
  } catch {
    throw new InvalidJoinUrlError(joinUrl);
  }
  if (!ALLOWED_JOIN_URL_PROTOCOLS.includes(protocol)) {
    throw new InvalidJoinUrlError(joinUrl);
  }
  return trimmed;
}

/**
 * 解決済みの参加用クラウド公開 URL（/join）を QR（SVG）へ符号化する。
 *
 * 制御盤が可視要素として提示する SVG 文字列を返し、その QR を読取ると符号化された /join 公開 URL へ
 * 到達する（op_display_join_qr / dod_qr_encodes_public_join_url）。描画は SVG に限り、`qrcode`（npm）の
 * SVG レンダラへ委譲する。符号化結果は入力 URL の関数であり、渡された URL（分岐 A の秘匿トークン付与を
 * 含む）をそのまま符号化する。
 *
 * @param joinUrl buildJoinUrl() 等が解決した /join の公開 URL（http/https の絶対 URL）。
 * @returns QR を表す SVG 文字列（`<svg …>…</svg>`）。
 * @throws {InvalidJoinUrlError} 入力が空・非 Web スキーム・URL として解釈不能な場合。
 */
export async function renderJoinQrSvg(joinUrl: string): Promise<string> {
  const encodableUrl = assertEncodableJoinUrl(joinUrl);
  return QRCode.toString(encodableUrl, {
    type: "svg",
    errorCorrectionLevel: QR_ERROR_CORRECTION_LEVEL,
    margin: QR_QUIET_ZONE_MARGIN,
  });
}
