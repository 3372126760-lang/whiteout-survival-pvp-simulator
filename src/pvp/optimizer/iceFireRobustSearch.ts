import { TROOP_TYPES } from "../types/combat";
import { threeQueueSchedulerType } from "../scenario/threeQueueScheduler";
import type { ValidationBattleInput } from "../validationUi/types";
import { toValidationThreeQueueConfig } from "../validationUi/adapter";
import { iceFireQueueConversionAudit } from "../validationUi/iceFireAudit";
import { iceFireExpertSkillAudit } from "../validationUi/iceFireContext";
import { threeQueueCandidateInput, threeQueueCandidateKey, threeQueueEvaluationKey, type ThreeQueueCandidateEvaluation,
  type ThreeQueueOptimizationOptions, type ThreeQueueOptimizationResult, type ThreeQueueOptimizationState } from "./threeQueueOptimizer";
import { enemyQueueOrders, permutationMetrics, comparePermutationMetrics, permuteIceFireInput } from "./iceFirePermutations";
import { formalSampleSchedule, type FormalRacingStage } from "./queueRacing";
import { TrajectorySampleAccumulator, summarizeTrajectoryScheduler } from "./trajectorySamples";
import { addOptimizationPerformance, emptyOptimizationPerformance, threeQueueStageSeeds,
  type OptimizationWorkflow, type EvaluationJob } from "./execution";
import type { generateCriterionQueueSeeds } from "./criterion/queueSearch";
import type { HeroPoolAudit } from "./heroSearchPolicy";
import type { OptimizationProgress } from "./types";
import type { OptimizerProfiler } from "./profiling";

