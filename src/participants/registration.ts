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
 * 参加者登録の公開ファサード（`module:participants`・op_join_game の durable producer）。
 *
 * participation_connection_design §2.2 の委譲例に従い、参加確定時の参加者レコード生成
 * {@link registerParticipant} の実装本体を `src/participants/registration_impl.ts` に置き、本モジュールは
 * それを re-export する単一の公開入口である。受入判定（家族限定アクセス制御 → 氏名検証 → 上限判定）を
 * 順に束ねてから本 producer を呼ぶ /join オーケストレーションは `design:realtime-sync-design` が所有する
 * 消費者であり（§1.1 責務境界）、本ファサードは受入成立後の永続化 producer とその入出力型・エラーだけを
 * 公開する。
 *
 * 相対 re-export は NodeNext 規約に従い出力 `.js` を明示する（type-only 再エクスポートも同一規約）。
 */

export {
  registerParticipant,
  InvalidDisplayNameError,
} from "./registration_impl.js";
export type {
  RegisterParticipantInput,
  RegisterParticipantDeps,
} from "./registration_impl.js";
export type { Participant } from "./participant.js";
