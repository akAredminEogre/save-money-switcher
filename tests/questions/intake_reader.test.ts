// @generated-by: codd implement
// @generated-from: docs/design/question_media_intake_design.md (design:question-media-intake-design)
// @design-node: docs/design/question_media_intake_design.md
// @output-paths: src, tests
// @generated-from: docs/design/data_model_design.md (design:data-model-design)
// @generated-from: docs/design/system_design.md (design:system-design)
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseIntakeRecords,
  readIntakeFile,
  MalformedIntakeError,
  DEFAULT_QUESTION_INTAKE_FILE,
} from "../../src/questions/intake_reader.js";
import type { QuestionIntakeRecord } from "../../src/questions/intake_record.js";

// intake_reader は「読取り＋構造整形（parse-and-shape）」のみを担い、意味検証
// （範囲・一意・非空・メディア実体）は validateIntake へ委ねる。本テストは §2.2 の
// JSON 入稿形式を整形式・壊れた入力の双方で与え、整形式は QuestionIntakeRecord[] へ
// 解されること／壊れた入稿は MalformedIntakeError で拒否されることを、生成側の出力に
// 対して独立に手書きした期待値で検証する。intake_reader の parse 挙動はいずれの
// 宣言済み VB にも対応しない（VB-52/63/65/66 等は登録・検証・DB 供給側の証明であり、
// それらの証明テストは別途存在する）ため、本テストは VB マーカーを持たない。
describe("questions/intake_reader 事前問題ファイルの読取り（parse-and-shape・QM-1）", () => {
  // §2.2 の JSON 入稿例（メディア無し／動画のみ／画像のみの 3 系統を含む）。
  const wellFormed = JSON.stringify([
    { questionNumber: 1, text: "日本の都道府県の数は？", correctValue: 47 },
    {
      questionNumber: 2,
      text: "この映像の最高速度は時速何km？",
      correctValue: 80,
      videoPath: "q02-speed.mp4",
    },
    {
      questionNumber: 3,
      text: "この写真の人数は？",
      correctValue: 12,
      imagePath: "q03-crowd.png",
    },
  ]);

  it("整形式の JSON 配列を QuestionIntakeRecord[] へ解し、各フィールドを保持する", () => {
    const records = parseIntakeRecords(wellFormed);
    // 期待値はシステム出力から独立に手書きする。省略された画像/動画パスは DB 表現
    // （NULL）に合わせ null へ正規化され、宣言されたパスはそのまま素通しされる。
    const expected: QuestionIntakeRecord[] = [
      {
        questionNumber: 1,
        text: "日本の都道府県の数は？",
        correctValue: 47,
        imagePath: null,
        videoPath: null,
      },
      {
        questionNumber: 2,
        text: "この映像の最高速度は時速何km？",
        correctValue: 80,
        imagePath: null,
        videoPath: "q02-speed.mp4",
      },
      {
        questionNumber: 3,
        text: "この写真の人数は？",
        correctValue: 12,
        imagePath: "q03-crowd.png",
        videoPath: null,
      },
    ];
    expect(records).toEqual(expected);
  });

  it("メディアパスは宣言どおり素通しし、未宣言は null になる（動画優先の解決前提を保つ）", () => {
    const [q1, q2, q3] = parseIntakeRecords(wellFormed);
    // 未宣言 → null
    expect(q1.videoPath).toBeNull();
    expect(q1.imagePath).toBeNull();
    // 動画のみ宣言 → videoPath 保持・imagePath は null
    expect(q2.videoPath).toBe("q02-speed.mp4");
    expect(q2.imagePath).toBeNull();
    // 画像のみ宣言 → imagePath 保持・videoPath は null
    expect(q3.imagePath).toBe("q03-crowd.png");
    expect(q3.videoPath).toBeNull();
  });

  it("空配列は 0 件の入稿として受理する（件数の意味判断はしない）", () => {
    expect(parseIntakeRecords("[]")).toEqual([]);
  });

  it("JSON として解釈できない内容は MalformedIntakeError で拒否する", () => {
    expect(() => parseIntakeRecords("これはJSONではありません")).toThrow(
      MalformedIntakeError,
    );
    expect(() => parseIntakeRecords('[{"questionNumber":1,')).toThrow(
      MalformedIntakeError,
    );
  });

  it("トップレベルが配列でない JSON は拒否する", () => {
    expect(() => parseIntakeRecords('{"questionNumber":1}')).toThrow(
      MalformedIntakeError,
    );
    expect(() => parseIntakeRecords("42")).toThrow(MalformedIntakeError);
  });

  it("配列要素が問題レコードのオブジェクトでない場合は拒否する", () => {
    expect(() => parseIntakeRecords("[1, 2, 3]")).toThrow(MalformedIntakeError);
    expect(() => parseIntakeRecords("[null]")).toThrow(MalformedIntakeError);
  });

  it("ディスク上の整形式ファイルを読み取ってレコードを返す", async () => {
    const dir = await mkdtemp(join(tmpdir(), "intake-reader-"));
    const file = join(dir, "questions.json");
    try {
      await writeFile(file, wellFormed, "utf-8");
      const records = await readIntakeFile(file);
      expect(records).toHaveLength(3);
      expect(records[0]).toEqual({
        questionNumber: 1,
        text: "日本の都道府県の数は？",
        correctValue: 47,
        imagePath: null,
        videoPath: null,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("ディスク上の壊れたファイルは MalformedIntakeError で拒否する", async () => {
    const dir = await mkdtemp(join(tmpdir(), "intake-reader-"));
    const file = join(dir, "broken.json");
    try {
      await writeFile(file, "{ broken", "utf-8");
      await expect(readIntakeFile(file)).rejects.toBeInstanceOf(
        MalformedIntakeError,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("既定の入稿ファイルパスが JSON 配列既定として単一定義される", () => {
    expect(DEFAULT_QUESTION_INTAKE_FILE).toBe("./questions.json");
  });
});
