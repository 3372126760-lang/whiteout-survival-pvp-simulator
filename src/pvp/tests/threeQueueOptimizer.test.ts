import { describe, expect, it } from "vitest";
import {
  TROOP_TYPES, allocateThreeQueueTroops, applyThreeQueueCandidate,
  defaultThreeQueueOptimizationOptions, getValidationCatalog,
  getValidationThreeQueues,
  isWholePercentQueue, optimizeThreeQueueScenario, runThreeQueueScenario,
  sanitizeConfigForStage, ThreeQueueUnresolvedError,
  toValidationThreeQueueConfig,
  type PureTroopScenarioResult, type ThreeQueueScenarioConfig,
  type ThreeQueueScenarioResult,
} from "../../pvp";
import { createDefaultValidationInput } from "../../ui/defaultInput";

function inputAtS8() {
  const base = createDefaultValidationInput();
  const input = sanitizeConfigForStage({ ...base, scenarioType: "THREE_QUEUE" as const,
    attributeInputMode: "prediction" as const,
    sideA: { ...base.sideA, deploymentCapacity: 91 },
    sideB: { ...base.sideB, deploymentCapacity: 91 } }, "s8_fc10").input;
  return {...input,availableHeroIds:getValidationCatalog().leaderHeroes.filter((h)=>(h.generation??0)>=6&&(h.generation??0)<=8).map((h)=>h.heroId)};
}

function quickOptions() {
  return { ...defaultThreeQueueOptimizationOptions(4321),
    criterionCandidatesPerQueue: 18, criterionPairLimit: 70, criterionTripleLimit: 60, criterionTheoryLimit: 12, criterionSchedulerTrials: 4,
    initialCandidateCount: 12, coarseSimulationCount: 2,
    beamWidth: 2, beamRounds: 1, expansionsPerState: 6,
    refinementCandidateCount: 8, refinementSimulationCount: 2,
    finalCandidateCount: 2, finalValidationCount: 3 };
}

function schedulerScenario(config: ThreeQueueScenarioConfig): ThreeQueueScenarioResult {
  return runThreeQueueScenario(config, (battle) => ({
    winner: "A", attackerSurvivors: {
      shield: battle.sideA.shield.count,
      lancer: battle.sideA.lancer.count,
      marksman: battle.sideA.marksman.count,
    }, defenderSurvivors: { shield: 0, lancer: 0, marksman: 0 },
    battle: {} as PureTroopScenarioResult,
  }));
}

