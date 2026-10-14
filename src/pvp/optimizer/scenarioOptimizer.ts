import { OptimizerProfiler, profileOptimizationWorkflow, type SearchPerformanceReport } from "./profiling";
import { createAdaptiveSimpleStages } from "./adaptiveSimpleSearch";
import { createFixedSimpleStages } from "./fixedSimpleSearch";
import { createEmptyHeadCandidate, currentHeadHeroIds, currentHeadWeaponLevels,
  isEmptyHead, resolveSearchDimensions, type SearchDimensionsAudit } from "./searchDimensions";
import type { AdaptiveSearchOptions, SearchIntegrityReport } from "./adaptiveSampling";
import type { OptimizationProgress } from "./types";
import type { HeroPoolAudit } from "./heroSearchPolicy";
import { createOptimizationContext, optimizationContextAudit, auditOptimizationRoleState,
  type OptimizationContext, type OptimizationContextAudit, type OptimizationRoleAudit, type OptimizationEffectRoleRow } from "./optimizationContext";
import { TROOP_TYPES, type SideId, type TroopType } from "../types";
import { isHeroAvailableAtStage } from "../progression";
import { OPTIMIZER_RATIO_BASIS_POINT_STEP } from "../scenario/threeQueueRatios";
import { createValidationPreviewState, deriveBatchSeed,
  getValidationCatalog, sanitizeConfigForStage, validationStageId,
  type ValidationBattleInput, type ValidationSideInput,
  type ValidationTroopInput } from "../validationUi";
import { createSeededRandomSource } from "../troopSkills";
import { createStageSeeds } from "./seedSet";
import { rescaleTroop } from "./troopAllocation";
import { generateRatioGrid } from "./candidateGenerator";
import { createTheoryTemplateBuilder, defaultTheoryOptions, estimateTheoryCandidate,
  createRatioAdjacency, detectRatioLocalPeaks, ratioRegion, scanLineupRatios, validateTheoryOptions,
  type TheoryOptions, type TheoryCoverage, type TheoryEstimate, type SelectionReason } from "./theory";
import { addOptimizationPerformance, emptyOptimizationPerformance, evaluateSearchStage,
  runOptimizationWorkflow, runOptimizationWorkflowAsync,
  type AsyncEvaluationExecutor, type OptimizationPerformance, type OptimizationWorkflow } from "./execution";

export type SimpleScenarioType = "SINGLE" | "THREE_THREE_THREE";
export interface SimpleScenarioCandidate {
  readonly headMode?: SearchDimensionsAudit["headMode"];
  readonly headWeaponLevels?: Readonly<Record<string, number>>;
  readonly criterionEstimate?: CriterionBattleResult;
  /** Candidate-facing score; raw Criterion estimate retains its original A/B names. */
  readonly candidateCriterionScore?: number;
  readonly criterionPerspectiveSide?: SideId;
  readonly leaderHeroIds: Readonly<Partial<Record<TroopType, string | null>>>;
  /** Whole percentages. THREE_THREE_THREE always uses its fixed 1:1:1 allocation. */
  readonly ratios?: Readonly<Record<TroopType, number>>;
  readonly theoryEstimate?: TheoryEstimate;
  readonly selectionReasons?: readonly SelectionReason[];
}
export interface SimpleScenarioOptimizationOptions {
  readonly criterion?: Partial<CriterionSearchOptions>;
  readonly adaptiveSearch?: Partial<AdaptiveSearchOptions>;
  readonly profiling?: boolean;
  readonly side: SideId;
  readonly coarseTrials: number;
  readonly middleTrials: number;
  readonly verificationTrials: number;
  readonly topN: number;
  readonly seed: number;
  readonly fixedHeroes: boolean;
  readonly fixedRatio: boolean;
  readonly theory?: TheoryOptions;
  readonly initialBattleTrials?: number;
  readonly intermediateTrials?: number;
  readonly basinSearch?: Partial<BasinSearchOptions>;
  readonly monteCarloStages?: readonly { readonly trials: number; readonly keep: number }[];
  /** Inner Earth ratio-only path: numerical coverage stays exhaustive, while
   * only the strongest numerical candidates enter formal Monte Carlo. */
  readonly fixedHeadInitialCandidateLimit?: number;
}
export function defaultSimpleScenarioOptimizationOptions(seed: number):
  SimpleScenarioOptimizationOptions {
  return { side: "A", coarseTrials: 20, middleTrials: 150,
    verificationTrials: 1000, topN: 5, seed,
    theory: defaultTheoryOptions(), initialBattleTrials: 10, intermediateTrials: 50,
    fixedHeroes: false, fixedRatio: false };
}
export interface SimpleScenarioEvaluation {
  readonly candidate: SimpleScenarioCandidate;
  readonly trials: number;
  readonly wins: number;
  readonly winRate: number;
  /** Exact input baseline; applying it is a no-op. */
  readonly isCurrent?: boolean;
}
export interface SimpleScenarioOptimizationResult extends OptimizationContextAudit, SearchDimensionsAudit {
  readonly searchDimensionAudit: SearchDimensionsAudit;
  readonly headTemplateCount: number;
  readonly ratioCount: number;
  readonly theoreticalEvaluationCount: number;
  readonly optimizationContext: OptimizationContext;
  readonly criterionAudit?: OptimizationRoleAudit & SearchDimensionsAudit & {kernel:"CriterionBattle";matrixEvaluations:number;roundTheoryEvaluations:number;legalHeads:number;ratioRepresentatives:number;omittedMechanisms:readonly string[];weaponLevels:Readonly<Record<string,number>>;bodiesRejectedAsInactiveInCurrentRole:number};
  readonly searchIntegrityReport?: SearchIntegrityReport;
  readonly searchPerformanceReport?: SearchPerformanceReport;
  readonly scenarioType: SimpleScenarioType;
  readonly status: "success" | "failed";
  readonly side: SideId;
  readonly seed: number;
  readonly current: SimpleScenarioEvaluation;
  readonly topCandidates: readonly SimpleScenarioEvaluation[];
  readonly searchedCandidateCount: number;
  readonly finalValidatedCandidateCount: number;
  readonly performance: OptimizationPerformance;
  readonly theoryCoverage?: TheoryCoverage;
  readonly ratioSearchAudit?: RatioSearchAudit;
  readonly heroPoolAudit?: HeroPoolAudit;
}
export interface ScenarioOptimizer<TOptions, TResult> {
  optimize(input: ValidationBattleInput, options: TOptions,
    onProgress?: (progress: OptimizationProgress) => void): TResult;
}

