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
 * 共有 E2E ハーネスの決定的ユニット検証。健全性判定・禁止コピー走査・円建て/6列表/ロール
 * ラベルのアサート・検証環境注入・起動待受の各ヘルパを、稼働サーバやブラウザを起こさずに
 * 実行し、観測結果を独立に固定した期待値と照合する。
 *
 * 本ファイルはハーネス（ヘルパ関数群）自体を SUT として検証するものであり、各サーフェスの
 * 検証可能挙動（VB）を証明するのは、これらのヘルパを import する tests/e2e/*.browser.spec.ts
 * である。したがって本ファイルは VB の covers マーカーを持たない（虚偽のカバレッジ主張を
 * 避ける）。
 */

import { describe, it, expect } from "vitest";
import { MAX_TABLET_CONNECTIONS_ENV } from "../../../src/config/connection_limit.js";
import { ROLE_LABELS } from "../../../src/game_state/role_labels.js";
import type { ChildProcess } from "node:child_process";
import {
  resolveStatus,
  isServerHealthy,
  assertServerHealthy,
  waitForServerHealthy,
} from "./server-health.js";
import {
  scanForbiddenCopy,
  assertNoForbiddenCopy,
} from "./forbidden-copy.js";
import {
  assertYenDenominated,
  assertSettlementTableHeaders,
  assertRoleLabelsBusinessFacing,
  visibleRoleLabel,
  isVisibleRoleLabel,
  SETTLEMENT_TABLE_HEADERS,
} from "./assertions.js";
import {
  E2E_BASE_URL_ENV,
  DEFAULT_E2E_BASE_URL,
  resolveBaseUrl,
  applyVerificationEnv,
} from "./env.js";
import { startAppServer, type SpawnFn } from "./server-lifecycle.js";

describe("server-health（健全性ベースライン < 500）", () => {
  it("Playwright 形（status()）・fetch 形（status）・数値のいずれからも数値ステータスを解決する", () => {
    expect(resolveStatus(200)).toBe(200);
    expect(resolveStatus({ status: 404 })).toBe(404);
    expect(resolveStatus({ status: () => 503 })).toBe(503);
  });

  it("< 500 は健全・>= 500 は不健全と判定する", () => {
    expect(isServerHealthy(499)).toBe(true);
    expect(isServerHealthy(500)).toBe(false);
  });

  it("assertServerHealthy は 4xx を通し 5xx を例外にする", () => {
    expect(assertServerHealthy(200)).toBe(200);
    expect(assertServerHealthy(403)).toBe(403);
    expect(() => assertServerHealthy(500)).toThrow();
    expect(() => assertServerHealthy({ status: () => 502 })).toThrow();
  });

  it("waitForServerHealthy は 503→200 で健全化した時点のステータスを返す", async () => {
    let calls = 0;
    const status = await waitForServerHealthy("http://app.example", {
      fetchImpl: async () => ({ status: calls++ < 1 ? 503 : 200 }),
      sleep: async () => {},
      now: () => 0,
      timeoutMs: 1_000,
    });
    expect(status).toBe(200);
    expect(calls).toBe(2);
  });

  it("waitForServerHealthy は 60s 予算内に健全化しなければ例外を送出する", async () => {
    let clock = 0;
    await expect(
      waitForServerHealthy("http://app.example", {
        fetchImpl: async () => ({ status: 503 }),
        sleep: async (ms) => {
          clock += ms;
        },
        now: () => clock,
        timeoutMs: 1_000,
        intervalMs: 500,
      }),
    ).rejects.toThrow();
  });
});

