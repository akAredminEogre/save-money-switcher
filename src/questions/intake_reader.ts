// @generated-by: codd implement
// @generated-from: docs/design/question_media_intake_design.md (design:question-media-intake-design)
// @design-node: docs/design/question_media_intake_design.md
// @output-paths: src, tests
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

/**
 * 事前問題ファイル（JSON 配列）の読取り（`module:questions`・QM-1）。
 *
 * question_media_intake_design §2.1 / §2.2 / §3.1 が定める入稿パイプラインの入口
 * （producer 端）である。出題内容の初期入稿の唯一の機構は事前ファイル読込であり
 * （当日その場でゼロから手入力する UI/API は持たない・QM-1）、本モジュールはその
 * 事前問題ファイルをディスクから読み、JSON 配列を {@link QuestionIntakeRecord}[] へ
 * 解して返す。
 *
 * 責務は「読取り＋構造整形（parse-and-shape）」に限る（§2.1）:
 *   - ファイル内容を JSON として解釈する。
 *   - トップレベルが配列であることを保証する。
 *   - 各要素が問題レコード（非 null オブジェクト）であることを保証する。
 * これらに反する入力は {@link MalformedIntakeError} で拒否する（＝壊れた入稿ファイルの
 * 早期棄却）。一方、フィールドの型・値の意味検証（問題番号 1〜10・一意、text 非空、
 * correct_value 0〜100 整数、宣言メディアの実体存在）は入稿検証（`validateIntake`・
 * §2.2）の責務であり、本モジュールは行わない。意味エラーは問題番号付きの `IntakeIssue`
 * として司会者へ提示される設計ゆえ（§1.4）、ここで throw するとその per-question
 * フィードバックを奪う。したがってフィールド値は素通しし、意味判断を validateIntake に
 * 委ねる。
 *
 * 本読取りは永続化を行わず、ランタイム出題にも関与しない。登録後のランタイム出題は
 * `questions` テーブルから供給され、ファイルは再読込されない（QM-1・§2.3）。入稿ファイル
 * 形式は JSON を既定とし（§3.1）、Node ランタイムがネイティブに解釈できるデータ形式で
 * あるため第三者ランタイム依存を持たない。
 */

import { readFile } from "node:fs/promises";
import type { QuestionIntakeRecord } from "./intake_record.js";

/**
 * 既定の入稿ファイルパス（相対）。§3.1 の確定どおり入稿形式は JSON 配列を既定とし、
 * その既定ファイルをこのパスから読む。合成（制御盤の読込ハンドラ）は明示パスで上書き
 * できる。
 */
export const DEFAULT_QUESTION_INTAKE_FILE = "./questions.json";

/**
 * 入稿ファイルが JSON として解釈できない、またはトップレベルが問題レコード配列の構造を
 * 成さない（配列でない／要素が問題レコードのオブジェクトでない）場合に送出するドメイン
 * エラー。フィールドの型・値の意味検証で生じる拒否は本エラーではなく入稿検証
 * （`validateIntake`）の `IntakeIssue` として扱う（§2.2）。
 */
export class MalformedIntakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedIntakeError";
  }
}

/**
 * 1 件分の生の入稿エントリを {@link QuestionIntakeRecord} の構造へ整形する。
 *
 * 構造（非 null オブジェクトであること）のみを保証し、フィールドの型・値は検証せず
 * 素通しする（意味検証は `validateIntake` の責務・§2.2）。既知の 5 フィールドのみを取り
 * 出して未知の余分なキーは持ち込まず、省略された画像/動画パスは DB 表現（NULL）に合わせて
 * null へ正規化する（`load_questions` の `?? null` と整合）。
 */
function shapeIntakeEntry(entry: unknown, index: number): QuestionIntakeRecord {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw new MalformedIntakeError(
      `問題ファイルの ${index + 1} 番目の要素が問題レコードの形式ではありません。`,
    );
  }
  const raw = entry as Record<string, unknown>;
  return {
    questionNumber: raw.questionNumber as number,
    text: raw.text as string,
    correctValue: raw.correctValue as number,
    imagePath: (raw.imagePath as string | null | undefined) ?? null,
    videoPath: (raw.videoPath as string | null | undefined) ?? null,
  };
}

/**
 * 入稿ファイルの文字列内容を解して {@link QuestionIntakeRecord}[] を返す（構造整形のみ）。
 *
 * ディスク I/O を伴わない純粋な parse-and-shape であり、ディスクから読んだ内容にも
 * テスト用の文字列にも同じ規則を適用する。JSON として解釈できない場合・トップレベルが
 * 配列でない場合・要素が問題レコードのオブジェクトでない場合は {@link MalformedIntakeError}
 * を送出する。空配列は 0 件の入稿として受理する（件数の意味判断は行わない）。
 *
 * @throws {MalformedIntakeError} 内容が壊れた入稿ファイルである場合。
 */
export function parseIntakeRecords(content: string): QuestionIntakeRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new MalformedIntakeError(
      "問題ファイルを JSON として読み取れませんでした。",
    );
  }
  if (!Array.isArray(parsed)) {
    throw new MalformedIntakeError(
      "問題ファイルは問題レコードの配列である必要があります。",
    );
  }
  return parsed.map((entry, index) => shapeIntakeEntry(entry, index));
}

/**
 * 事前問題ファイルをディスクから読み、{@link QuestionIntakeRecord}[] を返す。
 *
 * 入稿の唯一の初期機構（QM-1）であり、UTF-8 でファイルを読取り {@link parseIntakeRecords}
 * で構造整形する。返したレコードは入稿検証（`validateIntake`）→ 登録（`loadQuestions`）へ
 * 渡される。本読取りは永続化せず、ランタイム出題では再読込されない（§2.1 / §2.3）。
 *
 * @param filePath 読み取る入稿ファイルのパス（未指定時は {@link DEFAULT_QUESTION_INTAKE_FILE}）。
 * @throws {MalformedIntakeError} 内容が壊れた入稿ファイルである場合。
 */
export async function readIntakeFile(
  filePath: string = DEFAULT_QUESTION_INTAKE_FILE,
): Promise<QuestionIntakeRecord[]> {
  const content = await readFile(filePath, "utf-8");
  return parseIntakeRecords(content);
}