import { emptyRatioSearchAudit, resolveBasinSearchOptions, searchRatioBasins, type BasinSearchOptions, type RatioSearchAudit } from "./basinSearch";
import { buildHeroPoolAudit, heroSearchPriority, optimizerRecentHeadEligible } from "./heroSearchPolicy";

import { optimizationHeroIds, optimizerHeadWeaponLevels } from "./heroPools";
import { prepareCriterionHead, compileCriterionTemplate, criterionBattle, resolveCriterionSearchOptions, type CriterionBattleResult, type CriterionSearchOptions, type Triple } from "./criterion";
const catalog = getValidationCatalog();
const sides = { A: "sideA", B: "sideB" } as const;

function countsToWholeRatios(side: ValidationSideInput): Record<TroopType, number> {
  const total = TROOP_TYPES.reduce((sum, troop) => sum + side.troops[troop].count, 0);
  if (total <= 0) throw new Error("优化方总兵数必须大于零。");
  const exact = TROOP_TYPES.map((troop) => side.troops[troop].count * 100 / total);
  const values = exact.map(Math.floor);
  const order = [0, 1, 2].sort((a, b) =>
    exact[b]! - values[b]! - (exact[a]! - values[a]!) || a - b);
  const missing = 100 - values.reduce((sum, item) => sum + item, 0);
  for (let index = 0; index < missing; index += 1) {
    values[order[index]!]! += 1;
  }
  return { shield: values[0]!, lancer: values[1]!, marksman: values[2]! };
}

function allocate(total: number, ratios: Readonly<Record<TroopType, number>>): Record<TroopType, number> {
  const exact = TROOP_TYPES.map((troop) => total * ratios[troop] / 100);
  const values = exact.map(Math.floor);
  const order = [0, 1, 2].sort((a, b) =>
    exact[b]! - values[b]! - (exact[a]! - values[a]!) || a - b);
  const missing = total - values.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < missing; index += 1) values[order[index]!]! += 1;
  return { shield: values[0]!, lancer: values[1]!, marksman: values[2]! };
}

