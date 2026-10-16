import { createValidationBattleCompiler, deriveBatchSeed, toValidationThreeQueueConfig,
  type compileValidationBattle,
  type ValidationBattleInput } from "../validationUi";
import { ThreeQueueUnresolvedError, type ThreeQueueScenarioConfig,
  type ThreeQueueScenarioResult } from "../scenario/threeQueueScenario";
import type { FastBattleResult } from "../battle/fastBattleMode";
import type { SideId } from "../types/combat";
import { createFastThreeQueueCompiler, TemplateCache, type compileFastThreeQueue } from "./fastTemplates";
import { shouldEliminate, type EarlyEliminationOptions, type WinSample } from "./earlyElimination";
import type { MultiWaveEvaluation, RallyCandidate, TroopSurvivors } from "./types";
import { createEngineWaveRunner, evaluateMultiWaveSequence } from "./multiWaveSearch";
import { scanJointPeaks, type JointPeakJob, type JointPeakChunk } from "./jointPipeline/peakScan";

export interface EvaluationJob {
  readonly collectTrajectories?: boolean;
  readonly profiling?: boolean;
  readonly kind: "battle" | "threeQueue" | "multiWave" | "jointPeak";
  readonly jointPeakJob?: JointPeakJob;
  readonly input: ValidationBattleInput;
  readonly seeds: readonly number[];
  readonly side: SideId;
  readonly collectOutcomes?: boolean;
  /** Used by injected rally trial runners; the engine evaluates the assembled input. */
  readonly rallyCandidate?: RallyCandidate;
  readonly sequence?: readonly RallyCandidate[];
  readonly initialEnemy?: TroopSurvivors;
  readonly targetProbability?: number;
  readonly pruning?: EarlyEliminationOptions;
  readonly protectFromPruning?: boolean;
}
export interface EvaluationSamples {
  readonly trajectories?: readonly TrajectoryObservation[];
  readonly trials: number;
  readonly requestedTrials: number;
  readonly wins: number;
  readonly losses: number;
  readonly failedTrials: number;
  readonly pruned: boolean;
  readonly outcomes: readonly FastBattleResult[];
}
export interface TrajectoryObservation {
  readonly candidateKey?: string;
  readonly seed: number;
  readonly outcome: "A" | "B" | "failed";
  readonly battleCount: number;
  readonly remainingQueuesA: number;
  readonly remainingQueuesB: number;
  readonly maxRoundHitCount: number;
  readonly failedBattleId?: string;
  readonly failedBattleSeed?: number;
  readonly failureReason?: "roundLimit" | "simultaneousElimination" | "unknown";
}
export interface OptimizationPerformance {
  readonly simulatedTrials: number;
  readonly skippedTrials: number;
  readonly prunedCandidates: number;
  readonly templateBuilds: number;
  readonly templateHits: number;
  readonly workerCount?: number;
}
export interface EvaluationJobResult {
  readonly jointPeak?: JointPeakChunk;
  readonly timing?: { readonly battleCount: number; readonly battleElapsedMs: number };
  readonly samples: EvaluationSamples;
  readonly performance: OptimizationPerformance;
  readonly multiWave?: MultiWaveEvaluation;
}
export type OptimizationWorkflow<T> = Generator<readonly EvaluationJob[], T, readonly EvaluationJobResult[]>;
export type AsyncEvaluationExecutor = (jobs: readonly EvaluationJob[]) => Promise<readonly EvaluationJobResult[]>;

export function emptyOptimizationPerformance(): OptimizationPerformance {
  return { simulatedTrials: 0, skippedTrials: 0, prunedCandidates: 0,
    templateBuilds: 0, templateHits: 0 };
}
export function addOptimizationPerformance(a: OptimizationPerformance,
  b: OptimizationPerformance): OptimizationPerformance {
  return { simulatedTrials: a.simulatedTrials + b.simulatedTrials,
    skippedTrials: a.skippedTrials + b.skippedTrials,
    prunedCandidates: a.prunedCandidates + b.prunedCandidates,
    templateBuilds: a.templateBuilds + b.templateBuilds,
    templateHits: a.templateHits + b.templateHits };
}

