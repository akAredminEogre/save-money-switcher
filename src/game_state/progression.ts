// @generated-by: codd implement
// @generated-from: docs/detailed_design/state_machines.md (detailed_design:state-machines)
// @design-node: docs/detailed_design/state_machines.md
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
 * 問題進行の状態モデル（`module:game_state`）。
 *
 * 各問題は
 *   accepting → answers_locked → answers_opened → answer_revealed → settlement_computed
 * の 5 段階を、この順序で **一方向**に進む（system_design §2.5 / decision_records
 * 論点7・E-3残）。本モジュールはその段階（{@link Stage}）と段階間の合法遷移、および
 * 再採点範囲・締切ガードを仕切る述語（{@link isDisclosed} / {@link isSettled} /
 * {@link acceptsSubmissions}）の**単一所有者**である。scoring / game_flow /
 * realtime_sync など他モジュールはこれらを再実装せず本モジュールを参照する
 * （「開示済み（c 以降）」の判定と締切後の送信拒否は、ここが唯一の出典）。
 *
 * 採点エンジン（`module:scoring`・scoring_engine_design §2.8 / SC-4）は本モジュールの
 * {@link isDisclosed} / {@link isSettled} を**読取り専用**で用いて正解ライブ編集の
 * 自動再採点範囲（c 以降のみ）と TV d/e 同時更新の対象（d 到達のみ）を絞り込む。
 * 段階を前進させる**遷移権限は採点エンジンに無く**、遷移は `role: host` のみが起こす
 * （scoring_engine_design §2.10）。採点エンジンは述語の真偽を判定材料にするだけで
 * 自ら段階を書き換えない。
 *
 * 段階の文字列表現は DB の `game_state.stage`（snake_case）と一致し、そのまま
 * 永続化・復元できる。本モジュールは他の実装単位へ依存しないリーフに保つ。
 */

/** 進行段階の宣言。**宣言順が進行順**であり、添字が段階の順序位置を与える。 */
export const STAGES = [
  "accepting",
  "answers_locked",
  "answers_opened",
  "answer_revealed",
  "settlement_computed",
] as const;

/** 問題の進行段階。`game_state.stage` の値集合と一致する。 */
export type Stage = (typeof STAGES)[number];

/** 各問題が開始時に置かれる初期段階（受付中）。 */
export const INITIAL_STAGE: Stage = "accepting";

/** これ以上先へ進めない終端段階（得点精算済み）。 */
export const TERMINAL_STAGE: Stage = "settlement_computed";

/**
 * 「開示済み」の閾値段階。TV で「c 正解発表」を実行した時点＝この段階以降を
 * 「開示済み」とし、正解ライブ編集の自動再採点範囲の下限とする（E-3残）。
 */
export const DISCLOSURE_STAGE: Stage = "answer_revealed";

/**
 * 各段階の順序位置（{@link STAGES} の添字）。段階比較の唯一の基準であり、
 * 段階名から一意に導出して二重定義を避ける。
 */
const STAGE_RANK: Readonly<Record<Stage, number>> = Object.freeze(
  STAGES.reduce<Record<Stage, number>>((acc, stage, index) => {
    acc[stage] = index;
    return acc;
  }, {} as Record<Stage, number>),
);

/**
 * `rounds` テーブルの 1 行（問＝ラウンドごとの到達段階）。data_model_design §2.5 /
 * 規約 DM-2 の正規化に従い、各問の進行段階（b/c/d）を問単位で 1 行保持し、正解ライブ
 * 編集の自動再採点範囲を問単位で問い合わせ可能にする（{@link isDisclosed} /
 * {@link isSettled}）。上位設計の `game_state.stage` 概念を `rounds` へ正規化した器で
 * あり、この段階保持なしに再採点範囲は決められない。
 *
 * `questionId` は `questions.id`（text 主キー）への外部キーで `rounds.question_id` に
 * 対応する。`questionNumber` は 1〜10 の出題順（`rounds.question_number`）、`stage` は
 * 当該問が到達した最新段階（`rounds.stage`）。
 */
export interface Round {
  /** 対象問題の識別子（`rounds.question_id` = `questions.id`（text）への FK）。 */
  readonly questionId: string;
  /** 出題順（1〜10・`rounds.question_number`）。 */
  readonly questionNumber: number;
  /** この問題が到達した最新段階（`rounds.stage`）。 */
  readonly stage: Stage;
}

/**
 * 1 問題の進行状態。対象問題の識別子と、その問題が到達した最新段階を対にして
 * 保持する不変値。遷移は既存値を変更せず、新しい {@link QuestionProgress} を返す。
 */
export interface QuestionProgress {
  /** 対象問題の識別子（`rounds.question_id` に対応）。 */
  readonly questionId: number;
  /** この問題が到達した最新段階。 */
  readonly stage: Stage;
}

