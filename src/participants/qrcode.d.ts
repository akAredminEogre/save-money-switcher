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
 * `qrcode`（npm・participation_connection_design §3.1）の最小アンビエント型宣言。
 *
 * `src/participants/qr.ts` が用いる SVG 符号化 API（{@link toString}）だけを型付けする。出荷ランタイム
 * 依存として宣言するのは実行時パッケージ `qrcode` のみ（package.json）であり、型は本モジュールが利用する
 * 表面へ限定して自己完結させる（`@types/qrcode` を別途持ち込まない）。本ファイルはトップレベルの
 * import/export を持たないスクリプトであり、`declare module "qrcode"` はアンビエントモジュール宣言として
 * `import ... from "qrcode"` を型解決させる。
 */
declare module "qrcode" {
  /** {@link toString} に渡す描画オプション（本プロダクトが用いる範囲）。 */
  interface QRCodeToStringOptions {
    /** 出力表現。参加 QR は可視要素としての SVG を用いる。 */
    type?: "svg" | "utf8" | "terminal";
    /** 誤り訂正レベル。 */
    errorCorrectionLevel?:
      | "low"
      | "medium"
      | "quartile"
      | "high"
      | "L"
      | "M"
      | "Q"
      | "H";
    /** クワイエットゾーン（モジュール単位の静的余白）。 */
    margin?: number;
    /** 出力画像の幅（省略時はモジュール数に追従）。 */
    width?: number;
    /** 1 モジュールあたりのピクセル数。 */
    scale?: number;
    /** QR バージョン（型番）。 */
    version?: number;
    /** 前景・背景色。 */
    color?: {
      dark?: string;
      light?: string;
    };
  }

  /** 本プロダクトが利用する `qrcode` の表面。 */
  interface QRCodeApi {
    /** テキストを QR へ符号化した文字列（`type: "svg"` で SVG 文字列）を返す。 */
    toString(text: string, options?: QRCodeToStringOptions): Promise<string>;
  }

  const qrcode: QRCodeApi;
  export default qrcode;
}
