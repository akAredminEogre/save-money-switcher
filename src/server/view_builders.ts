/**
 * ロール別サーフェス断片ビルダ（`module:server`・cmd_2159 Phase1・要確認C）。
 *
 * {@link session} の権威状態から、各ロール（host=制御盤 / answerer=タブレット /
 * audience=TV）の描画済み HTML 断片を組み立てる。描画は既存 render モジュール
 * （`renderControlPanelHtml` / `renderTabletSurface` / `renderTvSurface`＋`serializeTvSurface`）を
 * **import 合成のみ**で用い、session state → 各 render モジュールの入力型（`ControlPanelInput` /
 * `TabletSurfaceState` / `TvSurfaceRequest`）への写像だけを新規に担う。ロール可視境界
 * （answerer=自分の残額のみ / audience=TV のみ / 開示前は他者解答を伏せる）は、ロールごとに
 * 対応する面だけを組むこと自体で担保される（`fanout.projectForRole` と同じ可視規約）。
 *
 * 起動直後（lobby・未出題）の TV a は、出題内容を出さず受動シェルのみを提示する。これにより
 * live 描画が静的 GET（main.ts の初期 chrome）と一致し、progressive enhancement で既存 E2E を
 * 壊さない（未出題では出題面へ実データを持ち込まない）。
 */

import { buildControlPanelView } from "../control_panel/control_panel_view.js";
import { renderControlPanelHtml } from "../control_panel/render_control_panel.js";
import { renderTabletSurface } from "../tablet/render_tablet_surface.js";
import type { TabletSurfaceState } from "../tablet/tablet_surface_view_model.js";
import type { TabletInputStatus } from "../tablet/tablet_status.js";
import { renderTvSurface, serializeTvSurface } from "../tv_display/render_tv_surface.js";
import type { SettlementTableEntry } from "../tv_display/render_settlement_table.js";
import { acceptsSubmissions, isDisclosed, isSettled, stageRank, type Stage } from "../game_state/progression.js";
import {
  session,
  currentStage,
  currentQuestion,
  answersForQuestion,
  balanceFor,
  type Session,
} from "./session.js";

/** 制御盤断片の組立に要する、config/QR 由来の解決済みコンテキスト（main.ts が供給）。 */
export interface ControlPanelContext {
  readonly joinUrl: string;
  readonly joinQrSvg: string;
  readonly maxTabletConnections: number;
  readonly connectedTablets: number;
}

/** HTML 特殊文字を実体参照へ退避する（受動シェルの反射型注入防止・main.ts と同一規約）。 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * TV a/c の受動シェル（データ捏造なし）。出題開始前・正解発表前はモード識別可能な観客向け
 * 見出しのみを描画し、実データ（出題本文・正解値）を持ち込まない（main.ts `tvPassiveShell` と同形）。
 */
function tvPassiveShell(mode: "a" | "c", heading: string, note: string): string {
  return (
    `<section class="tv-surface tv-mode-${mode}">` +
    `<div class="tv-line">${escapeHtml(heading)}</div>` +
    `<div class="tv-line">${escapeHtml(note)}</div></section>`
  );
}

/** 制御盤（host）サーフェス断片を組み立てる。 */
export function buildControlPanelFragment(ctx: ControlPanelContext, s: Session = session): string {
  const view = buildControlPanelView({
    stage: currentStage(s),
    participants: s.participants,
    connectedTablets: ctx.connectedTablets,
    maxTabletConnections: ctx.maxTabletConnections,
    joinUrl: ctx.joinUrl,
    joinQrSvg: ctx.joinQrSvg,
  });
  return renderControlPanelHtml(view);
}

/**
 * タブレット（answerer）サーフェス断片を組み立てる。`participantId` が無い（未参加・匿名）
 * 接続は残額 0・未送信で描画し、静的 GET /tablet と一致させる。数値ステッパの作成中値は
 * クライアント局所状態ゆえサーバは 0 を返し（クライアントが swap 後に自分の値を復元する）。
 */