function candidateInput(input: ValidationBattleInput,
  sideId: SideId, candidate: SimpleScenarioCandidate): ValidationBattleInput {
  const scenarioType = input.scenarioType;
  if (scenarioType !== "SINGLE" && scenarioType !== "THREE_THREE_THREE") {
    throw new Error("当前场景不支持此推荐方案。");
  }
  const key = sides[sideId];
  const side = input[key];
  if (scenarioType === "SINGLE" && candidate.ratios !== undefined &&
    (TROOP_TYPES.some((troop) => !Number.isSafeInteger(candidate.ratios![troop]) ||
      candidate.ratios![troop] < 0 || candidate.ratios![troop] > 100) ||
      TROOP_TYPES.reduce((sum, troop) => sum + candidate.ratios![troop], 0) !== 100)) {
    throw new Error("优化候选兵种比例必须为整数百分比且合计 100%。");
  }
  const total = TROOP_TYPES.reduce((sum, troop) => sum + side.troops[troop].count, 0);
  const counts = scenarioType === "SINGLE" && candidate.ratios !== undefined
    ? allocate(total, candidate.ratios) : null;
  const nextSide: ValidationSideInput = { ...side,
    leaderHeroIds: (input.attributeInputMode ?? "finalReport") === "finalReport"
      ? currentHeadHeroIds(input, sideId) : candidate.leaderHeroIds,
    ...((input.attributeInputMode ?? "finalReport") === "finalReport" ? {}
      : { simulationWeaponLevels: { ...side.simulationWeaponLevels,
        ...(candidate.headWeaponLevels ?? optimizerHeadWeaponLevels(input, candidate.leaderHeroIds, sideId)) } }),
    ...(counts === null ? {} : { troops: Object.fromEntries(TROOP_TYPES.map((troop) =>
      [troop, rescaleTroop(side.troops[troop], counts[troop])])) as
        Record<TroopType, ValidationTroopInput> }) };
  return { ...input, [key]: nextSide };
}

export function applySimpleScenarioCandidate(input: ValidationBattleInput,
  sideId: SideId, candidate: SimpleScenarioCandidate): ValidationBattleInput {
  const original = input[sides[sideId]];
  const sameHeroes = TROOP_TYPES.every((troop) =>
    (candidate.leaderHeroIds[troop] ?? null) ===
    (original.leaderHeroIds?.[troop] ?? null));
  const total = TROOP_TYPES.reduce((sum, troop) => sum + original.troops[troop].count, 0);
  const sameRatios = input.scenarioType === "THREE_THREE_THREE" ||
    (candidate.ratios !== undefined && total > 0 && TROOP_TYPES.every((troop) =>
      Math.abs(candidate.ratios![troop] - original.troops[troop].count * 100 / total) < 1e-8));
  if (sameHeroes && sameRatios && Object.entries(candidate.headWeaponLevels ?? {}).every(([id,level]) => original.simulationWeaponLevels?.[id] === level)) return input;
  const cleaned = sanitizeConfigForStage(candidateInput(input, sideId, candidate),
    validationStageId(input)).input;
  createValidationPreviewState(cleaned);
  return cleaned;
}

function key(candidate: SimpleScenarioCandidate): string {
  return `${TROOP_TYPES.map((troop) => candidate.leaderHeroIds[troop] ?? "").join("|")}|${
    candidate.ratios === undefined ? "333" : TROOP_TYPES.map((troop) => candidate.ratios![troop]).join("|")}:${TROOP_TYPES.map((t)=>candidate.headWeaponLevels?.[candidate.leaderHeroIds[t]??""]??"pool").join("/")}`;
}

function heroPoolAudit(input: ValidationBattleInput, sideId: SideId, profiler?: OptimizerProfiler) {
  return buildHeroPoolAudit(input, catalog.leaderHeroes.filter((hero) => isHeroAvailableAtStage(hero, validationStageId(input)) &&
    optimizationHeroIds(input, sideId).includes(hero.heroId)), sideId, profiler);
}
export function generateScenarioHeroFormations(input: ValidationBattleInput,
  sideId: SideId, fixed: boolean, profiler?: OptimizerProfiler): readonly SimpleScenarioCandidate["leaderHeroIds"][] {
  const dimensions = resolveSearchDimensions(input, { side: sideId, fixedHead: fixed });
  const current = currentHeadHeroIds(input, sideId);
  if (!dimensions.headSearchEnabled) return dimensions.headMode === "EMPTY_HEAD"
    ? [createEmptyHeadCandidate().leaderHeroIds] : [current];
  const stage = validationStageId(input);
  const choices = Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
    heroPoolAudit(input, sideId, profiler).optimizerHeroPoolAfterFilter.filter((hero) => hero.troopType === troop &&
      isHeroAvailableAtStage(hero, stage) &&
      optimizationHeroIds(input, sideId).includes(hero.heroId)).sort((a, b) =>
        (b.generation ?? 0) - (a.generation ?? 0) || a.heroId.localeCompare(b.heroId))
      .map((hero) => hero.heroId)])) as Record<TroopType, string[]>;
  const formations: SimpleScenarioCandidate["leaderHeroIds"][] = [];
  for (const shield of choices.shield.length ? choices.shield : [null])
    for (const lancer of choices.lancer.length ? choices.lancer : [null])
      for (const marksman of choices.marksman.length ? choices.marksman : [null])
        if (optimizerRecentHeadEligible(input, { shield, lancer, marksman }, sideId))
          formations.push({ shield, lancer, marksman });
  return [...new Map(formations.map((row) =>
    [TROOP_TYPES.map((troop) => row[troop] ?? "").join("|"), row])).values()];
}

