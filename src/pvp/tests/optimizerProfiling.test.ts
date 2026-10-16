import { withoutOptimizerTimings } from "./fixtures/optimizerTiming";
import { describe, expect, it, vi } from "vitest";
import { OptimizerProfiler, stageEta, stopPerformanceReport, profileOptimizationWorkflow,
  defaultOptimizationConfig, runRallyOptimization, runRallyOptimizationAsync,
  createEvaluationExecutor, defaultSimpleScenarioOptimizationOptions, optimizeSimpleScenario,
  defaultThreeQueueOptimizationOptions, optimizeThreeQueueScenario,
  type OptimizationProgress, type OptimizationWorkflow, type SearchPerformanceReport } from "../../pvp";
import { optimizerProgressText, renderOptimizerPerformance } from "../../ui/optimizerPerformanceView";
import { rallyHeadSearchFixture, OPPONENT_HEAD } from "./fixtures/rallyHeadSearch";
import { createDefaultValidationInput } from "../../ui/defaultInput";

const quickConfig = () => ({ ...defaultOptimizationConfig(91), objectiveMode: "singleWin" as const,
  constraints: { fixedLeaders: OPPONENT_HEAD, fixedBodyExact: true, fixedMemberSkillIds: [] },
  monteCarloStages: [{ trials: 1, keep: 4 }, { trials: 2, keep: 3 },
    { trials: 3, keep: 2 }, { trials: 4, keep: 1 }],
  basinSearch: { maxBasins: 1, maxClimbRounds: 1, fineBasins: 1, fineRadius: 1 },
  verificationTrials: 5, verificationTop: 1, topN: 2 });