/** 受付中（accepting）で始まる問題進行を生成する。 */
export function startQuestion(questionId: number): QuestionProgress {
  return { questionId, stage: INITIAL_STAGE };
}

/** 段階の順序位置を返す（早い段階ほど小さい）。 */
export function stageRank(stage: Stage): number {
  return STAGE_RANK[stage];
}

/**
 * 任意の値が正当な {@link Stage} 文字列かを判定する型ガード。
 * DB からの読み戻しやネットワーク受信値を段階として扱う前の境界検証に用いる。
 */
export function isStage(value: unknown): value is Stage {
  return typeof value === "string" && (STAGES as readonly string[]).includes(value);
}

/**
 * 当該段階が「開示済み」（正解発表 c 以降）かを判定する。
 *
 * 段階 ≥ {@link DISCLOSURE_STAGE}（answer_revealed）のとき `true`。正解ライブ編集の
 * 自動再採点は本述語が `true` の問題のみを対象とする。
 * 境界: answers_opened（b）=`false` / answer_revealed（c）=`true`。
 */
export function isDisclosed(stage: Stage): boolean {
  return STAGE_RANK[stage] >= STAGE_RANK[DISCLOSURE_STAGE];
}

/**
 * 当該段階が得点精算済み（d 到達）かを判定する。
 *
 * 段階 ≥ {@link TERMINAL_STAGE}（settlement_computed）のとき `true`。開示済み問題の
 * 正解訂正時、本述語が `true` なら残額の差分再計算を伴い TV の d/e を同時更新する
 * 対象となる（E-3残）。settlement_computed は終端ゆえ、本述語が `true` になるのは
 * settlement_computed ちょうど 1 段階のみ（d 到達のみ）。
 */
export function isSettled(stage: Stage): boolean {
  return STAGE_RANK[stage] >= STAGE_RANK[TERMINAL_STAGE];
}

/**
 * 当該段階で解答の**新規送信を受理するか**を判定する（締切＝終端状態ガード）。
 *
 * 受付中（accepting）のみ `true`。締切（answers_locked）以降は恒久的に `false` で、
 * 以降の送信はサーバ側で拒否される（system_design §2.5 / AC-13）。既存解答の保持は
 * answers 側の責務であり、本ガードは「以降の受理可否」のみを決める。
 */
export function acceptsSubmissions(stage: Stage): boolean {
  return stage === INITIAL_STAGE;
}

/** 不正な段階遷移（順序を飛ばす・逆行・自己遷移・終端超過）を表すエラー。 */
export class IllegalStageTransitionError extends Error {
  /** 遷移元段階。 */
  readonly from: Stage;
  /** 拒否された遷移先段階。 */
  readonly to: Stage;

  constructor(from: Stage, to: Stage) {
    super(
      `段階 ${from} から ${to} への遷移は不正です（進行は 1 段階ずつの前進のみ許可）。`,
    );
    this.name = "IllegalStageTransitionError";
    this.from = from;
    this.to = to;
  }
}

/** 当該段階の唯一の合法な次段階を返す。終端（settlement_computed）なら `null`。 */
export function successorOf(stage: Stage): Stage | null {
  const nextRank = STAGE_RANK[stage] + 1;
  if (nextRank >= STAGES.length) {
    return null;
  }
  return STAGES[nextRank] as Stage;
}

/**
 * `from` から `to` への遷移が合法（`to` が `from` の直後の段階）かを判定する。
 * 飛ばし・逆行・自己遷移・終端超過はすべて `false`。
 */
export function canTransition(from: Stage, to: Stage): boolean {
  return successorOf(from) === to;
}

/**
 * 進行を明示した目標段階へ 1 段階前進させ、新しい {@link QuestionProgress} を返す。
 *
 * `to` が現在段階の直後でない（飛ばし・逆行・自己遷移・終端超過）場合は
 * {@link IllegalStageTransitionError} を送出する。例: answers_locked から
 * answer_revealed（開示を飛ばした正解発表）や、answers_opened から
 * settlement_computed（正解発表を飛ばした精算）は拒否される。
 *
 * @throws {IllegalStageTransitionError} 遷移が合法でない場合。
 */
export function transitionTo(progress: QuestionProgress, to: Stage): QuestionProgress {
  if (!canTransition(progress.stage, to)) {
    throw new IllegalStageTransitionError(progress.stage, to);
  }
  return { questionId: progress.questionId, stage: to };
}

/**
 * 進行を直後の段階へ前進させ、新しい {@link QuestionProgress} を返す。
 * 終端（settlement_computed）からの前進は {@link IllegalStageTransitionError} を送出する。
 *
 * @throws {IllegalStageTransitionError} 既に終端段階にある場合。
 */
export function advance(progress: QuestionProgress): QuestionProgress {
  const next = successorOf(progress.stage);
  if (next === null) {
    throw new IllegalStageTransitionError(progress.stage, progress.stage);
  }
  return { questionId: progress.questionId, stage: next };
}
