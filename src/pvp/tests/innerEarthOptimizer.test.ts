import { describe, expect, it } from "vitest";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { createDefaultInnerEarthConfig, materializeInnerEarthInput,
  normalizeInnerEarthInput, type InnerEarthMode } from "../innerEarth";
import { TROOP_TYPES } from "../types";
import { createValidationPreviewState, getValidationCatalog } from "../validationUi";
import { createInnerEarthOptimizationWorkflow, defaultInnerEarthOptimizationOptions,
  innerEarthOptimizerInput, applyInnerEarthCandidate } from "../optimizer/innerEarthOptimizer";
import { currentCriterionQueueState, createCriterionThreeQueueEvaluator } from "../optimizer/criterion/threeQueue";
import { runOptimizationWorkflow, emptyOptimizationPerformance, createEvaluationExecutor,
  type EvaluationJob, type EvaluationJobResult } from "../optimizer/execution";
import { defaultTheoryOptions } from "../optimizer/theory";
import type { FastBattleResult } from "../battle/fastBattleMode";

function fixture(mode: InnerEarthMode) {
  const base = createDefaultValidationInput();
  const config = createDefaultInnerEarthConfig(base, mode);
  return normalizeInnerEarthInput({ ...base, maxRounds: 2, ownedHeroIds: [],
    optimizerHeroPool: { A: {}, B: {} }, innerEarth: { ...config,
      ally: { ...config.ally, counts: { shield: 5000, lancer: 2000, marksman: 3000 } } } });
}
function options() {
  const defaults = defaultInnerEarthOptimizationOptions(51);
  return { simple: { ...defaults.simple, side: "B" as const,
    theory: { ...defaultTheoryOptions(), deterministicRounds: 2 },
    basinSearch: { fineBasins: 1, fineRadius: 1 } },
    threeQueue: { ...defaults.threeQueue, criterionEnabled: false,
      initialCandidateCount: 2, coarseSimulationCount: 1, beamWidth: 1, beamRounds: 1,
      expansionsPerState: 2, refinementCandidateCount: 2, refinementSimulationCount: 1,
      finalCandidateCount: 1, finalValidationCount: 2,
      lockHeroes: [true, true, true] as const, lockRatios: [true, true, true] as const } };
}
function fakeExecute(jobs: EvaluationJob[]) {
  return (job: EvaluationJob): EvaluationJobResult => {
    jobs.push(job);
    const remaining = { A: { shield: 1, lancer: 0, marksman: 0 },
      B: { shield: 0, lancer: 0, marksman: 0 } };
    const outcome: FastBattleResult = { outcome: "A", winner: "A", failed: false,
      rounds: 1, roundCount: 1, remaining, aRemaining: remaining.A,
      bRemaining: remaining.B, winnerRemaining: remaining.A };
    return { samples: { trials: job.seeds.length, requestedTrials: job.seeds.length,
      wins: job.seeds.length, losses: 0, failedTrials: 0, pruned: false,
      outcomes: job.kind === "battle" ? job.seeds.map(() => outcome) : [] },
      performance: { ...emptyOptimizationPerformance(), simulatedTrials: job.seeds.length } };
  };
}

