import { createEngineCandidateRunner, evaluateSingleCandidate,
  createSingleWaveSearchWorkflow, type SingleSearchResult } from "./singleWaveSearch";
import { OptimizerProfiler, profileOptimizationWorkflow } from "./profiling";
import { createMultiWaveSearchWorkflow } from "./multiWaveSearch";
import { AutoObjective } from "./objectives";
import { createStageSeeds } from "./seedSet";
import { defaultTheoryOptions, validateTheoryOptions } from "./theory";
import { resolveCriterionSearchOptions } from "./criterion/searchTypes";
import { createOptimizationContext } from "./optimizationContext";
import { resolveSearchDimensions } from "./searchDimensions";
import { TROOP_TYPES } from "../types";
import { candidateToInput } from "./candidateGenerator";
import { createEvaluationExecutor } from "./execution";
import type { SideId } from "../types";
import type { ScenarioOptimizer } from "./scenarioOptimizer";
import type { CandidateEvaluation, MultiWaveEvaluation, OptimizationConfig, OptimizationInput, OptimizationProgress, OptimizationResult, RallyCandidate } from "./types";
import { addOptimizationPerformance, runOptimizationWorkflow, runOptimizationWorkflowAsync,
  type AsyncEvaluationExecutor, type OptimizationWorkflow } from "./execution";

export * from "./types";
export * from "./statistics";
export * from "./candidateGenerator";
export * from "./seedSet";
export * from "./singleWaveSearch";
export * from "./multiWaveSearch";
export * from "./objectives";
export * from "./scenarioOptimizer";
export * from "./threeQueueOptimizer";
export * from "./innerEarthOptimizer";
export * from "./execution";
export * from "./earlyElimination";
export * from "./theory";
export * from "./basinSearch";
export * from "./heroSearchPolicy";
export * from "./profiling";
export * from "./heroPools";
export * from "./optimizationContext";
export * from "./searchDimensions";
export * from "./criterion";
export * from "./adaptiveSampling";
export * from "./adaptiveBasinSearch";

/** UI defaults are deliberately bounded; all search effort parameters are configurable. */
export function defaultOptimizationConfig(seed = 12_345): OptimizationConfig {
  return {
    candidateSide: "A",
    objectiveMode: "auto",
    constraints: {},
    stages: [
      { ratioStep: 5, trials: 20, keep: 3000, maxCandidates: 300 },
      { ratioStep: 5, trials: 50, keep: 500, maxCandidates: 100 },
      { ratioStep: 1, trials: 100, keep: 50, maxCandidates: 60 },
    ],
    theory: defaultTheoryOptions(),
    criterion: resolveCriterionSearchOptions(),
    initialBattleTrials: 5,
    verificationTrials: 1000,
    verificationTop: 5,
    topN: 5,
    firstSeed: seed,
    targetDefeatProbability: .90,
    maxWaves: 3,
    beamWidth: 3,
    branchWidth: 3,
    beamTrials: 50,
    singleFightThresholdLow: .05,
    singleFightThresholdHigh: .95,
  };
}

export function runRallyOptimization(
  input: OptimizationInput,
  config: OptimizationConfig,
  onProgress?: (progress: OptimizationProgress) => void,
): OptimizationResult {
  return runOptimizationWorkflow(createRallyOptimizationWorkflow(input, config, onProgress));
}

export async function runRallyOptimizationAsync(input: OptimizationInput,
  config: OptimizationConfig, execute: AsyncEvaluationExecutor,
  onProgress?: (progress: OptimizationProgress) => void,
): Promise<OptimizationResult> {
  return runOptimizationWorkflowAsync(createRallyOptimizationWorkflow(input, config, onProgress), execute);
}

export function* createRallyOptimizationWorkflow(input: OptimizationInput,
  config: OptimizationConfig, onProgress?: (progress: OptimizationProgress) => void,
): OptimizationWorkflow<OptimizationResult> {
  const profiler = config.profiling ? new OptimizerProfiler(onProgress) : undefined;
  return yield* profileOptimizationWorkflow(createRallyWorkflow(input, config,
    profiler?.progress ?? onProgress, profiler), profiler);
}
function* createRallyWorkflow(input: OptimizationInput,
  config: OptimizationConfig, onProgress?: (progress: OptimizationProgress) => void,
  profiler?: OptimizerProfiler,
): OptimizationWorkflow<OptimizationResult> {
  if (input.battleContext !== "rally" && input.scenarioType !== "CITY_DEFENSE") throw new Error("Optimizer is available only for rally battles.");
  if (input.scenarioType === "CITY_DEFENSE") config = { ...config, objectiveMode: "singleWin",
    ...(config.candidateSide !== "B" ? { constraints: { ...config.constraints, fixedBodyExact: true, fixedMemberSkillIds: [] } } : {}) };
  validateConfig(config);
  const single = yield* createSingleWaveSearchWorkflow(input, config, onProgress, profiler);
  const mode = config.candidateSide === "B" ? "singleWin" : config.objectiveMode === "auto"
    ? AutoObjective.select(single.coarseBest.winRate, config) : config.objectiveMode;
  if (mode !== "minRallies") return finishRallyOptimization(input, config, single, []);
  const multi = yield* createMultiWaveSearchWorkflow(input,
    single.top.map((row) => row.candidate), config, onProgress, profiler);
  return finishRallyOptimization(input, config, { ...single,
    performance: addOptimizationPerformance(single.performance, multi.performance) }, multi.top);
}

