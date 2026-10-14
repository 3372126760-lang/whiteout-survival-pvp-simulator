import { TROOP_TYPES } from "../types";
import { resolveValidationTroopCounts } from "../validationUi";
import { availableHeadHeroesByTroop, candidateKey, candidateToInput, currentRallyRatios,
  } from "./candidateGenerator";
import { createLegacyBodySearchPool } from "./criterion/bodyEnumeration";
import { headLineupKey, preFilterRallyCandidates } from "./theory";
import { evaluateSingleCandidate, type SingleSearchResult } from "./singleWaveSearch";
import type { CandidateEvaluation, OptimizationConfig, OptimizationInput, OptimizationProgress, RallyCandidate } from "./types";
import type { OptimizationWorkflow } from "./execution";
import type { OptimizerProfiler } from "./profiling";
import { SingleWinObjective } from "./objectives";
import { emptyRatioSearchAudit, resolveBasinSearchOptions } from "./basinSearch";
import { searchAdaptiveRatioBasins } from "./adaptiveBasinSearch";
import { BattleSampleLedger, adaptiveSeedPools, boundedCheckpoints, emptySearchIntegrityReport,
  raceCandidates, resolveAdaptiveSearchOptions, racingZ, pairedBattleImprovement, type AdaptiveStageAudit } from "./adaptiveSampling";

