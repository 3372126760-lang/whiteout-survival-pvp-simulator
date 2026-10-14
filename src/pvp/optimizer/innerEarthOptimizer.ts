import { getInnerEarthRule, innerEarthIsThreeQueue, materializeInnerEarthInput,
  normalizeInnerEarthInput, auditInnerEarthInput, type InnerEarthMode } from "../innerEarth";
import { TROOP_TYPES, type TroopType } from "../types";
import type { ValidationBattleInput } from "../validationUi";
import { allocateThreeQueueTroops, toThreeQueueBasisPoints } from "../scenario";
import { createSimpleOptimizationWorkflow, defaultSimpleScenarioOptimizationOptions,
  type SimpleScenarioCandidate, type SimpleScenarioOptimizationOptions,
  type SimpleScenarioOptimizationResult } from "./scenarioOptimizer";
import { createThreeQueueOptimizationWorkflow, defaultThreeQueueOptimizationOptions,
  type ThreeQueueOptimizationOptions, type ThreeQueueOptimizationResult,
  type ThreeQueueOptimizationState } from "./threeQueueOptimizer";
import { runOptimizationWorkflow, runOptimizationWorkflowAsync,
  type AsyncEvaluationExecutor, type OptimizationPerformance, type OptimizationWorkflow } from "./execution";
import type { OptimizationProgress } from "./types";

export interface InnerEarthOptimizationOptions {
  readonly simple: SimpleScenarioOptimizationOptions;
  readonly threeQueue: ThreeQueueOptimizationOptions;
}
type InnerEarthOptimizationAudit = ReturnType<typeof auditInnerEarthInput> & {
  readonly optimizationSide: "A";
  readonly searchDimensions: readonly ("head" | "ratio")[];
  readonly headMode: "EMPTY_HEAD" | "SEARCH_HEAD";
  readonly headTemplateCount?: number;
  readonly ratioCount?: number;
  readonly formalInitialCandidateLimit?: number;
};
interface InnerEarthOptimizationResultBase {
  readonly battleScenario: "INNER_EARTH";
  readonly innerEarthMode: InnerEarthMode;
  readonly audit: InnerEarthOptimizationAudit;
  readonly performance: OptimizationPerformance;
}
export type InnerEarthOptimizationResult = InnerEarthOptimizationResultBase & (
  { readonly kind: "ratio"; readonly result: SimpleScenarioOptimizationResult } |
  { readonly kind: "threeQueue"; readonly result: ThreeQueueOptimizationResult }
);
export function defaultInnerEarthOptimizationOptions(seed: number): InnerEarthOptimizationOptions {
  return { simple: defaultSimpleScenarioOptimizationOptions(seed),
    threeQueue: defaultThreeQueueOptimizationOptions(seed) };
}

/** A disposable view for the existing search kernels. The canonical Inner
 * Earth schema remains attached for its scoped troop/skill policy, but adapter
 * materialization is not repeated over candidate heroes and ratios. */
export function innerEarthOptimizerInput(input: ValidationBattleInput): ValidationBattleInput {
  const prepared = materializeInnerEarthInput(input);
  return { ...prepared, scenarioType: innerEarthIsThreeQueue(prepared.innerEarth!.subMode)
    ? "THREE_QUEUE" : "SINGLE", battleContext: "challenge" };
}

export function* createInnerEarthOptimizationWorkflow(input: ValidationBattleInput,
  options: InnerEarthOptimizationOptions = defaultInnerEarthOptimizationOptions(input.randomSeed),
  onProgress?: (progress: OptimizationProgress) => void,
): OptimizationWorkflow<InnerEarthOptimizationResult> {
  if (input.scenarioType !== "INNER_EARTH") throw new Error("地心优化器需要地心场景配置。");
  const prepared = innerEarthOptimizerInput(input), mode = prepared.innerEarth!.subMode;
  const rule = getInnerEarthRule(mode);
  const audit = { ...auditInnerEarthInput(input), optimizationSide: "A" as const,
    searchDimensions: rule.searchDimensions };
  if (innerEarthIsThreeQueue(mode)) {
    const result = yield* createThreeQueueOptimizationWorkflow(prepared,
      { ...options.threeQueue, side: "A", innerEarthHeroSearch: true,
        finalValidationCount: Math.max(1000, options.threeQueue.finalValidationCount) }, onProgress);
    return { kind: "threeQueue", battleScenario: "INNER_EARTH", innerEarthMode: mode,
      audit: { ...audit, headMode: "SEARCH_HEAD" }, result, performance: result.performance };
  }
  // No ownership, generation, weapon or body search is consulted. All 231
  // ratios still receive Criterion and deterministic round estimates first.
  const result = yield* createSimpleOptimizationWorkflow(prepared, { ...options.simple,
    side: "A", fixedHeroes: true, fixedRatio: false,
    coarseTrials: Math.max(20, Math.min(50, options.simple.coarseTrials)),
    verificationTrials: Math.max(1000, options.simple.verificationTrials),
    topN: Math.min(5, Math.max(3, options.simple.topN)), fixedHeadInitialCandidateLimit: 30 }, onProgress);
  return { kind: "ratio", battleScenario: "INNER_EARTH", innerEarthMode: mode,
    audit: { ...audit, headMode: "EMPTY_HEAD", headTemplateCount: result.headTemplateCount,
      ratioCount: result.ratioCount, formalInitialCandidateLimit: 30 }, result, performance: result.performance };
}