export function buildTabletFragment(participantId: string | null, s: Session = session): string {
  const stage = currentStage(s);
  const status: TabletInputStatus = acceptsSubmissions(stage) ? "accepting" : "locked";
  const submitted =
    participantId !== null && answersForQuestion(s.game.currentQuestionNumber, s).has(participantId);
  const ownBalanceYen = participantId !== null ? balanceFor(participantId, s) : 0;
  const state: TabletSurfaceState = {
    questionNumber: s.game.currentQuestionNumber,
    answerValue: 0,
    submitted,
    ownBalanceYen,
    status,
  };
  return renderTabletSurface(state);
}

/** 開示段階（answers_opened 以降）に到達済みか。 */
function isOpened(stage: Stage): boolean {
  return stageRank(stage) >= stageRank("answers_opened");
}

/** 現在問の氏名＋解答の一覧（開示 b 用・突合できた参加者のみ）。 */
function disclosureAnswers(s: Session): readonly { name: string; answerValue: number }[] {
  const answerMap = answersForQuestion(s.game.currentQuestionNumber, s);
  const rows: { name: string; answerValue: number }[] = [];
  for (const p of s.participants) {
    const value = answerMap.get(p.id);
    if (value !== undefined) rows.push({ name: p.name, answerValue: value });
  }
  return rows;
}

/** 現在問の 6 列精算エントリ（d 用・精算台帳＋氏名＋現在残額を結合）。 */
function settlementEntries(s: Session): readonly SettlementTableEntry[] {
  const rows = s.settlements.get(s.game.currentQuestionNumber) ?? [];
  const entries: SettlementTableEntry[] = [];
  for (const row of rows) {
    const p = s.participants.find((pp) => pp.id === row.participantId);
    if (p === undefined) continue; // 突合できない行は描画対象外
    entries.push({
      name: p.name,
      answerValue: row.answerValue,
      error: row.error,
      deltaYen: row.deltaYen,
      pitariAwarded: row.pitariAwarded,
      pitariBonusYen: row.pitariBonusYen,
      balanceYen: balanceFor(p.id, s),
    });
  }
  return entries;
}

/** 全員の通算残額一覧（e 用）。 */
function totalsEntries(s: Session): readonly { name: string; balanceYen: number }[] {
  return s.participants.map((p) => ({ name: p.name, balanceYen: balanceFor(p.id, s) }));
}

/**
 * TV（audience）サーフェス断片を、現在の `game.tvMode` と進行段階から組み立てる。
 * 未出題（lobby）や未到達段階では受動シェル／空データを提示し、実データを先取りしない。
 */
export function buildTvFragment(s: Session = session): string {
  const mode = s.game.tvMode;
  const stage = currentStage(s);
  switch (mode) {
    case "a":
      if (!s.loaded) return tvPassiveShell("a", "出題", "出題の開始をお待ちください。");
      return serializeTvSurface(renderTvSurface({ mode: "a", question: currentQuestion(s) }));
    case "b":
      return serializeTvSurface(
        renderTvSurface({
          mode: "b",
          disclosure: { disclosed: isOpened(stage), answers: isOpened(stage) ? disclosureAnswers(s) : [] },
        }),
      );
    case "c":
      if (!isDisclosed(stage)) return tvPassiveShell("c", "正解", "正解の発表をお待ちください。");
      return serializeTvSurface(renderTvSurface({ mode: "c", correctValue: currentQuestion(s).correctValue }));
    case "d":
      return serializeTvSurface(
        renderTvSurface({ mode: "d", settlement: isSettled(stage) ? settlementEntries(s) : [] }),
      );
    case "e":
      return serializeTvSurface(
        renderTvSurface({ mode: "e", totals: { entries: totalsEntries(s), finished: s.game.phase === "finished" } }),
      );
  }
}
