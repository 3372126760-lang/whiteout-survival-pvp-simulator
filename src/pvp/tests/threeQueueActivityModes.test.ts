import { describe, expect, it } from "vitest";
import {
  IceFireLeagueScheduler, RandomAliveQueueScheduler, createSeededRandomSource,
  createThreeQueueScheduler, generateThreeQueuePositionCandidates,
  getValidationThreeQueues, runThreeQueueScenario, runThreeQueueScenarioFast,
  runThreeQueueBatchSimulation,
  toValidationThreeQueueConfig, defaultThreeQueueOptimizationOptions,
  optimizeThreeQueueScenario, sanitizeConfigForStage, getValidationCatalog,
  type PureTroopBattleScenario, type PureTroopScenarioResult,
  type ThreeQueueOptimizationState, type SideId, type TroopCounts,
} from "../../pvp";
import { createCriterionThreeQueueEvaluator, currentCriterionQueueState } from "../optimizer/criterion/threeQueue";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { createPersistedEnvelope, restorePersistedConfig } from "../../storage";

const input = () => ({ ...createDefaultValidationInput(), scenarioType: "THREE_QUEUE" as const,
  attributeInputMode: "prediction" as const, threeQueueMode: "ICE_FIRE_LEAGUE" as const,
  randomSeed: 771 });
const config = () => toValidationThreeQueueConfig(input());

function scriptDuels(winners: readonly SideId[]) {
  let index = 0;
  return (battle: PureTroopBattleScenario) => {
    const counts = (side: typeof battle.sideA): TroopCounts => ({
      shield: side.shield.count - 1, lancer: side.lancer.count, marksman: side.marksman.count,
    });
    return { winner: winners[index++]!, attackerSurvivors: counts(battle.sideA),
      defenderSurvivors: counts(battle.sideB), battle: {} as PureTroopScenarioResult };
  };
}

