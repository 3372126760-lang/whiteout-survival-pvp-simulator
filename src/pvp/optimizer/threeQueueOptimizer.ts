import { formalSampleSchedule, retainQueueRacingCandidates, type FormalRacingStage } from "./queueRacing";
import { TrajectorySampleAccumulator, summarizeTrajectoryScheduler } from "./trajectorySamples";
import { OptimizerProfiler, profileOptimizationWorkflow, type SearchPerformanceReport } from "./profiling";
import type { OptimizationProgress } from "./types";
import type { HeroPoolAudit } from "./heroSearchPolicy";
import type { EnemyPermutationMode } from "./iceFirePermutations";
import type { permutationMetrics } from "./iceFirePermutations";
import { iceFireQueueConversionAudit } from "../validationUi/iceFireAudit";
import { iceFireRobustSearch } from "./iceFireRobustSearch";
import { isIceFireInput, type iceFireExpertSkillAudit } from "../validationUi/iceFireContext";
import { getServerStage, isHeroAvailableAtStage } from "../progression";
import { allocateThreeQueueTroops, OPTIMIZER_RATIO_BASIS_POINT_STEP,
  toThreeQueueBasisPoints, type ThreeQueueScenarioConfig,
  type ThreeQueueScenarioResult, type TroopRatioBasisPoints,
  runThreeQueueScenario, resolveThreeQueueMode, threeQueueSchedulerType,
  type ThreeQueueMode, type ThreeQueueSchedulerType } from "../scenario";
import { createSeededRandomSource } from "../troopSkills";
import { TROOP_TYPES, type SideId, type TroopType } from "../types";
import { captureQueueReportBaseline, normalizeIceFireReportLineage } from "../validationUi/queueReportLineage";
import { deriveBatchSeed, getValidationCatalog, getValidationThreeQueues,
  sanitizeConfigForStage,
  toValidationThreeQueueConfig, validationStageId,
  type ValidationBattleInput, type ValidationQueueConfig } from "../validationUi";
import type { ScenarioOptimizer } from "./scenarioOptimizer";
import { addOptimizationPerformance, createEvaluationExecutor, emptyOptimizationPerformance,
  evaluateSearchStage, runOptimizationWorkflow, runOptimizationWorkflowAsync, threeQueueStageSeeds,
  type AsyncEvaluationExecutor, type EvaluationJobResult, type OptimizationPerformance,
  type OptimizationWorkflow } from "./execution";

export type ThreeQueueLocks = readonly [boolean, boolean, boolean];
export interface ThreeQueueOptimizationOptions {
  readonly enemyPermutationMode?: EnemyPermutationMode;
  readonly fixedOwnQueueOrder?: boolean;
  /** Scoped to Earth Heart/Hero Land; manual locked heads are authoritative. */
  readonly innerEarthHeroSearch?: boolean;
  readonly criterionEnabled?: boolean;
  readonly criterionCandidatesPerQueue?: number;
  readonly criterionSchedulerTrials?: number;
  readonly criterionPairLimit?: number;
  readonly criterionTripleLimit?: number;
  readonly criterionTheoryLimit?: number;
  readonly formalStageTrials?: readonly number[];
  readonly formalStageKeeps?: readonly number[];
  readonly profiling?: boolean;
  readonly side: SideId;
  readonly initialCandidateCount: number;
  readonly coarseSimulationCount: number;
  readonly beamWidth: number;
  readonly beamRounds: number;
  readonly expansionsPerState: number;
  readonly refinementCandidateCount: number;
  readonly refinementSimulationCount: number;
  readonly finalCandidateCount: number;
  readonly finalValidationCount: number;
  readonly rootSeed: number;
  readonly lockHeroes: ThreeQueueLocks;
  readonly lockRatios: ThreeQueueLocks;
}
export interface ThreeQueueCandidateQueue {
  /** Original complete queue, including its historical lineage and troop settings. */
  readonly sourceQueueIndex?: number;
  readonly headWeaponLevels?: Readonly<Record<string, number>>;
  readonly leaderHeroIds: Readonly<Partial<Record<TroopType, string | null>>>;
  readonly ratiosBp: TroopRatioBasisPoints;
}
export interface ThreeQueueOptimizationState {
  readonly queues: readonly [ThreeQueueCandidateQueue,
    ThreeQueueCandidateQueue, ThreeQueueCandidateQueue];
}
export interface ThreeQueueCandidateEvaluation {
  readonly candidateExpectedHeroIds?: readonly (readonly string[])[];
  readonly candidateExpectedAttributes?: readonly NonNullable<ValidationQueueConfig["attributes"]>[];
  readonly permutationAudit?: ReturnType<typeof permutationMetrics>;
  readonly convertedQueueAudit?: readonly ReturnType<typeof iceFireQueueConversionAudit>[];
  readonly candidate: ThreeQueueOptimizationState;
  readonly trials: number;
  readonly wins: number;
  readonly losses: number;
  readonly failedTrials: number;
  readonly validTrials: number;
  /** With permutationAudit this is the worst order's rate; trials totals all orders. Otherwise wins / trials. */
  readonly winRate: number;
  /** Exact input baseline; applying it is a no-op. */
  readonly isCurrent?: boolean;
}
export interface ThreeQueueOptimizationResult {
  readonly sharedExpertAudit?: Readonly<Record<SideId, ReturnType<typeof iceFireExpertSkillAudit>>>;
  readonly permutationAudit?: { readonly myOrderSearchEnabled: boolean; readonly enemyPermutationMode: EnemyPermutationMode;
    readonly enemyPermutationCount: number; readonly queueOrderBefore: readonly number[]; readonly queueOrderAfter: readonly number[] };
  readonly threeQueueMode: ThreeQueueMode;
  readonly schedulerType: ThreeQueueSchedulerType;
  readonly optimizationObjective: "fixedPositionWinProbability" | "schedulerMonteCarloWinProbability" | "worstEnemyPermutationWinProbability";
  readonly positionCandidateCount: number;
  readonly criterionAudit?: ReturnType<typeof generateCriterionQueueSeeds>["audit"];
  readonly formalStages?: readonly FormalRacingStage[];
  readonly formalRacingAudit?: { readonly sampleSchedule: readonly number[]; readonly incrementalRunsPerStage: readonly number[]; readonly reusedTrajectoryCount: number; readonly baselineReusedRuns: number; readonly baselineSimulatedRuns: number; readonly sharedSeedSetId: string; readonly pairedComparisonEnabled: boolean };
  readonly schedulerAudit?: ReturnType<TrajectorySampleAccumulator["schedulerAudit"]>;
  readonly recommendedSchedulerAudit?: ReturnType<TrajectorySampleAccumulator["schedulerAudit"]>;
  readonly searchPerformanceReport?: SearchPerformanceReport;
  readonly scenarioType: "THREE_QUEUE";
  readonly status: "success" | "failed";
  readonly side: SideId;
  readonly rootSeed: number;
  readonly current: ThreeQueueCandidateEvaluation;
  readonly topCandidates: readonly ThreeQueueCandidateEvaluation[];
  readonly searchedCandidateCount: number;
  readonly finalValidatedCandidateCount: number;
  readonly finalValidationCount: number;
  readonly cacheHits: number;
  readonly performance: OptimizationPerformance;
  readonly heroPoolAudit?: HeroPoolAudit;
}
export type ThreeQueueOptimizationProgress = OptimizationProgress;

