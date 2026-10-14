import { describe, expect, it, vi } from "vitest";
import {
  cloneBattleTemplate, compileValidationBattle, createEvaluationExecutor, createValidationBattleCompiler,
  createPureTroopBattleState, createStageSeeds, defaultOptimizationConfig,
  defaultSimpleScenarioOptimizationOptions, defaultThreeQueueOptimizationOptions,
  getValidationCatalog, optimizeSimpleScenario, optimizeSimpleScenarioAsync,
  optimizeThreeQueueScenario, optimizeThreeQueueScenarioAsync,
  runRallyOptimization, runRallyOptimizationAsync, runThreeQueueScenario,
  runValidationBattleCore, sanitizeConfigForStage, shouldEliminate,
  toEngineScenario, toValidationThreeQueueConfig, type BattleState,
  type EvaluationJob, type EvaluationJobResult, type ValidationBattleInput,
} from "../../pvp";
import { compileFastThreeQueue } from "../optimizer/fastTemplates";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { createOptimizerWorkerPool } from "../../ui/optimizerWorkerPool";

function remaining(state: BattleState) {
  const counts = (side: BattleState["sideA"]) => ({ shield: side.troops.shield.aliveCount,
    lancer: side.troops.lancer.aliveCount, marksman: side.troops.marksman.aliveCount });
  return { A: counts(state.sideA), B: counts(state.sideB) };
}