function validReport(report: SearchPerformanceReport) {
  expect(report.status).toBe("completed");
  for (const row of report.stages) {
    expect(row.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(row.completed).toBeLessThanOrEqual(row.total);
    expect(row.finishedAt).not.toBeNull(); expect(row.status).toBe("completed");
    expect(row.finishedAt!).toBeGreaterThanOrEqual(row.startedAt);
  }
  expect(report.stages.reduce((sum, row) => sum + row.elapsedMs, 0)).toBeLessThanOrEqual(report.totalElapsedMs + 1e-6);
  expect(report.overallAvgBattleMs).toBe(report.totalBattleEngineCalls ? report.totalBattleElapsedMs / report.totalBattleEngineCalls : null);
}
describe("optimizer internal stage profiling", () => {
  it("uses monotonic offsets and exclusive nested time; throttles frequent progress", () => {
    let clock = 100; const progress = vi.fn();
    const profiler = new OptimizerProfiler(progress, () => clock);
    profiler.begin("generation", 1); clock += 10;
    profiler.measure("filter", 3, () => { clock += 20; }); clock += 30;
    profiler.end(); profiler.begin("M1", 4);
    for (let i = 0; i < 50; i++) { clock += 1; profiler.progress({ stage: "M1", completed: 1, total: 4 }); }
    expect(progress.mock.calls.length).toBeLessThan(10);
    profiler.end(); const report = profiler.finish(); validReport(report);
    expect(report.totalElapsedMs).toBe(110);
    expect(report.stages.map((row) => row.elapsedMs)).toEqual([40, 20, 50]);
    expect(report.unaccountedElapsedMs).toBe(0);
  });
  it("does not invent ETA at zero completion", () => {
    expect(stageEta(100, 0, 100)).toBeNull(); expect(stageEta(100, 2, 4)).toBe(100);
    const profiler = new OptimizerProfiler(); profiler.begin("M1", 10);
    const report = profiler.snapshot(); expect(report.stages[0]!.estimatedRemainingMs).toBeNull();
    expect(optimizerProgressText({ stage: "M1", completed: 0, total: 10 }, report)).toContain("估算中");
    expect(JSON.stringify(report)).not.toMatch(/Infinity|NaN/);
  });
  it("uses only missing queue trajectories for ETA and keeps formal duel counts separate",()=>{
    let clock=0;const profiler=new OptimizerProfiler(undefined,()=>clock);profiler.begin("queue",3);
    profiler.reuseBattles(10);profiler.setExecutionWorkload(4,true,"trajectory");clock=1000;
    profiler.recordRows([{timing:{battleCount:10,battleElapsedMs:900},samples:{trials:2,requestedTrials:2,wins:2,losses:0,failedTrials:0,pruned:false,outcomes:[]},performance:{simulatedTrials:2,skippedTrials:0,prunedCandidates:0,templateBuilds:1,templateHits:0}}]);
    const row=profiler.snapshot().stages[0]!;
    expect(row.completed).toBe(2);expect(row.total).toBe(4);expect(row.executedBattles).toBe(10);expect(row.reusedBattles).toBe(10);
    expect(row.estimatedRemainingMs).toBe(1000);
    expect(renderOptimizerPerformance(profiler.snapshot())).toContain("条轨迹/s");
    profiler.setExecutionWorkload(4,false,"trajectory");expect(profiler.snapshot().stages[0]!.estimatedRemainingMs).toBeNull();
    const finished=profiler.finish().stages[0]!;
    expect(finished.completed).toBe(2);expect(finished.total).toBe(2);expect(finished.executedCount).toBe(2);
  });
  it("keeps real fixed-seed rally candidates, sample counts and full diagnostics identical", () => {
    const config = quickConfig();
    const baseline = runRallyOptimization({ ...rallyHeadSearchFixture(), maxRounds: 1 }, config);
    const observed = runRallyOptimization({ ...rallyHeadSearchFixture(), maxRounds: 1 }, { ...config, profiling: true });
    const { searchPerformanceReport, ...withoutTiming } = observed;
    const stripStageElapsed = (value: typeof baseline) => ({ ...value, searchDiagnostics: { ...value.searchDiagnostics,
      criterionAudit: value.searchDiagnostics?.criterionAudit ? {...value.searchDiagnostics.criterionAudit,
        headGenerationTime:0,headRatioCriterionTime:0,bodyPreprocessTime:0,bodyRoughScanTime:0,matrixCriterionTime:0,deterministicTheoryTime:0,battleEngineTime:0,totalWallTime:0} : undefined,
      searchIntegrityReport: value.searchDiagnostics?.searchIntegrityReport === undefined ? undefined : {
        ...value.searchDiagnostics.searchIntegrityReport,
        perStage: value.searchDiagnostics.searchIntegrityReport.perStage.map((row) => ({ ...row, elapsedMs: 0 })) } } });
    expect(withoutOptimizerTimings(stripStageElapsed(withoutTiming))).toEqual(withoutOptimizerTimings(stripStageElapsed(baseline))); validReport(searchPerformanceReport!);
    expect(searchPerformanceReport!.totalBattleEngineCalls).toBe(observed.performance.simulatedTrials);
    expect(searchPerformanceReport!.executedBattles).toBe(searchPerformanceReport!.totalBattleEngineCalls);
    expect(searchPerformanceReport!.requestedBattles).toBe(searchPerformanceReport!.executedBattles + searchPerformanceReport!.reusedBattles);
    expect(searchPerformanceReport!.cacheHitCount).toBe(searchPerformanceReport!.reusedBattles);
    expect(searchPerformanceReport!.cacheHitRate).toBeGreaterThan(0);
    const names = searchPerformanceReport!.stages.map((row) => row.stage);
    for (const prefix of ["H0", "B0", "J Preparation", "J Peak", "Recall Merge", "Criterion", "Theory", "Formal", "Final"])
      expect(names.some((name) => name.startsWith(prefix))).toBe(true);
    expect(observed.searchDimensionAudit?.headSearchEnabled).toBe(false);
    expect(names.some((name) => name.startsWith("英雄目录") || name.startsWith("严格支配"))).toBe(false);
    expect(names.some((name) => name.includes("1%"))).toBe(
      (observed.searchDiagnostics?.searchIntegrityReport?.fineSearch.basin1PercentEntered ?? 0) > 0);
  }, 20_000);
  it("profiles Single/333 without changing their fixed-seed ranking", () => {
    const base = createDefaultValidationInput();
    const input = { ...base, scenarioType: "THREE_THREE_THREE" as const, maxRounds: 4,
      sideA: { ...base.sideA, leaderHeroIds: OPPONENT_HEAD }, sideB: { ...base.sideB, leaderHeroIds: OPPONENT_HEAD } };
    const options = { ...defaultSimpleScenarioOptimizationOptions(91), fixedHeroes: true,
      fixedRatio: true, monteCarloStages: [{ trials: 1, keep: 1 }], verificationTrials: 2 };
    const baseline = optimizeSimpleScenario(input, options);
    const { searchPerformanceReport, ...observed } = optimizeSimpleScenario(input, { ...options, profiling: true });
    const stripTiming = (value: typeof baseline) => ({ ...value, searchIntegrityReport: value.searchIntegrityReport && {
      ...value.searchIntegrityReport, perStage: value.searchIntegrityReport.perStage.map((row) => ({ ...row, elapsedMs: 0 })) } });
    expect(stripTiming(observed)).toEqual(stripTiming(baseline)); validReport(searchPerformanceReport!);
    expect(searchPerformanceReport!.totalBattleEngineCalls).toBe(observed.performance.simulatedTrials);
  });
  it("counts real three-queue duels, including unresolved duels, rather than queue trajectories", () => {
    const base = createDefaultValidationInput();
    const input = { ...base, scenarioType: "THREE_QUEUE" as const,
      attributeInputMode: "prediction" as const, maxRounds: 1 };
    const result = createEvaluationExecutor()({ kind: "threeQueue", input, seeds: [91, 92], side: "A", profiling: true });
    expect(result.timing!.battleCount).toBeGreaterThanOrEqual(result.samples.trials);
    expect(result.timing!.battleElapsedMs).toBeGreaterThanOrEqual(0);
    const options = { ...defaultThreeQueueOptimizationOptions(91), beamRounds: 1,
      coarseSimulationCount: 1, refinementSimulationCount: 1, finalValidationCount: 1,
      lockHeroes: [true, true, true] as const, lockRatios: [true, true, true] as const };
    const baseline = optimizeThreeQueueScenario(input, options);
    const { searchPerformanceReport, ...observed } = optimizeThreeQueueScenario(input, { ...options, profiling: true });
    expect(observed).toEqual(baseline); validReport(searchPerformanceReport!);
  });
  it("counts only actual multi-wave calls when the enemy has already been defeated", () => {
    const input = rallyHeadSearchFixture();
    const candidate = { leaderHeroIds: OPPONENT_HEAD, memberSkillIds: [], ratios: { shield: 50, lancer: 20, marksman: 30 } };
    const result = createEvaluationExecutor()({ kind: "multiWave", input, seeds: [91], side: "A", profiling: true,
      sequence: [candidate, candidate, candidate], initialEnemy: { shield: 1, lancer: 0, marksman: 0 }, targetProbability: .9 });
    expect(result.timing!.battleCount).toBe(1);
  });
  it("retains completed records and marks current stage on async executor failure", async () => {
    const events: OptimizationProgress[] = [];
    await expect(runRallyOptimizationAsync(rallyHeadSearchFixture(), { ...quickConfig(), profiling: true },
      async () => { throw new Error("test executor failure"); }, (progress) => events.push(progress)))
      .rejects.toThrow("test executor failure");
    const report = events.at(-1)!.performanceReport!;
    expect(report.status).toBe("error");
    expect(report.stages.find((row) => row.stage.startsWith("J Peak"))!.status).toBe("error");
    expect(report.stages.find((row) => row.stage.startsWith("H0"))!.status).toBe("completed");
    expect(renderOptimizerPerformance(report)).toContain("复制性能报告 JSON");
  });
  it("handles generator cancellation and coordinator termination without clearing prior timings", () => {
    let clock = 0; const events: OptimizationProgress[] = [];
    const profiler = new OptimizerProfiler((progress) => events.push(progress), () => clock);
    function* workflow(): OptimizationWorkflow<object> {
      profiler.begin("generation", 1); clock += 10; profiler.end(); profiler.begin("M1", 2);
      yield []; return {};
    }
    const observed = profileOptimizationWorkflow(workflow(), profiler); observed.next(); clock += 20;
    observed.return({});
    const report = events.at(-1)!.performanceReport!;
    expect(report.status).toBe("cancelled");
    expect(report.stages[0]!.status).toBe("completed"); expect(report.stages[1]!.status).toBe("cancelled");
    const next = new OptimizerProfiler(); next.begin("M1", 2);
    const stopped = stopPerformanceReport(next.snapshot(), "cancelled", 250);
    expect(stopped.totalElapsedMs).toBe(250); expect(stopped.stages[0]!.finishedAt).toBe(250);
    expect(stopped.totalBattleEngineCalls).toBe(0);
  });
});