export function defaultThreeQueueOptimizationOptions(seed: number):
  ThreeQueueOptimizationOptions {
  return { side: "A", initialCandidateCount: 18, coarseSimulationCount: 20,
    criterionCandidatesPerQueue: 150, criterionPairLimit: 2000,
    criterionTripleLimit: 1000, criterionTheoryLimit: 200, criterionSchedulerTrials: 100,
    beamWidth: 3, beamRounds: 2, expansionsPerState: 12,
    refinementCandidateCount: 30, refinementSimulationCount: 100,
    finalCandidateCount: 5, finalValidationCount: 1000, rootSeed: seed,
    enemyPermutationMode: "allPermutations", fixedOwnQueueOrder: false,
    lockHeroes: [false, false, false], lockRatios: [false, false, false] };
}

import { buildHeroPoolAudit, optimizerRecentHeadEligible } from "./heroSearchPolicy";

import { optimizationHeroIds, optimizerHeadWeaponLevels } from "./heroPools";
import { generateCriterionQueueSeeds, uniqueTripleRatios, tripleRatioPattern } from "./criterion/queueSearch";
const catalog = getValidationCatalog();
const inputSide = { A: "sideA", B: "sideB" } as const;
const farRatios = [
  [34, 33, 33], [50, 20, 30], [20, 20, 60], [60, 20, 20],
  [20, 60, 20], [10, 20, 70], [40, 30, 30], [30, 40, 30],
] as const;

function asTuple<T>(values: readonly T[]): readonly [T, T, T] {
  if (values.length !== 3) throw new Error("三队列必须恰好包含三队。");
  return [values[0]!, values[1]!, values[2]!];
}

function ratioKey(ratios: TroopRatioBasisPoints): string {
  return TROOP_TYPES.map((troop) => ratios[troop]).join("/");
}

function queueKey(queue: ThreeQueueCandidateQueue): string {
  return `${queue.sourceQueueIndex ?? "slot"}:${TROOP_TYPES.map((troop) => queue.leaderHeroIds[troop] ?? "").join("/")}:${
    ratioKey(queue.ratiosBp)}:${TROOP_TYPES.map((t)=>queue.headWeaponLevels?.[queue.leaderHeroIds[t]??""]??"pool").join("/")}`;
}

/** Queue order is retained: slot locks and common-seed samples refer to these labels. */
export function threeQueueCandidateKey(state: ThreeQueueOptimizationState): string {
  return state.queues.map(queueKey).join("|");
}

/** Evaluation identity is input-bound; it includes historical values, shared context,
 * converted attributes, troop settings and both ordered sides. Never sort queues. */
export function threeQueueEvaluationKey(input: ValidationBattleInput, side: SideId,
  candidate: ThreeQueueOptimizationState): string {
  const converted = threeQueueCandidateInput(input, side, candidate);
  const config = toValidationThreeQueueConfig(converted);
  return JSON.stringify({ candidate: threeQueueCandidateKey(candidate), side,
    sharedA: converted.sideA.shared, sharedB: converted.sideB.shared,
    sourceA: converted.sideA.threeQueues, sourceB: converted.sideB.threeQueues,
    orderA: converted.sideA.queueOrder, orderB: converted.sideB.queueOrder,
    converted: config,
    ...(isIceFireInput(converted) ? { convertedExpectedAttributes: (["A", "B"] as const).map((id) =>
      [0, 1, 2].map((index) => iceFireQueueConversionAudit(converted, id, index).expectedAttributesAfterHeroConversion)) } : {}) });
}

function bpFromWhole(shield: number, lancer: number): TroopRatioBasisPoints {
  const marksman = 100 - shield - lancer;
  return { shield: shield * OPTIMIZER_RATIO_BASIS_POINT_STEP,
    lancer: lancer * OPTIMIZER_RATIO_BASIS_POINT_STEP,
    marksman: marksman * OPTIMIZER_RATIO_BASIS_POINT_STEP };
}

function wholeBp(ratios: TroopRatioBasisPoints): TroopRatioBasisPoints {
  const raw = TROOP_TYPES.map((troop) => ratios[troop] / OPTIMIZER_RATIO_BASIS_POINT_STEP);
  const values = raw.map(Math.floor);
  const missing = 100 - values.reduce((sum, value) => sum + value, 0);
  const order = [0, 1, 2].sort((a, b) =>
    raw[b]! - values[b]! - (raw[a]! - values[a]!) || a - b);
  for (let index = 0; index < missing; index += 1) values[order[index]!]! += 1;
  return bpFromWhole(values[0]!, values[1]!);
}

export function isWholePercentQueue(queue: ThreeQueueCandidateQueue): boolean {
  return TROOP_TYPES.every((troop) => queue.ratiosBp[troop] %
    OPTIMIZER_RATIO_BASIS_POINT_STEP === 0) &&
    TROOP_TYPES.reduce((sum, troop) => sum + queue.ratiosBp[troop], 0) === 10_000;
}