const tupleKey = (candidate: ThreeQueueOptimizationState, orderIndex: number) => `${threeQueueCandidateKey(candidate)}::enemy-order-${orderIndex}`;
/** Same formal scheduler and engine for every order; only initial complete queues move. */
export function* iceFireRobustSearch(input: ValidationBattleInput, current: ThreeQueueOptimizationState,
  seeds: ReturnType<typeof generateCriterionQueueSeeds>, options: ThreeQueueOptimizationOptions,
  heroPoolAudit: HeroPoolAudit, onProgress?: (progress: OptimizationProgress) => void,
  profiler?: OptimizerProfiler): OptimizationWorkflow<ThreeQueueOptimizationResult> {
  const mode = options.enemyPermutationMode ?? "allPermutations", orders = enemyQueueOrders(mode);
  const enemySide = options.side === "A" ? "B" : "A", baselineKey = threeQueueCandidateKey(current);
  const unique = (candidates: readonly ThreeQueueOptimizationState[]) => [...new Map(candidates.map((c) => [threeQueueCandidateKey(c), c])).values()];
  let candidates = unique([current, ...seeds.candidates]);
  const converted = new Map<string, ValidationBattleInput>();
  const evaluationKeys = new Map<string, string>();
  for (const candidate of candidates) {
    const key = threeQueueCandidateKey(candidate), candidateInput = key === baselineKey ? input : threeQueueCandidateInput(input, options.side, candidate);
    try { toValidationThreeQueueConfig(candidateInput); converted.set(key, candidateInput);
      evaluationKeys.set(key, threeQueueEvaluationKey(input, options.side, candidate)); }
    catch (error) { if (key === baselineKey || !(error instanceof RangeError)) throw error; }
  }
  candidates = candidates.filter((candidate) => converted.has(threeQueueCandidateKey(candidate)));
  const samples = new Map<string, TrajectorySampleAccumulator>(), schedule = formalSampleSchedule(options);
  const sharedSeeds = threeQueueStageSeeds(options.rootSeed, options.finalValidationCount);
  const evidence = new Map(seeds.evidence.map((row) => [threeQueueCandidateKey(row.candidate), row]));
  const searched = new Set<string>(), formalStages: FormalRacingStage[] = [];
  const keeps = options.formalStageKeeps ?? [80, 25, 10, options.finalCandidateCount];
  let rows: ThreeQueueCandidateEvaluation[] = [], cacheHits = 0, performance = emptyOptimizationPerformance();
  const accumulator = (candidate: ThreeQueueOptimizationState, orderIndex: number) => {
    const key = `${evaluationKeys.get(threeQueueCandidateKey(candidate))}::enemy-order-${orders[orderIndex]!.join()}`;
    let acc = samples.get(key);
    if (!acc) { acc = new TrajectorySampleAccumulator(options.side); samples.set(key, acc); }
    return acc;
  };
  const rowFor = (candidate: ThreeQueueOptimizationState): ThreeQueueCandidateEvaluation => {
    const list = orders.map((order, index) => {
      const acc = accumulator(candidate, index);
      return { order, trials: acc.trials, wins: acc.wins, failedTrials: acc.failedTrials, winRate: acc.wins / Math.max(1, acc.trials) };
    });
    const metrics = permutationMetrics(list);
    const trials = list.reduce((sum, row) => sum + row.trials, 0), wins = list.reduce((sum, row) => sum + row.wins, 0);
    const failedTrials = list.reduce((sum, row) => sum + row.failedTrials, 0);
    return { candidate, trials, wins, losses: trials - wins - failedTrials, failedTrials, validTrials: trials - failedTrials,
      winRate: metrics.worstPermutationWinRate, permutationAudit: metrics,
      ...(threeQueueCandidateKey(candidate) === baselineKey ? { isCurrent: true } : {}) };
  };
  const compare = (a: ThreeQueueCandidateEvaluation, b: ThreeQueueCandidateEvaluation) =>
    comparePermutationMetrics(a.permutationAudit!, b.permutationAudit!) || Number(b.isCurrent === true) - Number(a.isCurrent === true) ||
    threeQueueCandidateKey(a.candidate).localeCompare(threeQueueCandidateKey(b.candidate));
  for (const [stageIndex, trials] of schedule.entries()) {
    const final = trials === options.finalValidationCount;
    const requests: { candidate: ThreeQueueOptimizationState; orderIndex: number; start: number; target: number }[] = [];
    let reusedTrajectoryCount = 0, baselineReusedRuns = 0, baselineIncrementalRuns = 0;
    profiler?.begin(`冰火六排列 · ${final ? "Final" : "正式筛选"} 每排列上限 ${trials}`, candidates.length * orders.length);
    for (const candidate of candidates) {
      const key = threeQueueCandidateKey(candidate), previous = rows.find((row) => threeQueueCandidateKey(row.candidate) === key);
      const dangerous = previous?.permutationAudit?.permutationResults.map((row, index) => ({ ...row, index }))
        .sort((a, b) => a.winRate - b.winRate || a.index - b.index).slice(0, 2).map((row) => row.index) ?? [];
      searched.add(key);
      for (const [orderIndex] of orders.entries()) {
        // First stage covers every order with a common ten-seed prefix; middle
        // stages deepen current/worst/near-worst. Final covers all six equally.
        const target = final || key === baselineKey && stageIndex > 0 || stageIndex > 0 && (orderIndex === 0 || dangerous.includes(orderIndex))
          ? trials : orders.length === 1 ? trials : Math.min(10, trials);
        const acc = accumulator(candidate, orderIndex);
        reusedTrajectoryCount += acc.trials;
        if (acc.trials) { cacheHits++; profiler?.reuseTrajectorySamples(acc.trials, acc.observations.reduce((n, row) => n + row.battleCount, 0)); }
        if (key === baselineKey) { baselineReusedRuns += acc.trials; baselineIncrementalRuns += Math.max(0, target - acc.trials); }
        if (acc.trials < target) requests.push({ candidate, orderIndex, start: acc.trials, target });
      }
    }
    const incrementalRuns = requests.reduce((sum, row) => sum + row.target - row.start, 0);
    profiler?.setExecutionWorkload(incrementalRuns, true, "trajectory");
    for (let offset = 0; offset < requests.length; offset += 4) {
      const chunk = requests.slice(offset, offset + 4);
      const jobs: EvaluationJob[] = chunk.map((request) => ({ kind: "threeQueue",
        input: permuteIceFireInput(converted.get(threeQueueCandidateKey(request.candidate))!, enemySide, orders[request.orderIndex]!),
        side: options.side, seeds: sharedSeeds.slice(request.start, request.target), collectTrajectories: true,
        protectFromPruning: threeQueueCandidateKey(request.candidate) === baselineKey }));
      const results = yield jobs;
      if (results.length !== jobs.length) throw new Error("六排列模拟返回数量不一致。");
      results.forEach((result, index) => {
        const request = chunk[index]!;
        accumulator(request.candidate, request.orderIndex).append(sharedSeeds.slice(request.start, request.target), result.samples);
        performance = addOptimizationPerformance(performance, result.performance);
      });
      onProgress?.({ stage: `冰火六排列 · ${final ? "Final" : "累计"} ${trials} 场/排列`, completed: Math.min(offset + chunk.length, requests.length), total: requests.length });
    }
    rows = candidates.map(rowFor).sort(compare);
    const keep = final ? rows.length : Math.max(1, Math.min(keeps[stageIndex] ?? options.finalCandidateCount, schedule[stageIndex + 1] === options.finalValidationCount ? options.finalCandidateCount + 1 : Infinity));
    const retained = new Map<string, ThreeQueueCandidateEvaluation>();
    const add = (row?: ThreeQueueCandidateEvaluation) => { if (row && retained.size < keep) retained.set(threeQueueCandidateKey(row.candidate), row); };
    add(rows.find((row) => row.isCurrent));
    // Explicit formal metrics lead; a quarter preserves Criterion/Theory and
    // uncertain dangerous-order samples, rather than hiding an avg/worst blend.
    for (const row of rows.slice(0, Math.max(1, Math.floor(keep * .75)))) add(row);
    for (const field of ["criterionWorst", "theoryWorst"] as const) add([...rows].sort((a, b) =>
      (evidence.get(threeQueueCandidateKey(b.candidate))?.[field] ?? 0) - (evidence.get(threeQueueCandidateKey(a.candidate))?.[field] ?? 0))[0]);
    const uncertainty = (row: ThreeQueueCandidateEvaluation) => Math.max(...row.permutationAudit!.permutationResults.map((p) =>
      Math.sqrt((p.wins + 1) * (p.trials - p.wins + 1) / ((p.trials + 2) ** 2 * (p.trials + 3)))));
    add([...rows].sort((a, b) => uncertainty(b) - uncertainty(a))[0]);
    for (const row of rows) add(row);
    const selection = rows.map((row) => {
      const key = threeQueueCandidateKey(row.candidate), ev = evidence.get(key);
      const worstIndex = orders.findIndex((order) => order.join() === row.permutationAudit!.worstEnemyOrder.join());
      const paired = accumulator(row.candidate, worstIndex).pairedComparison(accumulator(current, worstIndex), options.side);
      return { candidateKey: key, winRate: row.winRate, pairedMean: paired.mean, uncertainty: uncertainty(row),
        criterionScore: ev?.criterionScore ?? 0, theoryScore: ev?.theoryScore ?? 0,
        theoryEngineDisagreement: Math.abs((ev?.theoreticalWinRate ?? row.winRate) - row.winRate), mechanisms: ev?.mechanisms ?? [], retained: retained.has(key) };
    });
    formalStages.push({ trials, candidates: rows.length, retained: final ? Math.min(options.finalCandidateCount, rows.length) : retained.size,
      incrementalRuns, reusedTrajectoryCount, baselineReusedRuns, baselineIncrementalRuns,
      sharedSeedSetId: `iceFire:${options.rootSeed}:permutation-trajectory-v1`,
      seedRange: { startIndex: 0, endIndex: trials - 1, firstSeed: sharedSeeds[0]!, lastSeed: sharedSeeds[trials - 1]! },
      pairedComparisonEnabled: true, selection, schedulerStatistics: summarizeTrajectoryScheduler(rows.flatMap((row) => orders.flatMap((_, i) =>
        accumulator(row.candidate, i).observations.map((observation) => ({ ...observation, candidateKey: tupleKey(row.candidate, i) }))))) });
    if (!final) candidates = [...retained.values()].map((row) => row.candidate);
    profiler?.end();
  }
  const attach = (row: ThreeQueueCandidateEvaluation) => {
    const convertedQueueAudit = [0, 1, 2].map((index) => iceFireQueueConversionAudit(converted.get(threeQueueCandidateKey(row.candidate))!, options.side, index));
    return { ...row, convertedQueueAudit, candidateExpectedHeroIds: convertedQueueAudit.map((audit) => audit.expectedHeroIds),
      candidateExpectedAttributes: convertedQueueAudit.map((audit) => audit.expectedAttributesAfterHeroConversion) };
  };
  const baseline = attach(rows.find((row) => row.isCurrent)!), ranked = rows.slice(0, options.finalCandidateCount).map(attach);
  const best = ranked[0] ?? baseline;
  return { scenarioType: "THREE_QUEUE", threeQueueMode: "ICE_FIRE_LEAGUE", schedulerType: threeQueueSchedulerType("ICE_FIRE_LEAGUE"),
    sharedExpertAudit: { A: iceFireExpertSkillAudit(input.sideA), B: iceFireExpertSkillAudit(input.sideB) },
    optimizationObjective: "worstEnemyPermutationWinProbability", positionCandidateCount: seeds.audit.tripleCandidates,
    status: ranked.some((row) => row.validTrials > 0) ? "success" : "failed", side: options.side, rootSeed: options.rootSeed,
    current: baseline, topCandidates: ranked, searchedCandidateCount: searched.size, finalValidatedCandidateCount: rows.length,
    finalValidationCount: options.finalValidationCount, cacheHits, performance, heroPoolAudit, formalStages,
    schedulerAudit: formalStages.at(-1)!.schedulerStatistics!,
    recommendedSchedulerAudit: summarizeTrajectoryScheduler(orders.flatMap((_, i) => accumulator(best.candidate, i).observations)),
    formalRacingAudit: { sampleSchedule: schedule, incrementalRunsPerStage: formalStages.map((s) => s.incrementalRuns),
      reusedTrajectoryCount: formalStages.reduce((n, s) => n + s.reusedTrajectoryCount, 0),
      baselineReusedRuns: formalStages.reduce((n, s) => n + s.baselineReusedRuns, 0), baselineSimulatedRuns: baseline.trials,
      sharedSeedSetId: `iceFire:${options.rootSeed}:permutation-trajectory-v1`, pairedComparisonEnabled: true },
    permutationAudit: { myOrderSearchEnabled: options.fixedOwnQueueOrder !== true, enemyPermutationMode: mode,
      enemyPermutationCount: orders.length, queueOrderBefore: input[options.side === "A" ? "sideA" : "sideB"].queueOrder ?? [0, 1, 2],
      queueOrderAfter: best.candidate.queues.map((q, i) => input[options.side === "A" ? "sideA" : "sideB"].queueOrder?.[q.sourceQueueIndex ?? i] ?? q.sourceQueueIndex ?? i) },
    criterionAudit: { ...seeds.audit, formalTripleCandidates: searched.size, uniqueTripleRatioPatternsAtM1: new Set(seeds.candidates.map((c) => c.queues.map((q) => TROOP_TYPES.map((t) => q.ratiosBp[t]).join()).join("|"))).size,
      uniqueTripleRatioPatternsAtFinal: new Set(rows.map((r) => r.candidate.queues.map((q) => JSON.stringify(q.ratiosBp)).join())).size,
      alternativeRatiosEvaluated: seeds.candidates.some((candidate) => searched.has(threeQueueCandidateKey(candidate)) &&
        candidate.queues.some((queue, index) => TROOP_TYPES.some((troop) => queue.ratiosBp[troop] !== current.queues[queue.sourceQueueIndex ?? index]!.ratiosBp[troop]))),
      formalFinalistsCompared: rows.some((row) => !row.isCurrent && row.candidate.queues.some((queue, index) =>
        TROOP_TYPES.some((troop) => queue.ratiosBp[troop] !== current.queues[queue.sourceQueueIndex ?? index]!.ratiosBp[troop]))),
      finalWinRate: best.winRate, formalWinRate: best.winRate } };
}
