import { describe, expect, it } from "vitest";
import { defaultThreeQueueOptimizationOptions, generateScenarioHeroFormations,
  getValidationCatalog, optimizeThreeQueueScenario, runThreeQueueScenario,
  toValidationThreeQueueConfig, type PureTroopScenarioResult } from "../../pvp";
import { createDefaultValidationInput } from "../../ui/defaultInput";

describe("owned hero pool and three-queue uniqueness", () => {
  it("restricts simple candidates to the selected pool", () => {
    const hero = getValidationCatalog().leaderHeroes.find((item) =>
      item.troopType === "shield" && item.generation === 8)!;
    const base = createDefaultValidationInput();
    const input = { ...base, attributeInputMode: "prediction" as const,
      sideA: { ...base.sideA, leaderHeroIds: { shield: hero.heroId } }, availableHeroIds: [hero.heroId] };
    const formations = generateScenarioHeroFormations(input, "A", false);
    expect(formations.every((row) => Object.values(row).every((id) =>
      id === null || id === hero.heroId))).toBe(true);
  });
  it("rejects duplicate manually selected queue leaders", () => {
    const base = createDefaultValidationInput();
    const queues = base.sideA.threeQueues!.map((queue) => ({ ...queue,
      leaderHeroIds: { shield: "hero.s8.jiatuo" } }));
    const input = { ...base, scenarioType: "THREE_QUEUE" as const,
      attributeInputMode: "prediction" as const,
      sideA: { ...base.sideA, threeQueues: [queues[0]!, queues[1]!, queues[2]!] as const } };
    expect(() => runThreeQueueScenario(toValidationThreeQueueConfig(input)))
      .toThrow(/不能重复/);
  });
  it("generates candidates from one common pool without duplicating heroes", () => {
    const base = createDefaultValidationInput();
    const pool = getValidationCatalog().leaderHeroes.filter((hero) => hero.generation === 8)
      .map((hero) => hero.heroId);
    const input = { ...base, scenarioType: "THREE_QUEUE" as const,
      attributeInputMode: "prediction" as const, availableHeroIds: pool,
      sideA: { ...base.sideA, deploymentCapacity: 90 },
      sideB: { ...base.sideB, deploymentCapacity: 90 } };
    const options = { ...defaultThreeQueueOptimizationOptions(41),
      initialCandidateCount: 4, coarseSimulationCount: 1,
      beamWidth: 1, beamRounds: 1, expansionsPerState: 3,
      refinementCandidateCount: 3, refinementSimulationCount: 1,
      finalCandidateCount: 1, finalValidationCount: 2 };
    const seen: string[][] = [];
    optimizeThreeQueueScenario(input, options, undefined, (config) => {
      const ids = config.attacker.queues.flatMap((queue) =>
        queue.side.heroes?.filter((hero) => hero.position === "leader")
          .map((hero) => hero.heroId) ?? []);
      seen.push(ids);
      return runThreeQueueScenario(config, (scenario) => ({ winner: "A",
        attackerSurvivors: { shield: scenario.sideA.shield.count,
          lancer: scenario.sideA.lancer.count, marksman: scenario.sideA.marksman.count },
        defenderSurvivors: { shield: 0, lancer: 0, marksman: 0 },
        battle: {} as PureTroopScenarioResult }));
    });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every((ids) => new Set(ids).size === ids.length &&
      ids.every((id) => pool.includes(id)))).toBe(true);
  }, 15000);
});
