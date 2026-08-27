// @generated-by: codd implement
// @generated-from: docs/design/participation_connection_design.md (design:participation-connection-design)
// @design-node: docs/design/participation_connection_design.md
// @output-paths: src, tests
// @generated-from: docs/design/realtime_sync_design.md (design:realtime-sync-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { describe, it, expect } from "vitest";
import {
  renderJoinQrSvg,
  InvalidJoinUrlError,
} from "../../src/participants/qr.js";

describe("participants/qr 参加 URL の QR 符号化（op_display_join_qr / dod_qr_encodes_public_join_url）", () => {
  const joinUrl = "https://save-money.example.com/join";
  const joinUrlWithToken = "https://save-money.example.com/join?t=family-secret";

  // codd: covers vb=VB-06
  it("解決済みの /join 公開 URL を符号化した QR を可視要素の SVG として生成する", async () => {
    const svg = await renderJoinQrSvg(joinUrl);
    const svgAgain = await renderJoinQrSvg(joinUrl);
    const svgWithToken = await renderJoinQrSvg(joinUrlWithToken);

    // 制御盤の QR 提示面に可視要素として描画できる SVG ルート要素であること（QR 提示面に表示される）。
    // SVG ルート要素そのものへ束縛し、文書全体の走査ではなく提示される図形の識別を確かめる。
    expect(svg.trimStart().startsWith("<svg")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);

    // 同一 URL からは決定的に同一の QR が得られる（符号化は入力 URL の関数）。
    expect(svg).toBe(svgAgain);

    // QR は参加 URL そのものを符号化するため、URL（分岐 A の秘匿トークン付与を含む）が変われば
    // 符号化結果も変わる＝固定値ではなく渡された /join URL を符号化している。他者向けの定数や入力無視の
    // 実装ならこの不等号が破れて RED になる。
    expect(svgWithToken.trimStart().startsWith("<svg")).toBe(true);
    expect(svgWithToken).not.toBe(svg);
  });

  it("空・非 http(s)・URL 解釈不能な入力は QR 符号化せず拒否する（データ境界防衛）", async () => {
    // 解決済み URL を受け取る契約だが、非 Web スキーム等を QR へ通さないサーバ側最終防衛を固定する。
    await expect(renderJoinQrSvg("")).rejects.toThrow(InvalidJoinUrlError);
    await expect(renderJoinQrSvg("   ")).rejects.toThrow(InvalidJoinUrlError);
    await expect(renderJoinQrSvg("javascript:alert(1)")).rejects.toThrow(
      InvalidJoinUrlError,
    );
    await expect(renderJoinQrSvg("not a url")).rejects.toThrow(InvalidJoinUrlError);
  });
});
