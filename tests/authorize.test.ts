// @generated-by: codd implement
// @generated-from: docs/design/system_design.md (design:system-design)
// @design-node: docs/design/system_design.md
// @output-paths: src, tests
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { describe, it, expect } from "vitest";
import {
  requireHost,
  authorizeTrigger,
  isHostOnlyTrigger,
  isHostSession,
  HOST_ONLY_TRIGGERS,
  AuthorizationError,
  ForbiddenRoleError,
  UnauthenticatedError,
  type Session,
} from "../src/participants/authorize.js";

const hostSession: Session = { role: "host", participantId: 1, connectionId: "c-host" };
const answererSession: Session = { role: "answerer", participantId: 2, connectionId: "c-ans" };
const audienceSession: Session = { role: "audience", connectionId: "c-tv" };

/**
 * ガードを実行し、送出されたエラーを返す。拒否せず正常復帰した場合はここで失敗させ、
 * 権限境界の後退（非 host が通ってしまう回帰）を確実に RED にする。
 */
function captureThrow(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("認可ガードが拒否せず正常復帰しました（権限境界の後退）。");
}

describe("participants/authorize — 締切・開示・取消の権限境界", () => {
  // codd: covers vb=VB-22
  it("host は締切・開示・正解発表・取消をいずれも発動できる（認可が通る）", () => {
    for (const trigger of ["lock", "open", "reveal", "undo"] as const) {
      const decision = authorizeTrigger(hostSession, trigger);
      expect(decision.session.role).toBe("host");
      expect(decision.session.participantId).toBe(1);
      expect(decision.trigger).toBe(trigger);
    }
  });

  // codd: covers vb=VB-23
  it("解答者・観客・未認証からの締切・開示・正解発表・取消は 401/403 で拒否される", () => {
    for (const trigger of ["lock", "open", "reveal", "undo"] as const) {
      const answererErr = captureThrow(() => authorizeTrigger(answererSession, trigger));
      expect(answererErr).toBeInstanceOf(ForbiddenRoleError);
      expect((answererErr as ForbiddenRoleError).status).toBe(403);
      expect((answererErr as ForbiddenRoleError).role).toBe("answerer");

      const audienceErr = captureThrow(() => authorizeTrigger(audienceSession, trigger));
      expect(audienceErr).toBeInstanceOf(ForbiddenRoleError);
      expect((audienceErr as ForbiddenRoleError).status).toBe(403);

      const unauthErr = captureThrow(() => authorizeTrigger(undefined, trigger));
      expect(unauthErr).toBeInstanceOf(UnauthenticatedError);
      expect((unauthErr as UnauthenticatedError).status).toBe(401);
    }
  });
});

describe("participants/authorize — 精算・モード切替・読込・編集の権限境界", () => {
  // codd: covers vb=VB-74
  it("得点精算(settle)は host のみ発動でき、非host の精算コマンドは 401/403 で拒否される", () => {
    expect(isHostOnlyTrigger("settle")).toBe(true);
    expect(authorizeTrigger(hostSession, "settle").session.role).toBe("host");

    const forbidden = captureThrow(() => authorizeTrigger(answererSession, "settle"));
    expect(forbidden).toBeInstanceOf(ForbiddenRoleError);
    expect((forbidden as ForbiddenRoleError).status).toBe(403);

    const unauth = captureThrow(() => authorizeTrigger(null, "settle"));
    expect(unauth).toBeInstanceOf(UnauthenticatedError);
    expect((unauth as UnauthenticatedError).status).toBe(401);
  });

  // codd: covers vb=VB-75
  it("モード切替(switch)は host のみ発動でき、非host のモード切替は 403 で拒否される", () => {
    expect(isHostOnlyTrigger("switch")).toBe(true);
    expect(authorizeTrigger(hostSession, "switch").session.role).toBe("host");

    const err = captureThrow(() => authorizeTrigger(audienceSession, "switch"));
    expect(err).toBeInstanceOf(ForbiddenRoleError);
    expect((err as ForbiddenRoleError).status).toBe(403);
  });

  // codd: covers vb=VB-67
  it("問題読込(load)は host のみ発動でき、非host の読込コマンドは 401/403 で拒否される", () => {
    expect(isHostOnlyTrigger("load")).toBe(true);
    expect(authorizeTrigger(hostSession, "load").session.role).toBe("host");

    const forbidden = captureThrow(() => authorizeTrigger(answererSession, "load"));
    expect(forbidden).toBeInstanceOf(ForbiddenRoleError);
    expect((forbidden as ForbiddenRoleError).status).toBe(403);

    const unauth = captureThrow(() => authorizeTrigger({}, "load"));
    expect(unauth).toBeInstanceOf(UnauthenticatedError);
    expect((unauth as UnauthenticatedError).status).toBe(401);
  });

  // codd: covers vb=VB-72
  it("ライブ編集(edit)は host のみ発動でき、非host の編集コマンドは 401/403 で拒否される", () => {
    expect(isHostOnlyTrigger("edit")).toBe(true);
    expect(authorizeTrigger(hostSession, "edit").session.role).toBe("host");

    const forbidden = captureThrow(() => authorizeTrigger(answererSession, "edit"));
    expect(forbidden).toBeInstanceOf(ForbiddenRoleError);
    expect((forbidden as ForbiddenRoleError).status).toBe(403);
  });
});

