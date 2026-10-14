import { describe, expect, it } from "vitest";
import { createThreeQueueScheduler, runThreeQueueScenario,
  runThreeQueueScenarioFast, toValidationThreeQueueConfig,
  type PureTroopBattleScenario, type PureTroopScenarioResult, type ThreeQueuePick,
  type ThreeQueueScheduler } from "../../pvp";
import { createDefaultValidationInput } from "../../ui/defaultInput";

const config = () => toValidationThreeQueueConfig({ ...createDefaultValidationInput(),
  scenarioType: "THREE_QUEUE", attributeInputMode: "prediction", randomSeed: 771 });
function script(picks: readonly ThreeQueuePick[]): ThreeQueueScheduler {
  let index = 0;
  return { rule: "uniformAliveRandom", ruleStatus: "provisional", seed: 771,
    pick() { return picks[index++]!; } };
}
function duel(winners: readonly ("A" | "B")[]) {
  let index = 0;
  return (scenario: PureTroopBattleScenario) => {
    const winner = winners[index++]!;
    const counts = (side: typeof scenario.sideA, loss: number) => ({
      shield: side.shield.count - loss, lancer: side.lancer.count,
      marksman: side.marksman.count });
    return { winner, attackerSurvivors: counts(scenario.sideA, 1),
      defenderSurvivors: counts(scenario.sideB, 1),
      battle: {} as PureTroopScenarioResult };
  };
}

describe("three-queue surviving-pool scheduler", () => {
  it("allows a winning queue to fight consecutively and inherits its exact remaining troops", () => {
    const result = runThreeQueueScenario(config(), duel(["A", "A", "A"]), script([
      { attackerQueueId: "A1", defenderQueueId: "B1" },
      { attackerQueueId: "A1", defenderQueueId: "B2" },
      { attackerQueueId: "A1", defenderQueueId: "B3" },
    ]));
    expect(result.battleResults.map((row) => row.attackerQueueId)).toEqual(["A1", "A1", "A1"]);
    expect(result.scenarioTrace.battles[1]!.attackerBefore.shield)
      .toBe(result.scenarioTrace.battles[0]!.attackerAfter.shield);
    expect(result.scenarioTrace.battles[2]!.attackerBefore.shield)
      .toBe(result.scenarioTrace.battles[1]!.attackerAfter.shield);
    expect(result.scenarioTrace.battles.map((row) => row.eliminatedQueue))
      .toEqual(["B1", "B2", "B3"]);
  });
  it("allows a winner to rest then return, with no healing", () => {
    const result = runThreeQueueScenario(config(), duel(["A", "A", "A"]), script([
      { attackerQueueId: "A1", defenderQueueId: "B1" },
      { attackerQueueId: "A2", defenderQueueId: "B2" },
      { attackerQueueId: "A1", defenderQueueId: "B3" },
    ]));
    expect(result.battleResults.map((row) => row.attackerQueueId)).toEqual(["A1", "A2", "A1"]);
    expect(result.scenarioTrace.battles[2]!.attackerBefore)
      .toEqual(result.scenarioTrace.battles[0]!.attackerAfter);
  });
  it("rejects a permanently eliminated queue and never needs more than five duels", () => {
    expect(() => runThreeQueueScenario(config(), duel(["B", "A"]), script([
      { attackerQueueId: "A1", defenderQueueId: "B1" },
      { attackerQueueId: "A1", defenderQueueId: "B2" },
    ]))).toThrow(/eliminated queue/);
    const result = runThreeQueueScenario(config(), duel(["A", "B", "A", "B", "A"]), script([
      { attackerQueueId: "A1", defenderQueueId: "B1" },
      { attackerQueueId: "A2", defenderQueueId: "B2" },
      { attackerQueueId: "A3", defenderQueueId: "B3" },
      { attackerQueueId: "A1", defenderQueueId: "B2" },
      { attackerQueueId: "A3", defenderQueueId: "B2" },
    ]));
    expect(result.totalBattles).toBe(5);
    expect(result.winner).toBe("A");
  });
  it("reproduces seeded selections and includes scheduling in Monte Carlo seeds", () => {
    const sequence = (seed: number) => {
      const scheduler = createThreeQueueScheduler(seed);
      return Array.from({ length: 8 }, () => scheduler.pick(["A1", "A2", "A3"],
        ["B1", "B2", "B3"]));
    };
    expect(sequence(771)).toEqual(sequence(771));
    expect(sequence(771)).not.toEqual(sequence(772));
    expect(createThreeQueueScheduler(771).ruleStatus).toBe("confirmed");
  });
  it("keeps the fast optimizer result free of battle traces", () => {
    const result = runThreeQueueScenarioFast(config(), (scenario) => ({ winner: "A",
      attackerSurvivors: { shield: scenario.sideA.shield.count,
        lancer: scenario.sideA.lancer.count, marksman: scenario.sideA.marksman.count },
      defenderSurvivors: { shield: 0, lancer: 0, marksman: 0 }, roundCount: 2 }));
    expect(result.totalBattles).toBe(3);
    expect(result.remainingQueues.A).toHaveLength(3);
    expect("scenarioTrace" in result).toBe(false);
    expect("battleResults" in result).toBe(false);
  });
});