/** Own one executor per optimizer session/worker, so stages reuse static templates. */
export function createEvaluationExecutor(
  executeScenario?: (config: ThreeQueueScenarioConfig) => ThreeQueueScenarioResult,
) {
  const battles = new TemplateCache<ReturnType<typeof compileValidationBattle>>();
  const compile = createValidationBattleCompiler();
  const queues = new TemplateCache<ReturnType<typeof compileFastThreeQueue>>(32);
  let compileQueues: ReturnType<typeof createFastThreeQueueCompiler> | undefined;
  const waves = new TemplateCache<ReturnType<typeof createEngineWaveRunner>>(16);
  return (job: EvaluationJob): EvaluationJobResult => {
    if (job.kind === "jointPeak") {
      if (!job.jointPeakJob) throw new Error("Missing joint peak job.");
      return { jointPeak: scanJointPeaks(job.jointPeakJob),
        samples: { trials: 0, requestedTrials: 0, wins: 0, losses: 0, failedTrials: 0, pruned: false, outcomes: [] },
        performance: emptyOptimizationPerformance() };
    }
    let battleCount = 0, battleElapsedMs = 0;
    const observe = (elapsedMs: number) => { battleCount++; battleElapsedMs += elapsedMs; };
    const timed = <T>(run: () => T): T => {
      if (!job.profiling) return run();
      const start = performance.now();
      try { return run(); } finally { observe(performance.now() - start); }
    };
    const timing = () => job.profiling ? { timing: { battleCount, battleElapsedMs } } : {};
    const builds = battles.builds + queues.builds;
    const hits = battles.hits + queues.hits;
    // RNG seed is supplied separately. Every other setting participates in the key.
    const signature = JSON.stringify({ ...job.input, randomSeed: 0, simulationMode: "fixedSeed" });
    if (job.kind === "multiWave") {
      if (job.sequence === undefined || job.initialEnemy === undefined || job.targetProbability === undefined) {
        throw new Error("Incomplete multi-wave evaluation job.");
      }
      const previousBuilds = waves.builds;
      const previousHits = waves.hits;
      const runner = waves.get(signature, () => createEngineWaveRunner(job.input));
      const multiWave = evaluateMultiWaveSequence(job.sequence, job.initialEnemy,
        job.seeds, job.targetProbability, (candidate, enemy, seed) => timed(() => runner(candidate, enemy, seed)));
      return { multiWave, ...timing(),
        samples: { trials: job.seeds.length, requestedTrials: job.seeds.length,
          wins: Math.round(multiWave.waves.at(-1)!.defeatProbability * job.seeds.length),
          losses: 0, failedTrials: 0, pruned: false, outcomes: [] },
        performance: { simulatedTrials: job.seeds.length, skippedTrials: 0, prunedCandidates: 0,
          templateBuilds: waves.builds - previousBuilds, templateHits: waves.hits - previousHits } };
    }
    const battle = job.kind === "battle"
      ? battles.get(signature, () => compile(job.input)) : undefined;
    const config = job.kind === "threeQueue" ? toValidationThreeQueueConfig(job.input) : undefined;
    const queue = config !== undefined && executeScenario === undefined
      ? queues.get(signature, () => {
        compileQueues ??= createFastThreeQueueCompiler();
        return compileQueues(config);
      }) : undefined;
    let wins = 0;
    let losses = 0;
    let failedTrials = 0;
    let trials = 0;
    let pruned = false;
    const outcomes: FastBattleResult[] = [];
    const trajectories: TrajectoryObservation[] = [];
    for (const seed of job.seeds) {
      trials += 1;
      let duelCount = 0, maxRoundHitCount = 0, failedBattleId: string | undefined;
      let failedBattleSeed: number | undefined, failureReason: TrajectoryObservation["failureReason"];
      try {
        let outcome: FastBattleResult["outcome"];
        if (battle !== undefined) {
          const trial = timed(() => battle.runFastTrial(seed));
          outcome = trial.outcome;
          if (job.collectOutcomes) outcomes.push(trial);
        } else if (queue !== undefined) {
          const trial = queue.run(seed, job.profiling ? observe : undefined, job.collectTrajectories ? (duel) => {
            duelCount++;
            if (duel.roundCount >= config!.maxRoundsPerBattle && duel.outcome === "timeout") {
              maxRoundHitCount++;
            }
            if (duel.outcome === "timeout" || duel.outcome === "draw") {
              failedBattleId = duel.battleId; failedBattleSeed = duel.battleSeed;
              failureReason = duel.outcome === "timeout" ? "roundLimit" : "simultaneousElimination";
            }
          } : undefined);
          outcome = trial.winner;
          if (job.collectTrajectories) trajectories.push({ seed, outcome, battleCount: trial.totalBattles,
            remainingQueuesA: trial.remainingQueues.A.length, remainingQueuesB: trial.remainingQueues.B.length, maxRoundHitCount });
        } else {
          const trial = executeScenario!({ ...config!, seed });
          outcome = trial.winner;
          if (job.collectTrajectories) trajectories.push({ seed, outcome, battleCount: trial.totalBattles,
            remainingQueuesA: trial.remainingAttackerQueues.length, remainingQueuesB: trial.remainingDefenderQueues.length, maxRoundHitCount: 0 });
        }
        if (outcome === job.side) wins += 1;
        else if (outcome === (job.side === "A" ? "B" : "A")) losses += 1;
      } catch (error) {
        if (!(error instanceof ThreeQueueUnresolvedError)) throw error;
        failedTrials += 1;
        if (job.collectTrajectories) trajectories.push({ seed, outcome: "failed", battleCount: duelCount,
          remainingQueuesA: 0, remainingQueuesB: 0, maxRoundHitCount,
          failureReason: failureReason ?? "unknown",
          ...(failedBattleId === undefined ? {} : { failedBattleId }),
          ...(failedBattleSeed === undefined ? {} : { failedBattleSeed }) });
      }
      if (job.pruning !== undefined && shouldEliminate({ wins, trials }, job.pruning)) {
        pruned = true;
        break;
      }
    }
    return { ...timing(), samples: { trials, requestedTrials: job.seeds.length, wins, losses,
      failedTrials, pruned, outcomes, ...(job.collectTrajectories ? { trajectories } : {}) }, performance: {
      simulatedTrials: trials, skippedTrials: job.seeds.length - trials,
      prunedCandidates: pruned ? 1 : 0,
      templateBuilds: battles.builds + queues.builds - builds,
      templateHits: battles.hits + queues.hits - hits,
    } };
  };
}

