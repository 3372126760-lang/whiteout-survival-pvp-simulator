import { describe, expect, it } from "vitest";
import {
  runThreeQueueScenario,
  runValidationThreeQueueScenario,
  toValidationThreeQueueConfig,
  toThreeQueueBasisPoints,
  allocateThreeQueueTroops,
  MANUAL_RATIO_BASIS_POINT_STEP,
  OPTIMIZER_RATIO_BASIS_POINT_STEP,
  resolveThreeQueueTroopLevels,
  getValidationThreeQueues,
  sanitizeConfigForStage,
  type PureTroopScenarioResult,
  type ThreeQueueDuelResolution,
} from "../../pvp";
import { createDefaultValidationInput } from "../../ui/defaultInput";

const queueInput = () => ({
  ...createDefaultValidationInput(), scenarioType: "THREE_QUEUE" as const,
  attributeInputMode: "prediction" as const,
  maxRounds: 50, randomSeed: 42,
});

describe("three-queue scenario", () => {
  it("uses each matched queue's own report attributes and troop levels", () => {
    const base = queueInput();
    const sideAQueues = getValidationThreeQueues(base.sideA).map((queue, index) => ({
      ...queue, attributes: { ...queue.attributes!,
        shield: { ...queue.attributes!.shield, attack: 1000 * (index + 1) } },
      troopLevels: { ...queue.troopLevels!, shield: ["T10-FC8",
        "T11-FC10", "T12-FC10"][index]! },
    })) as unknown as NonNullable<typeof base.sideA.threeQueues>;
    const sideBQueues = getValidationThreeQueues(base.sideB).map((queue, index) => ({
      ...queue, attributes: { ...queue.attributes!,
        shield: { ...queue.attributes!.shield, attack: 4000 + 1000 * index } },
    })) as unknown as NonNullable<typeof base.sideB.threeQueues>;
    const config = toValidationThreeQueueConfig({ ...base,
      sideA: { ...base.sideA, threeQueues: sideAQueues },
      sideB: { ...base.sideB, threeQueues: sideBQueues } });
    const seen = new Set<string>();
    runThreeQueueScenario(config, (scenario) => {
      const match = /A([1-3])-vs-B([1-3])/.exec(scenario.id)!;
      const a = Number(match[1]) - 1;
      const b = Number(match[2]) - 1;
      expect(scenario.sideA.shield.attack).toBe(10 * (a + 1));
      expect(scenario.sideB.shield.attack).toBe(40 + 10 * b);
      expect(scenario.sideA.shield.troopLevel).toBe(
        sideAQueues[a]!.troopLevels!.shield);
      seen.add(match[1]!);
      return { winner: "A", attackerSurvivors: {
        shield: scenario.sideA.shield.count,
        lancer: scenario.sideA.lancer.count,
        marksman: scenario.sideA.marksman.count,
      }, defenderSurvivors: { shield: 0, lancer: 0, marksman: 0 },
      battle: {} as PureTroopScenarioResult };
    });
    expect(seen).toEqual(new Set(["1", "2", "3"]));
  });

  it("clamps each queue's level at the existing ServerStage while retaining attributes", () => {
    const base = queueInput();
    const queues = getValidationThreeQueues(base.sideA);
    const input = { ...base, sideA: { ...base.sideA,
      threeQueues: [{ ...queues[0],
        attributes: { ...queues[0].attributes!,
          shield: { ...queues[0].attributes!.shield, attack: 7654 } },
        troopLevels: { ...queues[0].troopLevels!, shield: "T12-FC10" } },
      queues[1], queues[2]] as NonNullable<typeof base.sideA.threeQueues> } };
    const cleaned = sanitizeConfigForStage(input, "s8_fc10").input;
    expect(cleaned.sideA.threeQueues?.[0].troopLevels?.shield).toBe("T11-FC10");
    expect(cleaned.sideA.threeQueues?.[0].attributes?.shield.attack).toBe(7654);
  });

  it("produces different real battle traces with the same heroes but different queue attributes", () => {
    const base = queueInput();
    const strong = (troop: typeof base.sideA.troops.shield) => ({ ...troop,
      attack: 10_000, penetration: 10_000, defense: 10_000 });
    const input = { ...base, maxRounds: 50,
      sideA: { ...base.sideA, deploymentCapacity: 90,
        troops: { shield: strong(base.sideA.troops.shield),
          lancer: strong(base.sideA.troops.lancer),
          marksman: strong(base.sideA.troops.marksman) } },
      sideB: { ...base.sideB, deploymentCapacity: 90 } };
    const queues = getValidationThreeQueues(input.sideA);
    const withAttack = (attack: number) => ({ ...input,
      sideA: { ...input.sideA, threeQueues: [
        { ...queues[0], attributes: { ...queues[0].attributes!,
          shield: { ...queues[0].attributes!.shield, attack } } },
        queues[1], queues[2],
      ] as NonNullable<typeof input.sideA.threeQueues> } });
    const first = runValidationThreeQueueScenario(withAttack(1000));
    const second = runValidationThreeQueueScenario(withAttack(10_000));
    const battleForA1 = (value: typeof first) => value.battleResults.find(
      (battle) => battle.attackerQueueId === "A1")!.battle.readableTrace;
    expect(battleForA1(first)).not.toEqual(battleForA1(second));
    expect(first.initialAttackerOrder).toEqual(second.initialAttackerOrder);
  });

  it("allocates the full capacity to every queue and respects the player's level ceiling", () => {
    const base = queueInput();
    const input = { ...base, sideA: { ...base.sideA,
      deploymentCapacity: 1_000_000, availableTroopLevels: ["T11-FC10"] } };
    const config = toValidationThreeQueueConfig(input);
    const seen: number[] = [];
    const seenA1: number[][] = [];
    runThreeQueueScenario(config, (scenario) => {
      seen.push(scenario.sideA.shield.count + scenario.sideA.lancer.count +
        scenario.sideA.marksman.count);
      if (scenario.id.includes("A1-vs-")) seenA1.push([
        scenario.sideA.shield.count, scenario.sideA.lancer.count,
        scenario.sideA.marksman.count,
      ]);
      expect([scenario.sideA.shield.troopLevel, scenario.sideA.lancer.troopLevel,
        scenario.sideA.marksman.troopLevel]).toEqual([
        "T11-FC10", "T11-FC10", "T11-FC10",
      ]);
      return { winner: "A", attackerSurvivors: {
        shield: scenario.sideA.shield.count,
        lancer: scenario.sideA.lancer.count,
        marksman: scenario.sideA.marksman.count,
      }, defenderSurvivors: { shield: 0, lancer: 0, marksman: 0 },
      battle: {} as PureTroopScenarioResult };
    });
    expect(seen).toEqual([1_000_000, 1_000_000, 1_000_000]);
    expect(seenA1).toEqual([[500_000, 200_000, 300_000]]);
  });

  it("repeats seeded surviving-queue scheduling", () => {
    const config = toValidationThreeQueueConfig(queueInput());
    const run = () => {
      let battleIndex = 0;
      const winners = ["A", "B", "A", "B", "A"] as const;
      const scenarios: { readonly aShield: number; readonly bShield: number }[] = [];
      const result = runThreeQueueScenario(config, (scenario): ThreeQueueDuelResolution => {
        const winner = winners[battleIndex++]!;
        scenarios.push({ aShield: scenario.sideA.shield.count,
          bShield: scenario.sideB.shield.count });
        return { winner, attackerSurvivors: {
          shield: scenario.sideA.shield.count - (winner === "A" ? 1 : 0),
          lancer: scenario.sideA.lancer.count,
          marksman: scenario.sideA.marksman.count,
        }, defenderSurvivors: {
          shield: scenario.sideB.shield.count - (winner === "B" ? 1 : 0),
          lancer: scenario.sideB.lancer.count,
          marksman: scenario.sideB.marksman.count,
        }, battle: {} as PureTroopScenarioResult };
      });
      return { result, scenarios };
    };
    const { result: first, scenarios } = run();
    const { result: second } = run();
    expect(first.initialAttackerOrder).toEqual(second.initialAttackerOrder);
    expect(first.initialDefenderOrder).toEqual(second.initialDefenderOrder);
    expect(first.scenarioTrace).toEqual(second.scenarioTrace);
    expect(first.scenarioTrace.threeQueueScheduler).toMatchObject({
      rule: "uniformAliveRandom", ruleStatus: "confirmed", seed: 42,
      threeQueueMode: "EARTH_HEART_BRAVE_LAND", schedulerType: "RandomAliveQueueScheduler",
      queueCursorA: null, queueCursorB: null });
    expect(first.totalBattles).toBe(5);
    expect(first.battleResults.map((battle) => battle.winner)).toEqual([
      "A", "B", "A", "B", "A",
    ]);
    expect(scenarios).toHaveLength(5);
    expect(first.scenarioTrace.battles.map((row) => row.eliminatedQueue))
      .toHaveLength(5);
    expect(first.winner).toBe("A");
  });

  it("uses the existing engine for every real queue battle and retains its trace", () => {
    const base = queueInput();
    const raise = (troop: typeof base.sideA.troops.shield) => ({ ...troop,
      attack: 10_000, penetration: 10_000, defense: 10_000 });
    const input = { ...base, sideA: { ...base.sideA, deploymentCapacity: 90,
      troops: { shield: raise(base.sideA.troops.shield),
        lancer: raise(base.sideA.troops.lancer),
        marksman: raise(base.sideA.troops.marksman) } },
      sideB: { ...base.sideB, deploymentCapacity: 90 } };
    const result = runValidationThreeQueueScenario(input);
    expect(result.winner).toBe("A");
    expect(result.totalBattles).toBe(3);
    expect(result.battleResults.every((entry) =>
      entry.battle.simulation.trace.rounds.length > 0)).toBe(true);
    expect(result.remainingAttackerQueues).toHaveLength(3);
    expect(result.remainingDefenderQueues).toHaveLength(0);
    const replay = runValidationThreeQueueScenario(input);
    expect(replay.scenarioTrace).toEqual(result.scenarioTrace);
    expect(replay.battleResults.map((battle) => battle.battle.readableTrace))
      .toEqual(result.battleResults.map((battle) => battle.battle.readableTrace));
  });

  it("uses exact basis points and conserves irregular capacities", () => {
    expect(MANUAL_RATIO_BASIS_POINT_STEP).toBe(1);
    expect(OPTIMIZER_RATIO_BASIS_POINT_STEP).toBe(100);
    const basisPoints = toThreeQueueBasisPoints({ shield: 33.33,
      lancer: 33.33, marksman: 33.34 });
    expect(basisPoints).toEqual({ shield: 3333, lancer: 3333, marksman: 3334 });
    const counts = allocateThreeQueueTroops(1_234_567, basisPoints);
    expect(counts.shield + counts.lancer + counts.marksman).toBe(1_234_567);
    expect(() => toThreeQueueBasisPoints({ shield: 33.33,
      lancer: 33.33, marksman: 33.33 })).toThrow(/100.00%/);
    expect(() => toThreeQueueBasisPoints({ shield: 33.335,
      lancer: 33.33, marksman: 33.335 })).toThrow(/0.01%/);
  });

  it("uses independent player ceilings for shield, lancer and marksman", () => {
    const base = queueInput();
    const input = { ...base, sideA: { ...base.sideA,
      highestTroopLevels: { shield: "T10-FC10", lancer: "T12-FC10",
        marksman: "T11-FC10" } } };
    const config = toValidationThreeQueueConfig(input);
    let seen = 0;
    runThreeQueueScenario(config, (scenario) => {
      expect([scenario.sideA.shield.troopLevel, scenario.sideA.lancer.troopLevel,
        scenario.sideA.marksman.troopLevel]).toEqual([
        "T10-FC10", "T12-FC10", "T11-FC10",
      ]);
      seen += 1;
      return { winner: "A", attackerSurvivors: {
        shield: scenario.sideA.shield.count,
        lancer: scenario.sideA.lancer.count,
        marksman: scenario.sideA.marksman.count,
      }, defenderSurvivors: { shield: 0, lancer: 0, marksman: 0 },
      battle: {} as PureTroopScenarioResult };
    });
    expect(seen).toBe(3);
    expect(config.attacker.highestTroopLevels).toEqual(input.sideA.highestTroopLevels);
    expect(config.attacker.queues[0]?.ratiosBp).toEqual({
      shield: 5000, lancer: 2000, marksman: 3000,
    });
    expect(config.attacker.queues[0]?.ratios).toBeUndefined();
    expect(config.attacker.availableTroopLevels).toBeUndefined();
    expect(config.attacker.highestTroopLevel).toBeUndefined();
  });

  it("migrates a legacy shared level without changing the three queues", () => {
    const config = toValidationThreeQueueConfig(queueInput());
    const legacy = { deploymentCapacity: config.attacker.deploymentCapacity,
      queues: config.attacker.queues, highestTroopLevel: "T11-FC10" };
    expect(resolveThreeQueueTroopLevels(legacy)).toEqual({ shield: "T11-FC10",
      lancer: "T11-FC10", marksman: "T11-FC10" });
    const first = config.attacker.queues[0]!;
    const oldQueue = { id: first.id, side: first.side,
      ratios: { shield: 50, lancer: 20, marksman: 30 } };
    expect(() => runThreeQueueScenario({ ...config,
      attacker: { ...legacy, queues: [oldQueue,
        config.attacker.queues[1]!, config.attacker.queues[2]!] } },
    (scenario) => ({ winner: "A", attackerSurvivors: {
      shield: scenario.sideA.shield.count, lancer: scenario.sideA.lancer.count,
      marksman: scenario.sideA.marksman.count,
    }, defenderSurvivors: { shield: 0, lancer: 0, marksman: 0 },
    battle: {} as PureTroopScenarioResult }))).not.toThrow();
  });

  it("rejects a queue whose percentages do not total exactly 100", () => {
    const config = toValidationThreeQueueConfig(queueInput());
    const first = config.attacker.queues[0]!;
    const queues = [{ ...first,
      ratiosBp: { ...first.ratiosBp!, shield: 4999 } },
      config.attacker.queues[1]!, config.attacker.queues[2]!] as const;
    expect(() => runThreeQueueScenario({ ...config,
      attacker: { ...config.attacker, queues } })).toThrow(/100.00%/);
  });
});
