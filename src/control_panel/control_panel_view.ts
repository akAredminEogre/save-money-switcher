// @generated-by: codd implement
// @generated-from: docs/design/surface_copy_obligations.md (design:surface-copy-obligations)
// @design-node: docs/design/surface_copy_obligations.md
// @output-paths: src, tests
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

/**
 * 制御盤サーフェス（`/control-panel`）のビューモデル構築（surface_copy_obligations §2.2 /
 * op_render_control_panel_surface・SCO-1・N-3・論点7）。
 *
 * 司会者向けの進行制御コンソールの表示モデルを、純関数として組み立てる。可視要素は §2.7 の
 * 全司会者トリガー（{@link HOST_TRIGGERS} と個別ジャンプ {@link MODE_JUMP_TRIGGERS}）、参加者一覧
 * （自己入力氏名 `participants.name`）、接続把握「◯/◯台」、参加用 QR に限る。解答者用の数値入力
 * 送信面（+1/-1/+10/-10 と送信）は持たない（dod_cp_no_answerer_input_face）。ロール表記は単一定義
 * {@link ROLE_LABELS} から供給し、内部ロール識別子（host/answerer）・内部イベント名・設定キー名・
 * point/pt/点・デモ/テスト表記を可視コピーへ出さない（dod_cp_no_internal_leak）。
 *
 * 参加用 QR の符号化（クラウド公開 `/join` URL → SVG）は `module:participants`（`op_display_join_qr`）
 * が所有し、本サーフェスは解決済みの `joinUrl` と `joinQrSvg` を受け取って描画するのみとする（生成
 * 責務を持たない）。上限台数の解決は `src/config/` が所有し、本ビルダは解決済み値を受け取る。
 */

import { ROLE_LABELS } from "../game_state/role_labels.js";
import type { Participant } from "../participants/participant.js";
import type { Stage } from "../game_state/progression.js";
import { controlPanelStatusLabel } from "./status_labels.js";
import { formatTabletConnectionCount } from "./connection_count.js";
import {
  HOST_TRIGGERS,
  MODE_JUMP_TRIGGERS,
  type HostTriggerView,
  type ModeJumpTriggerView,
} from "./host_triggers.js";

/** 参加者一覧の 1 行（自己入力氏名を表示する。端末番号・座席は持たない）。 */
export interface RosterEntryView {
  /** 参加者の安定識別子（`participants.id`・表示制御用の非可視キー）。 */
  readonly participantId: string;
  /** 参加者が自己入力した氏名（`participants.name`）。 */
  readonly displayName: string;
}

/** 参加用 QR 提示面のビュー（解決済みの公開 URL と SVG を描画するのみ）。 */
export interface JoinQrView {
  readonly heading: string;
  /** 符号化元のクラウド公開 `/join` URL（`module:participants` が解決）。 */
  readonly joinUrl: string;
  /** 解決済みの QR SVG マークアップ（`renderJoinQrSvg` 由来）。 */
  readonly svg: string;
  readonly caption: string;
}

/** 制御盤サーフェスの完全な表示モデル。 */
export interface ControlPanelView {
  /** 司会者の可視ロールラベル（{@link ROLE_LABELS} から供給）。 */
  readonly roleLabel: string;
  readonly title: string;
  readonly statusHeading: string;
  /** 現在の進行状況を運用語で表したラベル（内部イベント名を出さない）。 */
  readonly statusLabel: string;
  /** §2.7 の司会者トリガー（個別ジャンプを除く）。 */
  readonly triggers: readonly HostTriggerView[];
  readonly modeJumpHeading: string;
  /** 各モード（a〜e）への個別ジャンプトリガー。 */
  readonly modeJumpTriggers: readonly ModeJumpTriggerView[];
  readonly rosterHeading: string;
  /** 参加者一覧（自己入力氏名）。 */
  readonly roster: readonly RosterEntryView[];
  readonly connectionCountHeading: string;
  /** 接続把握「◯/◯台」（host 面のみ・設定キー名を露出しない）。 */
  readonly connectionCount: string;
  /** 参加用 QR 提示面。 */
  readonly joinQr: JoinQrView;
}

/** 制御盤ビュー構築の入力。 */
export interface ControlPanelInput {
  /** 現在の進行段階（運用語ラベルへ写す）。 */
  readonly stage: Stage;
  /** 参加者一覧（自己入力氏名を反映する。VB-08 の制御盤側）。 */
  readonly participants: readonly Participant[];
  /** 現在の解答者（タブレット）接続数。 */
  readonly connectedTablets: number;
  /** 解決済みのタブレット接続上限（`src/config/` が解決した値）。 */
  readonly maxTabletConnections: number;
  /** 参加用 QR が符号化するクラウド公開 `/join` URL。 */
  readonly joinUrl: string;
  /** 解決済みの参加用 QR SVG（`renderJoinQrSvg` 由来）。 */
  readonly joinQrSvg: string;
}

/**
 * 制御盤サーフェスの表示モデルを組み立てる。
 *
 * 参加者一覧は入力の自己入力氏名をそのまま反映し（端末番号・事前氏名台帳を持ち込まない）、
 * 進行状況は運用語へ、接続把握は「◯/◯台」へ写す。ロール表記は {@link ROLE_LABELS} から供給する。
 */
export function buildControlPanelView(input: ControlPanelInput): ControlPanelView {
  const roster: readonly RosterEntryView[] = input.participants.map((p) => ({
    participantId: p.id,
    displayName: p.name,
  }));
  return {
    roleLabel: ROLE_LABELS.host,
    title: "進行制御盤",
    statusHeading: "進行状況",
    statusLabel: controlPanelStatusLabel(input.stage),
    triggers: HOST_TRIGGERS,
    modeJumpHeading: "個別ジャンプ",
    modeJumpTriggers: MODE_JUMP_TRIGGERS,
    rosterHeading: "参加者一覧",
    roster,
    connectionCountHeading: "接続台数",
    connectionCount: formatTabletConnectionCount(
      input.connectedTablets,
      input.maxTabletConnections,
    ),
    joinQr: {
      heading: "参加用QR",
      joinUrl: input.joinUrl,
      svg: input.joinQrSvg,
      caption: "このQRコードを読み取って参加してください",
    },
  };
}
