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
 * 共有 E2E ハーネス: 検証環境でのアプリ起動（boot）と健全化待受の結合
 * （surface_copy_obligations §2.10 / acceptance_criteria §4.9）。
 *
 * `npm run start` 等でアプリをバックグラウンド起動し、ベース URL（`/healthz`）が `< 500` を
 * 返すまで最大 60 秒ポーリングして準備完了を待つ。健全化に失敗した場合は起動プロセスを
 * 確実に停止する。`spawnFn` と健全化オプション（fetch/sleep/now）を注入可能にし、実プロセス
 * を起こさずに配線を決定的に検証できる。
 */

import { spawn } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { resolveBaseUrl } from "./env.js";
import { waitForServerHealthy } from "./server-health.js";
import type { WaitForServerHealthyOptions } from "./server-health.js";

/** プロセス起動関数の抽象（既定は `node:child_process` の `spawn`）。 */
export type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface StartAppServerOptions {
  /** 起動コマンド（既定 `npm`）。 */
  command?: string;
  /** 起動引数（既定 `["run", "start"]`）。 */
  args?: readonly string[];
  /** 健全化を確認するベース URL（既定は {@link resolveBaseUrl}）。 */
  baseUrl?: string;
  /** 作業ディレクトリ。 */
  cwd?: string;
  /** 起動プロセスへ渡す環境変数（既定は `process.env`）。 */
  env?: NodeJS.ProcessEnv;
  /** 起動関数の注入（テスト用）。 */
  spawnFn?: SpawnFn;
  /** 健全化待受のオプション（timeout/interval/fetch 等）。 */
  health?: WaitForServerHealthyOptions;
}

export interface RunningAppServer {
  /** 準備完了したベース URL。 */
  baseUrl: string;
  /** 起動プロセスハンドル。 */
  process: ChildProcess;
  /** プロセスを SIGTERM で停止する。 */
  stop(): Promise<void>;
}

/**
 * アプリを起動し、`< 500` の健全性ベースラインに達するまで待って稼働ハンドルを返す。
 * 健全化に失敗したらプロセスを停止して例外を再送出する。
 */
export async function startAppServer(options: StartAppServerOptions = {}): Promise<RunningAppServer> {
  const {
    command = "npm",
    args = ["run", "start"],
    baseUrl = resolveBaseUrl(),
    cwd,
    env = process.env,
    spawnFn = spawn,
    health,
  } = options;

  const child = spawnFn(command, args, { cwd, env, stdio: "inherit" });

  const stop = async (): Promise<void> => {
    if (child.killed || child.exitCode != null || child.signalCode != null) return;
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.once("error", () => resolve());
      child.kill("SIGTERM");
    });
  };

  try {
    await waitForServerHealthy(baseUrl, health);
  } catch (err) {
    await stop();
    throw err;
  }

  return { baseUrl, process: child, stop };
}
