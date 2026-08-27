// @generated-by: codd implement
// @generated-from: docs/detailed_design/state_machines.md (detailed_design:state-machines)
// @design-node: docs/detailed_design/state_machines.md
// @output-paths: tests
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @generated-from: docs/design/operational_behavior_model.md (design:operational-behavior-model)
// @generated-from: docs/design/participation_connection_design.md (design:participation-connection-design)
// @generated-from: docs/design/question_media_intake_design.md (design:question-media-intake-design)
// @generated-from: docs/design/realtime_sync_design.md (design:realtime-sync-design)
// @generated-from: docs/design/scoring_engine_design.md (design:scoring-engine-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { describe, it, expect } from "vitest";
import {
  admitTablet,
  type AdmitResult,
} from "../../src/participants/connection_machine.js";

// Connection Lifecycle Machine（src/participants/connection_machine.ts の admitTablet）の
// 同時接続上限の境界を in-process で検証する（SM-3・detailed_design:state-machines
// §2.5 / §3.3 / §4.4 / §4.5）。admitTablet は「現在の answerer 接続数」と config が解決した
// 上限だけを参照して受入可否（{ kind: "ok" } / { kind: "over_limit" }）を返す純関数で、
// 上限値そのものは src/config/connection_limit.ts が単一解決する（既定 8 はそこの単一定数）。
// 本テストは env を明示注入して process.env に依存せず駆動し、
//   ・上限未設定（既定 8）：8 台目（connected=7）まで許可・9 台目（connected=8）拒否
//   ・MAX_TABLET_CONNECTIONS=16：16 台目まで許可・17 台目拒否（コード改修なし追随）
//   ・MAX_TABLET_CONNECTIONS=32：32 台目まで許可・33 台目拒否
// を固定する。over_limit を受けた connection_rejected＋WS close(4001) の通知や既存データ
// （participants/answers/balances）の不変性は module:realtime_sync の責務で別スイートが担い、
// 本テストは connection_machine が所有する受入可否の判定のみを検証する。
// 期待結果は SUT 出力とは独立に AdmitResult 型付き定数として書き、実出力へ突き合わせる
// （kind と "ok"/"over_limit" のタグは producer connection_machine.ts の AdmitResult に由来）。

const OK: AdmitResult = { kind: "ok" };
const OVER_LIMIT: AdmitResult = { kind: "over_limit" };

describe("participants/connection_machine admitTablet 上限境界（SM-3・§4.5）", () => {
  // codd: covers vb=VB-10
  it("上限未設定（既定 8）で 8 台目タブレットまで接続が成立する", () => {
    // connected=0（1 台目の受入）から connected=7（8 台目の受入）まで、いずれも受入可であること。
    // 判定は config の解決値（既定 8）を参照し、8 台目までの枠が空いていれば admitTablet は ok を返す。
    for (let connected = 0; connected <= 7; connected += 1) {
      expect(admitTablet(connected, {})).toEqual(OK);
    }
  });

  // codd: covers vb=VB-11
  it("既定 8 の上限到達後、9 台目（connected=8）が over_limit で断られる", () => {
    // 8 台受入済み（connected=8）で新規参加を試みる 9 台目は上限到達ゆえ over_limit を返し成立しない。
    // WS close(4001) 付きの connection_rejected 通知は realtime_sync の責務だが、
    // 「9 台目を受け入れない」判定（authority 層の断り）は connection_machine が所有し本判定が根拠となる。
    expect(admitTablet(8, {})).toEqual(OVER_LIMIT);
    // 8 台目（connected=7）は許可・9 台目（connected=8）は拒否＝上限がちょうど 8 であることを固定する。
    expect(admitTablet(7, {})).toEqual(OK);
    // 上限超過側は 9 台受入済み相当（connected=9）でも一貫して over_limit。
    expect(admitTablet(9, {})).toEqual(OVER_LIMIT);
  });

  // codd: covers vb=VB-13
  it("MAX_TABLET_CONNECTIONS=16 注入で 16 台目まで許可・17 台目拒否（コード改修なし追随）", () => {
    const env = { MAX_TABLET_CONNECTIONS: "16" };
    // 16 台目（connected=15）は受入可。
    expect(admitTablet(15, env)).toEqual(OK);
    // 17 台目（connected=16）は上限到達で over_limit。
    expect(admitTablet(16, env)).toEqual(OVER_LIMIT);
    // 同一 admitTablet が env 注入だけで既定 8 の枠を超えて 9 台目相当（connected=8）も受け入れる＝設定追随。
    expect(admitTablet(8, env)).toEqual(OK);
  });

  // codd: covers vb=VB-14
  it("MAX_TABLET_CONNECTIONS=32 注入で 32 台目まで許可・33 台目拒否", () => {
    const env = { MAX_TABLET_CONNECTIONS: "32" };
    // 32 台目（connected=31）は受入可。
    expect(admitTablet(31, env)).toEqual(OK);
    // 33 台目（connected=32）は上限到達で over_limit。
    expect(admitTablet(32, env)).toEqual(OVER_LIMIT);
    // 16 の枠（connected=16）を超えても 32 まで受け入れる＝上限が注入値へ追随している証左。
    expect(admitTablet(16, env)).toEqual(OK);
  });

  it("同一の接続数でも env 注入値のみで受入可否が反転する（判定は解決値参照で固定 8 でない）", () => {
    // connected=15 は既定 8 では over_limit、16 注入では ok、と注入値のみで結果が変わる。
    expect(admitTablet(15, {})).toEqual(OVER_LIMIT);
    expect(admitTablet(15, { MAX_TABLET_CONNECTIONS: "16" })).toEqual(OK);
  });
});
