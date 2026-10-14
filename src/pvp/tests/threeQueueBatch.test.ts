import { describe, expect, it } from "vitest";
import { runThreeQueueBatchSimulation } from "../../pvp";
import { createDefaultValidationInput } from "../../ui/defaultInput";

function fastScenario() {
  const base = createDefaultValidationInput();
  const strong = (troop: typeof base.sideA.troops.shield) => ({ ...troop,
    attack: 10_000, penetration: 10_000, defense: 10_000 });
  return { ...base, scenarioType: "THREE_QUEUE" as const,
    attributeInputMode: "prediction" as const,
    randomSeed: 271_828, maxRounds: 50,
    sideA: { ...base.sideA, deploymentCapacity: 30,
      troops: { shield: strong(base.sideA.troops.shield),
        lancer: strong(base.sideA.troops.lancer),
        marksman: strong(base.sideA.troops.marksman) } },
    sideB: { ...base.sideB, deploymentCapacity: 30 } };
}

describe("three-queue Monte Carlo", () => {
  it("runs 100 complete scenarios and conserves the trial count", () => {
    const result = runThreeQueueBatchSimulation(fastScenario(), 100);
    expect(result.simulationCount).toBe(100);
    expect(result.attackerWins + result.defenderWins + result.failedTrials).toBe(100);
    expect(result.attackerWins).toBeGreaterThan(0);
    expect(result.averageBattleCount).toBeGreaterThanOrEqual(3);
    expect(result.avgAttackerRemainingQueues).toBeGreaterThanOrEqual(0);
    expect(result.avgAttackerSurvivors).toBeGreaterThanOrEqual(0);
  });

  it("repeats all aggregate values from the same root seed", () => {
    const input = fastScenario();
    const first = runThreeQueueBatchSimulation(input, 12);
    const second = runThreeQueueBatchSimulation(input, 12);
    expect(second).toEqual(first);
    const changed = runThreeQueueBatchSimulation({ ...input,
      randomSeed: input.randomSeed + 1 }, 12);
    expect(changed.rootSeed).not.toBe(first.rootSeed);
    expect(changed.firstTrialSeed).not.toBe(first.firstTrialSeed);
    const randomInput = { ...input, simulationMode: "random" as const };
    expect(runThreeQueueBatchSimulation(randomInput, 3, () => 42))
      .toEqual(runThreeQueueBatchSimulation(randomInput, 3, () => 42));
  });

  it("counts unresolved sub-battles as failed trials", () => {
    const base = createDefaultValidationInput();
    const input = { ...base, scenarioType: "THREE_QUEUE" as const,
      attributeInputMode: "prediction" as const,
      maxRounds: 1, sideA: { ...base.sideA, deploymentCapacity: 90 },
      sideB: { ...base.sideB, deploymentCapacity: 90 } };
    const result = runThreeQueueBatchSimulation(input, 10);
    expect(result.attackerWins + result.defenderWins + result.failedTrials).toBe(10);
    expect(result.failedTrials).toBeGreaterThan(0);
    expect(result.failedTrialSeeds).toHaveLength(result.failedTrials);
    if (result.completedTrials === 0) expect(result.schedulerSample).toBeNull();
  });
});