function currentState(input: ValidationBattleInput,
  side: SideId): ThreeQueueOptimizationState {
  return { queues: asTuple(getValidationThreeQueues(input[inputSide[side]]).map(
    (queue, index) => ({ sourceQueueIndex: index, leaderHeroIds: queue.leaderHeroIds, headWeaponLevels: queue.weaponLevels ?? input[inputSide[side]].simulationWeaponLevels ?? {},
      ratiosBp: toThreeQueueBasisPoints(queue.ratios) }))) };
}

function wholeState(state: ThreeQueueOptimizationState): ThreeQueueOptimizationState {
  return { queues: asTuple(state.queues.map((queue) => ({ ...queue,
    ratiosBp: wholeBp(queue.ratiosBp) }))) };
}

function replaceQueue(state: ThreeQueueOptimizationState, index: number,
  queue: ThreeQueueCandidateQueue): ThreeQueueOptimizationState {
  return { queues: asTuple(state.queues.map((current, slot) =>
    slot === index ? queue : current)) };
}

/** Permutes search variables only. Each destination keeps its own report attributes,
 * external modifiers, troop levels and skill-level inputs via candidateInput. */
export function generateThreeQueuePositionCandidates(state: ThreeQueueOptimizationState,
  options: Pick<ThreeQueueOptimizationOptions, "lockHeroes" | "lockRatios">): readonly ThreeQueueOptimizationState[] {
  const permutations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const candidates = new Map<string, ThreeQueueOptimizationState>();
  for (const permutation of permutations) {
    const candidate = { queues: asTuple(state.queues.map((current, index) => {
      const source = state.queues[permutation[index]!]!;
      const headWeaponLevels = options.lockHeroes[index] ? current.headWeaponLevels : source.headWeaponLevels;
      return { leaderHeroIds: options.lockHeroes[index] ? current.leaderHeroIds : source.leaderHeroIds,
        ...(headWeaponLevels === undefined ? {} : { headWeaponLevels }),
        ratiosBp: options.lockRatios[index] ? current.ratiosBp : source.ratiosBp };
    })) };
    const ids = candidate.queues.flatMap((queue) => TROOP_TYPES.flatMap((troop) =>
      queue.leaderHeroIds[troop] ?? []));
    if (new Set(ids).size === ids.length) candidates.set(threeQueueCandidateKey(candidate), candidate);
  }
  return [...candidates.values()];
}

export function threeQueueCandidateInput(input: ValidationBattleInput, side: SideId,
  candidate: ThreeQueueOptimizationState): ValidationBattleInput {
  input = normalizeIceFireReportLineage(input);
  const key = inputSide[side];
  const originalQueues = getValidationThreeQueues(input[key]);
  const nextSide = { ...input[key], queueOrder: candidate.queues.map((queue, index) => input[key].queueOrder?.[queue.sourceQueueIndex ?? index] ?? queue.sourceQueueIndex ?? index), simulationWeaponLevels: { ...input[key].simulationWeaponLevels,
    ...Object.assign({}, ...candidate.queues.map((queue)=>queue.headWeaponLevels ?? optimizerHeadWeaponLevels(input,queue.leaderHeroIds,side))) }, threeQueues: asTuple(candidate.queues.map(
    (queue, index): ValidationQueueConfig => ({ ...captureQueueReportBaseline({ ...originalQueues[queue.sourceQueueIndex ?? index]!,
      ...input[key].threeQueues?.[queue.sourceQueueIndex ?? index] }),
      leaderHeroIds: queue.leaderHeroIds,
      weaponLevels: queue.headWeaponLevels ?? optimizerHeadWeaponLevels(input, queue.leaderHeroIds, side),
      ratios: { shield: queue.ratiosBp.shield / 100,
        lancer: queue.ratiosBp.lancer / 100,
        marksman: queue.ratiosBp.marksman / 100 } }))) };
  return { ...input, [key]: nextSide };
}
const candidateInput = threeQueueCandidateInput;

export function applyThreeQueueCandidate(input: ValidationBattleInput,
  side: SideId, candidate: ThreeQueueOptimizationState): ValidationBattleInput {
  if (input.scenarioType !== "THREE_QUEUE" && input.scenarioType !== "ICE_FIRE_LEAGUE") {
    throw new Error("当前场景不是三队列。");
  }
  if (threeQueueCandidateKey(candidate) === threeQueueCandidateKey(currentState(input, side))) {
    return input;
  }
  if (!candidate.queues.every(isWholePercentQueue)) {
    throw new Error("推荐方案比例必须为 1% 网格且合计 100%。");
  }
  const cleaned = sanitizeConfigForStage(candidateInput(input, side, candidate),
    validationStageId(input)).input;
  const config = toValidationThreeQueueConfig(cleaned);
  const chosen = side === "A" ? config.attacker : config.defender;
  for (const queue of chosen.queues) {
    const counts = allocateThreeQueueTroops(chosen.deploymentCapacity, queue.ratiosBp!);
    if (TROOP_TYPES.reduce((sum, troop) => sum + counts[troop], 0) !==
      chosen.deploymentCapacity) throw new Error("推荐方案队列容量无效。");
  }
  return cleaned;
}

function eligibleHeroes(input: ValidationBattleInput, sideId: SideId): Record<TroopType, readonly string[]> {
  const stage = validationStageId(input);
  return Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
    buildHeroPoolAudit(input, catalog.leaderHeroes.filter((hero) => isHeroAvailableAtStage(hero, stage) &&
      optimizationHeroIds(input, sideId).includes(hero.heroId)), sideId).optimizerHeroPoolAfterFilter.filter((hero) => hero.troopType === troop &&
      isHeroAvailableAtStage(hero, stage) &&
      optimizationHeroIds(input, sideId).includes(hero.heroId))
      .sort((a, b) => (b.generation ?? 0) - (a.generation ?? 0) ||
        a.heroId.localeCompare(b.heroId)).map((hero) => hero.heroId)])) as unknown as
      Record<TroopType, readonly string[]>;
}

function ratioNeighbors(ratios: TroopRatioBasisPoints,
  step = OPTIMIZER_RATIO_BASIS_POINT_STEP): readonly TroopRatioBasisPoints[] {
  const result: TroopRatioBasisPoints[] = [];
  for (const from of TROOP_TYPES) {
    if (ratios[from] < step) continue;
    for (const to of TROOP_TYPES) {
      if (from === to) continue;
      result.push({ ...ratios,
        [from]: ratios[from] - step,
        [to]: ratios[to] + step });
    }
  }
  return result;
}