export function generateWholePercentRatios(): readonly Readonly<Record<TroopType, number>>[] {
  const result: Record<TroopType, number>[] = [];
  for (let shield = 0; shield <= 100; shield += OPTIMIZER_RATIO_BASIS_POINT_STEP / 100) {
    for (let lancer = 0; lancer <= 100 - shield;
      lancer += OPTIMIZER_RATIO_BASIS_POINT_STEP / 100) {
      result.push({ shield, lancer, marksman: 100 - shield - lancer });
    }
  }
  return result;
}

function sortEvaluations(rows: readonly SimpleScenarioEvaluation[]): SimpleScenarioEvaluation[] {
  return [...rows].sort((a, b) => b.winRate - a.winRate || key(a.candidate).localeCompare(key(b.candidate)));
}

export function* createSimpleOptimizationWorkflow(input: ValidationBattleInput,
  options: SimpleScenarioOptimizationOptions,
  onProgress?: (progress: OptimizationProgress) => void,
): OptimizationWorkflow<SimpleScenarioOptimizationResult> {
  const profiler = options.profiling ? new OptimizerProfiler(onProgress) : undefined;
  return yield* profileOptimizationWorkflow(createSimpleWorkflow(input, options,
    profiler?.progress ?? onProgress, profiler), profiler);
}
function* createSimpleWorkflow(input: ValidationBattleInput,
  options: SimpleScenarioOptimizationOptions,
  onProgress?: (progress: OptimizationProgress) => void,
  profiler?: OptimizerProfiler,
): OptimizationWorkflow<SimpleScenarioOptimizationResult> {
  if (input.scenarioType !== "SINGLE" && input.scenarioType !== "THREE_THREE_THREE") {
    throw new Error("场景优化器仅支持单撞或 333。");
  }
  const optimizationContext = createOptimizationContext(input, options.side);
  const contextAudit = optimizationContextAudit(optimizationContext);
  const searchDimensionAudit = resolveSearchDimensions(input, { side: options.side,
    fixedHead: options.fixedHeroes, fixedRatio: options.fixedRatio });
  const fixedHeadPath = !searchDimensionAudit.headSearchEnabled;
  const count = (value: number, label: string) => {
    if (!Number.isSafeInteger(value) || value < 1 || value > 100_000) {
      throw new Error(`${label} 必须是 1～100000 的整数。`);
    }
  };
  count(options.coarseTrials, "粗筛场次");
  count(options.middleTrials, "二阶段场次");
  count(options.verificationTrials, "最终复验场次");
  count(options.topN, "最终候选数");
  if (!Number.isSafeInteger(options.seed)) throw new Error("搜索种子必须是整数。");
  const side = input[sides[options.side]];
  const currentRatios = input.scenarioType === "SINGLE" ? countsToWholeRatios(side) : undefined;
  const totalTroops = TROOP_TYPES.reduce((sum, troop) => sum + side.troops[troop].count, 0);
  if (input.scenarioType === "SINGLE" && options.fixedRatio) {
    const total = TROOP_TYPES.reduce((sum, troop) => sum + side.troops[troop].count, 0);
    if (TROOP_TYPES.some((troop) => side.troops[troop].count * 100 % total !== 0)) {
      throw new Error("固定当前兵种比例要求当前比例为整数百分比。");
    }
  }
  const currentCandidate: SimpleScenarioCandidate = {
    headMode: isEmptyHead(currentHeadHeroIds(input, options.side)) ? "EMPTY_HEAD" : "FIXED_HEAD",
    leaderHeroIds: currentHeadHeroIds(input, options.side),
    headWeaponLevels: currentHeadWeaponLevels(input, options.side),
    ...(currentRatios === undefined ? {} : { ratios: currentRatios }) };
  const actualCurrentCandidate: SimpleScenarioCandidate = {
    headMode: currentCandidate.headMode!,
    leaderHeroIds: currentHeadHeroIds(input, options.side),
    headWeaponLevels: currentHeadWeaponLevels(input, options.side),
    ...(currentRatios === undefined ? {} : { ratios: Object.fromEntries(TROOP_TYPES.map(
      (troop) => [troop, side.troops[troop].count * 100 / totalTroops])) as
        Record<TroopType, number> }) };
  profiler?.begin("候选生成", 1);
  const generated = [...generateScenarioHeroFormations(input, options.side, options.fixedHeroes, profiler)];
  const formations = fixedHeadPath ? generated : generated.sort((a,b)=>heroSearchPriority(input,b,options.side)-heroSearchPriority(input,a,options.side));
  profiler?.end();
  const theory = options.theory ?? defaultTheoryOptions(); validateTheoryOptions(theory);
  const fixedRatios = currentRatios ?? { shield: 100 / 3, lancer: 100 / 3, marksman: 100 / 3 };
  const grid = input.scenarioType === "THREE_THREE_THREE" || options.fixedRatio
    ? [fixedRatios] : generateRatioGrid(fixedHeadPath ? 5 : theory.ratioStep);
  const adjacency = createRatioAdjacency(grid, theory.ratioStep);
  const buildTemplate = createTheoryTemplateBuilder(theory);
  const coarse = new Map<string, SimpleScenarioCandidate>();
  let localPeaksDetected = 0;
  const hasRatios = input.scenarioType === "SINGLE";
  const criterionOptions = resolveCriterionSearchOptions(options.criterion);
  const dimensionAudit = { ...searchDimensionAudit, headTemplateCount: formations.length,
    ratioCount: grid.length, theoreticalEvaluationCount: formations.length * grid.length };
  const criterionAudit={...contextAudit,...dimensionAudit,kernel:"CriterionBattle" as const,matrixEvaluations:0,roundTheoryEvaluations:0,legalHeads:formations.length,ratioRepresentatives:0,omittedMechanisms:[] as string[],weaponLevels:{} as Record<string,number>,
    headEffectsActiveByRole:[] as string[],headEffectsInactiveByRole:[] as string[],weaponEffectsActiveByRole:[] as string[],weaponEffectsInactiveByRole:[] as string[],
    bodyEffectsActiveByRole:[] as string[],bodyEffectsInactiveByRole:[] as string[],roleEffectApplicability:[] as OptimizationEffectRoleRow[],bodiesRejectedAsInactiveInCurrentRole:0};
  const roleRows=new Map<string,OptimizationEffectRoleRow>();
  profiler?.begin("Criterion → Theory · 全车头扫描", formations.length);
  for (const [index, formation] of formations.entries()) {
    const headWeaponLevels = fixedHeadPath ? searchDimensionAudit.headMode === "EMPTY_HEAD" ? {}
      : currentHeadWeaponLevels(input, options.side) : optimizerHeadWeaponLevels(input, formation, options.side);
    const formationInput = candidateInput(input, options.side, { leaderHeroIds: formation, headWeaponLevels,
      ...(hasRatios ? { ratios: options.fixedRatio ? fixedRatios : { shield: 34, lancer: 33, marksman: 33 } } : {}) });
    const preparedHead = criterionOptions.enabled || fixedHeadPath ? prepareCriterionHead(formationInput) : undefined;
    const criterion = preparedHead ? compileCriterionTemplate(preparedHead) : undefined;
    const roleAudit=auditOptimizationRoleState(preparedHead?.state??createValidationPreviewState(formationInput),optimizationContext,undefined,input.disabledSkillIds);
    for(const field of ["headEffectsActiveByRole","headEffectsInactiveByRole","weaponEffectsActiveByRole","weaponEffectsInactiveByRole"] as const)
      criterionAudit[field]=[...new Set([...criterionAudit[field],...roleAudit[field]])];
    for(const row of roleAudit.roleEffectApplicability)if(row.source!=="body")roleRows.set(`${row.runtimeInstanceId}:${row.skillId}:${row.level}`,row);
    const template = buildTemplate(candidateInput(input, options.side, { leaderHeroIds: formation, headWeaponLevels,
      ...(hasRatios ? { ratios: options.fixedRatio ? fixedRatios : { shield: 34, lancer: 33, marksman: 33 } } : {}) }), options.side);
    Object.assign(criterionAudit.weaponLevels,headWeaponLevels);
    if(criterion){
      const optimized=options.side==="A"?criterion.a:criterion.b,total=optimized.counts.reduce((n,v)=>n+v,0);
      criterionAudit.omittedMechanisms.push(...optimized.omittedMechanisms);
      const evaluated=grid.map((ratios)=>{
        const counts=TROOP_TYPES.map((t)=>total*ratios[t]/100) as unknown as Triple;
        const estimate=options.side==="A"?criterionBattle(criterion,counts):criterionBattle(criterion,criterion.a.counts,counts);
        return {ratios,estimate,score:options.side==="A"?estimate.margin:-estimate.margin};
      });criterionAudit.matrixEvaluations+=evaluated.length;
      const ranked=evaluated.map((_,i)=>i).sort((a,b)=>evaluated[b]!.score-evaluated[a]!.score||a-b),selected=new Map<number,SelectionReason[]>();
      const add=(i:number|undefined,reason:SelectionReason)=>{if(i!==undefined){const reasons=selected.get(i)??[];if(!reasons.includes(reason))reasons.push(reason);selected.set(i,reasons);}};
      add(ranked[0],"matrixCriterion");
      const peaks=detectRatioLocalPeaks(evaluated.map((r)=>r.score),adjacency);localPeaksDetected+=peaks.length;
      add(peaks.sort((a,b)=>evaluated[b]!.score-evaluated[a]!.score)[0],"theoryLocalPeak");
      add([...ranked].sort((a,b)=>evaluated[b]!.estimate.uncertainty-evaluated[a]!.estimate.uncertainty)[0],"uncertaintyExploration");
      const random=createSeededRandomSource(deriveBatchSeed(options.seed,index+2000000)),uncovered=ranked.filter((i)=>![...selected.keys()].some((j)=>ratioRegion(grid[j]!)===ratioRegion(grid[i]!)));
      if(uncovered.length)add(uncovered[Math.floor(random.next()*uncovered.length)],"randomExploration");
      for(const i of ranked)if(selected.size<criterionOptions.representativesPerHead)add(i,"matrixCriterion");
      const selections: readonly (readonly [number, SelectionReason[]])[] = fixedHeadPath
        ? evaluated.map((_, i) => [i, ["matrixCriterion"]])
        : [...selected].slice(0,criterionOptions.representativesPerHead);
      for(const [i,reasons] of selections){
        const row=evaluated[i]!,candidate:SimpleScenarioCandidate={headMode:searchDimensionAudit.headMode,leaderHeroIds:formation,headWeaponLevels,...(hasRatios?{ratios:row.ratios}:{}),criterionEstimate:row.estimate,
          candidateCriterionScore:row.score,criterionPerspectiveSide:options.side,
          theoryEstimate:estimateTheoryCandidate(template,TROOP_TYPES.map((t)=>row.ratios[t])),selectionReasons:reasons};
        coarse.set(key(candidate),candidate);criterionAudit.roundTheoryEvaluations++;criterionAudit.ratioRepresentatives++;
      }
    }else{
      const scan=scanLineupRatios(grid,adjacency,(ratios)=>estimateTheoryCandidate(template,TROOP_TYPES.map((t)=>ratios[t])),theory,deriveBatchSeed(options.seed,index+2000000),profiler);
      localPeaksDetected+=scan.localPeaksDetected;
      for(const row of scan.selections){const candidate:SimpleScenarioCandidate={headMode:searchDimensionAudit.headMode,leaderHeroIds:formation,headWeaponLevels,...(hasRatios?{ratios:row.ratios}:{}),theoryEstimate:row.estimate,selectionReasons:row.selectionReasons};coarse.set(key(candidate),candidate);}
    }
    if ((index + 1) % 10 === 0 || index + 1 === formations.length)
      onProgress?.({ stage: "Criterion → Theory · 全车头扫描", completed: index + 1, total: formations.length });
  }
  profiler?.end();
  criterionAudit.omittedMechanisms=[...new Set(criterionAudit.omittedMechanisms)];
  criterionAudit.roleEffectApplicability=[...roleRows.values()];
  const currentKey = key(currentCandidate);
  if ((!fixedHeadPath || coarse.has(currentKey)) && formations.some((formation) => TROOP_TYPES.every((troop) =>
    (formation[troop] ?? null) === (currentCandidate.leaderHeroIds[troop] ?? null))))
    coarse.set(currentKey, { ...coarse.get(currentKey), ...currentCandidate, selectionReasons: ["currentConfig"] });
  if (fixedHeadPath) {
    const fixed = yield* createFixedSimpleStages(input, options, [...coarse.values()], actualCurrentCandidate,
      key, (candidate) => candidateInput(input, options.side, candidate), onProgress, profiler);
    return { ...contextAudit, ...dimensionAudit, searchDimensionAudit: dimensionAudit,
      optimizationContext, scenarioType: input.scenarioType, status: "success", side: options.side, seed: options.seed,
      criterionAudit, current: fixed.current, topCandidates: fixed.top, searchedCandidateCount: fixed.searched,
      finalValidatedCandidateCount: fixed.finalCount, performance: fixed.performance,
      ratioSearchAudit: fixed.ratioSearchAudit, searchIntegrityReport: fixed.searchIntegrityReport,
      theoryCoverage: { theoryCandidateCount: formations.length * grid.length, legalHeroLineupCount: formations.length,
        theoryHeroCoverage: 100, ratiosPerHeroLineup: grid.length, localPeaksDetected,
        battleCandidateCount: fixed.initialCandidateCount, heroLineupsEnteringBattleEngine: formations.length, battleHeroCoverage: 100 } };
  }
  if (options.adaptiveSearch?.enabled !== false) {
    const adaptive = yield* createAdaptiveSimpleStages(input, options, [...coarse.values()], actualCurrentCandidate,
      key, (candidate) => candidateInput(input, options.side, candidate), onProgress, profiler);
    if (formations.some((formation) => !adaptive.visited.has(TROOP_TYPES.map((troop) => formation[troop] ?? "").join("|"))))
      throw new Error("Formal hero coverage is incomplete.");
    return { ...contextAudit,...dimensionAudit,searchDimensionAudit:dimensionAudit,optimizationContext,scenarioType: input.scenarioType, status: "success", side: options.side, seed: options.seed,
      criterionAudit,current: adaptive.current, topCandidates: adaptive.top, searchedCandidateCount: adaptive.searched,
      finalValidatedCandidateCount: adaptive.finalCount, performance: adaptive.performance,
      ratioSearchAudit: adaptive.ratioSearchAudit, searchIntegrityReport: adaptive.searchIntegrityReport,
      heroPoolAudit: heroPoolAudit(input, options.side),
      theoryCoverage: { theoryCandidateCount: formations.length * grid.length, legalHeroLineupCount: formations.length,
        theoryHeroCoverage: 100, ratiosPerHeroLineup: grid.length, localPeaksDetected, battleCandidateCount: coarse.size,
        heroLineupsEnteringBattleEngine: formations.length, battleHeroCoverage: formations.length ? 100 : 0 } };
  }
  let performance = emptyOptimizationPerformance(), searchedCandidateCount = 0;
  const visitedHeads = new Set<string>();
  const runStage = function* (name: string, candidates: readonly SimpleScenarioCandidate[],
    trials: number, offset: number, prune = true): OptimizationWorkflow<SimpleScenarioEvaluation[]> {
    profiler?.begin(name, candidates.length);
    const seeds = createStageSeeds(options.seed, trials, offset);
    const rows: SimpleScenarioEvaluation[] = [];
    yield* evaluateSearchStage(candidates, (candidate) => ({ kind: "battle",
      input: candidateInput(input, options.side, candidate), seeds, side: options.side,
      protectFromPruning: key(candidate) === currentKey }), prune,
    (candidate, row, index) => {
      performance = addOptimizationPerformance(performance, row.performance); searchedCandidateCount += 1;
      visitedHeads.add(TROOP_TYPES.map((troop) => candidate.leaderHeroIds[troop] ?? "").join("|"));
      if (!row.samples.pruned) rows.push({ candidate, trials: row.samples.trials,
        wins: row.samples.wins, winRate: row.samples.wins / row.samples.trials });
      if ((index + 1) % 5 === 0 || index + 1 === candidates.length)
        onProgress?.({ stage: name, completed: index + 1, total: candidates.length });
    }, candidates.length);
    profiler?.end();
    return sortEvaluations(rows);
  };
  const stages = options.monteCarloStages ?? [
    { trials: Math.min(options.initialBattleTrials ?? 10, options.coarseTrials), keep: 3000 },
    { trials: options.coarseTrials, keep: 500 },
    { trials: Math.min(options.intermediateTrials ?? 50, options.middleTrials), keep: 50 },
    { trials: options.middleTrials, keep: Math.min(options.topN, 10) },
  ];
  if (!stages.length || stages.some((stage) => !Number.isSafeInteger(stage.trials) || stage.trials < 1 ||
    stage.trials > 100_000 || !Number.isSafeInteger(stage.keep) || stage.keep < 1))
    throw new Error("Invalid Monte Carlo halving schedule.");
  let pool = [...coarse.values()], top: SimpleScenarioEvaluation[] = [];
  const ratioSearchAudit = emptyRatioSearchAudit();
  for (const [index, stage] of stages.entries()) {
    if (index === 2 && hasRatios && !options.fixedRatio) {
      const expanded = yield* searchRatioBasins(top.filter((row) =>
        optimizerRecentHeadEligible(input, row.candidate.leaderHeroIds, options.side)), {
        candidate: (row: SimpleScenarioEvaluation) => row.candidate,
        ratios: (candidate: SimpleScenarioCandidate) => candidate.ratios!,
        head: (candidate: SimpleScenarioCandidate) => TROOP_TYPES.map((troop) => candidate.leaderHeroIds[troop] ?? "").join("|"),
        key, compare: (a, b) => b.winRate - a.winRate,
        child: (candidate: SimpleScenarioCandidate, ratios, fine) => ({ leaderHeroIds: candidate.leaderHeroIds,
          ...(candidate.headMode === undefined ? {} : { headMode: candidate.headMode }),
          ratios, selectionReasons: [fine ? "fineSearch" as const : "localExpansion" as const] }),
        evaluate: (candidates, round) => runStage(`Basin · 5%扩张第${round + 1}轮`, candidates, stage.trials, index * 100_000, false),
      }, resolveBasinSearchOptions(options.basinSearch), ratioSearchAudit);
      pool = [...new Map([...pool, ...expanded.coarse, ...expanded.fine].map((candidate) => [key(candidate), candidate])).values()];
      const screened = yield* runStage("Basin · 1%窗口共同种子复筛", pool, stages[1]!.trials, 100_000);
      const retained = screened.slice(0, stage.keep);
      const current = screened.find((row) => key(row.candidate) === currentKey);
      if (current && !retained.includes(current)) retained.push(current);
      pool = [...new Map([...retained.map((row) => row.candidate), ...expanded.centers].map((candidate) => [key(candidate), candidate])).values()];
    }
    const rows = yield* runStage(`M${index + 1} · 正式逐级筛选`, pool, stage.trials, index * 100_000, index !== 0);
    if (index === 0 && formations.some((formation) => !visitedHeads.has(TROOP_TYPES.map((troop) => formation[troop] ?? "").join("|"))))
      throw new Error("Formal hero coverage is incomplete.");
    top = rows.slice(0, stage.keep);
    const incumbent = rows.find((row) => key(row.candidate) === currentKey);
    if (incumbent !== undefined && !top.includes(incumbent)) top.push(incumbent);
    pool = top.map((row) => row.candidate);
  }
  const verified = yield* runStage("Final · 统一高场次复验", pool,
    options.verificationTrials, 500_000, false);
  profiler?.begin("Final · 当前方案独立复验", 1);
  const [currentRow] = yield [{ kind: "battle", input, side: options.side,
    seeds: createStageSeeds(options.seed, options.verificationTrials, 500_000) }];
  performance = addOptimizationPerformance(performance, currentRow!.performance);
  const current = { candidate: actualCurrentCandidate, trials: currentRow!.samples.trials,
    wins: currentRow!.samples.wins, winRate: currentRow!.samples.wins / currentRow!.samples.trials };
  profiler?.end();
  const baseline = { ...current, isCurrent: true };
  const ranked = sortEvaluations([baseline, ...verified]).slice(0, options.topN);
  return { ...contextAudit,...dimensionAudit,searchDimensionAudit:dimensionAudit,optimizationContext,scenarioType: input.scenarioType, status: ranked.length > 0 ? "success" : "failed",
    criterionAudit,side: options.side, seed: options.seed, current: baseline, topCandidates: ranked,
    searchedCandidateCount, finalValidatedCandidateCount: verified.length + 1, performance,
    ratioSearchAudit, heroPoolAudit: heroPoolAudit(input, options.side),
    theoryCoverage: { theoryCandidateCount: formations.length * grid.length, legalHeroLineupCount: formations.length,
      theoryHeroCoverage: 100, ratiosPerHeroLineup: grid.length, localPeaksDetected, battleCandidateCount: coarse.size,
      heroLineupsEnteringBattleEngine: formations.length, battleHeroCoverage: formations.length ? 100 : 0 } };
}