describe("three-queue optimizer", () => {
  it("reports the exact queue and attribute before a generic factor error", () => {
    const input = inputAtS8();
    const queues = getValidationThreeQueues(input.sideA);
    const broken = { ...queues[1]!, attributes: { ...queues[1]!.attributes!,
      lancer: { ...queues[1]!.attributes!.lancer, penetration: Number.NaN } } };
    expect(() => toValidationThreeQueueConfig({ ...input, sideA: { ...input.sideA,
      threeQueues: [queues[0], broken, queues[2]] } })).toThrow(
      /A方 第2队 矛兵穿透缺失/);
    const negative = { ...queues[1]!, attributes: { ...queues[1]!.attributes!,
      lancer: { ...queues[1]!.attributes!.lancer, penetration: -150 } } };
    expect(() => toValidationThreeQueueConfig({ ...input, sideA: { ...input.sideA,
      threeQueues: [queues[0], negative, queues[2]] } })).toThrow(
      /A方 第2队 矛兵穿透因子无效：.*reportFactor=-0.5/);
  });
  it("reports formal attribute provenance separately from hero and official additive", () => {
    const input = inputAtS8();
    const queues = getValidationThreeQueues(input.sideA);
    const attributes = { ...queues[0].attributes!,
      lancer: { ...queues[0].attributes!.lancer, attack: 300.2 } };
    const wrong = { ...input, sideA: { ...input.sideA,
      threeQueues: [{ ...queues[0], attributes, attributeSource: "importedReport" as const,
        leaderHeroIds: { lancer: "hero.s3.miya" }, reportHeroByTroop: { lancer: "hero.s8.suoniya" },
        reportLineage: { source: "historicalReport" as const, attributeSnapshot: attributes } },
      queues[1], queues[2]] as NonNullable<typeof input.sideA.threeQueues> } };
    expect(() => toValidationThreeQueueConfig(wrong)).toThrow(
      /reportValue=300\.2.*reportValueSource=.*importedReport.*sideA\.threeQueues\[0\]\.attributes\.lancer\.attack.*additiveContributions=\[\].*specialBonusAdditivePercent=0.*heroStaticDeltaPercent=-/);
  });
  it("searches full ordered states on the 1% grid within ServerStage and reuses seeded trials", () => {
    const input = inputAtS8();
    const seen = new Map<string, number[]>();
    const orders = new Set<string>();
    const execute = (config: ThreeQueueScenarioConfig) => {
      for (const queue of config.attacker.queues) {
        expect(queue.ratiosBp).toBeDefined();
        expect(TROOP_TYPES.reduce((sum, troop) => sum +
          queue.ratiosBp![troop], 0)).toBe(10_000);
      }
      const key = config.attacker.queues.map((queue) => JSON.stringify({
        ratios: queue.ratiosBp, heroes: queue.side.heroes })).join("|");
      seen.set(key, [...(seen.get(key) ?? []), config.seed]);
      const result = schedulerScenario(config);
      orders.add(result.scenarioTrace.battles.map((battle) =>
        `${battle.attackerQueueId}-${battle.defenderQueueId}`).join("/"));
      expect(result.totalBattles).toBeGreaterThanOrEqual(3);
      return result;
    };
    const options = quickOptions();
    const first = optimizeThreeQueueScenario(input, options, undefined, execute);
    const second = optimizeThreeQueueScenario(input, options, undefined, execute);
    expect(second).toEqual(first);
    expect(first.searchedCandidateCount).toBeGreaterThan(3);
    expect(first.finalValidatedCandidateCount).toBe(3);
    expect(first.topCandidates[0]!.winRate).toBeGreaterThanOrEqual(first.current.winRate);
    expect(orders.size).toBeGreaterThan(1);
    const seedFrequency = new Map<number, number>();
    for (const seeds of seen.values()) {
      for (const seed of new Set(seeds)) {
        seedFrequency.set(seed, (seedFrequency.get(seed) ?? 0) + 1);
      }
    }
    expect([...seedFrequency.values()].some((count) => count > 1)).toBe(true);
    const heroGeneration = new Map(getValidationCatalog().leaderHeroes.map((hero) =>
      [hero.heroId, hero.generation ?? 0]));
    for (const row of first.topCandidates) {
      expect(row.trials).toBe(options.finalValidationCount);
      expect(row.wins + row.losses + row.failedTrials).toBe(row.trials);
      for (const queue of row.candidate.queues) {
        expect(isWholePercentQueue(queue)).toBe(true);
        for (const troop of TROOP_TYPES) {
          const id = queue.leaderHeroIds[troop];
          if (id !== null && id !== undefined) {
            expect(heroGeneration.get(id)).toBeLessThanOrEqual(8);
          }
        }
      }
    }
    expect([...seen.values()].some((seeds) => seeds.length > 1)).toBe(true);
    const alternateSeeds: number[] = [];
    optimizeThreeQueueScenario(input, { ...options, rootSeed: options.rootSeed + 1 },
      undefined, (config) => {
        alternateSeeds.push(config.seed);
        return schedulerScenario(config);
      });
    expect(alternateSeeds[0]).not.toBe([...seen.values()][0]![0]);
  }, 60_000);

  it("honors queue locks and applies only the optimized side with exact capacity and levels", () => {
    const base = inputAtS8();
    const input = { ...base, sideA: { ...base.sideA,
      threeQueues: [base.sideA.threeQueues![0]!, {
        ...base.sideA.threeQueues![1]!,
        ratios: { shield: 52, lancer: 18, marksman: 30 },
      }, base.sideA.threeQueues![2]!] as NonNullable<typeof base.sideA.threeQueues> } };
    const options = { ...quickOptions(), lockHeroes: [true, false, false] as const,
      lockRatios: [false, true, false] as const };
    const originalQueues = input.sideA.threeQueues!;
    const distinct = { ...input, sideA: { ...input.sideA,
      threeQueues: originalQueues.map((queue, index) => ({ ...queue,
        attributes: { ...getValidationThreeQueues(input.sideA)[index]!.attributes!,
          shield: { ...getValidationThreeQueues(input.sideA)[index]!
            .attributes!.shield, attack: 1000 + index * 1000 } },
        externalBuffs: { ...getValidationThreeQueues(input.sideA)[index]!.externalBuffs!,
          town: { ...getValidationThreeQueues(input.sideA)[index]!.externalBuffs!.town,
            attack: index === 0 ? "small" as const : "large" as const } },
        heroSkillLevels: { "hero-skill.lingnai.shadow-blade": index === 0 ? 4 : 5 },
      })) as unknown as NonNullable<typeof input.sideA.threeQueues> } };
    const result = optimizeThreeQueueScenario(distinct, options, undefined, schedulerScenario);
    for (const row of result.topCandidates) {
      expect(row.candidate.queues[0].leaderHeroIds).toEqual(
        distinct.sideA.threeQueues![0]!.leaderHeroIds);
      expect(row.candidate.queues[1].ratiosBp).toEqual({
        shield: 5200, lancer: 1800, marksman: 3000 });
      const applied = applyThreeQueueCandidate(distinct, "A", row.candidate);
      expect(applied.sideB).toEqual(distinct.sideB);
      expect(applied.sideA.highestTroopLevels).toEqual(distinct.sideA.highestTroopLevels);
      for (let index = 0; index < 3; index += 1) {
        expect(applied.sideA.threeQueues![index]!.attributes).toEqual(
          distinct.sideA.threeQueues![index]!.attributes);
        expect(applied.sideA.threeQueues![index]!.externalBuffs).toEqual(
          distinct.sideA.threeQueues![index]!.externalBuffs);
        expect(applied.sideA.threeQueues![index]!.heroSkillLevels).toEqual(
          distinct.sideA.threeQueues![index]!.heroSkillLevels);
      }
      const config = toValidationThreeQueueConfig(applied);
      expect(config.attacker.deploymentCapacity).toBe(91);
      for (const queue of config.attacker.queues) {
        const allocated = allocateThreeQueueTroops(91, queue.ratiosBp!);
        expect(TROOP_TYPES.reduce((sum, troop) => sum + allocated[troop], 0))
          .toBe(91);
      }
    }
    const defender = optimizeThreeQueueScenario(input, { ...quickOptions(),
      side: "B" }, undefined, schedulerScenario);
    const appliedB = applyThreeQueueCandidate(input, "B",
      defender.topCandidates[0]!.candidate);
    expect(appliedB.sideA).toEqual(input.sideA);
    const fractionalInput = { ...input, sideA: { ...input.sideA,
      threeQueues: [input.sideA.threeQueues![0]!, {
        ...input.sideA.threeQueues![1]!,
        ratios: { shield: 33.33, lancer: 33.33, marksman: 33.34 },
      }, input.sideA.threeQueues![2]!] as NonNullable<typeof input.sideA.threeQueues> } };
    expect(() => optimizeThreeQueueScenario(fractionalInput, options,
      undefined, schedulerScenario)).toThrow(/1%/);
    const highLevelBase = createDefaultValidationInput();
    const highLevelInput = { ...highLevelBase,
      scenarioType: "THREE_QUEUE" as const, attributeInputMode: "prediction" as const,
      sideA: { ...highLevelBase.sideA, deploymentCapacity: 1_000_000,
        highestTroopLevels: { shield: "T10-FC10", lancer: "T12-FC10",
          marksman: "T11-FC10" } } };
    const highLevelApplied = applyThreeQueueCandidate(highLevelInput, "A",
      result.topCandidates[0]!.candidate);
    const highLevelConfig = toValidationThreeQueueConfig(highLevelApplied);
    expect(highLevelConfig.attacker.highestTroopLevels).toEqual(
      highLevelInput.sideA.highestTroopLevels);
    for (const queue of highLevelConfig.attacker.queues) {
      const counts = allocateThreeQueueTroops(1_000_000, queue.ratiosBp!);
      expect(TROOP_TYPES.reduce((sum, troop) => sum + counts[troop], 0))
        .toBe(1_000_000);
    }
  });

  it("keeps failed trials in the batch win-rate denominator", () => {
    const options = { ...quickOptions(), initialCandidateCount: 1,
      beamWidth: 1, expansionsPerState: 1,
      refinementCandidateCount: 1, finalCandidateCount: 1,
      finalValidationCount: 4,
      lockHeroes: [true, true, true] as const,
      lockRatios: [true, true, true] as const };
    const result = optimizeThreeQueueScenario(inputAtS8(), options,
      undefined, () => { throw new ThreeQueueUnresolvedError("test"); });
    expect(result.status).toBe("failed");
    expect(result.current).toMatchObject({ trials: 4, wins: 0,
      losses: 0, failedTrials: 4, validTrials: 0, winRate: 0 });
    expect(result.topCandidates[0]).toMatchObject({ trials: 4, wins: 0,
      losses: 0, failedTrials: 4, validTrials: 0, winRate: 0 });
  });

  it("uses the production ThreeQueueScenarioRunner and BattleEngine in final validation", () => {
    const base = inputAtS8();
    const strong = (troop: typeof base.sideA.troops.shield) => ({ ...troop,
      attack: 10_000, penetration: 10_000, defense: 10_000 });
    const input = { ...base, maxRounds: 50,
      sideA: { ...base.sideA, deploymentCapacity: 30,
        troops: { shield: strong(base.sideA.troops.shield),
          lancer: strong(base.sideA.troops.lancer),
          marksman: strong(base.sideA.troops.marksman) } },
      sideB: { ...base.sideB, deploymentCapacity: 30 } };
    const options = { ...quickOptions(), initialCandidateCount: 1,
      coarseSimulationCount: 1, beamWidth: 1, expansionsPerState: 1,
      refinementCandidateCount: 1, refinementSimulationCount: 1,
      finalCandidateCount: 1, finalValidationCount: 2,
      lockHeroes: [true, true, true] as const,
      lockRatios: [true, true, true] as const };
    const traces: ThreeQueueScenarioResult[] = [];
    const result = optimizeThreeQueueScenario(input, options, undefined,
      (config) => {
        const scenario = runThreeQueueScenario(config);
        traces.push(scenario);
        return scenario;
      });
    expect(result.topCandidates[0]!.trials).toBe(2);
    expect(traces.length).toBeGreaterThanOrEqual(2);
    expect(traces[0]!.initialAttackerOrder).toHaveLength(3);
    expect(traces[0]!.initialDefenderOrder).toHaveLength(3);
    expect(traces[0]!.battleResults[0]!.battle.simulation.trace.rounds.length)
      .toBeGreaterThan(0);
  });
});