export function* createAdaptiveSingleWaveSearchWorkflow(input: OptimizationInput, config: OptimizationConfig,
  onProgress?: (progress: OptimizationProgress) => void, profiler?: OptimizerProfiler): OptimizationWorkflow<SingleSearchResult> {
  if (!input.sideA.rallyDeployment || !input.sideB.rallyDeployment)
    throw new Error("Single-wave optimization requires both rally deployments.");
  const options = resolveAdaptiveSearchOptions(config.adaptiveSearch);
  const schedule = config.monteCarloStages ?? [
    { trials: Math.min(config.initialBattleTrials ?? 5, config.stages[0].trials), keep: config.stages[0].keep },
    { trials: config.stages[0].trials, keep: config.stages[1].keep },
    { trials: config.stages[1].trials, keep: config.stages[2].keep },
    { trials: config.stages[2].trials, keep: config.verificationTop },
  ];
  if (!schedule.length || schedule.some((stage, i) => stage.trials < 1 ||
    (i > 0 && stage.trials < schedule[i - 1]!.trials))) throw new Error("Cumulative Monte Carlo budgets must be nondecreasing.");
  const maxScreening = Math.max(...schedule.map((stage) => stage.trials));
  const seeds = adaptiveSeedPools(config.firstSeed, maxScreening, config.verificationTrials);
  const integrity = emptySearchIntegrityReport(seeds.finalScreeningPrefix);
  const actualCounts = resolveValidationTroopCounts(input.sideA, "rally", input.attributeInputMode ?? "finalReport");
  const totalTroops = TROOP_TYPES.reduce((sum, troop) => sum + actualCounts[troop], 0);
  const scan = preFilterRallyCandidates(input, config, onProgress, profiler);
  const currentCandidate: RallyCandidate = { leaderHeroIds: input.sideA.leaderHeroIds ?? {},
    memberSkillIds: input.sideA.bodySkills?.map((body) => body.skillId) ?? input.sideA.selectedMemberSkillIds,
    ratios: currentRallyRatios(input), selectionReasons: ["currentConfig"] };
  const currentKey = candidateKey(currentCandidate);
  const protectedKeys = new Set([...scan.protectedKeys, currentKey]);
  const ledger = new BattleSampleLedger(candidateKey, (candidate: RallyCandidate) =>
    candidateKey(candidate) === currentKey ? input : candidateToInput(input, candidate), "A", profiler, seeds.screeningSet);
  const headChoices = availableHeadHeroesByTroop(input, config.constraints);
  const legalHeads = new Set(scan.formations.map((row) => headLineupKey(row.leaderHeroIds)));
  const visitedHeads = new Map<string, RallyCandidate["leaderHeroIds"]>();
  const selections = new Map<string, Set<NonNullable<RallyCandidate["selectionReasons"]>[number]>>();
  const records: { stage: string; candidates: number; trials: number; retained: number; simulatedTrials: number }[] = [];
  let weakSearch = false;
  const compare = (a: CandidateEvaluation, b: CandidateEvaluation) => b.winRate - a.winRate || (weakSearch ?
    a.enemyRemaining.total.mean - b.enemyRemaining.total.mean || b.selfRemaining.total.mean - a.selfRemaining.total.mean :
    SingleWinObjective.compare(a, b));
  const unique = (candidates: readonly RallyCandidate[]) => [...new Map(candidates.map((candidate) => [candidateKey(candidate), candidate])).values()];
  const keep = (rows: readonly CandidateEvaluation[], count: number) => {
    const sorted = [...rows].sort(compare), kept = new Map(sorted.slice(0, count).map((row) => [candidateKey(row.candidate), row]));
    for (const row of sorted) if (protectedKeys.has(candidateKey(row.candidate))) kept.set(candidateKey(row.candidate), row);
    const audit = integrity.perStage.at(-1);
    if (audit) { audit.candidatesEliminated += sorted.length - kept.size; audit.candidatesAdvanced = kept.size; }
    for (const row of sorted) if (!kept.has(candidateKey(row.candidate))) integrity.racing.decisions.push({
      stage: audit?.stage ?? "promotion", candidateKey: candidateKey(row.candidate), checkpoint: row.trials,
      wins: row.wins, losses: row.losses, n: row.trials, winRate: row.winRate,
      confidenceLower: row.wilson95[0], confidenceUpper: row.wilson95[1],
      cutoffLower: sorted[Math.min(count, sorted.length) - 1]?.wilson95[0] ?? 0, eliminationReason: "notTopK" });
    if (records.at(-1)) records.at(-1)!.retained = kept.size;
    return [...kept.values()].sort(compare);
  };
  const evaluation = (candidate: RallyCandidate, pool: readonly number[]) => evaluateSingleCandidate(candidate,
    totalTroops, pool, () => ledger.outcomes(candidate, pool).map((row) => ({ outcome: row.outcome,
      self: row.remaining.A, enemy: row.remaining.B, rounds: row.roundCount })));
  const stage = function* (name: string, candidates: readonly RallyCandidate[], pool: readonly number[]): OptimizationWorkflow<CandidateEvaluation[]> {
    const uniqueCandidates = unique(candidates), started = performance.now();
    const audit: AdaptiveStageAudit = { stage: name, candidatesEntered: uniqueCandidates.length, candidatesEliminated: 0,
      candidatesAdvanced: uniqueCandidates.length, requestedBattles: 0, executedBattles: 0, reusedBattles: 0, cacheHitRate: 0, elapsedMs: 0 };
    integrity.perStage.push(audit); profiler?.begin(name, uniqueCandidates.length);
    onProgress?.({ stage: name, completed: 0, total: uniqueCandidates.length });
    yield* ledger.sample(uniqueCandidates, pool, audit, (completed) =>
      onProgress?.({ stage: name, completed, total: uniqueCandidates.length }));
    const rows = uniqueCandidates.map((candidate) => {
      const head = headLineupKey(candidate.leaderHeroIds);
      if (legalHeads.has(head)) visitedHeads.set(head, candidate.leaderHeroIds);
      const reasons = selections.get(candidateKey(candidate)) ?? new Set();
      for (const reason of candidate.selectionReasons ?? []) reasons.add(reason);
      selections.set(candidateKey(candidate), reasons); return evaluation(candidate, pool);
    }).sort(compare);
    profiler?.end(); audit.elapsedMs = profiler ? performance.now() - started : 0;
    records.push({ stage: name, candidates: rows.length, trials: pool.length, retained: rows.length, simulatedTrials: audit.executedBattles });
    return rows;
  };
  const race = function* (name: string, candidates: readonly RallyCandidate[], budget: number,
    checkpoints: readonly number[], topK: number, final = false): OptimizationWorkflow<CandidateEvaluation[]> {
    let pool = unique(candidates), rows: CandidateEvaluation[] = [];
    const seedPool = final ? seeds.final : seeds.screening;
    const completed = Math.min(budget, ...pool.map((candidate) => ledger.completedRunCount(candidate, seedPool)));
    const targets = boundedCheckpoints(checkpoints, budget).filter((n) => n >= completed), comparisons = pool.length;
    for (const target of targets) {
      const stageName = `${name} · 累计${target}场`;
      rows = yield* stage(stageName, pool, seedPool.slice(0, target));
      const entered = rows.length;
      rows = raceCandidates(rows, { candidate: (row) => row.candidate, key: candidateKey,
        uncertainty: (candidate) => candidate.theoryEstimate?.uncertainty ?? 1, compare,
        protected: (candidate) => protectedKeys.has(candidateKey(candidate)), topK, stage: name,
        looks: targets.length, comparisons, maxRuns: budget, options }, integrity);
      const audit = integrity.perStage.at(-1)!;
      audit.candidatesEliminated = entered - rows.length; audit.candidatesAdvanced = rows.length;
      records.at(-1)!.retained = rows.length;
      integrity.racing.checkpoints.push({ stage: name, runs: target, entered, remaining: rows.length, eliminated: entered - rows.length });
      if (final && (target === 300 || target === 500 || target === 1000)) {
        if (target === 300) integrity.final.finalistsAt300 = rows.length;
        if (target === 500) integrity.final.finalistsAt500 = rows.length;
        if (target === 1000) integrity.final.finalistsAt1000 = rows.length;
      }
      pool = rows.map((row) => row.candidate);
    }
    return rows;
  };
  // An old current lineup can be outside the optimizer's recent-generation pool.
  // It is still an exact protected Final baseline, not a generated M1 head.
  const initial = unique([...scan.candidates, ...(legalHeads.has(headLineupKey(currentCandidate.leaderHeroIds)) ? [currentCandidate] : [])]);
  let top = keep(yield* stage("M1 · 全车头正式验证", initial, seeds.screening.slice(0, schedule[0]!.trials)), schedule[0]!.keep);
  if (visitedHeads.size !== legalHeads.size) throw new Error("Formal hero coverage is incomplete.");
  const stage1Heads = [...visitedHeads.values()], retainedHeadCandidateCount = new Set(top.map((row) => headLineupKey(row.candidate.leaderHeroIds))).size;
  weakSearch = config.objectiveMode === "minRallies" || (config.objectiveMode === "auto" && top[0]!.winRate <= config.singleFightThresholdLow);
  const fixedBody = config.constraints.fixedBodyExact === true || (config.constraints.fixedMemberSkillIds?.length ?? 0) === 4;
  const bodyPool = legalHeads.size ? createLegacyBodySearchPool(input, config.constraints, scan.formations[0]!.leaderHeroIds) : undefined;
  const bodyFormations = bodyPool?.rows ?? [];
  let bodyScreeningCount = 0;
  const bodies = new Set(initial.map((candidate) => candidate.memberSkillIds.join("|")));
  for (let index = 1; index < schedule.length; index++) {
    const settings = schedule[index]!, pool = new Map(top.map((row) => [candidateKey(row.candidate), row.candidate]));
    if (index === 2 && !fixedBody && bodyFormations.length > 1) {
      const parents = top.filter((row) => legalHeads.has(headLineupKey(row.candidate.leaderHeroIds))).slice(0, 3);
      const perHead = Math.max(1, Math.floor(config.stages[0].maxCandidates / Math.max(1, parents.length)));
      const count = Math.min(perHead, bodyFormations.length);
      const selected = Array.from({ length: count }, (_, i) => bodyFormations[Math.round(i * (bodyFormations.length - 1) / Math.max(1, count - 1))]!);
      for (const parent of parents) for (const body of selected) {
        const { theoryEstimate, ...baseCandidate } = parent.candidate; void theoryEstimate;
        const candidate = { ...baseCandidate, memberSkillIds: body.memberSkillIds, selectionReasons: ["bodyScreening" as const] };
        if (!pool.has(candidateKey(candidate))) { pool.set(candidateKey(candidate), candidate); bodyScreeningCount++; }
        bodies.add(candidate.memberSkillIds.join("|"));
      }
    }
    const rows = index >= 3 ? yield* race(`M${index + 1} · Adaptive Racing`, [...pool.values()], settings.trials,
      options.m4Checkpoints, Math.max(config.topN, settings.keep)) :
      yield* stage(`M${index + 1} · 累计正式筛选`, [...pool.values()], seeds.screening.slice(0, settings.trials));
    top = keep(rows, settings.keep);
  }
  const ratioAudit = emptyRatioSearchAudit();
  const maxBasinRuns = maxScreening;
  const confidenceImproves = (challenger: CandidateEvaluation, incumbent: CandidateEvaluation, comparisons: number): boolean => {
    if (compare(challenger, incumbent) >= 0) return false;
    const pool = seeds.screening.slice(0, Math.min(challenger.trials, incumbent.trials));
    const left = ledger.outcomes(challenger.candidate, pool), right = ledger.outcomes(incumbent.candidate, pool);
    return pairedBattleImprovement(left, right, "A", racingZ(comparisons, 1, options.familyErrorRate));
  };
  const expanded = yield* searchAdaptiveRatioBasins(top.filter((row) => legalHeads.has(headLineupKey(row.candidate.leaderHeroIds))), {
    candidate: (row: CandidateEvaluation) => row.candidate, ratios: (candidate: RallyCandidate) => candidate.ratios,
    head: (candidate: RallyCandidate) => `${headLineupKey(candidate.leaderHeroIds)}:${candidate.memberSkillIds.join("|")}`,
    key: candidateKey, compare, confidenceImproves,
    child: (candidate: RallyCandidate, ratios, fine) => ({ ...candidate, ratios,
      selectionReasons: [fine ? "fineSearch" as const : "localExpansion" as const] }),
    evaluate: (candidates, step, round) => stage(`Basin · ${step}%第${round + 1}轮`, candidates,
      seeds.screening.slice(0, Math.min(maxBasinRuns, step === 5 ? Math.max(50, options.highUncertaintyMinimumRuns) : maxBasinRuns))),
  }, resolveBasinSearchOptions(config.basinSearch), options, ratioAudit, integrity);
  if (expanded.candidates.length) top = keep(yield* race("M4 · 精搜候选累计复筛",
    [...top.map((row) => row.candidate), ...expanded.candidates], maxScreening,
    options.m4Checkpoints, Math.max(config.topN, config.verificationTop)), config.verificationTop);
  const finalists = unique([...top.slice(0, config.verificationTop).map((row) => row.candidate),
    ...initial.filter((candidate) => protectedKeys.has(candidateKey(candidate))), currentCandidate]);
  const verified = yield* race("Final · Adaptive Racing", finalists, config.verificationTrials,
    options.finalCheckpoints, config.topN, true);
  const baseline = verified.find((row) => candidateKey(row.candidate) === currentKey)!;
  if (!baseline || verified[0]!.trials < Math.min(config.verificationTrials, options.minimumFinalRuns))
    throw new Error("Final champion/baseline verification is incomplete.");
  const ranked = [...verified].sort(compare).slice(0, config.topN);
  integrity.final.screeningRuns = ledger.executedScreeningRuns;
  integrity.final.independentValidationRuns = ledger.executedIndependentRuns;
  const coverage = { theoryCandidateCount: scan.theoryCandidateCount, legalHeroLineupCount: legalHeads.size,
    theoryHeroCoverage: legalHeads.size ? 100 : 0, ratiosPerHeroLineup: scan.grid.length, localPeaksDetected: scan.localPeaksDetected,
    battleCandidateCount: initial.length, heroLineupsEnteringBattleEngine: stage1Heads.length,
    battleHeroCoverage: legalHeads.size ? stage1Heads.length / legalHeads.size * 100 : 0 };
  const headCandidateCount = legalHeads.size;
  return { top: ranked, coarseBest: ranked[0]!, current: baseline, evaluatedCandidates: ledger.evaluatedBatches, performance: ledger.performance,
    searchDiagnostics: { ...(bodyPool ? { bodyEnumerationAudit: bodyPool.audit } : {}), searchIntegrityReport: integrity, heroPoolAudit: scan.heroPoolAudit, ratioSearchAudit: ratioAudit,
      theoryCoverage: coverage, theoryOptions: scan.options, theoryLineups: scan.lineups,
      battleSelections: [...selections].map(([candidateKey, values]) => ({ candidateKey, selectionReasons: [...values] })),
      monteCarloStages: records, localExpansionCount: expanded.candidates.length, legalHeadCandidateCount: legalHeads.size,
      evaluatedUniqueHeadCandidateCount: stage1Heads.length, headCoverageRate: coverage.battleHeroCoverage,
      fixedBody, availableBodyCandidateCount: bodyPool?.audit.finalPreprocessedBodyCount ?? 0,
      stage1Trials: schedule[0]!.trials, stage1CandidateCount: initial.length, retainedHeadCandidateCount,
      stage2RatioCandidateCount: records[1]?.candidates ?? 0,
      fixedHead: TROOP_TYPES.every((troop) => config.constraints.fixedLeaders?.[troop] !== undefined),
      searchDimensions: { headShield: config.constraints.fixedLeaders?.shield === undefined,
        headLancer: config.constraints.fixedLeaders?.lancer === undefined,
        headMarksman: config.constraints.fixedLeaders?.marksman === undefined, body: !fixedBody, troopRatio: true },
      availableHeadHeroesByTroop: headChoices, shieldCandidateCount: headChoices.shield.length,
      lancerCandidateCount: headChoices.lancer.length, marksmanCandidateCount: headChoices.marksman.length,
      headCandidateCount, bodyCandidateCount: bodies.size, ratioCandidateCount: scan.grid.length,
      totalCandidateCount: legalHeads.size * bodies.size * scan.grid.length, coarseRatioCandidateCount: scan.grid.length,
      coarseCandidateCount: initial.length + bodyScreeningCount, generatedFormationCount: scan.formations.length,
      evaluatedHeadLineups: stage1Heads, bestHeadLineup: ranked[0]!.candidate.leaderHeroIds,
      optimizationTargetSide: "A", candidateChangedSide: "A" } };
}