describe("forbidden-copy（禁止コピー走査・§2.8/§2.11）", () => {
  it("解答者向けの清潔な可視文言では違反を出さない", () => {
    expect(scanForbiddenCopy("あなたの残額 10,000円　受付中")).toEqual([]);
    expect(() => assertNoForbiddenCopy("お名前を入力してください")).not.toThrow();
  });

  it("点化文言 point/pt/点 を検出する", () => {
    expect(scanForbiddenCopy("100点").map((v) => v.match)).toContain("点");
    expect(scanForbiddenCopy("5 pt").map((v) => v.match)).toContain("pt");
    expect(scanForbiddenCopy("1000 points").map((v) => v.match)).toContain("point");
  });

  it("内部イベント名・設定キー名・内部ロール識別子・内部語/生パス・デモ表記を検出する", () => {
    expect(scanForbiddenCopy("状態: answers_locked").map((v) => v.category)).toContain(
      "internal_event_name",
    );
    expect(scanForbiddenCopy("MAX_TABLET_CONNECTIONS=8").map((v) => v.category)).toContain(
      "config_key",
    );
    expect(scanForbiddenCopy("host のみ操作可").map((v) => v.match)).toContain("host");
    expect(scanForbiddenCopy("fallback: q02-speed.mp4").map((v) => v.category)).toContain(
      "internal_word_or_path",
    );
    expect(scanForbiddenCopy("サンプル問題").map((v) => v.match)).toContain("サンプル");
  });

  it("カテゴリ絞り込みで対象カテゴリのみを走査する", () => {
    const only = scanForbiddenCopy("host 100点", { categories: ["currency_token"] });
    expect(only).toHaveLength(1);
    expect(only[0].match).toBe("点");
  });

  it("assertNoForbiddenCopy は露出時に例外を送出する", () => {
    expect(() => assertNoForbiddenCopy("得点は 50 pt です")).toThrow();
  });
});

describe("assertions（円建て・6列表・可視ロールラベル）", () => {
  it("円建て表示を受理し、円欠落・点化はいずれも拒否する", () => {
    expect(() => assertYenDenominated("あなたの残額 10,000円")).not.toThrow();
    expect(() => assertYenDenominated("あなたの残額 10000")).toThrow();
    expect(() => assertYenDenominated("残額 10000円 (100点)")).toThrow();
  });

  it("d モードの 6 列見出しは規定順のみを受理する", () => {
    expect(() =>
      assertSettlementTableHeaders(["氏名", "解答", "誤差", "増減円", "ピタリ賞", "残額"]),
    ).not.toThrow();
    expect(() =>
      assertSettlementTableHeaders([" 氏名 ", "解答", "誤差", "増減円", "ピタリ賞", "残額"]),
    ).not.toThrow();
    expect(() =>
      assertSettlementTableHeaders(["解答", "氏名", "誤差", "増減円", "ピタリ賞", "残額"]),
    ).toThrow();
    expect(() => assertSettlementTableHeaders(["氏名", "解答", "誤差"])).toThrow();
    expect(SETTLEMENT_TABLE_HEADERS).toEqual(["氏名", "解答", "誤差", "増減円", "ピタリ賞", "残額"]);
  });

  it("可視ロールラベルは司会者/解答者/観客であり内部識別子露出を拒否する", () => {
    expect(visibleRoleLabel("host")).toBe("司会者");
    expect(visibleRoleLabel("answerer")).toBe("解答者");
    expect(visibleRoleLabel("audience")).toBe("観客");
    expect(isVisibleRoleLabel("司会者")).toBe(true);
    expect(isVisibleRoleLabel("host")).toBe(false);
    expect(() => assertRoleLabelsBusinessFacing("司会者が締切を操作")).not.toThrow();
    expect(() => assertRoleLabelsBusinessFacing("host が締切を操作")).toThrow();
  });
});

