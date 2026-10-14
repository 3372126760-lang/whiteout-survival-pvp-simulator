import type { OptimizerProfiler } from "./profiling";
import { TROOP_TYPES } from "../types";
import { TemplateCache } from "./fastTemplates";
import { addOptimizationPerformance, createEvaluationExecutor, emptyOptimizationPerformance,
  runOptimizationWorkflow, type EvaluationJob, type EvaluationJobResult,
  type OptimizationPerformance, type OptimizationWorkflow } from "./execution";
import { createValidationBattleCompiler, type compileValidationBattle } from "../validationUi";
import { candidateKey, candidateToInput } from "./candidateGenerator";
import { MinRalliesObjective } from "./objectives";
import { createStageSeeds, deriveWaveSeed } from "./seedSet";
import { addTroopSample, emptyTroopSamples, summarizeTroopSamples } from "./statistics";
import type {
  MultiWaveEvaluation, OptimizationConfig, OptimizationInput, OptimizationProgress,
  RallyCandidate, TroopSurvivors, WaveEvaluation,
} from "./types";

export type FreshWaveRunner = (
  candidate: RallyCandidate,
  enemyCounts: TroopSurvivors,
  seed: number,
) => TroopSurvivors;

export function createEngineWaveRunner(
  input: OptimizationInput,
  onWaveComplete?: (rounds: number) => void,
): FreshWaveRunner {
  const compiled = new TemplateCache<ReturnType<typeof compileValidationBattle>>();
  const compile = createValidationBattleCompiler();
  return (candidate, enemyCounts, seed) => {
    const key = candidateKey(candidate);
    const battle = compiled.get(key, () => compile(candidateToInput(input, candidate)));
    const trial = battle.runFastFreshTrial(seed, enemyCounts);
    onWaveComplete?.(trial.roundCount);
    return trial.remaining.B;
  };
}

export function evaluateMultiWaveSequence(
  sequence: readonly RallyCandidate[],
  initialEnemy: TroopSurvivors,
  trajectorySeeds: readonly number[],
  targetProbability: number,
  runWave: FreshWaveRunner,
): MultiWaveEvaluation {
  if (sequence.length === 0 || trajectorySeeds.length === 0) throw new Error("Multi-wave evaluation needs waves and seeds.");
  const samples = sequence.map(() => emptyTroopSamples());
  const defeated = sequence.map(() => 0);
  for (const seed of trajectorySeeds) {
    // Each trajectory keeps its own actual random surviving counts, never a mean state.
    let enemy: TroopSurvivors = { ...initialEnemy };
    for (let wave = 0; wave < sequence.length; wave += 1) {
      if (TROOP_TYPES.some((troop) => !Number.isSafeInteger(enemy[troop]) || enemy[troop] < 0)) {
        throw new Error("Wave runner returned invalid enemy survivors.");
      }
      if (enemy.shield + enemy.lancer + enemy.marksman > 0) {
        enemy = runWave(sequence[wave]!, enemy, deriveWaveSeed(seed, wave));
      }
      addTroopSample(samples[wave]!, enemy);
      if (enemy.shield + enemy.lancer + enemy.marksman === 0) defeated[wave]! += 1;
    }
  }
  const waves: WaveEvaluation[] = samples.map((sample, index) => ({
    wave: index + 1,
    defeatProbability: defeated[index]! / trajectorySeeds.length,
    enemyRemaining: summarizeTroopSamples(sample),
  }));
  const targetIndex = waves.findIndex((wave) => wave.defeatProbability >= targetProbability);
  return {
    sequence: [...sequence],
    trials: trajectorySeeds.length,
    targetWaves: targetIndex < 0 ? null : targetIndex + 1,
    waves,
  };
}

export interface MultiWaveSearchResult {
  readonly top: readonly MultiWaveEvaluation[];
  readonly performance: OptimizationPerformance;
}

