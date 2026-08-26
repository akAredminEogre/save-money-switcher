// @generated-by: codd implement
// @generated-from: docs/design/system_design.md (design:system-design)
// @design-node: docs/design/system_design.md
// @output-paths: src, tests
// @generated-from: docs/governance/decision_records.md (governance:decision-records)
// @generated-from: docs/requirements/requirements.md (req:save-money-switcher-requirements)
// @generated-from: docs/test/acceptance_criteria.md (test:acceptance-criteria)

import { describe, it, expect } from "vitest";
import {
  determineWinners,
  isWinningParticipant,
  type ParticipantBalance,
} from "../src/scoring/determine_winner.js";

describe("determineWinners", () => {
  // codd: covers vb=VB-31
  it("全 10 問終了時、残額最多のプレイヤー 1 名を勝者として判別する", () => {
    // 4 人分の全問通算残額。単独最多は participantId=3 の 12,300 円。
    const finalBalances: ParticipantBalance[] = [
      { participantId: 1, amount: 9_800 },
      { participantId: 2, amount: 10_400 },
      { participantId: 3, amount: 12_300 },
      { participantId: 4, amount: 7_500 },
    ];

    const winners = determineWinners(finalBalances);

    expect(winners).toHaveLength(1);
    expect(winners[0]?.participantId).toBe(3);
    expect(winners[0]?.amount).toBe(12_300);
  });

  // codd: covers vb=VB-76
  it("残額同点時は共同首位を全員返し、同点優先順位を発明しない", () => {
    // participantId=2 と 4 が 11,000 円で同点最多（1 名へ絞る根拠は存在しない）。
    const finalBalances: ParticipantBalance[] = [
      { participantId: 1, amount: 9_000 },
      { participantId: 2, amount: 11_000 },
      { participantId: 3, amount: 10_500 },
      { participantId: 4, amount: 11_000 },
    ];

    const winners = determineWinners(finalBalances);

    // 同点 2 名を共同首位として提示する（参加順・氏名順などで 1 名へ絞らない）。
    expect(winners).toHaveLength(2);
    expect(
      winners
        .map((winner) => winner.participantId)
        .sort((a, b) => Number(a) - Number(b)),
    ).toEqual([2, 4]);
    for (const winner of winners) {
      expect(winner.amount).toBe(11_000);
    }
  });

  it("残額が負に至っても最も高い残額が勝者となる（F-01: 下限を仮定しない）", () => {
    // 全員がマイナスでも、最も高い残額 = participantId=2 の -200 円が勝者。
    const finalBalances: ParticipantBalance[] = [
      { participantId: 1, amount: -1_500 },
      { participantId: 2, amount: -200 },
      { participantId: 3, amount: -3_000 },
    ];

    const winners = determineWinners(finalBalances);

    expect(winners).toHaveLength(1);
    expect(winners[0]?.participantId).toBe(2);
    expect(winners[0]?.amount).toBe(-200);
  });

  it("参加者が 1 名なら当人が勝者", () => {
    const winners = determineWinners([{ participantId: 7, amount: 10_000 }]);

    expect(winners).toHaveLength(1);
    expect(winners[0]?.participantId).toBe(7);
  });

  it("残額が空なら勝者は存在しない", () => {
    const empty: ParticipantBalance[] = [];

    expect(determineWinners(empty)).toEqual([]);
  });

  it("入力配列を変更しない（純関数）", () => {
    const finalBalances: ParticipantBalance[] = [
      { participantId: 1, amount: 10_000 },
      { participantId: 2, amount: 12_000 },
    ];
    const before = finalBalances.map((balance) => ({ ...balance }));

    determineWinners(finalBalances);

    expect(finalBalances).toEqual(before);
  });
});

describe("isWinningParticipant", () => {
  const finalBalances: ParticipantBalance[] = [
    { participantId: 1, amount: 9_000 },
    { participantId: 2, amount: 12_000 },
    { participantId: 3, amount: 12_000 },
  ];

  it("残額最多の共同首位を勝者と判定する", () => {
    expect(isWinningParticipant(2, finalBalances)).toBe(true);
    expect(isWinningParticipant(3, finalBalances)).toBe(true);
  });

  it("残額最多でないプレイヤーは勝者でない", () => {
    expect(isWinningParticipant(1, finalBalances)).toBe(false);
  });

  it("残額に存在しないプレイヤーは勝者でない", () => {
    expect(isWinningParticipant(99, finalBalances)).toBe(false);
  });
});
