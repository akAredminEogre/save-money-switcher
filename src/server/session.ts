/**
 * ローカル試遊用の in-memory 単一セッション（`module:server`・cmd_2159 Phase1）。
 *
 * 本モジュールは「ローカルで家族クイズを 1 卓（1 マシン・複数タブ）試遊できる」ための
 * 揮発セッション状態のみを保持するシングルトンである。既存 QC 済みドメイン
 * （`game_state` / `scoring` / `realtime_sync` / `render_*`）は **import 合成のみ**で用い、
 * それらの型・関数は一切改変しない。永続化・複数セッション・再接続 recovery・QR 実参加は
 * Phase2 の関心事ゆえここには持ち込まない。
 *
 * 進行の権威:
 *   - セッションポインタ（現在問番号・TV モード・フェーズ）は {@link GameState}（game_state）。
 *   - 各問の到達段階（accepting〜settlement_computed）は問番号キーの `stage` で保持し、
 *     遷移は `round_machine`（lock/open/reveal/settle）を単一判定点として用いる。
 *   - 精算拠出台帳は `scoring.settleQuestion` が生成した {@link QuestionSettlement} を問番号で保持し、
 *     残額は `scoring.aggregateBalance` が台帳から全再計算する（`balances` は導出値・二重管理しない）。
 */

import type { GameState } from "../game_state/game_state.js";
import { INITIAL_STAGE, type Stage } from "../game_state/progression.js";
import { createSequenceGenerator, type SequenceGenerator } from "../realtime_sync/protocol.js";
import { aggregateBalance } from "../scoring/aggregate_balance.js";
import type { QuestionSettlement } from "../scoring/settlement.js";
import type { Question } from "../questions/question.js";
import type { Participant } from "../participants/participant.js";

/** 1 ゲームの問題数（確定値・data_model_design §2.2）。 */
export const QUESTIONS_PER_GAME = 10;

/**
 * ローカル試遊のシード問題集（10 問・テキスト出題）。動画/画像は用いずテキスト面
 * （`videoPath`/`imagePath` = null → TV a はテキストフォールバック）で完結させる。
 * `correctValue` は 0〜100 の整数（{@link Question} の回答レンジ）。実データ入稿（ファイル/DB）は
 * Phase2 の関心事ゆえ、Phase1 は試遊が成立する最小の固定集合をコードで供給する。
 */
export const SEED_QUESTIONS: readonly Question[] = Object.freeze(
  [
    { text: "日本の都道府県は全部でいくつ？", correctValue: 47 },
    { text: "1日は何時間？", correctValue: 24 },
    { text: "サッカーは1チーム何人でプレーする？", correctValue: 11 },
    { text: "虹はふつう何色といわれる？", correctValue: 7 },
    { text: "1年は何か月？", correctValue: 12 },
    { text: "人間の永久歯は全部で何本？", correctValue: 32 },
    { text: "トランプ1組は全部で何枚（ジョーカーを除く）？", correctValue: 52 },
    { text: "水が氷になるのはセ氏何度？", correctValue: 0 },
    { text: "還暦は何歳のお祝い？", correctValue: 60 },
    { text: "1ダースはいくつ？", correctValue: 12 },
  ].map((q, index) => ({
    id: `q${index + 1}`,
    questionNumber: index + 1,
    text: q.text,
    imagePath: null,
    videoPath: null,
    correctValue: q.correctValue,
  })),
);

/** in-memory 単一セッションの揮発状態。 */
export interface Session {
  /** セッションポインタ（現在問番号・TV モード・フェーズ）。 */
  game: GameState;
  /**
   * ホストが「問題を読み込む」を押して出題を開始済みか。false（lobby）の間、TV a は
   * 出題内容を出さず受動シェルのみを提示する（起動直後の静的 chrome と一致させる）。
   */
  loaded: boolean;
  /** 各問の到達段階（問番号 → stage）。未出題の問はエントリを持たない（既定 accepting）。 */
  stages: Map<number, Stage>;
  /** 参加者一覧（自己入力氏名・接続識別子）。 */
  participants: Participant[];
  /** 各問の解答（問番号 → (participantId → 0〜100 の整数)）。 */
  answers: Map<number, Map<string, number>>;
  /** 各問の精算拠出台帳（問番号 → settleQuestion の結果）。 */
  settlements: Map<number, readonly QuestionSettlement[]>;
  /** セッション単位の seq 発番器（ServerEvent の単調増加連番）。 */
  seq: SequenceGenerator;
}

/** 新規セッションを生成する（lobby・第1問・TV モード a）。 */
function createSession(): Session {
  return {
    game: { currentQuestionNumber: 1, tvMode: "a", phase: "lobby" },
    loaded: false,
    stages: new Map<number, Stage>(),
    participants: [],
    answers: new Map<number, Map<string, number>>(),
    settlements: new Map<number, readonly QuestionSettlement[]>(),
    seq: createSequenceGenerator(),
  };
}

/** module-level シングルトン（ローカルは 1 卓 1 セッション）。 */
export const session: Session = createSession();

/** 現在問の到達段階を返す（未出題は初期段階 accepting）。 */
export function currentStage(s: Session = session): Stage {
  return s.stages.get(s.game.currentQuestionNumber) ?? INITIAL_STAGE;
}

/** 現在出題中の問題（シード集合から現在問番号で解決）。 */
export function currentQuestion(s: Session = session): Question {
  const q = SEED_QUESTIONS[s.game.currentQuestionNumber - 1];
  if (q === undefined) {
    // 到達不能: currentQuestionNumber は 1〜QUESTIONS_PER_GAME に保たれる。
    throw new RangeError(`問題番号 ${s.game.currentQuestionNumber} に対応する問題がありません。`);
  }
  return q;
}

/** 指定問の解答マップを取得（無ければ生成して返す）。 */
export function answersForQuestion(questionNumber: number, s: Session = session): Map<string, number> {
  let map = s.answers.get(questionNumber);
  if (map === undefined) {
    map = new Map<string, number>();
    s.answers.set(questionNumber, map);
  }
  return map;
}

/**
 * 当該参加者の現在残額（整数円）を `scoring.aggregateBalance` で全再計算する。
 * 全問の精算台帳から当該参加者の拠出行だけを集めて集計する（台帳が正・残額は導出）。
 */
export function balanceFor(participantId: string, s: Session = session): number {
  const rows: QuestionSettlement[] = [];
  for (const perQuestion of s.settlements.values()) {
    for (const row of perQuestion) {
      if (row.participantId === participantId) rows.push(row);
    }
  }
  return aggregateBalance(rows);
}
