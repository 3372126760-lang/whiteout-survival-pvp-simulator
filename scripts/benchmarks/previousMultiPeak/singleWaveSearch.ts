// Frozen previous multi-peak workflow for regression comparison only.
import { TROOP_TYPES } from "../../../src/pvp/types";
import type { FastBattleResult } from "../../../src/pvp/battle/fastBattleMode";
import { allocateRallyTroopsByRatio, createValidationBattleCompiler, type compileValidationBattle,
  resolveValidationTroopCounts } from "../../../src/pvp/validationUi";
import { availableHeadHeroesByTroop, candidateKey, candidateToInput, currentRallyRatios, generateBodyFormations } from "./candidateGenerator";
import { preFilterRallyCandidates, headLineupKey, ratioNeighbors } from "./theory";
import { createStageSeeds } from "../../../src/pvp/optimizer/seedSet";
import { TemplateCache } from "../../../src/pvp/optimizer/fastTemplates";
import { addOptimizationPerformance, createEvaluationExecutor, emptyOptimizationPerformance,
  evaluateSearchStage, runOptimizationWorkflow,
  type EvaluationJob, type EvaluationJobResult, type OptimizationPerformance, type OptimizationWorkflow } from "../../../src/pvp/optimizer/execution";
import { SingleWinObjective } from "../../../src/pvp/optimizer/objectives";
import { addTroopSample, emptyTroopSamples, summarizeTroopSamples, wilsonInterval } from "../../../src/pvp/optimizer/statistics";
import type { CandidateEvaluation, OptimizationConfig, OptimizationInput, OptimizationProgress, RallyCandidate, RallySearchDiagnostics, TroopSurvivors } from "../../../src/pvp/optimizer/types";

export interface SingleTrialOutcome {
  readonly outcome: "A" | "B" | "draw" | "timeout";
  readonly self: TroopSurvivors;
  readonly enemy: TroopSurvivors;
  readonly rounds: number;
}

export type CandidateTrialRunner = (candidate: RallyCandidate, seeds: readonly number[]) => readonly SingleTrialOutcome[];

export function createEngineCandidateRunner(input: OptimizationInput): CandidateTrialRunner {
  const cache = new TemplateCache<ReturnType<typeof compileValidationBattle>>();
  const compile = createValidationBattleCompiler();
  return (candidate, seeds) => {
    const compiled = cache.get(candidateKey(candidate), () =>
      compile(candidateToInput(input, candidate)));
    return seeds.map((seed) => toSingleTrial(compiled.runFastTrial(seed)));
  };
}

function toSingleTrial(trial: FastBattleResult): SingleTrialOutcome {
  return { outcome: trial.outcome, self: trial.remaining.A, enemy: trial.remaining.B,
    rounds: trial.roundCount };
}

export function evaluateSingleCandidate(
  candidate: RallyCandidate,
  totalTroops: number,
  seeds: readonly number[],
  run: CandidateTrialRunner,
): CandidateEvaluation {
  const trials = run(candidate, seeds);
  if (trials.length !== seeds.length || trials.length === 0) throw new Error("Trial runner returned an invalid sample count.");
  const counts = { A: 0, B: 0, draw: 0, timeout: 0 };
  const self = emptyTroopSamples();
  const enemy = emptyTroopSamples();
  const rounds: number[] = [];
  for (const trial of trials) {
    counts[trial.outcome] += 1;
    addTroopSample(self, trial.self);
    addTroopSample(enemy, trial.enemy);
    rounds.push(trial.rounds);
  }
  const { summarizeBatchMetric } = batchMetricModule;
  return {
    candidate,
    actualCounts: allocateRallyTroopsByRatio({ totalTroops, ratios: candidate.ratios }),
    trials: trials.length,
    wins: counts.A, losses: counts.B, draws: counts.draw, timeouts: counts.timeout,
    winRate: counts.A / trials.length,
    wilson95: wilsonInterval(counts.A, trials.length),
    selfRemaining: summarizeTroopSamples(self),
    enemyRemaining: summarizeTroopSamples(enemy),
    rounds: summarizeBatchMetric(rounds),
  };
}

// Keep this import local to the statistics layer's existing nearest-rank convention.
import * as batchMetricModule from "../../../src/pvp/validationUi/batchSimulation";

export interface SingleSearchResult {
  readonly searchDiagnostics: RallySearchDiagnostics;
  readonly top: readonly CandidateEvaluation[];
  readonly coarseBest: CandidateEvaluation;
  readonly evaluatedCandidates: number;
  readonly current: CandidateEvaluation;
  readonly performance: OptimizationPerformance;
}

