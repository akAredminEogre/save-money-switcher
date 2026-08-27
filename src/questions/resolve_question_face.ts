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
 * TV a モードの出題面（display-ready）解決 ── `resolveQuestionFace`
 * （`module:questions` ／ surface_copy_obligations §2.4a・§2.9 / op_switch_tv_mode /
 * dod_tv_no_path_or_internal_leak・VB-48 / VB-49 / VB-83）。
 *
 * 本モジュールは TV の a（出題）モードが観客向けに描画する「解決済みの出題面」を供給する
 * 純関数の単一入口である。出題面の優先順位（N-2・確定順序）は **動画 →（無ければ）画像 →
 * （無ければ）テキスト** であり、この段階解決そのものはメディア層の純関数
 * `src/media/resolve_question_face.ts`（`{ kind, source }` を返す）へ委譲して単一の真実源と
 * する。本モジュールはその結果を **描画可能値（display-ready）** へ写し、次を保証する:
 *
 *   - 動画・画像は配信 URL（`/media/...`）として返し、DB 保持の生ファイルパス
 *     （`video_path`／`image_path` の値）そのものを描画値として持たせない
 *     （生パスは配信 URL 構築にのみ用いる・question_media_intake §2.4）。
 *   - テキストは問題文（`questions.text`）を観客向けの可視値として返す。
 *   - 返却値の種別語は video/image/text の観客中立な語のみで、`fallback` 等の内部語・
 *     内部イベント名を可視値として一切含めない。
 *
 * これにより TV a 面は本関数が返す解決済み値のみを描画でき、生パス文字列や内部語が観客の
 * 可視表示へ露出しない（dod_tv_no_path_or_internal_leak）。純関数として外部 I/O を持たず、
 * 優先順位判定はメディア層へ一元化して `module:questions` をリーフに保つ。
 */

import type { Question } from "./question.js";
import { resolveQuestionFace as resolveQuestionMediaFace } from "../media/resolve_question_face.js";

/**
 * 出題面の種別（video / image / text）。メディア層 `src/media/resolve_question_face.ts` の
 * 単一定義を再輸出し、優先順位段の語を本層と共有する（観客中立語のみ・内部語を含まない）。
 */
export type { QuestionFaceKind } from "../media/resolve_question_face.js";

/**
 * TV a モードのメディア配信ルート（kebab-case・question_media_intake_design §2.4）。
 *
 * 生の相対パスはこのルート配下の配信 URL 構築にのみ用い、可視表示へは出さない。設計が
 * `/media` を配信ルートとして固定するため、単一の定数として保持する。
 */
export const MEDIA_ROUTE_BASE = "/media" as const;

/** 動画で解決した出題面（配信 URL を `<video>` の src に用い、生パスを露出しない）。 */
export interface VideoQuestionFace {
  readonly kind: "video";
  /** 動画の配信 URL（`/media/...`）。生の `video_path` 値そのものではない。 */
  readonly mediaUrl: string;
}

/** 画像で解決した出題面（配信 URL を `<img>` の src に用い、生パスを露出しない）。 */
export interface ImageQuestionFace {
  readonly kind: "image";
  /** 画像の配信 URL（`/media/...`）。生の `image_path` 値そのものではない。 */
  readonly mediaUrl: string;
}

/** テキストで解決した出題面（問題文を観客向けの可視値として提示する）。 */
export interface TextQuestionFace {
  readonly kind: "text";
  /** 観客へ提示する問題文（`questions.text`）。生パス・内部語ではない。 */
  readonly text: string;
}

/**
 * TV a モードの描画可能な出題面。動画・画像は配信 URL を、テキストは問題文を持ち、いずれの
 * 種別も生ファイルパス文字列や `fallback` 等の内部語を可視値として持たない判別可能ユニオン。
 */
export type QuestionFaceView =
  | VideoQuestionFace
  | ImageQuestionFace
  | TextQuestionFace;

/**
 * 出題メディアの相対パスを配信 URL（`/media/...`）へ写す。
 *
 * 生の相対パスをそのまま返さず、配信ルート配下の URL を構築する（各セグメントを
 * `encodeURIComponent` で符号化し、空セグメント・先頭スラッシュを畳む）。これにより返却値は
 * 生ファイルパス値そのものと一致せず、配信 URL としてのみ用いられる。
 */
function toMediaUrl(relativePath: string): string {
  const segments = relativePath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment));
  return [MEDIA_ROUTE_BASE, ...segments].join("/");
}

/** 到達不能な出題面種別に対する網羅性ガード（想定外の enum 値のみで発火する）。 */
function assertUnreachableKind(kind: never): never {
  throw new Error(`未対応の出題面種別です: ${String(kind)}`);
}

/**
 * 1 問の出題面を **動画 →（無ければ）画像 →（無ければ）テキスト** の確定順（N-2）で解決し、
 * 描画可能値（display-ready）を返す純関数。
 *
 * 優先順位判定はメディア層 {@link resolveQuestionMediaFace}（`src/media/`）へ委譲して単一の
 * 真実源とし（動画パス有→動画・画像有無に依らず動画優先／動画無・画像有→画像／双方無→
 * テキスト）、その `source` を種別に応じて配信 URL または問題文へ写す。返却値は生ファイルパス
 * 文字列や `fallback` 等の内部語を可視値として持たない（dod_tv_no_path_or_internal_leak）。
 */
export function resolveQuestionFace(question: Question): QuestionFaceView {
  const mediaFace = resolveQuestionMediaFace(question);
  switch (mediaFace.kind) {
    case "video":
      return { kind: "video", mediaUrl: toMediaUrl(mediaFace.source) };
    case "image":
      return { kind: "image", mediaUrl: toMediaUrl(mediaFace.source) };
    case "text":
      return { kind: "text", text: mediaFace.source };
    default:
      return assertUnreachableKind(mediaFace.kind);
  }
}