function finishRallyOptimization(input: OptimizationInput, config: OptimizationConfig,
  single: SingleSearchResult, multi: readonly MultiWaveEvaluation[],
): OptimizationResult {
  const mode = config.candidateSide === "B" ? "singleWin" : config.objectiveMode === "auto"
    ? AutoObjective.select(single.coarseBest.winRate, config)
    : config.objectiveMode;
  return {
    optimizationContext: createOptimizationContext(input, config.candidateSide),
    searchDimensionAudit: single.searchDiagnostics.searchDimensionAudit ?? resolveSearchDimensions(input, {
      side: config.candidateSide ?? "A", fixedHead: TROOP_TYPES.every((troop) => config.constraints.fixedLeaders?.[troop] !== undefined),
      fixedBody: config.constraints.fixedBodyExact === true || config.constraints.fixedMemberSkillIds?.length === 4 }),
    status: mode === "minRallies" && multi.every((entry) => entry.targetWaves === null)
      ? "target_not_met" : "success",
    seed: config.firstSeed,
    searchDiagnostics: single.searchDiagnostics,
    currentEvaluation: single.current,
    requestedMode: config.objectiveMode,
    selectedMode: mode,
    singleWaveTop: single.top,
    multiWaveTop: multi,
    evaluatedCandidates: single.evaluatedCandidates,
    performance: single.performance,
    approximation: mode === "minRallies"
      ? "Beam search ranks sampled enemy-state distributions and replays each expanded sequence as real trajectories; finalists use independent full Monte Carlo verification. Search is approximate, not a global optimum proof."
      : "多阶段启发式搜索；理论评分不是胜率，最终推荐由正式 BattleEngine 复验决定，不能证明严格全局最优。",
  };
}

export const RallyScenarioOptimizer: ScenarioOptimizer<OptimizationConfig,
  OptimizationResult> = { optimize: runRallyOptimization };

/** Reverify one chosen candidate on a new common seed range without re-searching. */
export function verifyRallyCandidate(
  input: OptimizationInput,
  candidate: RallyCandidate,
  trials = 10_000,
  firstSeed = input.randomSeed,
  candidateSide: SideId = "A",
): CandidateEvaluation {
  const own = candidateSide === "A" ? input.sideA : input.sideB;
  if (input.scenarioType !== "CITY_DEFENSE" && (input.battleContext !== "rally" || own.rallyDeployment === undefined)) {
    throw new Error("Candidate verification requires a rally deployment on the candidate side.");
  }
  const totalTroops = input.scenarioType === "CITY_DEFENSE" ? TROOP_TYPES.reduce((sum, troop) => sum + own.troops[troop].count, 0) : own.rallyDeployment!.totalTroops;
  if (candidateSide === "B") {
    const mapped = candidateToInput(input, candidate, candidateSide);
    const seeds = createStageSeeds(firstSeed, trials, 1_000_000);
    const row = createEvaluationExecutor()({ kind: "battle", input: mapped, seeds, side: candidateSide, collectOutcomes: true });
    return evaluateSingleCandidate(candidate, totalTroops, seeds, () =>
      row.samples.outcomes.map((outcome) => ({ outcome: outcome.outcome === "B" ? "A" as const : outcome.outcome === "A" ? "B" as const : outcome.outcome,
        self: outcome.remaining.B, enemy: outcome.remaining.A, rounds: outcome.roundCount })));
  }
  return evaluateSingleCandidate(candidate, totalTroops,
    createStageSeeds(firstSeed, trials, 1_000_000), createEngineCandidateRunner(input));
}

function validateConfig(config: OptimizationConfig): void {
  if (config.candidateSide !== undefined && config.candidateSide !== "A" && config.candidateSide !== "B") throw new RangeError("Invalid optimization side.");
  validateTheoryOptions(config.theory ?? defaultTheoryOptions());
  if (!Number.isSafeInteger(config.initialBattleTrials ?? 5) || (config.initialBattleTrials ?? 5) < 1 ||
      (config.initialBattleTrials ?? 5) > 100_000 || config.monteCarloStages?.some((stage) =>
        !Number.isSafeInteger(stage.trials) || stage.trials < 1 || stage.trials > 100_000 ||
        !Number.isSafeInteger(stage.keep) || stage.keep < 1)) throw new RangeError("Invalid Monte Carlo halving schedule.");
  const positive = [config.verificationTrials, config.verificationTop, config.topN,
    config.maxWaves, config.beamWidth, config.branchWidth, config.beamTrials];
  if (positive.some((value) => !Number.isSafeInteger(value) || value < 1)) {
    throw new RangeError("Optimization effort fields must be positive integers.");
  }
  if (config.stages.some((stage) => !Number.isSafeInteger(stage.trials) || stage.trials < 1 ||
    stage.trials > 100_000 ||
    !Number.isSafeInteger(stage.ratioStep) || stage.ratioStep < 1 ||
    !Number.isSafeInteger(stage.keep) || stage.keep < 1 ||
    !Number.isSafeInteger(stage.maxCandidates) || stage.maxCandidates < 1)) {
    throw new RangeError("Invalid optimization stage.");
  }
  if (config.verificationTrials > 100_000 || config.beamTrials > 100_000) {
    throw new RangeError("Trial count cannot exceed 100000.");
  }
  if (config.monteCarloStages?.length === 0) throw new RangeError("Monte Carlo schedule cannot be empty.");
  for (const probability of [config.targetDefeatProbability,
    config.singleFightThresholdLow, config.singleFightThresholdHigh]) {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new RangeError("Optimization probabilities must be in [0, 1].");
    }
  }
  if (config.singleFightThresholdLow > config.singleFightThresholdHigh) {
    throw new RangeError("Auto-mode thresholds are reversed.");
  }
}
