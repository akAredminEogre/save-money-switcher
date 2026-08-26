// @generated-by: codd implement
// @generated-from: docs/design/question_media_intake_design.md (design:question-media-intake-design)
// @design-node: docs/design/question_media_intake_design.md
// @output-paths: src, tests
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import type { QuestionsRepository } from "./questions_repository.js";
import type { Question } from "./question.js";
import type { QuestionIntakeRecord } from "./intake_record.js";
import {
  validateIntake,
  type MediaPresence,
  type IntakeIssue,
} from "./intake_validator.js";

/**
 * 事前問題ファイル入稿の全 or 無オーケストレーション結果（`module:questions`・QM-1／§2.2）。
 *
 * question_media_intake_design §2.2 が定める「事前ファイル読込 → 検証 → DB 登録」入稿
 * パイプラインの帰結を表す。`loaded` は `questions` テーブルへ登録された問数であり、入稿
 * 検証で {@link IntakeIssue} が 1 件でも出れば全 or 無の原則により 0 となる（部分登録に
 * よる欠落問を防ぐ）。`issues` は検出された全問題点の列で、全項目が妥当なら空配列を返す。
 * 制御盤（司会者）サーフェスは `issues` の `questionNumber` と `field` から問題番号タグ
 * 付きの検証結果コピーを合成する。
 */
export interface LoadResult {
  /** `questions` テーブルへ登録された問数（検証エラーが 1 件でもあれば 0）。 */
  loaded: number;
  /** 入稿検証で検出した問題点の列（空なら全項目妥当）。 */
  issues: readonly IntakeIssue[];
}

/**
 * 事前問題ファイルの入稿を検証し、全 or 無で `questions` テーブルへ一括登録する（§2.2）。
 *
 * まず {@link validateIntake} で意味検証（問題番号 1〜10／一意・非空 text・0〜100 整数の
 * correct_value・宣言メディアの所定フォルダ実体）を行う。issue が 1 件でもあれば `questions`
 * を 1 行も変更せず `{ loaded: 0, issues }` を返す（全 or 無・dod_load_all_or_nothing）。
 * 全項目が妥当なら各 {@link QuestionIntakeRecord} を生成 id 付きの {@link Question} 行へ
 * 写像し（未指定メディアは NULL 化・検証済みの `correctValue` はそのまま保持）、
 * {@link QuestionsRepository.bulkInsert} で登録して登録問数と空 issue を返す。
 *
 * 出題内容の初期入稿はこの経路（事前ファイル読込 → DB 登録）のみで成立し、当日その場で
 * 問題集をゼロから手入力する UI/API は持たない（dod_load_no_adhoc_entry）。ランタイム出題
 * は `questions` テーブルから供給され、本関数はファイルの再読込に依存しない。
 *
 * @param records 検証対象の生入稿レコード列（`intake_reader` の出力）。
 * @param media 所定フォルダ配下のメディア実体存在を判定する注入ポート。
 * @param repo 問題データの永続化ポート（`bulkInsert` は `question_number` の upsert）。
 * @param newId 各問の安定識別子を生成する関数（合成の外側から注入）。
 * @returns 登録問数と検出 issue を保持する {@link LoadResult}。
 */
export async function loadQuestions(
  records: readonly QuestionIntakeRecord[],
  media: MediaPresence,
  repo: QuestionsRepository,
  newId: () => string,
): Promise<LoadResult> {
  const issues = validateIntake(records, media);
  // 全 or 無：検証エラーが 1 件でもあれば 1 問も登録せず、検出した全 issue を返す。
  if (issues.length > 0) {
    return { loaded: 0, issues };
  }
  // 検証済みレコードを Question 行へ写像する。imagePath / videoPath は未指定なら NULL、
  // correctValue は 0〜100 整数として検証済みの値をそのまま保持する。
  const questions: Question[] = records.map((record) => ({
    id: newId(),
    questionNumber: record.questionNumber,
    text: record.text,
    imagePath: record.imagePath ?? null,
    videoPath: record.videoPath ?? null,
    correctValue: record.correctValue,
  }));
  await repo.bulkInsert(questions);
  return { loaded: questions.length, issues: [] };
}
