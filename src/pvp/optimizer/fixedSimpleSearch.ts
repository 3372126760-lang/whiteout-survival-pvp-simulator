import { TROOP_TYPES } from "../types";
import type { ValidationBattleInput } from "../validationUi";
import { BattleSampleLedger, adaptiveSeedPools, emptySearchIntegrityReport,
  type AdaptiveStageAudit } from "./adaptiveSampling";
import { emptyRatioSearchAudit, fineRatioWindow, resolveBasinSearchOptions } from "./basinSearch";
import type { OptimizationWorkflow } from "./execution";
import type { OptimizerProfiler } from "./profiling";
import type { SimpleScenarioCandidate, SimpleScenarioEvaluation,
  SimpleScenarioOptimizationOptions } from "./scenarioOptimizer";
import type { OptimizationProgress } from "./types";

/** A small, fixed-head simplex gets exhaustive coverage before any promotion.
 * The large hero search's representative quotas and recent-generation rules
 * have no role here. All samples retain the official A/B input orientation. */
export function* createFixedSimpleStages(input: ValidationBattleInput,
  options: SimpleScenarioOptimizationOptions, coarse: readonly SimpleScenarioCandidate[],
  baselineCandidate: SimpleScenarioCandidate, key: (candidate: SimpleScenarioCandidate) => string,
  makeInput: (candidate: SimpleScenarioCandidate) => ValidationBattleInput,
  onProgress?: (progress: OptimizationProgress) => void, profiler?: OptimizerProfiler) {
  const initialRuns = coarse.length > 1 ? Math.max(20, Math.min(50, options.coarseTrials)) : options.coarseTrials;
  const promotionRuns = Math.max(initialRuns, Math.min(300, options.verificationTrials));
  const seeds = adaptiveSeedPools(options.seed, promotionRuns, options.verificationTrials);
  const integrity = emptySearchIntegrityReport(seeds.finalScreeningPrefix);
  const baselineKey = key(baselineCandidate);
  const ledger = new BattleSampleLedger(key, (candidate: SimpleScenarioCandidate) =>
    key(candidate) === baselineKey ? input : makeInput(candidate), options.side, profiler, seeds.screeningSet);
  const ratioSearchAudit = emptyRatioSearchAudit();
  const unique = (rows: readonly SimpleScenarioCandidate[]) => {
    const merged = new Map<string, SimpleScenarioCandidate>();
    for (const row of rows) merged.set(key(row), { ...merged.get(key(row)), ...row });
    return [...merged.values()];
  };
  const compare = (a: SimpleScenarioEvaluation, b: SimpleScenarioEvaluation) =>
    b.winRate - a.winRate || Number(!!b.isCurrent) - Number(!!a.isCurrent) ||
    (b.candidate.theoryEstimate?.theoryScore ?? 0) - (a.candidate.theoryEstimate?.theoryScore ?? 0) ||
    key(a.candidate).localeCompare(key(b.candidate));
  const select = (rows: readonly SimpleScenarioEvaluation[], count: number) => {
    const selected = [...rows].sort(compare).slice(0, count);
    const current = rows.find((row) => key(row.candidate) === baselineKey);
    if (current && !selected.includes(current)) selected.push(current);
    return selected;
  };
  const stage = function* (name: string, candidates: readonly SimpleScenarioCandidate[],
    stageSeeds: readonly number[]): OptimizationWorkflow<SimpleScenarioEvaluation[]> {
    const pool = unique(candidates), start = performance.now();
    const audit: AdaptiveStageAudit = { stage: name, candidatesEntered: pool.length,
      candidatesAdvanced: pool.length, candidatesEliminated: 0, requestedBattles: 0,
      executedBattles: 0, reusedBattles: 0, cacheHitRate: 0, elapsedMs: 0 };
    integrity.perStage.push(audit); profiler?.begin(name, pool.length);
    onProgress?.({ stage: name, completed: 0, total: pool.length });
    yield* ledger.sample(pool, stageSeeds, audit,
      (completed) => onProgress?.({ stage: name, completed, total: pool.length }));
    const rows = pool.map((candidate) => {
      const samples = ledger.outcomes(candidate, stageSeeds);
      const wins = samples.filter((sample) => sample.outcome === options.side).length;
      return { candidate, trials: samples.length, wins, winRate: wins / samples.length,
        ...(key(candidate) === baselineKey ? { isCurrent: true } : {}) };
    }).sort(compare);
    profiler?.end(); audit.elapsedMs = profiler ? performance.now() - start : 0;
    return rows;
  };
  const initialLimit = options.fixedHeadInitialCandidateLimit;
  if (initialLimit !== undefined && (!Number.isSafeInteger(initialLimit) || initialLimit < 1))
    throw new Error("Fixed-head initial candidate limit must be a positive integer.");
  const numericalPool = initialLimit === undefined ? coarse : [...coarse].sort((a, b) =>
    (b.theoryEstimate?.theoryScore ?? 0) - (a.theoryEstimate?.theoryScore ?? 0) ||
    (b.candidateCriterionScore ?? 0) - (a.candidateCriterionScore ?? 0) || key(a).localeCompare(key(b))).slice(0, initialLimit);
  // The official baseline joins the pool. Numerical screening already covered
  // every generated ratio; the ordinary PVP path keeps its complete MC pool.
  const initialPool = unique([...numericalPool, baselineCandidate]);
  const initial = yield* stage(`R2 · 固定车头${initialLimit === undefined ? "全比例" : `Top${initialLimit}`}${initialRuns}场`, initialPool,
    seeds.screening.slice(0, initialRuns));
  const promoted = select(initial, 10);
  integrity.perStage.at(-1)!.candidatesAdvanced = promoted.length;
  integrity.perStage.at(-1)!.candidatesEliminated = initial.length - promoted.length;
  const middle = yield* stage(`R3 · 固定车头Top10累计${promotionRuns}场`, promoted.map((row) => row.candidate),
    seeds.screening.slice(0, promotionRuns));
  const finalLimit = Math.min(5, Math.max(3, options.topN));
  let final = yield* stage("R4 · 固定车头候选统一复验", select(middle, finalLimit).map((row) => row.candidate), seeds.final);
  if (input.scenarioType === "SINGLE" && !options.fixedRatio) {
    const basinOptions = resolveBasinSearchOptions(options.basinSearch);
    const centers = final.filter((row) => row.candidate.ratios !== undefined &&
      TROOP_TYPES.every((troop) => Number.isSafeInteger(row.candidate.ratios![troop])))
      .slice(0, Math.min(3, basinOptions.fineBasins));
    const children: SimpleScenarioCandidate[] = [];
    for (const [index, center] of centers.entries()) {
      const ratios = center.candidate.ratios!;
      const window = fineRatioWindow(ratios, basinOptions.fineRadius);
      ratioSearchAudit.basins.push({ id: `fixed-basin-${index + 1}`,
        head: TROOP_TYPES.map((troop) => center.candidate.leaderHeroIds[troop] ?? "").join("|"),
        seed: ratios, centers: [ratios], rounds: 1, stopReason: "localOptimum",
        fineCenter: ratios, fineCandidates: window.length, onePercentEntered: true });
      children.push(...window.map((fineRatios) => ({ leaderHeroIds: center.candidate.leaderHeroIds,
        ...(center.candidate.headMode === undefined ? {} : { headMode: center.candidate.headMode }),
        ...(center.candidate.headWeaponLevels === undefined ? {} : { headWeaponLevels: center.candidate.headWeaponLevels }), ratios: fineRatios,
        criterionPerspectiveSide: options.side, selectionReasons: ["fineSearch" as const] })));
    }
    const fine = unique(children);
    const coarseKeys = new Set(coarse.map(key));
    ratioSearchAudit.generatedFineRatios = fine.filter((candidate) => !coarseKeys.has(key(candidate))).length;
    ratioSearchAudit.fineBasinCount = centers.length;
    ratioSearchAudit.fineHeroLineupCount = new Set(centers.map((row) =>
      TROOP_TYPES.map((troop) => row.candidate.leaderHeroIds[troop] ?? "").join("|"))).size;
    integrity.fineSearch.basinCount = centers.length;
    integrity.fineSearch.basin1PercentEntered = centers.length;
    integrity.fineSearch.generated1PercentRatios = ratioSearchAudit.generatedFineRatios;
    if (fine.length) {
      const fineInitial = yield* stage("R5 · 固定车头1%局部初筛", [...fine, ...final.map((row) => row.candidate)],
        seeds.screening.slice(0, initialRuns));
      const finePromoted = yield* stage(`R6 · 固定车头1%局部累计${promotionRuns}场`,
        select(fineInitial, 10).map((row) => row.candidate), seeds.screening.slice(0, promotionRuns));
      // Preserve every previously verified finalist; all recommendations and
      // the untouched baseline finish the identical final seed set.
      final = yield* stage("Final · 固定车头统一高场次复验",
        [...final.map((row) => row.candidate), ...select(finePromoted, finalLimit).map((row) => row.candidate)], seeds.final);
    }
  }
  integrity.final.finalistsAt300 = options.verificationTrials >= 300 ? final.length : 0;
  integrity.final.finalistsAt500 = options.verificationTrials >= 500 ? final.length : 0;
  integrity.final.finalistsAt1000 = options.verificationTrials >= 1000 ? final.length : 0;
  integrity.final.screeningRuns = ledger.executedScreeningRuns;
  integrity.final.independentValidationRuns = ledger.executedIndependentRuns;
  const current = final.find((row) => key(row.candidate) === baselineKey);
  if (!current || final.some((row) => row.trials !== options.verificationTrials))
    throw new Error("Fixed-head final comparison requires complete common-seed samples.");
  return { current, top: final.sort(compare).slice(0, options.topN), finalCount: final.length,
    performance: ledger.performance, searched: ledger.evaluatedBatches,
    ratioSearchAudit, searchIntegrityReport: integrity, initialCandidateCount: initialPool.length };
}