function snapFivePercent(ratios: TroopRatioBasisPoints): TroopRatioBasisPoints {
  const exact = TROOP_TYPES.map((troop) => ratios[troop] / 500);
  const units = exact.map(Math.floor);
  const order = [0, 1, 2].sort((a, b) =>
    exact[b]! - units[b]! - (exact[a]! - units[a]!) || a - b);
  for (let missing = 20 - units.reduce((sum, value) => sum + value, 0);
    missing > 0; missing -= 1) units[order[missing - 1]!]! += 1;
  return { shield: units[0]! * 500, lancer: units[1]! * 500,
    marksman: units[2]! * 500 };
}

function queueVariants(input:ValidationBattleInput,state: ThreeQueueOptimizationState, index: number,
  options: ThreeQueueOptimizationOptions,
  heroes: Record<TroopType, readonly string[]>,
  far: readonly TroopRatioBasisPoints[]): readonly ThreeQueueOptimizationState[] {
  const queue = state.queues[index]!;
  const local: ThreeQueueOptimizationState[] = [];
  const distant: ThreeQueueOptimizationState[] = [];
  const heroChanges: ThreeQueueOptimizationState[] = [];
  if (!options.lockRatios[index]) {
    for (const ratiosBp of ratioNeighbors(queue.ratiosBp)) {
      local.push(replaceQueue(state, index, { ...queue, ratiosBp }));
    }
    for (const ratiosBp of far) {
      distant.push(replaceQueue(state, index, { ...queue, ratiosBp }));
    }
  }
  if (!options.lockHeroes[index]) {
    for (const troop of TROOP_TYPES) {
      const alternatives = heroes[troop].filter((id) =>
        id !== queue.leaderHeroIds[troop] &&
        state.queues.every((other, slot) => slot === index ||
          TROOP_TYPES.every((type) => other.leaderHeroIds[type] !== id))).slice(0, 2);
      for (const heroId of alternatives) {
        heroChanges.push(replaceQueue(state, index, { ...queue,
          leaderHeroIds: { ...queue.leaderHeroIds, [troop]: heroId },headWeaponLevels:optimizerHeadWeaponLevels(input,{...queue.leaderHeroIds,[troop]:heroId},options.side) }));
      }
    }
  }
  const variants: ThreeQueueOptimizationState[] = [];
  const max = Math.max(local.length, distant.length, heroChanges.length);
  for (let rank = 0; rank < max; rank += 1) {
    if (local[rank] !== undefined) variants.push(local[rank]!);
    if (heroChanges[rank] !== undefined) variants.push(heroChanges[rank]!);
    if (distant[rank] !== undefined) variants.push(distant[rank]!);
  }
  return variants;
}

function diverseRatios(seed: number): readonly TroopRatioBasisPoints[] {
  const random = createSeededRandomSource(seed);
  const samples = farRatios.map(([shield, lancer]) => bpFromWhole(shield, lancer));
  for (let index = 0; index < 10; index += 1) {
    const shield = Math.floor(random.next() * 101);
    const lancer = Math.floor(random.next() * (101 - shield));
    samples.push(bpFromWhole(shield, lancer));
  }
  return samples;
}

function compareEvaluation(a: ThreeQueueCandidateEvaluation,
  b: ThreeQueueCandidateEvaluation): number {
  return b.winRate - a.winRate ||
    Number(b.isCurrent === true) - Number(a.isCurrent === true) ||
    threeQueueCandidateKey(a.candidate).localeCompare(threeQueueCandidateKey(b.candidate));
}