describe("optimizer fast execution", () => {
  it.each([0, 8, 11])("preserves seeded results with generation %i heroes and T12/mixed troops", (generation) => {
    const base = createDefaultValidationInput();
    const lineup = Object.fromEntries(getValidationCatalog().leaderHeroes
      .filter((hero) => hero.generation === generation)
      .map((hero) => [hero.troopType, hero.heroId]));
    const input: ValidationBattleInput = { ...base, scenarioType: "SINGLE", maxRounds: 8,
      sideA: { ...base.sideA, leaderHeroIds: lineup,
        troops: { ...base.sideA.troops,
          shield: { ...base.sideA.troops.shield, troopLevel: "T12-FC10", t12Level: 5 },
          lancer: { ...base.sideA.troops.lancer, levelMode: "mixed", troopLevel: "T11-FC10",
            levelComposition: [{ level: "T10-FC8", aliveCount: 4_000 },
              { level: "T11-FC10", aliveCount: 8_000 }] } } },
      sideB: { ...base.sideB, leaderHeroIds: lineup } };
    const compiled = compileValidationBattle(input);
    const before = structuredClone(compiled.initialState);
    for (const seed of [0, 42, 12345]) {
      const full = runValidationBattleCore({ ...input, randomSeed: seed }).simulation;
      const fast = compiled.runFastTrial(seed);
      expect(fast.remaining).toEqual(remaining(full.finalState));
      expect(fast.roundCount).toBe(full.rounds.length);
      const totals = { A: Object.values(fast.remaining.A).reduce((a, b) => a + b, 0),
        B: Object.values(fast.remaining.B).reduce((a, b) => a + b, 0) };
      expect(fast.outcome).toBe(full.endReason === "roundLimit" ? "timeout"
        : totals.A === totals.B ? "draw" : totals.A > totals.B ? "A" : "B");
      expect(fast).toMatchObject({ rounds: full.rounds.length,
        aRemaining: fast.remaining.A, bRemaining: fast.remaining.B,
        failed: fast.outcome === "timeout" || fast.outcome === "draw" });
      expect("trace" in fast).toBe(false);
      expect(compiled.runFastTrial(seed)).toEqual(fast);
    }
    expect(compiled.initialState).toEqual(before);
    const copy = cloneBattleTemplate(compiled.initialState);
    expect(copy.sideA.troops.shield).not.toBe(compiled.initialState.sideA.troops.shield);
    expect(copy.sideA.troops.shield.skillStates).not.toBe(compiled.initialState.sideA.troops.shield.skillStates);
    if (copy.sideA.heroStates.length > 0) {
      expect(copy.sideA.heroStates[0]!.skillStates[0]!.mainAttackCounts)
        .not.toBe(compiled.initialState.sideA.heroStates[0]!.skillStates[0]!.mainAttackCounts);
    }
  });

  it("rebases fresh-wave populations exactly like a newly constructed battle", () => {
    const base = createDefaultValidationInput();
    const input = { ...base, maxRounds: 3, battleContext: "rally" as const,
      sideB: { ...base.sideB, leaderHeroIds: { shield: "hero.s8.jiatuo" },
        troops: { ...base.sideB.troops, shield: { ...base.sideB.troops.shield,
          levelMode: "mixed" as const, levelComposition: [
            { level: "T10-FC8", aliveCount: 6_000 }, { level: "T11-FC10", aliveCount: 6_000 } ] } } } };
    const compiled = compileValidationBattle(input);
    const scenario = toEngineScenario(input);
    for (const counts of [{ shield: 200, lancer: 80, marksman: 10 },
      { shield: 0, lancer: 100, marksman: 0 }]) {
      const sideB = { ...scenario.sideB,
        ...Object.fromEntries((["shield", "lancer", "marksman"] as const).map((troop) =>
          [troop, { ...scenario.sideB[troop], count: counts[troop],
            levelComposition: [{ level: scenario.sideB[troop].troopLevel, aliveCount: counts[troop] }] }])) };
      const fresh = compiled.createFreshState(counts);
      expect(fresh).toEqual(createPureTroopBattleState({ ...scenario, sideB }));
      expect(fresh.sideA.heroStates).not.toBe(compiled.initialState.sideA.heroStates);
      expect(compiled.runFastFreshTrial(10, counts).remaining)
        .toEqual(remaining(compiled.runFreshTrial(10, counts).finalState));
    }
  });

  it.each([0, 8])("uses the identical three-queue scheduler without traces (generation %i)", (generation) => {
    const base = createDefaultValidationInput();
    const lineup = Object.fromEntries(getValidationCatalog().leaderHeroes
      .filter((hero) => hero.generation === generation).map((hero) => [hero.troopType, hero.heroId]));
    const input: ValidationBattleInput = { ...base, scenarioType: "THREE_QUEUE",
      attributeInputMode: "prediction", maxRounds: 300,
      sideA: { ...base.sideA, deploymentCapacity: 60,
        threeQueues: base.sideA.threeQueues!.map((queue, index) => ({ ...queue,
          leaderHeroIds: index === 0 ? lineup : {} })) as
          unknown as NonNullable<typeof base.sideA.threeQueues> },
      sideB: { ...base.sideB, deploymentCapacity: 60 } };
    const config = toValidationThreeQueueConfig(input);
    const fast = compileFastThreeQueue(config);
    for (const seed of [1, 17, 42]) {
      const full = runThreeQueueScenario({ ...config, seed });
      const actual = fast.run(seed);
      expect(actual.winner).toBe(full.winner);
      expect(actual.totalBattles).toBe(full.totalBattles);
      expect(actual.roundCount).toBe(full.battleResults.reduce((sum, battle) => sum + battle.battle.simulation.rounds.length, 0));
      for (const side of ["A", "B"] as const) {
        const queues = side === "A" ? full.remainingAttackerQueues : full.remainingDefenderQueues;
        for (const troop of ["shield", "lancer", "marksman"] as const) {
          expect(actual.remaining[side][troop]).toBe(queues.reduce((sum, queue) => sum + queue.survivors[troop], 0));
        }
      }
      expect("scenarioTrace" in actual).toBe(false);
      expect("battleResults" in actual).toBe(false);
    }
    expect(fast.pairs.builds).toBeLessThanOrEqual(9);
    expect(fast.pairs.hits).toBeGreaterThan(0);
  });

  it("reuses templates across seed sets and invalidates them when attributes change", () => {
    const input = { ...createDefaultValidationInput(), maxRounds: 1 };
    const execute = createEvaluationExecutor();
    const job: EvaluationJob = { kind: "battle", input, side: "A", seeds: [1] };
    expect(execute(job).performance.templateBuilds).toBe(1);
    expect(execute({ ...job, seeds: [2, 3] }).performance.templateHits).toBe(1);
    const changed = { ...input, sideA: { ...input.sideA, troops: { ...input.sideA.troops,
      shield: { ...input.sideA.troops.shield, attack: 1200 } } } };
    expect(execute({ ...job, input: changed }).performance.templateBuilds).toBe(1);
    const compile = createValidationBattleCompiler();
    const first = compile(input);
    const second = compile(changed);
    const expected = first.runFastTrial(17);
    second.runFastTrial(101);
    expect(first.runFastTrial(17)).toEqual(expected);
    const disabled = compile({ ...input, disabledSkillIds: ["lancer-ambush"] });
    expect(first.initialState.sideA.troops.lancer.skillStates.some((skill) =>
      skill.skillId === "lancer-ambush")).toBe(true);
    expect(disabled.initialState.sideA.troops.lancer.skillStates.some((skill) =>
      skill.skillId === "lancer-ambush")).toBe(false);
    disabled.runFastTrial(17);
    expect(first.runFastTrial(17)).toEqual(expected);
  });

  it("only prunes statistically separated candidates and keeps actual sample counts", () => {
    const reference = { wins: 200, trials: 200 };
    const policy = { reference, maxTrials: 200, comparisons: 100 };
    expect(shouldEliminate({ wins: 0, trials: 10 }, policy)).toBe(false);
    expect(shouldEliminate({ wins: 0, trials: 20 }, policy)).toBe(true);
    expect(shouldEliminate({ wins: 19, trials: 20 }, policy)).toBe(false);
    expect(shouldEliminate({ wins: 0, trials: 200 }, policy)).toBe(false);
    const input = { ...createDefaultValidationInput(), maxRounds: 1 };
    const execute = createEvaluationExecutor();
    const job: EvaluationJob = { kind: "battle", input, side: "A",
      seeds: createStageSeeds(1, 200), pruning: policy };
    const stopped = execute(job);
    expect(stopped.samples.pruned).toBe(true);
    expect(stopped.samples.trials).toBe(20);
    expect(stopped.performance.skippedTrials).toBe(180);
    const complete = execute({ kind: "battle", input, side: "A", seeds: job.seeds });
    expect(complete.samples.trials).toBe(200);
    expect(complete.samples.pruned).toBe(false);
  });

  it("returns the same seeded rankings through sync and asynchronous execution", async () => {
    const input = { ...sanitizeConfigForStage(createDefaultValidationInput(), "s1_t10").input,
      scenarioType: "THREE_THREE_THREE" as const, maxRounds: 1 };
    const options = { ...defaultSimpleScenarioOptimizationOptions(42), coarseTrials: 2,
      middleTrials: 2, verificationTrials: 3, topN: 2 };
    const execute = createEvaluationExecutor();
    const asyncResult = await optimizeSimpleScenarioAsync(input, options,
      (jobs) => Promise.all(jobs.map(async (job) => execute(job))));
    expect(asyncResult).toEqual(optimizeSimpleScenario(input, options));
    expect(asyncResult.current.trials).toBe(3);
    expect(asyncResult.topCandidates.every((row) => row.trials === 3)).toBe(true);
    const rally = { ...input, scenarioType: "RALLY" as const, battleContext: "rally" as const };
    const recentHead = Object.fromEntries(getValidationCatalog().leaderHeroes.filter((hero) => hero.generation === 1)
      .map((hero) => [hero.troopType, hero.heroId]));
    const config = { ...defaultOptimizationConfig(2), objectiveMode: "singleWin" as const,
      constraints: { fixedLeaders: recentHead, fixedBodyExact: true, fixedMemberSkillIds: [] },
      monteCarloStages: [{ trials: 1, keep: 2 }],
      stages: [{ ratioStep: 5, trials: 1, keep: 2, maxCandidates: 231 },
        { ratioStep: 2, trials: 1, keep: 2, maxCandidates: 4 },
        { ratioStep: 1, trials: 1, keep: 2, maxCandidates: 4 }] as const,
      verificationTrials: 2, verificationTop: 2, topN: 2 };
    const rallyExecute = createEvaluationExecutor();
    const asyncRally = await runRallyOptimizationAsync(rally, config,
      (jobs) => Promise.all(jobs.map(async (job) => rallyExecute(job))));
    expect(asyncRally).toEqual(runRallyOptimization(rally, config));
    const multiConfig = { ...config, objectiveMode: "minRallies" as const,
      maxWaves: 2, beamTrials: 2, beamWidth: 2, branchWidth: 2 };
    const multiExecute = createEvaluationExecutor();
    const asyncMulti = await runRallyOptimizationAsync(rally, multiConfig,
      (jobs) => Promise.all(jobs.map(async (job) => multiExecute(job))));
    expect(asyncMulti).toEqual(runRallyOptimization(rally, multiConfig));
    expect(asyncMulti.multiWaveTop.every((row) => row.trials === config.verificationTrials)).toBe(true);
    const threeQueue = { ...input, scenarioType: "THREE_QUEUE" as const,
      attributeInputMode: "prediction" as const };
    const queueOptions = { ...defaultThreeQueueOptimizationOptions(42),
      lockHeroes: [true, true, true] as const, lockRatios: [true, true, true] as const,
      coarseSimulationCount: 1, refinementSimulationCount: 1, finalValidationCount: 2 };
    const queueExecute = createEvaluationExecutor();
    const asyncQueue = await optimizeThreeQueueScenarioAsync(threeQueue, queueOptions,
      (jobs) => Promise.all(jobs.map(async (job) => queueExecute(job))));
    expect(asyncQueue).toEqual(optimizeThreeQueueScenario(threeQueue, queueOptions));
  }, 15_000);

  it("keeps default search samples bounded and final verification at 1000", () => {
    const simple = defaultSimpleScenarioOptimizationOptions(1);
    const queue = defaultThreeQueueOptimizationOptions(1);
    const rally = defaultOptimizationConfig(1);
    for (const value of [simple.coarseTrials, queue.coarseSimulationCount, rally.stages[0].trials]) {
      expect(value).toBeGreaterThanOrEqual(20); expect(value).toBeLessThanOrEqual(50);
    }
    for (const value of [simple.middleTrials, queue.refinementSimulationCount,
      rally.stages[2].trials]) {
      expect(value).toBeGreaterThanOrEqual(100); expect(value).toBeLessThanOrEqual(200);
    }
    expect([simple.verificationTrials, queue.finalValidationCount, rally.verificationTrials])
      .toEqual([1000, 1000, 1000]);
    expect([rally.initialBattleTrials, ...rally.stages.map((stage) => stage.trials)])
      .toEqual([5, 20, 50, 100]);
    expect(rally.criterion!.screeningTrials).toEqual([5, 20, 50, 100, 300]);
    expect(rally.criterion!.screeningKeep).toEqual([300, 80, 25, 10, 5]);
    expect([simple.initialBattleTrials, simple.intermediateTrials]).toEqual([10, 50]);
  });

  it("runs candidate jobs concurrently, restores submission order and closes worker resources", async () => {
    const instances: FakeWorker[] = [];
    let active = 0;
    let peak = 0;
    class FakeWorker {
      readonly execute = createEvaluationExecutor();
      onmessage: ((event: { data: { id: number; result: EvaluationJobResult } }) => void) | null = null;
      onerror: ((event: { message: string }) => void) | null = null;
      terminated = false;
      constructor() { instances.push(this); }
      postMessage(data: { id: number; job: EvaluationJob }) {
        active += 1; peak = Math.max(peak, active);
        setTimeout(() => {
          active -= 1;
          this.onmessage?.({ data: { id: data.id, result: this.execute(data.job) } });
        }, 4 - data.id % 4);
      }
      terminate() { this.terminated = true; }
    }
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 8 });
    try {
      const pool = createOptimizerWorkerPool();
      const input = { ...createDefaultValidationInput(), maxRounds: 1 };
      const jobs = Array.from({ length: 12 }, (_, index): EvaluationJob => ({ kind: "battle",
        input: { ...input, maxRounds: index % 2 + 1, randomSeed: 50,
          sideA: { ...input.sideA, troops: { ...input.sideA.troops,
            shield: { ...input.sideA.troops.shield, attack: 200 + index } } } },
        seeds: [index], side: "A", collectOutcomes: true }));
      const rows = await pool.run(jobs);
      expect(pool.workerCount).toBe(4);
      expect(peak).toBeGreaterThan(1);
      const sync = createEvaluationExecutor();
      expect(rows.map((row) => row.samples)).toEqual(jobs.map((job) => sync(job).samples));
      const reused = await pool.run([jobs[0]!]);
      expect(reused[0]!.performance.templateHits).toBe(1);
      pool.close();
      expect(instances.every((worker) => worker.terminated)).toBe(true);
      await expect(pool.run([jobs[0]!])).rejects.toThrow(/closed/);
    } finally { vi.unstubAllGlobals(); }
  });
});
