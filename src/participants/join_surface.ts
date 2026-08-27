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
 * 参加受付サーフェス `/join` の描画（`module:participants`・surface_copy_obligations §2.6 /
 * op_render_join_surface / VB-81 / VB-82 / VB-58）。
 *
 * 解答者が制御盤の QR から到達する `/join` を、家族限定アクセス制御の判定結果（checkJoinAccess）・
 * 接続上限の充足（admitTablet）・分岐B 認証状態から導いた真偽値に応じて描画分岐する純粋な
 * ビュー投影である。許可済・非満席のときのみ氏名の自己入力欄と「参加する」を提示し、可視要素は
 * それに限る（事前氏名台帳・端末番号割当の入力要素を型としても持たない・dod_join_no_seat_ledger_ui）。
 * 満席時・アクセス不可時・分岐B 未認証時は job-to-be-done 平易文へ分岐し、設定キー名
 * （MAX_TABLET_CONNECTIONS 等）・接続数会計（◯/◯台）・内部ロール識別子（host/answerer/
 * audience）・アクセス制御方式（トークン/認証）を一切露出しない（dod_join_full_plain_copy /
 * dod_join_access_denied_plain_copy）。未認証・未参加の到達点に制御盤操作等の保護ナビを露出
 * させず、分岐B 未認証はログインへ誘導する（dod_join_no_protected_nav）。
 *
 * 可視ロールラベルは単一供給点 {@link ROLE_LABELS} から取り、氏名入力欄の長さ上限は氏名検証の
 * 単一定義 {@link MAX_DISPLAY_NAME_LENGTH} を反映して UI とサーバの制約を一致させる。本モジュールは
 * 投影のみを担い、アクセス判定・上限判定・氏名永続の各機構へは依存しない（それらの確定結果を
 * 入力として受け取る）。
 */

import { ROLE_LABELS } from "../game_state/role_labels.js";
import { MAX_DISPLAY_NAME_LENGTH } from "./name.js";

/** 氏名入力欄の前置き（「お名前を入力してください」）。 */
export const JOIN_NAME_PROMPT = "お名前を入力してください";

/** 参加確定 CTA の可視ラベル（「参加する」）。 */
export const JOIN_SUBMIT_LABEL = "参加する";

/** 満席時の job-to-be-done 平易文（設定キー名・接続数会計・ロール識別子を含まない）。 */
export const JOIN_FULL_MESSAGE = "ただいま満席のため参加できません";

/** アクセス不可時の平易文（アクセス制御方式＝トークン/認証や内部会計を露出しない）。 */
export const JOIN_ACCESS_DENIED_MESSAGE = "現在ご参加いただけません";

/** 分岐B 未認証時の平易文（保護ナビを露出せずログインへ誘導する）。 */
export const JOIN_LOGIN_REQUIRED_MESSAGE = "参加にはログインが必要です";

/** ログイン導線の可視ラベル。 */
export const JOIN_LOGIN_ACTION_LABEL = "ログイン";

/** ログイン導線の遷移先（制御盤等の保護ナビではないログインの入口）。 */
export const JOIN_LOGIN_PATH = "/login";

/**
 * `/join` の入力欄の用途。氏名の自己入力のみを許し、端末番号割当・事前氏名台帳の選択欄を
 * 型として持たない（dod_join_no_seat_ledger_ui）。
 */
export type JoinFieldPurpose = "display_name";

/** 氏名の自己入力欄（自由記述テキスト・長さ上限は単一定義から反映）。 */
export interface JoinNameField {
  readonly purpose: JoinFieldPurpose;
  readonly control: "text";
  readonly maxLength: number;
}

/** 参加フォーム面（許可済・非満席）のビューモデル。 */
export interface JoinFormViewModel {
  readonly kind: "form";
  readonly heading: string;
  readonly prompt: string;
  readonly fields: readonly JoinNameField[];
  readonly submitLabel: string;
}

/** ログイン導線（分岐B 未認証時のみ・保護ナビではない）。 */
export interface JoinLoginAffordance {
  readonly label: string;
  readonly path: string;
}

/** 平易文の告知面（満席／アクセス不可／要ログイン）のビューモデル。 */
export interface JoinNoticeViewModel {
  readonly kind: "full" | "access_denied" | "login_required";
  readonly message: string;
  readonly login?: JoinLoginAffordance;
}

/** `/join` の描画結果（参加フォーム面 または 平易文の告知面）。 */
export type JoinSurfaceViewModel = JoinFormViewModel | JoinNoticeViewModel;

/**
 * `/join` の描画分岐を決める入力。家族限定アクセス制御・接続上限・分岐B 認証状態の
 * 確定結果を真偽値として受け取る（判定機構そのものへは依存しない）。
 */
export interface JoinSurfaceInput {
  /** 家族限定アクセス制御の判定結果（checkJoinAccess(...).granted）。 */
  readonly accessGranted: boolean;
  /** 分岐B（認証）で未認証のため、保護ナビを露出せずログインへ誘導すべきか。 */
  readonly loginRedirectRequired: boolean;
  /** answerer 接続が上限に達している（満席）か（admitTablet の over_limit 相当）。 */
  readonly atCapacity: boolean;
}

/**
 * `/join` サーフェスを描画する。アクセス不可・満席・要ログインは平易文へ分岐し、許可済・
 * 非満席のときのみ氏名の自己入力欄と「参加する」を提示する。いずれの分岐でも制御盤操作等の
 * 保護ナビ・設定キー名・接続数会計・内部ロール識別子・アクセス制御方式を露出しない。
 */
export function renderJoinSurface(input: JoinSurfaceInput): JoinSurfaceViewModel {
  if (!input.accessGranted) {
    if (input.loginRedirectRequired) {
      return {
        kind: "login_required",
        message: JOIN_LOGIN_REQUIRED_MESSAGE,
        login: { label: JOIN_LOGIN_ACTION_LABEL, path: JOIN_LOGIN_PATH },
      };
    }
    return { kind: "access_denied", message: JOIN_ACCESS_DENIED_MESSAGE };
  }
  if (input.atCapacity) {
    return { kind: "full", message: JOIN_FULL_MESSAGE };
  }
  return {
    kind: "form",
    heading: `${ROLE_LABELS.answerer}として参加`,
    prompt: JOIN_NAME_PROMPT,
    fields: [
      { purpose: "display_name", control: "text", maxLength: MAX_DISPLAY_NAME_LENGTH },
    ],
    submitLabel: JOIN_SUBMIT_LABEL,
  };
}