export function runOptimizationWorkflow<T>(workflow: OptimizationWorkflow<T>,
  execute = createEvaluationExecutor()): T {
  let step = workflow.next();
  while (!step.done) {
    let rows: readonly EvaluationJobResult[];
    try { rows = step.value.map(execute); }
    catch (error) { workflow.throw(error); throw error; }
    step = workflow.next(rows);
  }
  return step.value;
}
export async function runOptimizationWorkflowAsync<T>(workflow: OptimizationWorkflow<T>,
  execute: AsyncEvaluationExecutor): Promise<T> {
  let step = workflow.next();
  while (!step.done) {
    let rows: readonly EvaluationJobResult[];
    try { rows = await execute(step.value); }
    catch (error) { workflow.throw(error); throw error; }
    step = workflow.next(rows);
  }
  return step.value;
}

/** Fixed-size batches make results independent of worker completion order/count.
 * First candidate runs fully; subsequent batches use the best fully evaluated row.
 * Partial samples are excluded from promotion and can never reach final rankings.
 */
export function* evaluateSearchStage<T>(
  candidates: readonly T[], makeJob: (candidate: T) => EvaluationJob,
  prune: boolean, onRow: (candidate: T, row: EvaluationJobResult, index: number) => void,
  comparisons = candidates.length,
  initialBest?: WinSample,
): OptimizationWorkflow<void> {
  let best = initialBest;
  for (let index = 0; index < candidates.length;) {
    const size = index === 0 && best === undefined ? 1 : 4;
    const chunk = candidates.slice(index, index + size);
    const jobs = chunk.map((candidate) => {
      const job = makeJob(candidate);
      return prune && best !== undefined && job.protectFromPruning !== true ? { ...job,
        pruning: { reference: best, maxTrials: job.seeds.length, comparisons } } : job;
    });
    const rows = yield jobs;
    if (rows.length !== chunk.length) throw new Error("Invalid evaluation batch size.");
    rows.forEach((row, offset) => {
      const sample = row.samples;
      if (!sample.pruned && (best === undefined || sample.wins / sample.trials > best.wins / best.trials)) {
        best = sample;
      }
      onRow(chunk[offset]!, row, index + offset);
    });
    index += chunk.length;
  }
}

/** Identical to the existing three-queue batch root/trial derivation. */
export function threeQueueStageSeeds(seed: number, trials: number): readonly number[] {
  const root = deriveBatchSeed(seed, 0);
  return Array.from({ length: trials }, (_, index) => deriveBatchSeed(root, index));
}
