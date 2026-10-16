import { OptimizerProfiler, profileOptimizationWorkflow, type SearchPerformanceReport } from "./profiling";
import type { FastBattleResult } from "../battle/fastBattleMode";
import { allocateRallyTroopsByRatio, createValidationBattleCompiler, type compileValidationBattle } from "../validationUi";
import { candidateKey, candidateToInput } from "./candidateGenerator";
import { TemplateCache } from "./fastTemplates";
import { createEvaluationExecutor, emptyOptimizationPerformance, runOptimizationWorkflow,
  type EvaluationJob, type EvaluationJobResult, type OptimizationPerformance, type OptimizationWorkflow } from "./execution";
import { addTroopSample, emptyTroopSamples, summarizeTroopSamples, wilsonInterval } from "./statistics";
import type { CandidateEvaluation, OptimizationConfig, OptimizationInput, OptimizationProgress, RallyCandidate, RallySearchDiagnostics, TroopSurvivors } from "./types";
import { createPeakJointWorkflow } from "./jointPipeline/workflow";
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
import * as batchMetricModule from "../validationUi/batchSimulation";

export interface SingleSearchResult {
  readonly searchPerformanceReport?: SearchPerformanceReport;
  readonly searchDiagnostics: RallySearchDiagnostics;
  readonly top: readonly CandidateEvaluation[];
  readonly coarseBest: CandidateEvaluation;
  readonly evaluatedCandidates: number;
  readonly current: CandidateEvaluation;
  readonly performance: OptimizationPerformance;
}

export function* createSingleWaveSearchWorkflow(input: OptimizationInput, config: OptimizationConfig,
  onProgress?: (progress: OptimizationProgress) => void, profiler?: OptimizerProfiler): OptimizationWorkflow<SingleSearchResult> {
  return yield* createPeakJointWorkflow(input, config, onProgress, profiler);
}

/** Sync API retained for Node/tests; browser drives the same workflow with workers. */
export function searchSingleWave(input: OptimizationInput, config: OptimizationConfig,
  onProgress?: (progress: OptimizationProgress) => void,
  runner?: CandidateTrialRunner,
): SingleSearchResult {
  const execute = runner === undefined ? createEvaluationExecutor() :
    (job: EvaluationJob): EvaluationJobResult => {
      if (job.kind === "jointPeak") return createEvaluationExecutor()(job);
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
  const profiler = config.profiling ? new OptimizerProfiler(onProgress) : undefined;
  return runOptimizationWorkflow(profileOptimizationWorkflow(createSingleWaveSearchWorkflow(input, config, profiler?.progress ?? onProgress, profiler), profiler), execute);
}