export function optimizeInnerEarth(input: ValidationBattleInput,
  options: InnerEarthOptimizationOptions = defaultInnerEarthOptimizationOptions(input.randomSeed),
  onProgress?: (progress: OptimizationProgress) => void): InnerEarthOptimizationResult {
  return runOptimizationWorkflow(createInnerEarthOptimizationWorkflow(input, options, onProgress));
}
export function optimizeInnerEarthAsync(input: ValidationBattleInput,
  options: InnerEarthOptimizationOptions, execute: AsyncEvaluationExecutor,
  onProgress?: (progress: OptimizationProgress) => void): Promise<InnerEarthOptimizationResult> {
  return runOptimizationWorkflowAsync(createInnerEarthOptimizationWorkflow(input, options, onProgress), execute);
}

function assertWholeRatio(ratios: Readonly<Record<TroopType, number>>): void {
  if (TROOP_TYPES.some((troop) => !Number.isSafeInteger(ratios[troop]) || ratios[troop] < 0 || ratios[troop] > 100) ||
    TROOP_TYPES.reduce((total, troop) => total + ratios[troop], 0) !== 100)
    throw new Error("地心优化方案比例须为整数百分比并合计 100%。");
}

/** Writes search variables back to the canonical mode schema. User-entered
 * attributes, report-lineup baseline, pet context and all enemy data survive. */
export function applyInnerEarthCandidate(input: ValidationBattleInput, result: InnerEarthOptimizationResult,
  candidate: SimpleScenarioCandidate | ThreeQueueOptimizationState): ValidationBattleInput {
  if (input.scenarioType !== "INNER_EARTH" || input.innerEarth?.subMode !== result.innerEarthMode)
    throw new Error("地心优化方案与当前玩法不一致，请重新优化。");
  const config = input.innerEarth;
  if (result.kind === "threeQueue") {
    if (!("queues" in candidate) || candidate.queues.length !== 3) throw new Error("地心三队方案无效。");
    const queues = config.ally.queues.map((queue, index) => {
      const selected = candidate.queues[index]!;
      const ratio = Object.fromEntries(TROOP_TYPES.map((troop) => [troop, selected.ratiosBp[troop] / 100])) as Record<TroopType, number>;
      assertWholeRatio(ratio);
      return { ...queue, heroes: { ...selected.leaderHeroIds }, ratio,
        ...(selected.headWeaponLevels === undefined ? {} : { weaponLevels: { ...selected.headWeaponLevels } }) };
    }) as unknown as typeof config.ally.queues;
    return materializeInnerEarthInput(normalizeInnerEarthInput({ ...input,
      innerEarth: { ...config, ally: { ...config.ally, queues } } }));
  }
  if ("queues" in candidate || !candidate.ratios ||
    TROOP_TYPES.some((troop) => candidate.leaderHeroIds[troop] != null)) throw new Error("地心无英雄方案只能修改兵种比例。");
  assertWholeRatio(candidate.ratios);
  const total = TROOP_TYPES.reduce((count, troop) => count + config.ally.counts[troop], 0);
  const counts = allocateThreeQueueTroops(total, toThreeQueueBasisPoints(candidate.ratios));
  return materializeInnerEarthInput(normalizeInnerEarthInput({ ...input,
    innerEarth: { ...config, ally: { ...config.ally, counts } } }));
}