function compareWeakPrimer(a: CandidateEvaluation, b: CandidateEvaluation): number {
  return b.winRate - a.winRate ||
    a.enemyRemaining.total.mean - b.enemyRemaining.total.mean ||
    b.selfRemaining.total.mean - a.selfRemaining.total.mean;
}

export function* createSingleWaveSearchWorkflow(
  input: OptimizationInput,
  config: OptimizationConfig,
  onProgress?: (progress: OptimizationProgress) => void,
): OptimizationWorkflow<SingleSearchResult> {
  if (input.sideA.rallyDeployment === undefined || input.sideB.rallyDeployment === undefined)
    throw new Error("Single-wave optimization requires both rally deployments.");
  const actualCounts = resolveValidationTroopCounts(input.sideA, "rally", input.attributeInputMode ?? "finalReport");
  const totalTroops = TROOP_TYPES.reduce((sum, troop) => sum + actualCounts[troop], 0);
  const scan = preFilterRallyCandidates(input, config, onProgress);
  const headChoices = availableHeadHeroesByTroop(input, config.constraints);
  const legalHeads = new Set(scan.formations.map((row) => headLineupKey(row.leaderHeroIds)));
  const visitedHeads = new Map<string, RallyCandidate["leaderHeroIds"]>();
  const selections = new Map(scan.candidates.map((row) => [candidateKey(row), row.selectionReasons ?? []]));
  const schedule = config.monteCarloStages ?? [
    { trials: Math.min(config.initialBattleTrials ?? 5, config.stages[0].trials), keep: config.stages[0].keep },
    { trials: config.stages[0].trials, keep: config.stages[1].keep },
    { trials: config.stages[1].trials, keep: config.stages[2].keep },
    { trials: config.stages[2].trials, keep: config.verificationTop },
  ];
  if (!schedule.length) throw new Error("Monte Carlo schedule cannot be empty.");
  let performance = emptyOptimizationPerformance(), evaluatedCandidates = 0;
  const stageRecords: { stage: string; candidates: number; trials: number; retained: number; simulatedTrials: number }[] = [];
  const keepProtected = (rows: readonly CandidateEvaluation[], keep: number,
    compare: (a: CandidateEvaluation, b: CandidateEvaluation) => number) => {
    const ranked = [...rows].sort(compare);
    const selected = new Map(ranked.slice(0, keep).map((row) => [candidateKey(row.candidate), row]));
    for (const row of ranked) if (scan.protectedKeys.has(candidateKey(row.candidate)))
      selected.set(candidateKey(row.candidate), row);
    return [...selected.values()].sort(compare);
  };
  const evaluateStage = function* (name: string, candidates: readonly RallyCandidate[], trials: number,
    keep: number, offset: number, compare: (a: CandidateEvaluation, b: CandidateEvaluation) => number,
    prune: boolean): OptimizationWorkflow<CandidateEvaluation[]> {
    const seeds = createStageSeeds(config.firstSeed, trials, offset);
    const rows: CandidateEvaluation[] = [];
    const before = performance.simulatedTrials;
    yield* evaluateSearchStage(candidates, (candidate) => ({ kind: "battle",
      input: candidateToInput(input, candidate), seeds, side: "A", collectOutcomes: true,
      rallyCandidate: candidate, protectFromPruning: scan.protectedKeys.has(candidateKey(candidate)) }), prune,
    (candidate, result, index) => {
      const head = headLineupKey(candidate.leaderHeroIds);
      if (legalHeads.has(head)) visitedHeads.set(head, candidate.leaderHeroIds);
      selections.set(candidateKey(candidate), candidate.selectionReasons ?? []);
      performance = addOptimizationPerformance(performance, result.performance);
      evaluatedCandidates += 1;
      if (!result.samples.pruned) rows.push(evaluateSingleCandidate(candidate, totalTroops,
        seeds.slice(0, result.samples.trials), () => result.samples.outcomes.map(toSingleTrial)));
      if ((index + 1) % 5 === 0 || index + 1 === candidates.length)
        onProgress?.({ stage: name, completed: index + 1, total: candidates.length });
    }, candidates.length);
    const kept = keepProtected(rows, keep, compare);
    stageRecords.push({ stage: name, candidates: candidates.length, trials, retained: kept.length,
      simulatedTrials: performance.simulatedTrials - before });
    return kept;
  };
  // No early elimination or global theory cutoff before every legal lineup has formal samples.
  let top = yield* evaluateStage("M1 · 全车头正式验证", scan.candidates, schedule[0]!.trials,
    schedule[0]!.keep, 0, SingleWinObjective.compare, false);
  if (visitedHeads.size !== legalHeads.size) throw new Error("Formal hero coverage is incomplete.");
  const stage1Heads = [...visitedHeads.values()];
  const retainedHeadCandidateCount = new Set(top.map((row) => headLineupKey(row.candidate.leaderHeroIds))).size;
  const weakSearch = config.objectiveMode === "minRallies" ||
    (config.objectiveMode === "auto" && top[0]!.winRate <= config.singleFightThresholdLow);
  const compare = weakSearch ? compareWeakPrimer : SingleWinObjective.compare;
  const fixedBody = config.constraints.fixedBodyExact === true || (config.constraints.fixedMemberSkillIds?.length ?? 0) === 4;
  const bodyFormations = generateBodyFormations(input, config.constraints, scan.formations[0]!.leaderHeroIds);
  const availableBodyCandidateCount = new Set(bodyFormations.map((row) => row.memberSkillIds.join("|"))).size;
  const bodies = new Set(scan.candidates.map((row) => row.memberSkillIds.join("|")));
  let localExpansionCount = 0, bodyScreeningCount = 0;
  for (let index = 1; index < schedule.length; index += 1) {
    const stage = schedule[index]!;
    const pool = new Map(top.map((row) => [candidateKey(row.candidate), row.candidate]));
    // Local expansion follows real M2/M3 results. Round-robin protects several discovered peaks.
    if (index >= 2) {
      const parameters = config.stages[Math.min(index - 1, 2)]!;
      const parents = top.slice(0, Math.max(1, Math.min(50, parameters.maxCandidates)));
      const neighbors = parents.map((row) => ratioNeighbors(row.candidate.ratios, parameters.ratioStep));
      let added = 0;
      for (let neighbor = 0; neighbor < 6 && added < parameters.maxCandidates; neighbor += 1)
        for (let parent = 0; parent < parents.length && added < parameters.maxCandidates; parent += 1) {
          const ratios = neighbors[parent]![neighbor]; if (ratios === undefined) continue;
          const origin = parents[parent]!.candidate;
          const candidate: RallyCandidate = { leaderHeroIds: origin.leaderHeroIds,
            memberSkillIds: origin.memberSkillIds, ratios, selectionReasons: ["localExpansion"] };
          const key = candidateKey(candidate); if (pool.has(key)) continue;
          pool.set(key, candidate); added += 1; localExpansionCount += 1;
        }
    }
    if (index === 2 && !fixedBody && availableBodyCandidateCount > 1) {
      const parents = top.slice(0, 3), budget = config.stages[0].maxCandidates;
      const perHead = Math.max(1, Math.floor(budget / Math.max(1, parents.length)));
      const selected = Array.from({ length: Math.min(perHead, bodyFormations.length) }, (_, i) =>
        bodyFormations[Math.round(i * (bodyFormations.length - 1) / Math.max(1, Math.min(perHead, bodyFormations.length) - 1))]!);
      for (const parent of parents) for (const body of selected) {
        const candidate: RallyCandidate = { leaderHeroIds: parent.candidate.leaderHeroIds,
          memberSkillIds: body.memberSkillIds, ratios: parent.candidate.ratios, selectionReasons: ["bodyScreening"] };
        const key = candidateKey(candidate);
        if (!pool.has(key)) { pool.set(key, candidate); bodyScreeningCount += 1; }
        bodies.add(candidate.memberSkillIds.join("|"));
      }
    }
    top = yield* evaluateStage(`M${index + 1} · 正式逐级筛选`, [...pool.values()], stage.trials,
      stage.keep, index * 100_000, compare, !weakSearch);
  }
  const finalists = new Map(top.slice(0, config.verificationTop).map((row) => [candidateKey(row.candidate), row.candidate]));
  for (const candidate of scan.candidates) if (scan.protectedKeys.has(candidateKey(candidate)))
    finalists.set(candidateKey(candidate), candidate);
  const finalCompare = (a: CandidateEvaluation, b: CandidateEvaluation) => b.winRate - a.winRate || compare(a, b);
  const verified = yield* evaluateStage("Final · 统一高场次复验", [...finalists.values()],
    config.verificationTrials, Math.max(config.topN, finalists.size), 500_000, finalCompare, false);
  const currentCandidate: RallyCandidate = { leaderHeroIds: input.sideA.leaderHeroIds ?? {},
    memberSkillIds: input.sideA.bodySkills?.map((body) => body.skillId) ?? input.sideA.selectedMemberSkillIds,
    ratios: currentRallyRatios(input), selectionReasons: ["currentConfig"] };
  const baselineSeeds = createStageSeeds(config.firstSeed, config.verificationTrials, 500_000);
  const [baselineResult] = yield [{ kind: "battle", input, seeds: baselineSeeds,
    side: "A", collectOutcomes: true, rallyCandidate: currentCandidate }];
  performance = addOptimizationPerformance(performance, baselineResult!.performance);
  evaluatedCandidates += 1;
  const baselineEvaluation = evaluateSingleCandidate(currentCandidate, totalTroops, baselineSeeds,
    () => baselineResult!.samples.outcomes.map(toSingleTrial));
  const unique = new Map<string, CandidateEvaluation>();
  for (const row of [...verified, baselineEvaluation]) unique.set(candidateKey(row.candidate), row);
  const ranked = [...unique.values()].sort(finalCompare).slice(0, config.topN);
  const headCandidateCount = TROOP_TYPES.reduce((count, troop) => count * headChoices[troop].length, 1);
  const theoryCoverage = { theoryCandidateCount: scan.theoryCandidateCount,
    legalHeroLineupCount: legalHeads.size, theoryHeroCoverage: 100, ratiosPerHeroLineup: scan.grid.length,
    localPeaksDetected: scan.localPeaksDetected, battleCandidateCount: scan.candidates.length,
    heroLineupsEnteringBattleEngine: stage1Heads.length, battleHeroCoverage: stage1Heads.length / legalHeads.size * 100 };
  return { top: ranked, coarseBest: ranked[0]!, evaluatedCandidates, current: baselineEvaluation, performance,
    searchDiagnostics: { theoryCoverage, theoryOptions: scan.options, theoryLineups: scan.lineups,
      battleSelections: [...selections].map(([key, selectionReasons]) => ({ candidateKey: key, selectionReasons })),
      monteCarloStages: stageRecords, localExpansionCount,
      legalHeadCandidateCount: legalHeads.size, evaluatedUniqueHeadCandidateCount: stage1Heads.length,
      headCoverageRate: theoryCoverage.battleHeroCoverage, fixedBody, availableBodyCandidateCount,
      stage1Trials: schedule[0]!.trials, stage1CandidateCount: scan.candidates.length, retainedHeadCandidateCount,
      stage2RatioCandidateCount: stageRecords[1]?.candidates ?? 0,
      fixedHead: TROOP_TYPES.every((troop) => config.constraints.fixedLeaders?.[troop] !== undefined),
      searchDimensions: { headShield: config.constraints.fixedLeaders?.shield === undefined,
        headLancer: config.constraints.fixedLeaders?.lancer === undefined,
        headMarksman: config.constraints.fixedLeaders?.marksman === undefined, body: !fixedBody, troopRatio: true },
      availableHeadHeroesByTroop: headChoices, shieldCandidateCount: headChoices.shield.length,
      lancerCandidateCount: headChoices.lancer.length, marksmanCandidateCount: headChoices.marksman.length,
      headCandidateCount, bodyCandidateCount: bodies.size, ratioCandidateCount: scan.grid.length,
      totalCandidateCount: legalHeads.size * bodies.size * scan.grid.length,
      coarseRatioCandidateCount: scan.grid.length, coarseCandidateCount: scan.candidates.length + bodyScreeningCount,
      generatedFormationCount: scan.formations.length, evaluatedHeadLineups: stage1Heads,
      bestHeadLineup: ranked[0]!.candidate.leaderHeroIds, optimizationTargetSide: "A", candidateChangedSide: "A" } };
}