describe("Inner Earth optimizer dispatch and canonical application", () => {
  it.each(["BEAST_CAVE", "GEM_MINE", "UNDERGROUND_LAB", "EQUIPMENT_FORGE"] as const)(
    "%s evaluates every ratio numerically without generating heroes", (mode) => {
      const input = fixture(mode), before = structuredClone(input), jobs: EvaluationJob[] = [];
      const result = runOptimizationWorkflow(createInnerEarthOptimizationWorkflow(input, options()), fakeExecute(jobs));
      expect(result.kind).toBe("ratio");
      if (result.kind !== "ratio") throw new Error("ratio result required");
      expect(result.audit).toMatchObject({ heroSearchEnabled: false, ratioSearchEnabled: true,
        headMode: "EMPTY_HEAD", headTemplateCount: 1, ratioCount: 231,
        searchDimensions: ["ratio"], petAppliedToBaseStats: false, optimizationSide: "A" });
      expect(result.result.criterionAudit).toMatchObject({ legalHeads: 1,
        matrixEvaluations: 231, roundTheoryEvaluations: 231 });
      expect(result.result.searchIntegrityReport!.perStage[0]!.candidatesEntered).toBeLessThanOrEqual(31);
      expect(result.result.topCandidates.every((row) => row.trials === 1000)).toBe(true);
      expect(jobs.every((job) => job.side === "A" && job.kind === "battle" &&
        Object.values(job.input.sideA.leaderHeroIds ?? {}).every((hero) => !hero) &&
        Object.values(job.input.sideB.leaderHeroIds ?? {}).every((hero) => !hero))).toBe(true);
      expect(input).toEqual(before);
      const changed = applyInnerEarthCandidate(input, result, { leaderHeroIds: {},
        ratios: { shield: 20, lancer: 30, marksman: 50 } });
      expect(changed.innerEarth!.ally.counts).toEqual({ shield: 2000, lancer: 3000, marksman: 5000 });
      expect(changed.innerEarth!.ally.reportStats).toEqual(input.innerEarth!.ally.reportStats);
      expect(changed.innerEarth!.enemy).toEqual(input.innerEarth!.enemy);
      expect(changed.scenarioType).toBe("INNER_EARTH");
      expect(() => applyInnerEarthCandidate(input, result, { leaderHeroIds: { shield: "hero.s1.nataliya" },
        ratios: { shield: 20, lancer: 30, marksman: 50 } })).toThrow(/无英雄/);
    }, 20_000);

  it("keeps laboratory constants and skill policy through the ratio-search view", () => {
    const original = fixture("UNDERGROUND_LAB");
    const input = { ...original, innerEarth: { ...original.innerEarth!, ally: {
      ...original.innerEarth!.ally, troopTiers: { shield: "LAB_T11", lancer: "LAB_T12", marksman: "T10" },
      t12SkillLevels: { shield: 0, lancer: 3, marksman: 0 } } } };
    const state = createValidationPreviewState(innerEarthOptimizerInput(input));
    expect(state.sideA.troops.shield.troopConstant).toBe(8.8437);
    expect(state.sideA.troops.lancer.troopConstant).toBe(10.4356);
    expect(state.sideB.troops.lancer.levelComposition[0]!.level).toBe("T10");
    expect(state.sideA.troops.lancer.skillStates.some((skill) => skill.skillId.includes("t12"))).toBe(true);
    expect(state.sideA.troops.lancer.skillStates.some((skill) => /crystal|lightforged|crimson|flame-impact/.test(skill.skillId))).toBe(false);
  });

  it("hands generated laboratory candidates to the real fast battle executor", () => {
    const original = fixture("UNDERGROUND_LAB");
    const input = { ...original, innerEarth: { ...original.innerEarth!, ally: {
      ...original.innerEarth!.ally, troopTiers: { shield: "LAB_T11", lancer: "LAB_T12", marksman: "T10" },
      t12SkillLevels: { shield: 0, lancer: 3, marksman: 0 } } } };
    const first = createInnerEarthOptimizationWorkflow(input, options()).next();
    if (first.done || first.value[0] === undefined) throw new Error("formal candidate required");
    const job = first.value[0];
    expect(job.input.innerEarth!.ally.troopTiers.lancer).toBe("LAB_T12");
    const result = createEvaluationExecutor()({ ...job, seeds: job.seeds.slice(0, 1), collectOutcomes: true });
    expect(result.samples.trials).toBe(1);
    expect(result.samples.failedTrials).toBe(0);
    expect(result.samples.outcomes).toHaveLength(1);
    expect(result.samples.outcomes[0]!.roundCount).toBeLessThanOrEqual(2);
  });

  it("evaluates pet combat modifiers independently of three base attribute inputs", () => {
    const original = fixture("HEART_OF_EARTH");
    const queues = original.innerEarth!.ally.queues.map((queue, index) => ({ ...queue,
      expectedReportStats: Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
        { ...queue.expectedReportStats[troop], attack: 1000 + index * 200 }])) as typeof queue.expectedReportStats,
    })) as unknown as NonNullable<typeof original.innerEarth>["ally"]["queues"];
    const input = normalizeInnerEarthInput({ ...original, innerEarth: { ...original.innerEarth!,
      ally: { ...original.innerEarth!.ally, queues }, petContext: {
        ...original.innerEarth!.petContext!, attackLevel: 10 } } });
    const before = structuredClone(input), jobs: EvaluationJob[] = [];
    const result = runOptimizationWorkflow(createInnerEarthOptimizationWorkflow(input, options()), fakeExecute(jobs));
    expect(result.kind).toBe("threeQueue");
    expect(result.audit).toMatchObject({ schedulerType: "RandomAliveQueueScheduler",
      searchDimensions: ["head", "ratio"], petAppliedToBaseStats: false, petAppliedToOptimization: true });
    expect(jobs.every((job) => job.kind === "threeQueue" &&
      job.input.sideA.threeQueues!.every((queue) => queue.externalBuffs!.pet.attackLevel === 10))).toBe(true);
    const withPet = innerEarthOptimizerInput(input);
    const withoutPet = { ...materializeInnerEarthInput(input, { applyPetModifier: false }), scenarioType: "THREE_QUEUE" as const };
    const own = currentCriterionQueueState(withPet, "A"), enemy = currentCriterionQueueState(withPet, "B");
    const petScore = createCriterionThreeQueueEvaluator(withPet).matchup(own.queues[0], enemy.queues[0], 0, 0).margin;
    const nakedScore = createCriterionThreeQueueEvaluator(withoutPet).matchup(own.queues[0], enemy.queues[0], 0, 0).margin;
    expect(petScore).toBeGreaterThan(nakedScore);
    expect(input).toEqual(before);
    if (result.kind !== "threeQueue") throw new Error("three-queue result required");
    const changed = applyInnerEarthCandidate(input, result, { queues: result.result.current.candidate.queues.map((queue) => ({
      ...queue, ratiosBp: { shield: 2000, lancer: 3000, marksman: 5000 } })) as unknown as typeof result.result.current.candidate.queues });
    expect(changed.innerEarth!.ally.queues.map((queue) => queue.expectedReportStats)).toEqual(queues.map((queue) => queue.expectedReportStats));
    expect(changed.innerEarth!.petContext).toEqual(input.innerEarth!.petContext);
    expect(changed.innerEarth!.enemy).toEqual(input.innerEarth!.enemy);
  });

  it("searches hero heads from an initially empty Heart lineup", () => {
    const original = fixture("HEART_OF_EARTH");
    const ids = getValidationCatalog().leaderHeroes.filter((hero) =>
      [9, 10, 11].includes(hero.generation ?? 0)).map((hero) => hero.heroId);
    const input = { ...original, ownedHeroIds: ids, availableHeroIds: ids,
      optimizerHeroPool: { A: Object.fromEntries(ids.map((id) => [id, { enabled: true, weaponLevel: 10 }])), B: {} } };
    const settings = options(), jobs: EvaluationJob[] = [];
    const result = runOptimizationWorkflow(createInnerEarthOptimizationWorkflow(input, { ...settings,
      threeQueue: { ...settings.threeQueue, lockHeroes: [false, false, false] } }), fakeExecute(jobs));
    expect(jobs.some((job) => job.input.sideA.threeQueues!.every((queue) =>
      TROOP_TYPES.every((troop) => !!queue.leaderHeroIds[troop])))).toBe(true);
    expect(input.innerEarth!.ally.queues.every((queue) => Object.values(queue.heroes).every((id) => !id))).toBe(true);
    if (result.kind !== "threeQueue") throw new Error("three-queue result required");
    const generated = jobs.find((job) => job.input.sideA.threeQueues!.every((queue) =>
      TROOP_TYPES.every((troop) => !!queue.leaderHeroIds[troop])))!;
    const candidate = { queues: generated.input.sideA.threeQueues!.map((queue) => ({
      leaderHeroIds: queue.leaderHeroIds, headWeaponLevels: queue.weaponLevels ?? {},
      ratiosBp: { shield: 2000, lancer: 3000, marksman: 5000 } })) as unknown as
        typeof result.result.current.candidate.queues };
    const applied = applyInnerEarthCandidate(input, result, candidate);
    expect(applied.innerEarth!.ally.queues.map((queue) => queue.heroes)).toEqual(candidate.queues.map((queue) => queue.leaderHeroIds));
    expect(applied.innerEarth!.ally.queues.map((queue) => queue.reportHeroes)).toEqual(input.innerEarth!.ally.queues.map((queue) => queue.reportHeroes));
    expect(applied.innerEarth!.ally.queues.map((queue) => queue.expectedReportStats)).toEqual(input.innerEarth!.ally.queues.map((queue) => queue.expectedReportStats));
    expect(applied.innerEarth!.enemy).toEqual(input.innerEarth!.enemy);
  });

  it("preserves exact preset counts in Criterion rather than rounded displayed ratios", () => {
    const original = fixture("HERO_LAND");
    const input = normalizeInnerEarthInput({ ...original, innerEarth: { ...original.innerEarth!, enemy: {
      ...original.innerEarth!.enemy, shared: { ...original.innerEarth!.enemy.shared, capacity: 150000 } } } });
    const prepared = innerEarthOptimizerInput(input), own = currentCriterionQueueState(prepared, "A"), enemy = currentCriterionQueueState(prepared, "B");
    const result = createCriterionThreeQueueEvaluator(prepared).run(own, enemy, 51);
    expect(result.battles[0]!.beforeB).toEqual([50000, 50000, 50000]);
  });
});
