import type { ValidationBattleInput } from "../validationUi";
import { TROOP_TYPES } from "../types";
import type { OptimizerProfiler } from "./profiling";
import type { OptimizationProgress } from "./types";
import type { OptimizationWorkflow } from "./execution";
import type { SimpleScenarioCandidate, SimpleScenarioEvaluation, SimpleScenarioOptimizationOptions } from "./scenarioOptimizer";
import { BattleSampleLedger, adaptiveSeedPools, boundedCheckpoints, emptySearchIntegrityReport, pairedBattleImprovement,
  raceCandidates, racingZ, resolveAdaptiveSearchOptions, type AdaptiveStageAudit } from "./adaptiveSampling";
import { emptyRatioSearchAudit, resolveBasinSearchOptions } from "./basinSearch";
import { searchAdaptiveRatioBasins } from "./adaptiveBasinSearch";
import { resolveCriterionSearchOptions } from "./criterion/searchTypes";
import { wilsonInterval } from "./statistics";
import { optimizerRecentHeadEligible } from "./heroSearchPolicy";

export function* createAdaptiveSimpleStages(input: ValidationBattleInput, options: SimpleScenarioOptimizationOptions,
  coarse: readonly SimpleScenarioCandidate[], baselineCandidate: SimpleScenarioCandidate,
  key: (candidate: SimpleScenarioCandidate) => string,
  makeInput: (candidate: SimpleScenarioCandidate) => ValidationBattleInput,
  onProgress?: (progress: OptimizationProgress) => void, profiler?: OptimizerProfiler) {
  const adaptive = resolveAdaptiveSearchOptions(options.adaptiveSearch);
  const protection = resolveCriterionSearchOptions(options.criterion);
  const schedule = options.monteCarloStages ?? [
    { trials: Math.min(options.initialBattleTrials ?? 10, options.coarseTrials), keep: 3000 },
    { trials: options.coarseTrials, keep: 500 },
    { trials: Math.min(options.intermediateTrials ?? 50, options.middleTrials), keep: 50 },
    { trials: options.middleTrials, keep: Math.min(options.topN, 10) },
  ];
  if (!schedule.length || schedule.some((row, i) => !Number.isSafeInteger(row.trials) || row.trials < 1 || row.trials > 100000 ||
    !Number.isSafeInteger(row.keep) || row.keep < 1 || (i > 0 && row.trials < schedule[i - 1]!.trials)))
    throw new Error("Cumulative Monte Carlo budgets must be nondecreasing.");
  const budget = Math.max(...schedule.map((row) => row.trials));
  const pools = adaptiveSeedPools(options.seed, budget, options.verificationTrials);
  const integrity = emptySearchIntegrityReport(pools.finalScreeningPrefix);
  const baselineKey = key(baselineCandidate);
  const ledger = new BattleSampleLedger(key, (candidate: SimpleScenarioCandidate) => key(candidate) === baselineKey ? input : makeInput(candidate),
    options.side, profiler, pools.screeningSet);
  const compare = (a: SimpleScenarioEvaluation, b: SimpleScenarioEvaluation) => b.winRate - a.winRate || key(a.candidate).localeCompare(key(b.candidate));
  const unique = (candidates: readonly SimpleScenarioCandidate[]) => [...new Map(candidates.map((candidate) => [key(candidate), candidate])).values()];
  const keep = (rows: readonly SimpleScenarioEvaluation[], count: number) => {
    const ranked = [...rows].sort(compare), retained = ranked.slice(0, count);
    const headOf = (row: SimpleScenarioEvaluation) => TROOP_TYPES.map((t)=>row.candidate.leaderHeroIds[t]??"").join("|");
    const groups=new Map<string,SimpleScenarioEvaluation>();for(const row of ranked)if(!groups.has(headOf(row)))groups.set(headOf(row),row);
    for(const row of groups.values()) if(row.trials < ((row.candidate.theoryEstimate?.uncertainty??1)>=protection.uncertaintyThreshold?protection.uncertainHeadRuns:protection.minimumHeadRuns) && !retained.includes(row)) retained.push(row);
    for(const row of [...groups.values()].slice(0,protection.finalHeadBasins)) if(!retained.includes(row)) retained.push(row);
    const baseline = ranked.find((row) => key(row.candidate) === baselineKey);
    if (baseline && !retained.includes(baseline)) retained.push(baseline);
    const audit = integrity.perStage.at(-1);
    if (audit) { audit.candidatesEliminated += ranked.length - retained.length; audit.candidatesAdvanced = retained.length; }
    for (const row of ranked) if (!retained.includes(row)) {
      const [confidenceLower, confidenceUpper] = wilsonInterval(row.wins, row.trials);
      integrity.racing.decisions.push({ stage: audit?.stage ?? "promotion", candidateKey: key(row.candidate), checkpoint: row.trials,
        wins: row.wins, losses: row.trials - row.wins, n: row.trials, winRate: row.winRate,
        confidenceLower, confidenceUpper, cutoffLower: 0, eliminationReason: "notTopK" });
    }
    return retained.sort(compare);
  };
  const visited = new Set<string>();
  const stage = function* (name: string, candidates: readonly SimpleScenarioCandidate[], seeds: readonly number[]): OptimizationWorkflow<SimpleScenarioEvaluation[]> {
    const pool = unique(candidates), start = performance.now();
    const audit: AdaptiveStageAudit = { stage: name, candidatesEntered: pool.length, candidatesAdvanced: pool.length,
      candidatesEliminated: 0, requestedBattles: 0, executedBattles: 0, reusedBattles: 0, cacheHitRate: 0, elapsedMs: 0 };
    integrity.perStage.push(audit); profiler?.begin(name, pool.length);
    onProgress?.({ stage: name, completed: 0, total: pool.length });
    yield* ledger.sample(pool, seeds, audit, (completed) => onProgress?.({ stage: name, completed, total: pool.length }));
    const rows = pool.map((candidate) => {
      visited.add(TROOP_TYPES.map((troop) => candidate.leaderHeroIds[troop] ?? "").join("|"));
      const samples = ledger.outcomes(candidate, seeds), wins = samples.filter((row) => row.outcome === options.side).length;
      return { candidate, trials: samples.length, wins, winRate: wins / samples.length,
        ...(key(candidate) === baselineKey ? { isCurrent: true } : {}) };
    }).sort(compare);
    profiler?.end(); audit.elapsedMs = profiler ? performance.now() - start : 0; return rows;
  };
  const race = function* (name: string, candidates: readonly SimpleScenarioCandidate[], maxRuns: number,
    checkpoints: readonly number[], final = false): OptimizationWorkflow<SimpleScenarioEvaluation[]> {
    let candidatesLeft = unique(candidates), rows: SimpleScenarioEvaluation[] = [];
    const seedPool = final ? pools.final : pools.screening;
    const completed = Math.min(maxRuns, ...candidatesLeft.map((candidate) => ledger.completedRunCount(candidate, seedPool)));
    const looks = boundedCheckpoints(checkpoints, maxRuns).filter((n) => n >= completed), comparisons = candidatesLeft.length;
    for (const n of looks) {
      rows = yield* stage(`${name} · 累计${n}场`, candidatesLeft, seedPool.slice(0, n));
      const entered = rows.length;
      const headGroups = new Map<string, SimpleScenarioEvaluation>();
      for (const row of rows) {
        const head = TROOP_TYPES.map((t) => row.candidate.leaderHeroIds[t] ?? "").join("|");
        if (!headGroups.has(head)) headGroups.set(head, row);
      }
      const protectedKeys = new Set([baselineKey]);
      for (const row of headGroups.values()) if (row.trials <
        ((row.candidate.theoryEstimate?.uncertainty ?? 1) >= protection.uncertaintyThreshold
          ? protection.uncertainHeadRuns : protection.minimumHeadRuns)) protectedKeys.add(key(row.candidate));
      for (const row of [...headGroups.values()].slice(0, protection.finalHeadBasins))
        protectedKeys.add(key(row.candidate));
      // Every reported finalist completes the same final budget; screening CI
      // pruning must not turn a partial final sample into a recommendation.
      if (final) for (const row of rows) protectedKeys.add(key(row.candidate));
      rows = raceCandidates(rows, { candidate: (row) => row.candidate, key, compare, topK: options.topN,
        protected: (candidate) => protectedKeys.has(key(candidate)),
        uncertainty: (candidate) => candidate.theoryEstimate?.uncertainty ?? 1, stage: name,
        looks: looks.length, comparisons, maxRuns, options: adaptive }, integrity);
      integrity.perStage.at(-1)!.candidatesEliminated = entered - rows.length;
      integrity.perStage.at(-1)!.candidatesAdvanced = rows.length;
      integrity.racing.checkpoints.push({ stage: name, runs: n, entered, remaining: rows.length, eliminated: entered - rows.length });
      if (final && n === 300) integrity.final.finalistsAt300 = rows.length;
      if (final && n === 500) integrity.final.finalistsAt500 = rows.length;
      if (final && n === 1000) integrity.final.finalistsAt1000 = rows.length;
      candidatesLeft = rows.map((row) => row.candidate);
    }
    return rows;
  };
  let candidates = unique([...coarse, baselineCandidate]), top: SimpleScenarioEvaluation[] = [];
  for (const [i, settings] of schedule.entries()) {
    const rows = i >= 3 ? yield* race(`M${i + 1} · Adaptive Racing`, candidates, settings.trials, adaptive.m4Checkpoints) :
      yield* stage(`M${i + 1} · 累计正式筛选`, candidates, pools.screening.slice(0, settings.trials));
    top = keep(rows, settings.keep); candidates = top.map((row) => row.candidate);
  }
  const audit = emptyRatioSearchAudit();
  if (input.scenarioType === "SINGLE" && !options.fixedRatio) {
    const expanded = yield* searchAdaptiveRatioBasins(top.filter((row) => optimizerRecentHeadEligible(input, row.candidate.leaderHeroIds, options.side) && row.candidate.ratios !== undefined &&
      TROOP_TYPES.every((troop) => Number.isSafeInteger(row.candidate.ratios![troop]))), {
      candidate: (row: SimpleScenarioEvaluation) => row.candidate, key,
      ratios: (candidate: SimpleScenarioCandidate) => candidate.ratios!,
      head: (candidate: SimpleScenarioCandidate) => TROOP_TYPES.map((troop) => candidate.leaderHeroIds[troop] ?? "").join("|"), compare,
      child: (candidate: SimpleScenarioCandidate, ratios, fine) => ({ ...candidate, ratios,
        selectionReasons: [fine ? "fineSearch" as const : "localExpansion" as const] }),
      confidenceImproves: (challenger, incumbent, comparisons) => compare(challenger, incumbent) < 0 &&
        pairedBattleImprovement(ledger.outcomes(challenger.candidate, pools.screening.slice(0, challenger.trials)),
          ledger.outcomes(incumbent.candidate, pools.screening.slice(0, incumbent.trials)), options.side,
          racingZ(comparisons, 1, adaptive.familyErrorRate)),
      evaluate: (pool, step, round) => stage(`Basin · ${step}%第${round + 1}轮`, pool,
        pools.screening.slice(0, Math.min(budget, step === 5 ? Math.max(50, adaptive.highUncertaintyMinimumRuns) : budget))),
    }, resolveBasinSearchOptions(options.basinSearch), adaptive, audit, integrity);
    top = keep(yield* race("M4 · 精搜候选累计复筛", [...candidates, ...expanded.candidates], budget, adaptive.m4Checkpoints), Math.max(options.topN, 10));
  }
  const final = yield* race("Final · Adaptive Racing", top.map((row) => row.candidate), options.verificationTrials,
    adaptive.finalCheckpoints, true);
  const current = final.find((row) => key(row.candidate) === baselineKey)!;
  if (!current || final[0]!.trials < Math.min(options.verificationTrials, adaptive.minimumFinalRuns))
    throw new Error("Final champion/baseline verification is incomplete.");
  integrity.final.screeningRuns = ledger.executedScreeningRuns;
  integrity.final.independentValidationRuns = ledger.executedIndependentRuns;
  return { current, top: final.sort(compare).slice(0, options.topN), finalCount: final.length,
    performance: ledger.performance, searched: ledger.evaluatedBatches, visited, ratioSearchAudit: audit,
    searchIntegrityReport: integrity };
}