/** Sync API retained for Node/tests; browser drives the same workflow with workers. */
export function searchSingleWave(input: OptimizationInput, config: OptimizationConfig,
  onProgress?: (progress: OptimizationProgress) => void,
  runner?: CandidateTrialRunner,
): SingleSearchResult {
  const execute = runner === undefined ? createEvaluationExecutor() :
    (job: EvaluationJob): EvaluationJobResult => {
      const trials = runner(job.rallyCandidate!, job.seeds);
      if (trials.length !== job.seeds.length) throw new Error("Invalid trial sample count.");
      return { samples: { trials: trials.length, requestedTrials: trials.length,
        wins: trials.filter((trial) => trial.outcome === "A").length,
        losses: trials.filter((trial) => trial.outcome === "B").length,
        failedTrials: 0, pruned: false,
        outcomes: trials.map((trial) => ({ outcome: trial.outcome,
          winner: trial.outcome === "A" || trial.outcome === "B" ? trial.outcome : null,
          failed: trial.outcome !== "A" && trial.outcome !== "B",
          remaining: { A: trial.self, B: trial.enemy },
          aRemaining: trial.self, bRemaining: trial.enemy,
          winnerRemaining: trial.outcome === "A" ? trial.self : trial.outcome === "B"
            ? trial.enemy : { shield: 0, lancer: 0, marksman: 0 },
          rounds: trial.rounds, roundCount: trial.rounds })),
      }, performance: { ...emptyOptimizationPerformance(), simulatedTrials: trials.length } };
    };
  return runOptimizationWorkflow(createSingleWaveSearchWorkflow(input, config, onProgress), execute);
}