describe("three-queue activity scheduling", () => {
  it("binds the explicit IceFire scene to fixed cursors even when a legacy random mode was supplied", () => {
    const selected = { ...config(), battleScenario: "ICE_FIRE_LEAGUE" as const,
      threeQueueMode: "EARTH_HEART_BRAVE_LAND" as const };
    const full = runThreeQueueScenario(selected, scriptDuels(["A", "B", "B", "A", "A"]));
    const duel = scriptDuels(["A", "B", "B", "A", "A"]);
    const fast = runThreeQueueScenarioFast(selected, (battle) => ({ ...duel(battle), roundCount: 2 }));
    for (const result of [full.threeQueueScheduler, fast.threeQueueScheduler]) {
      expect(result.schedulerType).toBe("IceFireLeagueScheduler");
      expect(result.threeQueueMode).toBe("ICE_FIRE_LEAGUE");
      expect(result.matchSequence).toEqual(["A1-B1", "A2-B2", "A3-B3", "A1-B2", "A1-B3"]);
      expect(result.cursorHistoryA).toEqual([0, 1, 2, 0, 1, 1]);
      expect(result.cursorHistoryB).toEqual([0, 1, 2, 0, 2, 0]);
    }
  });
  it("runs the five-duel IceFire sequence through the unchanged formal BattleEngine", () => {
    const base = config();
    const strengthen = (queue: typeof base.attacker.queues[number], strength: number) => ({
      ...queue, ratiosBp: { shield: 10000, lancer: 0, marksman: 0 },
      side: { ...queue.side, heroes: [], reportHeroIds: [], reportHeroes: [],
        shield: { ...queue.side.shield, attack: strength, defense: strength, penetration: strength, life: strength },
        lancer: { ...queue.side.lancer, attack: strength, defense: strength, penetration: strength, life: strength },
        marksman: { ...queue.side.marksman, attack: strength, defense: strength, penetration: strength, life: strength } },
    });
    const selected = { ...base, maxRoundsPerBattle: 300,
      attacker: { ...base.attacker, deploymentCapacity: 90,
        queues: [strengthen(base.attacker.queues[0], 3), strengthen(base.attacker.queues[1], .01),
          strengthen(base.attacker.queues[2], .01)] as const },
      defender: { ...base.defender, deploymentCapacity: 90,
        queues: [strengthen(base.defender.queues[0], 1), strengthen(base.defender.queues[1], 2),
          strengthen(base.defender.queues[2], 2)] as const } };
    const result = runThreeQueueScenario(selected);
    expect(result.threeQueueScheduler.matchSequence)
      .toEqual(["A1-B1", "A2-B2", "A3-B3", "A1-B2", "A1-B3"]);
    expect(result.battleResults.map((row) => row.winner)).toEqual(["A", "B", "B", "A", "A"]);
    expect(result.battleResults.every((row) => row.battle.simulation.trace.rounds.length > 0)).toBe(true);
    expect(result.scenarioTrace.battles.filter((row) => row.attackerQueueId === "A1")
      .map((row) => [row.attackerBefore.shield, row.attackerAfter.shield]))
      .toEqual([[90, 87], [87, 67], [67, 43]]);
    expect(result.scenarioTrace.battles[3]!.attackerBefore)
      .toEqual(result.scenarioTrace.battles[0]!.attackerAfter);
    expect(result.scenarioTrace.battles[4]!.attackerBefore)
      .toEqual(result.scenarioTrace.battles[3]!.attackerAfter);
  });

  it("reproduces the user's five-duel IceFire structure and exact survivors", () => {
    const result = runThreeQueueScenario(config(), scriptDuels(["A", "B", "B", "A", "A"]));
    expect(result.threeQueueScheduler.matchSequence)
      .toEqual(["A1-B1", "A2-B2", "A3-B3", "A1-B2", "A1-B3"]);
    expect(result.threeQueueScheduler).toMatchObject({ threeQueueMode: "ICE_FIRE_LEAGUE",
      schedulerType: "IceFireLeagueScheduler", rule: "independentCircularCursors", ruleStatus: "confirmed",
      queueCursorA: 1, queueCursorB: 0 });
    expect(result.totalBattles).toBe(5);
    expect(result.threeQueueScheduler.cursorHistoryA).toEqual([0, 1, 2, 0, 1, 1]);
    expect(result.threeQueueScheduler.cursorHistoryB).toEqual([0, 1, 2, 0, 2, 0]);
    expect(result.winner).toBe("A");
    expect(result.scenarioTrace.battles[3]!.attackerBefore)
      .toEqual(result.scenarioTrace.battles[0]!.attackerAfter);
    expect(result.scenarioTrace.battles[4]!.attackerBefore)
      .toEqual(result.scenarioTrace.battles[3]!.attackerAfter);
    expect(result.scenarioTrace.battles[3]!.defenderBefore)
      .toEqual(result.scenarioTrace.battles[1]!.defenderAfter);
    expect(result.remainingAttackerQueues.map((queue) => queue.id)).toEqual(["A1"]);
  });

  it("starts 1v1/2v2/3v3 even when the same side wins: no winner-stays", () => {
    const result = runThreeQueueScenario(config(), scriptDuels(["A", "A", "A"]));
    expect(result.threeQueueScheduler.matchSequence).toEqual(["A1-B1", "A2-B2", "A3-B3"]);
    expect(result.scenarioTrace.battles.map((row) =>
      [row.queueCursorA, row.queueCursorB, row.nextQueueCursorA, row.nextQueueCursorB]))
      .toEqual([[0, 0, 1, 1], [1, 1, 2, 2], [2, 2, 0, 0]]);
  });

  it("skips dead original slots after wrapping for either winner", () => {
    const result = runThreeQueueScenario(config(), scriptDuels(["B", "A", "B", "A", "A"]));
    expect(result.threeQueueScheduler.matchSequence)
      .toEqual(["A1-B1", "A2-B2", "A3-B3", "A2-B1", "A2-B3"]);
    expect(result.scenarioTrace.battles[3]!).toMatchObject({ queueCursorA: 0,
      queueCursorB: 0, nextQueueCursorA: 2, nextQueueCursorB: 1 });
  });

  it("uses original positions and never parses queue labels as numeric coordinates", () => {
    const scheduler = new IceFireLeagueScheduler(1, {
      attacker: ["cat", "fox", "dog"], defender: ["one", "two", "three"],
    });
    expect(scheduler.pick(["dog", "cat", "fox"], ["three", "two", "one"]))
      .toEqual({ attackerQueueId: "cat", defenderQueueId: "one" });
    expect(scheduler.pick(["dog", "cat"], ["two", "three"]))
      .toEqual({ attackerQueueId: "dog", defenderQueueId: "two" });
    expect(scheduler.queueCursorA).toBe(0);
    expect(() => scheduler.pick([], ["two"])).toThrow(/eliminated/);
    expect(() => new IceFireLeagueScheduler(1, { attacker: ["x", "x", "y"],
      defender: ["1", "2", "3"] })).toThrow(/three distinct/);
  });

  it("keeps the random activity's previous seeded choices exactly", () => {
    const legacy = createSeededRandomSource(771);
    const random = new RandomAliveQueueScheduler(771);
    const implicit = createThreeQueueScheduler(771);
    for (let index = 0; index < 8; index += 1) {
      const aliveA = index % 2 ? ["A1", "A3"] : ["A1", "A2", "A3"];
      const aliveB = index % 3 ? ["B2", "B3"] : ["B1", "B2", "B3"];
      const expected = { attackerQueueId: aliveA[Math.floor(legacy.next() * aliveA.length)]!,
        defenderQueueId: aliveB[Math.floor(legacy.next() * aliveB.length)]! };
      expect(random.pick(aliveA, aliveB)).toEqual(expected);
      expect(implicit.pick(aliveA, aliveB)).toEqual(expected);
    }
    expect(random.queueCursorA).toBeNull();
    expect(random.queueCursorB).toBeNull();
  });

  it("uses the same activity scheduler in the fast runner without detailed traces", () => {
    const full = runThreeQueueScenario(config(), scriptDuels(["A", "B", "B", "A", "A"]));
    const duel = scriptDuels(["A", "B", "B", "A", "A"]);
    const fast = runThreeQueueScenarioFast(config(), (battle) => ({ ...duel(battle), roundCount: 2 }));
    expect(fast.threeQueueScheduler).toEqual(full.scenarioTrace.threeQueueScheduler);
    expect(fast.remainingQueues.A).toEqual(full.remainingAttackerQueues);
    expect(fast.remainingQueues.B).toEqual(full.remainingDefenderQueues);
    expect(fast.roundCount).toBe(10);
    expect("scenarioTrace" in fast).toBe(false);
    expect("battleResults" in fast).toBe(false);
  });

  it("uses exact preset troop counts throughout scheduling and casualty totals", () => {
    const base = config();
    const exact = { shield: 48001, lancer: 24000, marksman: 18000 };
    const selected = { ...base, defender: { ...base.defender, deploymentCapacity: 90001,
      queues: base.defender.queues.map((queue) => ({ ...queue,
        ratiosBp: { shield: 5333, lancer: 2667, marksman: 2000 }, initialTroopCounts: exact,
      })) as unknown as typeof base.defender.queues } };
    const result = runThreeQueueScenario(selected, scriptDuels(["A", "A", "A"]));
    expect(result.scenarioTrace.battles.map((row) => row.defenderBefore)).toEqual([exact, exact, exact]);
    expect(result.aggregateCasualties.B.total.initial).toBe(270003);
    const invalid = { ...selected, defender: { ...selected.defender,
      queues: [{ ...selected.defender.queues[0], initialTroopCounts: { ...exact, shield: 48000 } },
        selected.defender.queues[1], selected.defender.queues[2]] as const } };
    expect(() => runThreeQueueScenario(invalid, scriptDuels(["A", "A", "A"]))).toThrow(/exact troop counts/);
  });

  it("persists activity modes and migrates legacy configurations to the random activity", () => {
    const envelope = createPersistedEnvelope(input(), 1000);
    expect(restorePersistedConfig(envelope).input.threeQueueMode).toBe("ICE_FIRE_LEAGUE");
    const legacy = structuredClone(envelope);
    delete (legacy.data.input as { threeQueueMode?: string }).threeQueueMode;
    expect(restorePersistedConfig(legacy).input.threeQueueMode).toBe("EARTH_HEART_BRAVE_LAND");
    const invalid = structuredClone(envelope);
    (invalid.data.input as { threeQueueMode?: string }).threeQueueMode = "winner-stays";
    expect(() => restorePersistedConfig(invalid)).toThrow(/threeQueueMode/);
  });

  it("batch results identify the mode and expose one actual seeded scheduler audit", () => {
    const result = runThreeQueueBatchSimulation(input(), 2, undefined, undefined,
      (scenario) => runThreeQueueScenario(scenario, scriptDuels(["A", "B", "B", "A", "A"])));
    expect(result.threeQueueMode).toBe("ICE_FIRE_LEAGUE");
    expect(result.schedulerType).toBe("IceFireLeagueScheduler");
    expect(result.schedulerSample?.trialSeed).toBe(result.firstTrialSeed);
    expect(result.schedulerSample?.audit.seed).toBe(result.firstTrialSeed);
    expect(result.schedulerSample?.audit.matchSequence)
      .toEqual(["A1-B1", "A2-B2", "A3-B3", "A1-B2", "A1-B3"]);
  });

  it("Criterion follows the chosen scheduler and records its match sequence", () => {
    const base = input();
    const a = currentCriterionQueueState(base, "A"), b = currentCriterionQueueState(base, "B");
    const evaluator = createCriterionThreeQueueEvaluator(base);
    const first = evaluator.run(a, b, 771), second = evaluator.run(a, b, 772);
    expect(first).toEqual(second);
    expect(first.matchSequence.slice(0, 3)).toEqual(["A1-B1", "A2-B2", "A3-B3"]);
    expect(first.schedulerType).toBe("IceFireLeagueScheduler");
    const random = createCriterionThreeQueueEvaluator({ ...base, threeQueueMode: "EARTH_HEART_BRAVE_LAND" });
    expect(random.run(a, b, 771).schedulerType).toBe("RandomAliveQueueScheduler");
    expect(random.run(a, b, 771).matchSequence).not.toEqual(random.run(a, b, 772).matchSequence);
  });

  it("permutes positions while honoring component locks and keeping ordered identities", () => {
    const state: ThreeQueueOptimizationState = { queues: [
      { leaderHeroIds: { shield: "h1" }, ratiosBp: { shield: 10000, lancer: 0, marksman: 0 } },
      { leaderHeroIds: { lancer: "h2" }, ratiosBp: { shield: 0, lancer: 10000, marksman: 0 } },
      { leaderHeroIds: { marksman: "h3" }, ratiosBp: { shield: 0, lancer: 0, marksman: 10000 } },
    ] };
    expect(generateThreeQueuePositionCandidates(state, { lockHeroes: [false, false, false],
      lockRatios: [false, false, false] })).toHaveLength(6);
    const locked = generateThreeQueuePositionCandidates(state, { lockHeroes: [true, false, false],
      lockRatios: [false, true, false] });
    for (const candidate of locked) {
      expect(candidate.queues[0].leaderHeroIds).toEqual(state.queues[0].leaderHeroIds);
      expect(candidate.queues[1].ratiosBp).toEqual(state.queues[1].ratiosBp);
    }
  });

  it("optimizer propagates the activity to formal trials and uses position search only for IceFire", () => {
    const base = createDefaultValidationInput();
    const staged = sanitizeConfigForStage({ ...base, scenarioType: "THREE_QUEUE",
      attributeInputMode: "prediction", sideA: { ...base.sideA, deploymentCapacity: 91 },
      sideB: { ...base.sideB, deploymentCapacity: 91 } }, "s8_fc10").input;
    const owned = getValidationCatalog().leaderHeroes.filter((hero) =>
      (hero.generation ?? 0) >= 6 && (hero.generation ?? 0) <= 8).map((hero) => hero.heroId);
    const options = { ...defaultThreeQueueOptimizationOptions(4321), criterionEnabled: false,
      criterionCandidatesPerQueue: 4, criterionPairLimit: 8, criterionTripleLimit: 12, criterionTheoryLimit: 4, initialCandidateCount: 2, coarseSimulationCount: 1, beamWidth: 1, beamRounds: 1,
      expansionsPerState: 1, refinementCandidateCount: 2, refinementSimulationCount: 1,
      finalCandidateCount: 1, finalValidationCount: 1 };
    for (const threeQueueMode of ["ICE_FIRE_LEAGUE", "EARTH_HEART_BRAVE_LAND"] as const) {
      const selected = { ...staged, availableHeroIds: owned, threeQueueMode };
      let executions = 0;
      const result = optimizeThreeQueueScenario(selected, options, undefined, (scenario) => {
        executions += 1;
        expect(scenario.threeQueueMode).toBe(threeQueueMode);
        return runThreeQueueScenario(scenario, scriptDuels(["A", "A", "A"]));
      });
      expect(executions).toBeGreaterThan(1);
      expect(result.threeQueueMode).toBe(threeQueueMode);
      expect(result.schedulerType).toBe(threeQueueMode === "ICE_FIRE_LEAGUE"
        ? "IceFireLeagueScheduler" : "RandomAliveQueueScheduler");
      expect(result.optimizationObjective).toBe(threeQueueMode === "ICE_FIRE_LEAGUE"
        ? "worstEnemyPermutationWinProbability" : "schedulerMonteCarloWinProbability");
      expect(result.positionCandidateCount > 0).toBe(threeQueueMode === "ICE_FIRE_LEAGUE");
      expect(getValidationThreeQueues(selected.sideA)).toHaveLength(3);
    }
  });
});