export function* createMultiWaveSearchWorkflow(
  input: OptimizationInput,
  candidates: readonly RallyCandidate[],
  config: OptimizationConfig,
  onProgress?: (progress: OptimizationProgress) => void,
  profiler?: OptimizerProfiler,
): OptimizationWorkflow<MultiWaveSearchResult> {
  if (candidates.length === 0) throw new Error("No multi-wave candidates.");
  const initial = input.sideB.rallyDeployment;
  if (initial === undefined) throw new Error("Defender rally deployment is required.");
  const { allocateRallyTroopsByRatio } = rallyModule;
  const initialEnemy = allocateRallyTroopsByRatio(initial);
  const branches = candidates.slice(0, config.branchWidth);
  const beamSeeds = createStageSeeds(config.firstSeed, config.beamTrials, 750_000);
  let performance = emptyOptimizationPerformance();
  let beam: MultiWaveEvaluation[] = [];
  let sequences: readonly (readonly RallyCandidate[])[] = branches.map((candidate) => [candidate]);
  for (let depth = 1; depth <= config.maxWaves; depth += 1) {
    profiler?.begin(`多波粗筛 ${depth}/${config.maxWaves}`, sequences.length);
    const rows = yield sequences.map((sequence): EvaluationJob => ({ kind: "multiWave",
      input, side: "A", seeds: beamSeeds, sequence, initialEnemy,
      targetProbability: config.targetDefeatProbability }));
    const stage = rows.map((row, index) => {
      performance = addOptimizationPerformance(performance, row.performance);
      onProgress?.({ stage: `多波粗筛 ${depth}/${config.maxWaves}`, completed: index + 1, total: sequences.length });
      if (row.multiWave === undefined) throw new Error("Invalid multi-wave result.");
      return row.multiWave;
    });
    profiler?.end();
    stage.sort(MinRalliesObjective.compare);
    beam = stage.slice(0, config.beamWidth);
    if (beam.some((entry) => entry.targetWaves !== null)) break;
    sequences = beam.flatMap((entry) => branches.map((candidate) => [...entry.sequence, candidate]));
  }
  // Beam uses sampled trajectory distributions for ranking. Final results are
  // re-run end-to-end on an independent common seed set for every finalist.
  const finalists = [...beam].sort(MinRalliesObjective.compare)
    .slice(0, config.verificationTop);
  const verificationSeeds = createStageSeeds(config.firstSeed, config.verificationTrials, 900_000);
  profiler?.begin("多波统一复验", finalists.length);
  const rows = yield finalists.map((entry): EvaluationJob => ({ kind: "multiWave",
    input, side: "A", seeds: verificationSeeds, sequence: entry.sequence, initialEnemy,
    targetProbability: config.targetDefeatProbability }));
  const top = rows.map((row, index) => {
    performance = addOptimizationPerformance(performance, row.performance);
    onProgress?.({ stage: "多波统一复验", completed: index + 1, total: finalists.length });
    if (row.multiWave === undefined) throw new Error("Invalid multi-wave result.");
    return row.multiWave;
  }).sort(MinRalliesObjective.compare).slice(0, config.topN);
  profiler?.end();
  return { top, performance };
}

export function searchMultiWave(input: OptimizationInput, candidates: readonly RallyCandidate[],
  config: OptimizationConfig, onProgress?: (progress: OptimizationProgress) => void,
  runWave?: FreshWaveRunner,
): readonly MultiWaveEvaluation[] {
  const execute = runWave === undefined ? createEvaluationExecutor() :
    (job: EvaluationJob): EvaluationJobResult => ({
      multiWave: evaluateMultiWaveSequence(job.sequence!, job.initialEnemy!, job.seeds,
        job.targetProbability!, runWave),
      samples: { trials: job.seeds.length, requestedTrials: job.seeds.length,
        wins: 0, losses: 0, failedTrials: 0, pruned: false, outcomes: [] },
      performance: { ...emptyOptimizationPerformance(), simulatedTrials: job.seeds.length },
    });
  return runOptimizationWorkflow(createMultiWaveSearchWorkflow(input, candidates, config, onProgress), execute).top;
}

import * as rallyModule from "../validationUi/rallyDeployment";
