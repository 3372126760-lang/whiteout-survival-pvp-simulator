// Previous pre-theory search stages for comparisons; body legality/templates use current B0 policy.
import { TROOP_TYPES } from "../../src/pvp/types";
import type { FastBattleResult } from "../../src/pvp/battle/fastBattleMode";
import { allocateRallyTroopsByRatio, createValidationBattleCompiler, type compileValidationBattle,
  resolveValidationTroopCounts } from "../../src/pvp/validationUi";
import { availableHeadHeroesByTroop, candidateKey, candidateToInput, generateAllHeadFormations, generateRatioGrid, refineRatios } from "../../src/pvp/optimizer/candidateGenerator";
import { createLegacyBodySearchPool } from "../../src/pvp/optimizer/criterion/bodyEnumeration";
import { createStageSeeds } from "../../src/pvp/optimizer/seedSet";
import { TemplateCache } from "../../src/pvp/optimizer/fastTemplates";
import { addOptimizationPerformance, createEvaluationExecutor, emptyOptimizationPerformance,
  evaluateSearchStage, runOptimizationWorkflow,
  type EvaluationJob, type EvaluationJobResult, type OptimizationPerformance, type OptimizationWorkflow } from "../../src/pvp/optimizer/execution";
import { SingleWinObjective } from "../../src/pvp/optimizer/objectives";
import { addTroopSample, emptyTroopSamples, summarizeTroopSamples, wilsonInterval } from "../../src/pvp/optimizer/statistics";
import type { CandidateEvaluation, OptimizationConfig, OptimizationInput, OptimizationProgress, RallyCandidate, RallySearchDiagnostics, TroopSurvivors } from "../../src/pvp/optimizer/types";

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
import * as batchMetricModule from "../../src/pvp/validationUi/batchSimulation";

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
  if (input.sideA.rallyDeployment === undefined || input.sideB.rallyDeployment === undefined) {
    throw new Error("Single-wave optimization requires both rally deployments.");
  }
  const predictedCounts = input.attributeInputMode === "prediction"
    ? resolveValidationTroopCounts(input.sideA, "rally", "prediction") : null;
  const totalTroops = predictedCounts === null ? input.sideA.rallyDeployment.totalTroops
    : TROOP_TYPES.reduce((sum, troop) => sum + predictedCounts[troop], 0);
  const stage1 = config.stages[0];
  const fullGrid = generateRatioGrid(stage1.ratioStep);
  const headChoices = availableHeadHeroesByTroop(input, config.constraints);
  const formations = generateAllHeadFormations(input, config.constraints);
  if (formations.length === 0) throw new Error("No eligible hero formation satisfies the constraints.");
  const evaluatedHeads = new Map<string, RallyCandidate["leaderHeroIds"]>();
  const currentRatio = input.sideA.rallyDeployment.ratios;
  const representativeRatios = [currentRatio, { shield: 34, lancer: 33, marksman: 33 },
    { shield: 60, lancer: 10, marksman: 30 }]
    .filter((ratio, index, rows) => rows.findIndex((other) =>
      TROOP_TYPES.every((troop) => ratio[troop] === other[troop])) === index);
  const headCandidates = formations.flatMap((formation) =>
    representativeRatios.map((ratios) => ({ ...formation, ratios })));
  const headTrials = Math.min(20, stage1.trials);
  const fixedBody = config.constraints.fixedBodyExact === true || (config.constraints.fixedMemberSkillIds?.length ?? 0) === 4;
  let evaluatedCandidates = 0;
  let performance = emptyOptimizationPerformance();
  const evaluateStage = function* (name: string, candidates: readonly RallyCandidate[], trials: number,
    keep: number, offset: number, compare: (a: CandidateEvaluation, b: CandidateEvaluation) => number,
    prune = true): OptimizationWorkflow<CandidateEvaluation[]> {
    const seeds = createStageSeeds(config.firstSeed, trials, offset);
    const evaluated: CandidateEvaluation[] = [];
    yield* evaluateSearchStage(candidates, (candidate) => ({ kind: "battle",
      input: candidateToInput(input, candidate), seeds, side: "A", collectOutcomes: true,
      rallyCandidate: candidate }), prune,
    (candidate, result, index) => {
      evaluatedHeads.set(TROOP_TYPES.map((troop) => candidate.leaderHeroIds[troop] ?? "").join("|"), candidate.leaderHeroIds);
      performance = addOptimizationPerformance(performance, result.performance);
      evaluatedCandidates += 1;
      if (!result.samples.pruned) evaluated.push(evaluateSingleCandidate(candidate, totalTroops,
        seeds.slice(0, result.samples.trials), () => result.samples.outcomes.map(toSingleTrial)));
      if ((index + 1) % 5 === 0 || index + 1 === candidates.length) {
        onProgress?.({ stage: name, completed: index + 1, total: candidates.length });
      }
    }, config.stages.reduce((sum, stage) => sum + stage.maxCandidates, 0));
    return evaluated.sort(compare).slice(0, keep);
  };
  // Every legal joint head receives genuine trace-free battles, even with a
  // small refinement budget. Do not prune this mandatory coverage stage.
  const headRows = yield* evaluateStage("Stage 1 · 车头全覆盖", headCandidates,
    headTrials, headCandidates.length, 0, SingleWinObjective.compare, false);
  const stage1Heads = [...evaluatedHeads.values()];
  if (stage1Heads.length !== formations.length) throw new Error("Stage 1 车头覆盖不完整。");
  const bestByHead = new Map<string, CandidateEvaluation>();
  for (const row of headRows) {
    const key = TROOP_TYPES.map((troop) => row.candidate.leaderHeroIds[troop] ?? "").join("|");
    if (!bestByHead.has(key)) bestByHead.set(key, row);
  }
  const retainedHeads = [...bestByHead.values()].slice(0, Math.min(100, stage1.keep));
  const referenceHead = formations.find((formation) => TROOP_TYPES.every((troop) =>
    (formation.leaderHeroIds[troop] ?? null) === (input.sideB.leaderHeroIds?.[troop] ?? null)));
  const referenceCandidate = referenceHead === undefined ? undefined :
    { ...referenceHead, ratios: currentRatio };
  // Full coarse ratio grid for each retained head, plus the incumbent and the
  // known legal opponent-head reference. All use the same stage seed set.
  const coarseMap = new Map<string, RallyCandidate>();
  for (const row of retainedHeads) for (const ratios of fullGrid) {
    const candidate = { ...row.candidate, ratios };
    coarseMap.set(candidateKey(candidate), candidate);
  }
  for (const row of headRows.slice(0, stage1.keep)) coarseMap.set(candidateKey(row.candidate), row.candidate);
  if (referenceCandidate !== undefined) coarseMap.set(candidateKey(referenceCandidate), referenceCandidate);
  const coarse = [...coarseMap.values()];
  const ratioRows = yield* evaluateStage("Stage 2 · Top 车头全比例筛选", coarse,
    stage1.trials, stage1.keep, 100_000, SingleWinObjective.compare,
    config.objectiveMode === "singleWin");
  const bodyPool = createLegacyBodySearchPool(input, config.constraints, formations[0]!.leaderHeroIds);
  const bodyFormations = bodyPool.rows;
  const availableBodyCandidateCount = bodyPool.audit.finalPreprocessedBodyCount;
  const bodyVariants = new Map<string, readonly string[]>();
  for (const row of headRows) bodyVariants.set(row.candidate.memberSkillIds.join("|"), row.candidate.memberSkillIds);
  const bodyRows: CandidateEvaluation[] = [];
  let bodyScreeningCount = 0;
  if (!fixedBody && availableBodyCandidateCount > 1) {
    const bodyCandidates = new Map<string, RallyCandidate>();
    const parents = ratioRows.slice(0, 3);
    const perHead = Math.max(2, Math.floor(stage1.maxCandidates / Math.max(1, parents.length)));
    const selected = Array.from({ length: Math.min(perHead, bodyFormations.length) }, (_, index) =>
      bodyFormations[Math.round(index * (bodyFormations.length - 1) / Math.max(1, Math.min(perHead, bodyFormations.length) - 1))]!);
    for (const parent of parents) for (const body of selected) {
      const candidate = { ...parent.candidate, memberSkillIds: body.memberSkillIds };
      bodyCandidates.set(candidateKey(candidate), candidate);
      bodyVariants.set(candidate.memberSkillIds.join("|"), candidate.memberSkillIds);
    }
    bodyScreeningCount = bodyCandidates.size;
    bodyRows.push(...yield* evaluateStage("Stage 2 · 车身筛选", [...bodyCandidates.values()],
      stage1.trials, stage1.keep, 100_000, SingleWinObjective.compare,
      config.objectiveMode === "singleWin"));
  }
  const coarseEvaluations = [...headRows.slice(0, stage1.keep), ...ratioRows, ...bodyRows];
  const coarseBest = [...coarseEvaluations].sort((a, b) => b.winRate - a.winRate)[0]!;
  const weakSearch = config.objectiveMode === "minRallies" ||
    (config.objectiveMode === "auto" && coarseBest.winRate <= config.singleFightThresholdLow);
  const compare = weakSearch ? compareWeakPrimer : SingleWinObjective.compare;
  let top = [...coarseEvaluations].sort(compare).slice(0, stage1.keep);
  for (let index = 1; index < config.stages.length; index += 1) {
    const stage = config.stages[index]!;
    const previousStep = config.stages[index - 1]!.ratioStep;
    const candidates = new Map<string, RallyCandidate>();
    for (const evaluation of top) {
      const incumbent = evaluation.candidate;
      candidates.set(candidateKey(incumbent, config.constraints.equivalentMemberPositions), incumbent);
    }
    for (const evaluation of top) {
      for (const ratios of refineRatios(evaluation.candidate.ratios, stage.ratioStep, previousStep)) {
        const candidate = { ...evaluation.candidate, ratios };
        candidates.set(candidateKey(candidate, config.constraints.equivalentMemberPositions), candidate);
        if (candidates.size >= stage.maxCandidates) break;
      }
      if (candidates.size >= stage.maxCandidates) break;
    }
    top = yield* evaluateStage(`细筛 ${stage.ratioStep}%`, [...candidates.values()], stage.trials, stage.keep, (index + 1) * 100_000, compare, !weakSearch);
  }
  // Final rankings use one common, independent high-sample verification seed set.
  const finalists = new Map(top.slice(0, config.verificationTop).map((row) => [candidateKey(row.candidate), row.candidate]));
  // Retain the eligible opponent-head reference even if coarse Monte Carlo undersampled it.
  if (referenceCandidate !== undefined) finalists.set(candidateKey(referenceCandidate), referenceCandidate);
  const finalCompare = (a: CandidateEvaluation, b: CandidateEvaluation) => b.winRate - a.winRate || compare(a, b);
  const verified = yield* evaluateStage("统一复验", [...finalists.values()],
    config.verificationTrials, config.topN, 500_000, finalCompare, false);
  const currentCandidate: RallyCandidate = {
    leaderHeroIds: input.sideA.leaderHeroIds ?? {},
    memberSkillIds: input.sideA.bodySkills?.map((body) => body.skillId) ??
      input.sideA.selectedMemberSkillIds,
    ratios: input.sideA.rallyDeployment.ratios,
  };
  const baselineSeeds = createStageSeeds(config.firstSeed, config.verificationTrials, 500_000);
  const [baselineResult] = yield [{ kind: "battle", input, seeds: baselineSeeds,
    side: "A", collectOutcomes: true, rallyCandidate: currentCandidate }];
  performance = addOptimizationPerformance(performance, baselineResult!.performance);
  const baselineEvaluation = evaluateSingleCandidate(currentCandidate, totalTroops, baselineSeeds,
    () => baselineResult!.samples.outcomes.map(toSingleTrial));
  evaluatedHeads.set(TROOP_TYPES.map((troop) => currentCandidate.leaderHeroIds[troop] ?? "").join("|"), currentCandidate.leaderHeroIds);
  const unique = new Map<string, CandidateEvaluation>();
  for (const row of [...verified, baselineEvaluation]) unique.set(candidateKey(row.candidate), row);
  const ranked = [...unique.values()].sort(finalCompare).slice(0, config.topN);
  const headCandidateCount = TROOP_TYPES.reduce((count, troop) => count * headChoices[troop].length, 1);
  const bodyCandidateCount = bodyVariants.size;
  return { top: ranked, coarseBest, evaluatedCandidates, current: baselineEvaluation, performance,
    searchDiagnostics: {
      legalHeadCandidateCount: formations.length,
      evaluatedUniqueHeadCandidateCount: stage1Heads.length,
      headCoverageRate: stage1Heads.length / formations.length * 100,
      fixedBody,
      availableBodyCandidateCount, stage1Trials: headTrials,
      stage1CandidateCount: headCandidates.length, retainedHeadCandidateCount: retainedHeads.length,
      stage2RatioCandidateCount: coarse.length,
      fixedHead: TROOP_TYPES.every((troop) => config.constraints.fixedLeaders?.[troop] !== undefined),
      searchDimensions: { headShield: config.constraints.fixedLeaders?.shield === undefined,
        headLancer: config.constraints.fixedLeaders?.lancer === undefined,
        headMarksman: config.constraints.fixedLeaders?.marksman === undefined,
        body: !fixedBody, troopRatio: true },
      availableHeadHeroesByTroop: headChoices,
      shieldCandidateCount: headChoices.shield.length, lancerCandidateCount: headChoices.lancer.length,
      marksmanCandidateCount: headChoices.marksman.length, headCandidateCount,
      bodyCandidateCount, ratioCandidateCount: fullGrid.length,
      coarseRatioCandidateCount: fullGrid.length,
      coarseCandidateCount: headCandidates.length + coarse.length + bodyScreeningCount,
      totalCandidateCount: headCandidateCount * bodyCandidateCount * fullGrid.length,
      generatedFormationCount: formations.length, evaluatedHeadLineups: stage1Heads,
      bestHeadLineup: ranked[0]!.candidate.leaderHeroIds,
      optimizationTargetSide: "A", candidateChangedSide: "A",
    } };
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