describe("env（検証環境値の注入と復元）", () => {
  it("resolveBaseUrl は E2E_BASE_URL を優先し未設定時は既定へ落ちる", () => {
    expect(resolveBaseUrl({ [E2E_BASE_URL_ENV]: "https://cloud.example" })).toBe(
      "https://cloud.example",
    );
    expect(resolveBaseUrl({})).toBe(DEFAULT_E2E_BASE_URL);
    expect(resolveBaseUrl({ [E2E_BASE_URL_ENV]: "   " })).toBe(DEFAULT_E2E_BASE_URL);
  });

  it("applyVerificationEnv は指定キーのみ上書きし restore で原状復帰する", () => {
    const env: Record<string, string | undefined> = { KEEP: "keep" };
    const restore = applyVerificationEnv(
      {
        baseUrl: "https://b.example",
        maxTabletConnections: 16,
        joinAccessMode: "url_secret",
        joinAccessToken: "family-secret",
      },
      env,
    );
    expect(env[E2E_BASE_URL_ENV]).toBe("https://b.example");
    expect(env[MAX_TABLET_CONNECTIONS_ENV]).toBe("16");
    expect(env.KEEP).toBe("keep");
    restore();
    expect(env[E2E_BASE_URL_ENV]).toBeUndefined();
    expect(env[MAX_TABLET_CONNECTIONS_ENV]).toBeUndefined();
    expect(env.KEEP).toBe("keep");
  });

  it("既存キーを上書きした場合 restore で元値へ戻す", () => {
    const env: Record<string, string | undefined> = { [E2E_BASE_URL_ENV]: "orig" };
    const restore = applyVerificationEnv({ baseUrl: "new" }, env);
    expect(env[E2E_BASE_URL_ENV]).toBe("new");
    restore();
    expect(env[E2E_BASE_URL_ENV]).toBe("orig");
  });

  it("可視ロールラベル定義が単一供給点から供給されている（producer 束縛）", () => {
    expect(visibleRoleLabel("host")).toBe(ROLE_LABELS.host);
  });
});

describe("server-lifecycle（起動と健全化待受の結合）", () => {
  it("startAppServer は起動プロセスを立て健全化後にハンドルを返し stop で停止する", async () => {
    let killed = false;
    const listeners: Record<string, Array<(arg: unknown) => void>> = {};
    const fakeChild = {
      pid: 4321,
      get killed(): boolean {
        return killed;
      },
      once(event: string, listener: (arg: unknown) => void) {
        (listeners[event] ??= []).push(listener);
        return fakeChild;
      },
      kill(_signal?: string): boolean {
        killed = true;
        for (const l of listeners.exit ?? []) l(0);
        return true;
      },
    } as unknown as ChildProcess;
    let spawnArgs: readonly string[] = [];
    const spawnFn: SpawnFn = (_command, args) => {
      spawnArgs = args;
      return fakeChild;
    };

    const running = await startAppServer({
      baseUrl: "http://app.example",
      spawnFn,
      health: { fetchImpl: async () => ({ status: 200 }), sleep: async () => {}, now: () => 0 },
    });

    expect(running.baseUrl).toBe("http://app.example");
    expect(spawnArgs).toEqual(["run", "start"]);
    expect(running.process).toBe(fakeChild);
    await running.stop();
    expect(killed).toBe(true);
  });

  it("健全化に失敗した場合 startAppServer はプロセスを停止して例外を再送出する", async () => {
    let killed = false;
    const listeners: Record<string, Array<(arg: unknown) => void>> = {};
    const fakeChild = {
      pid: 5555,
      get killed(): boolean {
        return killed;
      },
      once(event: string, listener: (arg: unknown) => void) {
        (listeners[event] ??= []).push(listener);
        return fakeChild;
      },
      kill(_signal?: string): boolean {
        killed = true;
        for (const l of listeners.exit ?? []) l(0);
        return true;
      },
    } as unknown as ChildProcess;
    const spawnFn: SpawnFn = () => fakeChild;
    let clock = 0;

    await expect(
      startAppServer({
        baseUrl: "http://app.example",
        spawnFn,
        health: {
          fetchImpl: async () => ({ status: 503 }),
          sleep: async (ms) => {
            clock += ms;
          },
          now: () => clock,
          timeoutMs: 1_000,
          intervalMs: 500,
        },
      }),
    ).rejects.toThrow();
    expect(killed).toBe(true);
  });
});