describe("participants/authorize — requireHost（単一のロール判定点）", () => {
  it("host セッションを HostSession として認可し、そのまま返す", () => {
    const authorized = requireHost(hostSession);
    expect(authorized.role).toBe("host");
    expect(authorized.participantId).toBe(1);
    expect(isHostSession(hostSession)).toBe(true);
    expect(isHostSession(answererSession)).toBe(false);
  });

  it("観客(audience)セッションを 403 で拒否し、拒否ロールを監査用に保持する", () => {
    const err = captureThrow(() => requireHost(audienceSession));
    expect(err).toBeInstanceOf(ForbiddenRoleError);
    expect((err as ForbiddenRoleError).status).toBe(403);
    expect((err as ForbiddenRoleError).role).toBe("audience");
  });

  it("セッション未確立(null/undefined)は 401 で拒否する", () => {
    for (const missing of [null, undefined]) {
      const err = captureThrow(() => requireHost(missing));
      expect(err).toBeInstanceOf(UnauthenticatedError);
      expect((err as UnauthenticatedError).status).toBe(401);
    }
  });

  it("偽装された不正ロールのセッションは 401 で拒否する（サーバ側最終防衛）", () => {
    for (const forged of [{ role: "spectator" }, { role: "HOST" }, { role: 1 }, { notRole: "host" }]) {
      const err = captureThrow(() => requireHost(forged));
      expect(err).toBeInstanceOf(UnauthenticatedError);
      expect((err as UnauthenticatedError).status).toBe(401);
    }
  });

  it("認可拒否はいずれも AuthorizationError であり status を保持する", () => {
    const forbidden = captureThrow(() => requireHost(answererSession));
    const unauth = captureThrow(() => requireHost(undefined));
    expect(forbidden).toBeInstanceOf(AuthorizationError);
    expect(unauth).toBeInstanceOf(AuthorizationError);
    expect((forbidden as AuthorizationError).status).toBe(403);
    expect((unauth as AuthorizationError).status).toBe(401);
  });

  it("拒否メッセージに内部ロール識別子(host/answerer/audience)を露出しない", () => {
    const forbidden = captureThrow(() => requireHost(answererSession)) as ForbiddenRoleError;
    const unauth = captureThrow(() => requireHost(undefined)) as UnauthenticatedError;
    for (const identifier of ["host", "answerer", "audience"]) {
      expect(forbidden.message).not.toContain(identifier);
      expect(unauth.message).not.toContain(identifier);
    }
    expect(forbidden.message).toContain("司会者");
  });
});

describe("participants/authorize — ホスト限定トリガー登録簿", () => {
  it("締切・開示・正解発表・得点精算・取消をホスト限定トリガーとして分類する", () => {
    for (const trigger of ["lock", "open", "reveal", "settle", "undo"] as const) {
      expect(isHostOnlyTrigger(trigger)).toBe(true);
      expect(HOST_ONLY_TRIGGERS.includes(trigger)).toBe(true);
    }
  });

  it("解答者操作(submit/join)や未知の語をホスト限定に分類しない", () => {
    for (const notHostOnly of ["submit", "join", "", "lock ", "LOCK"]) {
      expect(isHostOnlyTrigger(notHostOnly)).toBe(false);
    }
  });
});