export function optimizeSimpleScenario(input: ValidationBattleInput,
  options: SimpleScenarioOptimizationOptions,
  onProgress?: (progress: OptimizationProgress) => void,
): SimpleScenarioOptimizationResult {
  return runOptimizationWorkflow(createSimpleOptimizationWorkflow(input, options, onProgress));
}
export function optimizeSimpleScenarioAsync(input: ValidationBattleInput,
  options: SimpleScenarioOptimizationOptions, execute: AsyncEvaluationExecutor,
  onProgress?: (progress: OptimizationProgress) => void,
): Promise<SimpleScenarioOptimizationResult> {
  return runOptimizationWorkflowAsync(createSimpleOptimizationWorkflow(input, options, onProgress), execute);
}

export const SingleScenarioOptimizer: ScenarioOptimizer<SimpleScenarioOptimizationOptions,
  SimpleScenarioOptimizationResult> = { optimize: (input, options, onProgress) => {
    if (input.scenarioType !== "SINGLE") throw new Error("需要单撞场景配置。");
    return optimizeSimpleScenario(input, options, onProgress);
  } };
export const ThreeThreeThreeScenarioOptimizer: ScenarioOptimizer<
  SimpleScenarioOptimizationOptions, SimpleScenarioOptimizationResult> = {
  optimize: (input, options, onProgress) => {
    if (input.scenarioType !== "THREE_THREE_THREE") {
      throw new Error("需要 333 场景配置。");
    }
    return optimizeSimpleScenario(input, options, onProgress);
  },
};