function count(value: number, label: string, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label} 必须是 ${min}～${max} 的整数。`);
  }
}

function validateOptions(options: ThreeQueueOptimizationOptions): void {
  if (options.enemyPermutationMode !== undefined && !["fixedCurrent", "allPermutations", "worstCase"].includes(options.enemyPermutationMode)) throw new Error("敌方变阵模式无效。");
  if (options.fixedOwnQueueOrder !== undefined && typeof options.fixedOwnQueueOrder !== "boolean") throw new Error("固定我方队列顺序必须为布尔值。");
  if (options.side !== "A" && options.side !== "B") throw new Error("优化对象无效。");
  for (const [key, min, max] of [
    ["initialCandidateCount", 1, 500], ["coarseSimulationCount", 1, 100_000],
    ["beamWidth", 1, 50], ["beamRounds", 1, 20],
    ["expansionsPerState", 1, 100], ["refinementCandidateCount", 1, 500],
    ["refinementSimulationCount", 1, 100_000],
    ["finalCandidateCount", 1, 20], ["finalValidationCount", 1, 100_000],
  ] as const) count(options[key], key, min, max);
  if(options.criterionCandidatesPerQueue!==undefined)count(options.criterionCandidatesPerQueue,"criterionCandidatesPerQueue",1,300);
  for (const key of ["criterionPairLimit", "criterionTripleLimit", "criterionTheoryLimit"] as const)
    if (options[key] !== undefined) count(options[key], key, 1, 10000);
  for (const key of ["formalStageTrials", "formalStageKeeps"] as const) {
    const values = options[key];
    if (values !== undefined) {
      if (!values.length || values.length > 8) throw new Error(`${key} 应包含 1 至 8 个阶段。`);
      values.forEach((value) => count(value, key, 1, key === "formalStageTrials" ? options.finalValidationCount : 1000));
      if (key === "formalStageTrials" && values.some((value, index) => index > 0 && value <= values[index - 1]!))
        throw new Error("formalStageTrials 必须递增。");
    }
  }
  if(options.criterionSchedulerTrials!==undefined)count(options.criterionSchedulerTrials,"criterionSchedulerTrials",1,1000);
  if (!Number.isSafeInteger(options.rootSeed)) throw new Error("优化种子必须是安全整数。");
  for (const [name, locks] of [["lockHeroes", options.lockHeroes],
    ["lockRatios", options.lockRatios]] as const) {
    if (!Array.isArray(locks) || locks.length !== 3 ||
      locks.some((locked) => typeof locked !== "boolean")) {
      throw new Error(`${name} 必须恰好包含三个布尔锁定项。`);
    }
  }
}

/** Full-scenario Monte Carlo. Failed trials follow the existing batch denominator. */
export function* createThreeQueueOptimizationWorkflow(input: ValidationBattleInput,
  options: ThreeQueueOptimizationOptions,
  onProgress?: (progress: ThreeQueueOptimizationProgress) => void,
): OptimizationWorkflow<ThreeQueueOptimizationResult> {
  const profiler = options.profiling ? new OptimizerProfiler(onProgress) : undefined;
  return yield* profileOptimizationWorkflow(createThreeQueueWorkflow(input, options,
    profiler?.progress ?? onProgress, profiler), profiler);
}
function* createThreeQueueWorkflow(input: ValidationBattleInput, options: ThreeQueueOptimizationOptions,
  onProgress?: (progress: ThreeQueueOptimizationProgress) => void,
  profiler?: OptimizerProfiler,
): OptimizationWorkflow<ThreeQueueOptimizationResult> {
  if (input.scenarioType !== "THREE_QUEUE" && input.scenarioType !== "ICE_FIRE_LEAGUE") throw new Error("需要冰火战歌场景配置。");
  if (input.scenarioType === "ICE_FIRE_LEAGUE") input = { ...input, threeQueueMode: "ICE_FIRE_LEAGUE" };
  if (input.attributeInputMode === "finalReport" && !isIceFireInput(input)) options = { ...options, lockHeroes: [true, true, true] };
  validateOptions(options);
  const stage = validationStageId(input);
  getServerStage(stage);
  toValidationThreeQueueConfig(input);
  const threeQueueMode = resolveThreeQueueMode(input.threeQueueMode);
  const activityLabel = threeQueueMode === "ICE_FIRE_LEAGUE" ? "冰火战歌" :
    input.innerEarth?.subMode === "HERO_LAND" ? "英雄之地" : "大地之心";
  const current = currentState(input, options.side);
  if (!options.innerEarthHeroSearch && !isIceFireInput(input)) options = { ...options, lockHeroes: current.queues.map((queue,index) =>
    options.lockHeroes[index] || TROOP_TYPES.every((troop)=>!queue.leaderHeroIds[troop])) as unknown as ThreeQueueLocks };
  for (let queue = 0; queue < 3; queue += 1) {
    if (options.lockRatios[queue] && !isWholePercentQueue(current.queues[queue]!)) {
      throw new Error(`第 ${queue + 1} 队锁定比例须处于 1% 网格。`);
    }
  }
  let base: ThreeQueueOptimizationState = { queues: asTuple(wholeState(current).queues.map((queue,index)=>({...queue,headWeaponLevels:options.lockHeroes[index]?queue.headWeaponLevels??{}:optimizerHeadWeaponLevels(input,queue.leaderHeroIds,options.side)}))) };
  profiler?.begin(`${activityLabel}候选初始化与合法性过滤`, 1);
  const heroes = eligibleHeroes(input, options.side);
  const heroPoolAudit = buildHeroPoolAudit(input, catalog.leaderHeroes.filter((hero) => isHeroAvailableAtStage(hero, stage) &&
    optimizationHeroIds(input, options.side).includes(hero.heroId)), options.side, profiler);
  const legalState = (state: ThreeQueueOptimizationState) => state.queues.every((queue,index) =>
    options.lockHeroes[queue.sourceQueueIndex ?? index] || TROOP_TYPES.every((troop) => heroes[troop].length === 0 && !queue.leaderHeroIds[troop]) ? true :
      optimizerRecentHeadEligible(input,queue.leaderHeroIds,options.side) &&
      TROOP_TYPES.every((troop) => heroes[troop].includes(queue.leaderHeroIds[troop] ?? "")));
  // Repair unlocked automatic seeds; exact manual baseline is evaluated separately.
  for (let index = 0; index < 3; index++) {
    if (options.lockHeroes[index]) continue;
    const head = { ...base.queues[index]!.leaderHeroIds };
    const used = () => base.queues.flatMap((queue, i) => i === index ? [] : TROOP_TYPES.flatMap((troop) => queue.leaderHeroIds[troop] ?? []));
    for (const troop of TROOP_TYPES) if (!heroes[troop].includes(head[troop] ?? ""))
      head[troop] = heroes[troop].find((id) => !used().includes(id)) ?? null;
    if (!optimizerRecentHeadEligible(input,head,options.side)) {
      for (const troop of TROOP_TYPES) {
        const recent = heroes[troop].find((id) => !used().includes(id) &&
          optimizerRecentHeadEligible(input,{...head,[troop]:id},options.side));
        if (recent !== undefined) { head[troop] = recent; break; }
      }
    }
    base = replaceQueue(base, index, { ...base.queues[index]!, leaderHeroIds: head,headWeaponLevels:optimizerHeadWeaponLevels(input,head,options.side) });
  }
  profiler?.end();
  const far = diverseRatios(deriveBatchSeed(options.rootSeed, 10_000));
  const legacyAccumulators = new Map<string, TrajectorySampleAccumulator>();
  const searchedSignatures = new Set<string>();
  const validCandidates = new Set<string>();
  const invalidCandidates = new Set<string>();
  let cacheHits = 0;
  let performance = emptyOptimizationPerformance();
  const toRow = (candidate: ThreeQueueOptimizationState,
    result: EvaluationJobResult): ThreeQueueCandidateEvaluation => {
    performance = addOptimizationPerformance(performance, result.performance);
    const sample = result.samples;
    return { candidate, trials: sample.trials, wins: sample.wins, losses: sample.losses,
      failedTrials: sample.failedTrials, validTrials: sample.trials - sample.failedTrials,
      winRate: sample.wins / sample.trials };
  };
  const evaluateStage = function* (name: string,
    candidates: readonly ThreeQueueOptimizationState[], trials: number): OptimizationWorkflow<ThreeQueueCandidateEvaluation[]> {
    trials = Math.min(trials,options.finalValidationCount);
    profiler?.begin(name, candidates.length);
    const rows: ThreeQueueCandidateEvaluation[] = [];
    const pending = candidates.filter((candidate) => {
      const key = threeQueueCandidateKey(candidate);
      if (key !== threeQueueCandidateKey(current) && !legalState(candidate)) return false;
      searchedSignatures.add(key);
      if (invalidCandidates.has(key)) return false;
      if (!validCandidates.has(key)) {
        try { toValidationThreeQueueConfig(candidateInput(input, options.side, candidate)); }
        catch (error) {
          if (error instanceof RangeError && /[AB]方 第\d队/.test(error.message)) {
            invalidCandidates.add(key);
            return false;
          }
          throw error;
        }
        validCandidates.add(key);
      }
      const acc = legacyAccumulators.get(key);
      if (acc !== undefined && acc.trials >= trials) {
        const sample = acc.snapshot(trials);
        rows.push({candidate,...sample,validTrials:sample.trials-sample.failedTrials,winRate:sample.wins/sample.trials});
        cacheHits++;
        profiler?.reuseTrajectorySamples(trials,acc.observations.slice(0,trials).reduce((sum,row)=>sum+row.battleCount,0)||trials);
        return false;
      }
      if (acc?.trials) { cacheHits++; profiler?.reuseTrajectorySamples(acc.trials,acc.observations.reduce((sum,row)=>sum+row.battleCount,0)||acc.trials); }
      return true;
    });
    // Repeated compatibility stages request only their missing cumulative prefix.
    profiler?.setExecutionWorkload(pending.reduce((sum,c)=>sum+trials-(legacyAccumulators.get(threeQueueCandidateKey(c))?.trials??0),0), true, "trajectory");
    yield* evaluateSearchStage(pending, (candidate) => ({ kind: "threeQueue",
      input: threeQueueCandidateKey(candidate) === threeQueueCandidateKey(current) ? input : candidateInput(input, options.side, candidate),
      seeds: threeQueueStageSeeds(options.rootSeed, trials).slice(legacyAccumulators.get(threeQueueCandidateKey(candidate))?.trials??0),
      side: options.side, collectTrajectories: true }), false,
    (candidate, result, index) => {
      const key = threeQueueCandidateKey(candidate), acc = legacyAccumulators.get(key) ?? new TrajectorySampleAccumulator(options.side);
      const newSeeds = threeQueueStageSeeds(options.rootSeed,trials).slice(acc.trials);
      acc.append(newSeeds,result.samples); legacyAccumulators.set(key,acc);
      const row = {...toRow(candidate,result),...acc.snapshot(),validTrials:acc.trials-acc.failedTrials,winRate:acc.wins/acc.trials};
      rows.push(row);
      onProgress?.({ stage: name, completed: candidates.length - pending.length + index + 1,
        total: candidates.length });
    }, options.beamRounds * 3 * (options.initialCandidateCount + options.expansionsPerState) +
      options.refinementCandidateCount,
    [...rows].sort(compareEvaluation)[0]);
    if (pending.length === 0) onProgress?.({ stage: name, completed: candidates.length, total: candidates.length });
    profiler?.end();
    return rows.sort(compareEvaluation);
  };
  const criterionSeeds=options.criterionEnabled===false && !isIceFireInput(input)?undefined:generateCriterionQueueSeeds(input,base,options,heroes,onProgress,profiler);
  const evaluateBaseline = function* (trials: number): OptimizationWorkflow<ThreeQueueCandidateEvaluation> {
    const rows = yield* evaluateStage(`当前方案累计 ${trials} 整场`,[current],trials);
    return {...rows[0]!,isCurrent:true};
  };
  if (criterionSeeds) {
    if (threeQueueMode === "ICE_FIRE_LEAGUE") {
      return yield* iceFireRobustSearch(input, current, criterionSeeds, options, heroPoolAudit, onProgress, profiler);
    }
    const unique = (states: readonly ThreeQueueOptimizationState[]) =>
      [...new Map(states.map((state) => [threeQueueCandidateKey(state), state])).values()];
    let candidates = unique([current, ...criterionSeeds.candidates]);
    let m1Candidates: ThreeQueueOptimizationState[] = [];
    const baselineKey = threeQueueCandidateKey(current);
    const schedule = formalSampleSchedule(options), keeps = options.formalStageKeeps ?? [80,25,10,options.finalCandidateCount];
    const sharedSeedSetId = `threeQueue:${options.rootSeed >>> 0}:trajectory-v1`;
    const sharedSeeds = threeQueueStageSeeds(options.rootSeed, options.finalValidationCount);
    const accumulators = new Map<string, TrajectorySampleAccumulator>();
    const formalStages: FormalRacingStage[] = [];
    let lastRows: ThreeQueueCandidateEvaluation[] = [];
    for (const [stageIndex, trials] of schedule.entries()) {
      const final = trials === options.finalValidationCount;
      const name = `${activityLabel} · ${final ? "Final" : "正式筛选"} 累计 ${trials} 整场`;
      profiler?.begin(name, candidates.length);
      const pending: { candidate: ThreeQueueOptimizationState; start: number }[] = [];
      let reusedTrajectoryCount = 0, baselineReusedRuns = 0, baselineIncrementalRuns = 0;
      for (const candidate of candidates) {
        const key = threeQueueCandidateKey(candidate);
        if (key !== baselineKey && !legalState(candidate)) continue;
        try { toValidationThreeQueueConfig(key === baselineKey ? input : candidateInput(input, options.side, candidate)); }
        catch (error) {
          if (error instanceof RangeError && /[AB]方 第\d队/.test(error.message)) { invalidCandidates.add(key); continue; }
          throw error;
        }
        searchedSignatures.add(key);
        const acc = accumulators.get(key) ?? new TrajectorySampleAccumulator(options.side);
        accumulators.set(key,acc);
        reusedTrajectoryCount += acc.trials;
        // The profiler distinguishes trajectories executed from formal duel calls.
        if (acc.trials) { cacheHits++; profiler?.reuseTrajectorySamples(acc.trials,acc.observations.reduce((sum,row) => sum+row.battleCount,0) || acc.trials); }
        if (key === baselineKey) { baselineReusedRuns = acc.trials; baselineIncrementalRuns = trials-acc.trials; }
        if (acc.trials < trials) pending.push({candidate,start:acc.trials});
      }
      const incrementalRuns = pending.reduce((sum,row) => sum+trials-row.start,0);
      profiler?.setExecutionWorkload(incrementalRuns,true,"trajectory");
      for (let offset = 0; offset < pending.length; offset += 4) {
        const chunk = pending.slice(offset,offset+4);
        const results = yield chunk.map(({candidate,start}) => ({ kind: "threeQueue" as const,
          input: threeQueueCandidateKey(candidate) === baselineKey ? input : candidateInput(input,options.side,candidate),
          side: options.side, seeds: sharedSeeds.slice(start,trials), collectTrajectories: true,
          protectFromPruning: threeQueueCandidateKey(candidate) === baselineKey }));
        if (results.length !== chunk.length) throw new Error("Invalid cumulative evaluation batch.");
        results.forEach((result,i) => {
          const request = chunk[i]!;
          performance = addOptimizationPerformance(performance,result.performance);
          accumulators.get(threeQueueCandidateKey(request.candidate))!.append(sharedSeeds.slice(request.start,trials),result.samples);
        });
        onProgress?.({stage:name,completed:Math.min(offset+chunk.length,pending.length),total:pending.length});
      }
      lastRows = candidates.filter((candidate) => accumulators.get(threeQueueCandidateKey(candidate))?.trials === trials)
        .map((candidate) => {
          const key=threeQueueCandidateKey(candidate),acc=accumulators.get(key)!;
          return {candidate,trials:acc.trials,wins:acc.wins,losses:acc.losses,failedTrials:acc.failedTrials,
            validTrials:acc.trials-acc.failedTrials,winRate:acc.wins/acc.trials,...(key === baselineKey ? {isCurrent:true} : {})};
        }).sort(compareEvaluation);
      if (stageIndex === 0) m1Candidates = lastRows.map((row) => row.candidate);
      const selection = retainQueueRacingCandidates(lastRows, final ? lastRows.length : Math.min(keeps[stageIndex] ?? options.finalCandidateCount, schedule[stageIndex+1] === options.finalValidationCount ? options.finalCandidateCount+1 : Infinity),
        criterionSeeds.evidence,accumulators,baselineKey,options.side);
      formalStages.push({trials,candidates:lastRows.length,retained:final?Math.min(options.finalCandidateCount,lastRows.length):selection.candidates.length,
        incrementalRuns,reusedTrajectoryCount,baselineReusedRuns,baselineIncrementalRuns,sharedSeedSetId,
        seedRange:{startIndex:0,endIndex:trials-1,firstSeed:sharedSeeds[0]!,lastSeed:sharedSeeds[trials-1]!},
        pairedComparisonEnabled:selection.pairedComparisonEnabled,selection:selection.selection,
        schedulerStatistics:summarizeTrajectoryScheduler(lastRows.flatMap((row)=>{
          const candidateKey=threeQueueCandidateKey(row.candidate);
          return accumulators.get(candidateKey)!.observations.map((observation)=>({...observation,candidateKey}));
        }))});
      if (!final) candidates = unique([current,...selection.candidates]);
      profiler?.end();
    }
    const baseline = lastRows.find((row) => row.isCurrent)!;
    const ranked = lastRows.slice(0,options.finalCandidateCount);
    const finalAcc = accumulators.get(threeQueueCandidateKey(ranked[0]?.candidate ?? current))!;
    return {scenarioType:"THREE_QUEUE",threeQueueMode,schedulerType:threeQueueSchedulerType(threeQueueMode),
      optimizationObjective:"schedulerMonteCarloWinProbability",
      positionCandidateCount:criterionSeeds.audit.tripleCandidates,status:ranked.some((row)=>row.validTrials>0)?"success":"failed",side:options.side,
      rootSeed:options.rootSeed,current:baseline,topCandidates:ranked,searchedCandidateCount:searchedSignatures.size,
      finalValidatedCandidateCount:lastRows.length,finalValidationCount:options.finalValidationCount,
      cacheHits,performance,heroPoolAudit,formalStages,
      schedulerAudit:formalStages.at(-1)!.schedulerStatistics!,recommendedSchedulerAudit:finalAcc.schedulerAudit(),
      formalRacingAudit:{sampleSchedule:schedule,incrementalRunsPerStage:formalStages.map((s)=>s.incrementalRuns),
        reusedTrajectoryCount:formalStages.reduce((sum,s)=>sum+s.reusedTrajectoryCount,0),
        baselineReusedRuns:formalStages.reduce((sum,s)=>sum+s.baselineReusedRuns,0),baselineSimulatedRuns:baseline.trials,
        sharedSeedSetId,pairedComparisonEnabled:formalStages.every((s)=>s.pairedComparisonEnabled)},
      criterionAudit:{...criterionSeeds.audit,formalTripleCandidates:searchedSignatures.size,
        uniqueTripleRatioPatternsAtM1:uniqueTripleRatios(m1Candidates),uniqueTripleRatioPatternsAtFinal:uniqueTripleRatios(lastRows.map((row)=>row.candidate)),
        alternativeRatiosEvaluated:m1Candidates.some((c)=>searchedSignatures.has(threeQueueCandidateKey(c)) && tripleRatioPattern(c)!==tripleRatioPattern(current)),
        formalFinalistsCompared:lastRows.some((row)=>!row.isCurrent && tripleRatioPattern(row.candidate)!==tripleRatioPattern(current)),
        finalWinRate:ranked[0]?.winRate??0,formalWinRate:ranked[0]?.winRate??0}};
  }
  let baseline = yield* evaluateBaseline(Math.min(options.coarseSimulationCount,options.finalValidationCount));
  // Criterion explores joint complementary seeds before formal coordinate refinement.
  // All coarse decisions share one seed so adjacent candidates are comparable.
  let working = base;
  const coarsePool = new Map<string, ThreeQueueOptimizationState>();
  const positionCandidates = new Set<string>();
  const addCoarse = (state: ThreeQueueOptimizationState) =>
    coarsePool.set(threeQueueCandidateKey(state), state);
  addCoarse(working);
  const optimizePositions = function* (): OptimizationWorkflow<void> {
    if (threeQueueMode !== "ICE_FIRE_LEAGUE") return;
    const variants = generateThreeQueuePositionCandidates(working, options);
    variants.forEach((candidate) => positionCandidates.add(threeQueueCandidateKey(candidate)));
    const rows = yield* evaluateStage("冰火战歌 · 固定队列排位粗筛", variants,
      options.coarseSimulationCount);
    rows.forEach((row) => addCoarse(row.candidate));
    working = rows[0]?.candidate ?? working;
  };
  yield* optimizePositions();
  for (let sweep = 0; sweep < options.beamRounds; sweep += 1) {
    for (let index = 0; index < 3; index += 1) {
      if (!options.lockHeroes[index]) {
        const heroVariants = queueVariants(input,working, index, options, heroes, [])
          .filter((candidate) => queueKey(candidate.queues[index]!) !==
            queueKey(working.queues[index]!) &&
            ratioKey(candidate.queues[index]!.ratiosBp) ===
            ratioKey(working.queues[index]!.ratiosBp))
          .slice(0, options.expansionsPerState);
        const rows = yield* evaluateStage(`第 ${sweep + 1} 轮 · Q${index + 1} 英雄粗筛`,
          [working, ...heroVariants], options.coarseSimulationCount);
        rows.forEach((row) => addCoarse(row.candidate));
        working = rows[0]?.candidate ?? working;
      }
      if (!options.lockRatios[index]) {
        const queue = working.queues[index]!;
        const snapped = snapFivePercent(queue.ratiosBp);
        const ratioCandidates = [snapped, ...ratioNeighbors(snapped, 500),
          ...far.filter((ratios) => TROOP_TYPES.every((troop) => ratios[troop] % 500 === 0))];
        const variants = [...new Map(ratioCandidates.map((ratiosBp) => {
          const state = replaceQueue(working, index, { ...queue, ratiosBp });
          return [threeQueueCandidateKey(state), state];
        })).values()].slice(0, options.initialCandidateCount);
        const rows = yield* evaluateStage(`第 ${sweep + 1} 轮 · Q${index + 1} 比例 5% 粗筛`,
          [working, ...variants], options.coarseSimulationCount);
        rows.forEach((row) => addCoarse(row.candidate));
        working = rows[0]?.candidate ?? working;
      }
    }
    yield* optimizePositions();
  }
  // 1% local search around the best coarse states; each move still changes
  // only one queue. A hero swap plus one ratio move forms the joint micro stage.
  const coarseRows = yield* evaluateStage("粗筛候选统一排序", [...coarsePool.values()],
    options.coarseSimulationCount);
  const refined = new Map<string, ThreeQueueOptimizationState>();
  const addRefined = (state: ThreeQueueOptimizationState): void => {
    if (refined.size < options.refinementCandidateCount) {
      refined.set(threeQueueCandidateKey(state), state);
    }
  };
  for (const anchor of coarseRows.slice(0, options.beamWidth)) {
    addRefined(anchor.candidate);
    for (let index = 0; index < 3; index += 1) {
      if (!options.lockRatios[index]) {
        const queue = anchor.candidate.queues[index]!;
        for (const ratiosBp of ratioNeighbors(queue.ratiosBp)) {
          addRefined(replaceQueue(anchor.candidate, index, { ...queue, ratiosBp }));
        }
      }
      if (!options.lockHeroes[index]) {
        const heroStates = queueVariants(input,anchor.candidate, index, options, heroes, [])
          .filter((state) => ratioKey(state.queues[index]!.ratiosBp) ===
            ratioKey(anchor.candidate.queues[index]!.ratiosBp))
          .slice(0, options.expansionsPerState);
        for (const state of heroStates) {
          addRefined(state);
          if (options.lockRatios[index]) continue;
          for (const ratiosBp of ratioNeighbors(state.queues[index]!.ratiosBp).slice(0, 2)) {
            addRefined(replaceQueue(state, index, { ...state.queues[index]!, ratiosBp }));
          }
        }
      }
    }
    if (refined.size >= options.refinementCandidateCount) break;
  }
  const refinedRows = yield* evaluateStage("局部复验", [...refined.values()],
    options.refinementSimulationCount);
  const finalists = refinedRows.slice(0, options.finalCandidateCount)
    .map((row) => row.candidate);
  const finalRows = yield* evaluateStage(`${activityLabel}最终完整复验`, finalists,
    options.finalValidationCount);
  baseline = yield* evaluateBaseline(options.finalValidationCount);
  const ranked = [...finalRows.filter((row)=>threeQueueCandidateKey(row.candidate)!==threeQueueCandidateKey(current)), baseline].sort(compareEvaluation)
    .slice(0, options.finalCandidateCount);
  return { scenarioType: "THREE_QUEUE",
    threeQueueMode, schedulerType: threeQueueSchedulerType(threeQueueMode),
    optimizationObjective: threeQueueMode === "ICE_FIRE_LEAGUE"
      ? "fixedPositionWinProbability" : "schedulerMonteCarloWinProbability",
    positionCandidateCount: positionCandidates.size,
    status: ranked.some((row) => row.validTrials > 0) ? "success" : "failed",
    side: options.side, rootSeed: options.rootSeed, current: baseline,
    topCandidates: ranked, searchedCandidateCount: searchedSignatures.size,
    finalValidatedCandidateCount: finalRows.filter((row)=>threeQueueCandidateKey(row.candidate)!==threeQueueCandidateKey(current)).length + 1,
    finalValidationCount: options.finalValidationCount, cacheHits, performance, heroPoolAudit };
}

export function optimizeThreeQueueScenario(input: ValidationBattleInput,
  options: ThreeQueueOptimizationOptions,
  onProgress?: (progress: ThreeQueueOptimizationProgress) => void,
  executeScenario: (config: ThreeQueueScenarioConfig) => ThreeQueueScenarioResult = runThreeQueueScenario,
): ThreeQueueOptimizationResult {
  return runOptimizationWorkflow(createThreeQueueOptimizationWorkflow(input, options, onProgress),
    createEvaluationExecutor(executeScenario === runThreeQueueScenario ? undefined : executeScenario));
}
export function optimizeThreeQueueScenarioAsync(input: ValidationBattleInput,
  options: ThreeQueueOptimizationOptions, execute: AsyncEvaluationExecutor,
  onProgress?: (progress: ThreeQueueOptimizationProgress) => void,
): Promise<ThreeQueueOptimizationResult> {
  return runOptimizationWorkflowAsync(createThreeQueueOptimizationWorkflow(input, options, onProgress), execute);
}

export const ThreeQueueScenarioOptimizer: ScenarioOptimizer<ThreeQueueOptimizationOptions,
  ThreeQueueOptimizationResult> = { optimize: optimizeThreeQueueScenario };
