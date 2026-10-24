import type { CriterionBattleResult } from "./types";
import type { RallyTroopRatios } from "../../validationUi";
import type { TroopType } from "../../types";
import { DEFAULT_PROBE_LANE_SHARES, emptyM1aProbeAudit, type M1aProbeAudit, type ProbeLane } from "./probeRacing";
import type { OptimizationBattleScenario, RallyOptimizationRole, OptimizationEffectRoleRow, SkillRoleApplicability } from "../optimizationContext";
import type { SearchDimensionsAudit } from "../searchDimensions";
export interface CriterionSearchOptions {
  readonly racingVersion: 3;
  readonly enabled: boolean;
  /** Legacy Single/333 quota. Rally C0 has no per-head quota. */
  readonly representativesPerHead: number;
  readonly headRatioLimit: number; readonly headRatioFraction: number; readonly smallSpaceHeadRatioFloor: number;
  readonly potentialMainShare: number; readonly potentialProtectionShare: number; readonly potentialDiversityShare: number;
  readonly theoryCandidateLimit: number; readonly theoryCandidateFraction: number; readonly smallSpaceTheoryFloor: number;
  readonly formalCandidateLimit: number; readonly formalCandidateFraction: number; readonly smallSpaceFormalFloor: number;
  readonly roughBodyTop: number; readonly bodyDiversity: number; readonly bodyUncertainty: number;
  readonly bodySpecial: number; readonly bodyExploration: number; readonly matrixBodiesPerRatio: number;
  readonly theoryCandidatesPerRatio: number;
  /** Compatibility names: candidate confidence exposure, never a Rally per-head survival quota. */
  readonly minimumHeadRuns: number; readonly uncertainHeadRuns: number; readonly uncertaintyThreshold: number;
  readonly screeningTrials: readonly number[]; readonly screeningKeep: readonly number[];
  readonly probeLaneShares: Readonly<Record<ProbeLane, number>>;
  /** Legacy Single/333 basin exploration; not a Rally per-head retention rule. */
  readonly finalHeadBasins: number; readonly finalBodyBasinsPerHead: number;
  readonly fineRadius: number; readonly finePerBasin: number; readonly c0TheoryRounds: number;
}
export const DEFAULT_CRITERION_SEARCH: CriterionSearchOptions = {
  racingVersion: 3, enabled: true, representativesPerHead: 6,
  headRatioLimit: 2000, headRatioFraction: .01, smallSpaceHeadRatioFloor: 24,
  potentialMainShare: .75, potentialProtectionShare: .15, potentialDiversityShare: .10,
  theoryCandidateLimit: 4000, theoryCandidateFraction: .125, smallSpaceTheoryFloor: 24,
  formalCandidateLimit: 1500, formalCandidateFraction: .375, smallSpaceFormalFloor: 16,
  roughBodyTop: 16, bodyDiversity: 3,
  bodyUncertainty: 2, bodySpecial: 2, bodyExploration: 1, matrixBodiesPerRatio: 24,
  theoryCandidatesPerRatio: 8,
  minimumHeadRuns: 20, uncertainHeadRuns: 40, uncertaintyThreshold: .35,
  screeningTrials: [5, 20, 50, 100, 300], screeningKeep: [300, 80, 25, 10, 5],
  probeLaneShares: DEFAULT_PROBE_LANE_SHARES,
  finalHeadBasins: 4, finalBodyBasinsPerHead: 2, fineRadius: 3, finePerBasin: 4, c0TheoryRounds: 4,
};
export function resolveCriterionSearchOptions(partial: Partial<CriterionSearchOptions> = {}): CriterionSearchOptions {
  // Ignore removed legacy per-head fields even when present in a saved JSON.
  // Explicit custom cumulative trials/keep arrays remain valid and unchanged.
  const { formalCandidatesPerHead: _removedPerHead, ...supported } = partial as Partial<CriterionSearchOptions> & { formalCandidatesPerHead?: unknown };
  void _removedPerHead;
  const result = { ...DEFAULT_CRITERION_SEARCH, ...supported,
    probeLaneShares: { ...DEFAULT_PROBE_LANE_SHARES, ...partial.probeLaneShares } };
  if(result.racingVersion!==3||typeof result.enabled!=="boolean"||!Array.isArray(result.screeningTrials)||!Array.isArray(result.screeningKeep))throw new RangeError("Invalid Criterion option types.");
  for(const key of ["roughBodyTop","bodyDiversity","bodyUncertainty","bodySpecial","bodyExploration","fineRadius"] as const)if(!Number.isSafeInteger(result[key])||result[key]<0)throw new RangeError(`Invalid Criterion option: ${key}`);
  if(result.uncertaintyThreshold>1||result.fineRadius>10)throw new RangeError("Invalid Criterion protection/window.");
  for (const [key, value] of Object.entries(result)) if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) throw new RangeError(`Invalid Criterion option: ${key}`);
  for (const key of ["headRatioLimit", "smallSpaceHeadRatioFloor", "theoryCandidateLimit", "smallSpaceTheoryFloor", "formalCandidateLimit", "smallSpaceFormalFloor", "representativesPerHead", "matrixBodiesPerRatio", "theoryCandidatesPerRatio", "minimumHeadRuns", "uncertainHeadRuns", "finalHeadBasins", "finalBodyBasinsPerHead", "finePerBasin", "c0TheoryRounds"] as const)
    if (!Number.isSafeInteger(result[key]) || result[key] < 1) throw new RangeError(`Invalid Criterion option: ${key}`);
  if (!result.screeningTrials.length || result.screeningTrials.length !== result.screeningKeep.length ||
    result.screeningTrials.some((n, i) => !Number.isSafeInteger(n) || n < 1 || n > 100000 || i > 0 && n <= result.screeningTrials[i - 1]!) ||
    result.screeningKeep.some((n) => !Number.isSafeInteger(n) || n < 1) || result.uncertainHeadRuns < result.minimumHeadRuns) throw new RangeError("Invalid Criterion screening schedule.");
  for (const key of ["headRatioFraction", "theoryCandidateFraction", "formalCandidateFraction", "potentialMainShare", "potentialProtectionShare", "potentialDiversityShare"] as const)
    if(result[key]>1)throw new RangeError(`Invalid Criterion fraction: ${key}`);
  if(Math.abs(result.potentialMainShare+result.potentialProtectionShare+result.potentialDiversityShare-1)>1e-9)throw new RangeError("Potential channel shares must sum to one.");
  if(Object.keys(result.probeLaneShares).length!==Object.keys(DEFAULT_PROBE_LANE_SHARES).length||
    Object.values(result.probeLaneShares).some((v)=>!Number.isFinite(v)||v<0||v>1)||
    Math.abs(Object.values(result.probeLaneShares).reduce((a,b)=>a+b,0)-1)>1e-9)throw new RangeError("Probe channel shares must sum to one.");
  return result;
}
export interface CriterionElimination { stage: string; headKey: string; candidateKey: string; reason: "budget" | "theoryBudget" | "fiveRunProbe" | "confidence" | "dominance" | "notTopK"; samples: number; uncertainty: number; }
export interface CriterionFinalBodySlot {
  readonly heroDefinitionId:string;readonly runtimeInstanceId:string;readonly effectFamily:string;
  readonly skillId:string;readonly level:number;
}
export interface CriterionSearchAudit extends M1aProbeAudit, Partial<SearchDimensionsAudit> {
  headTemplateCount?:number;ratioCount?:number;bodyCandidateCount?:number;roughJointCount?:number;theoreticalEvaluationCount?:number;
  ignoredProtectedReferencesByFixedHead?:number;
  battleScenario:OptimizationBattleScenario;candidateSide:"A"|"B";candidateRole:RallyOptimizationRole|null;
  fixedOpponentSide:"A"|"B";optimizationObjective:"candidateSideWinRate"|"minEnemyRemainingQuality";
  headEffectsActiveByRole:readonly string[];headEffectsInactiveByRole:readonly string[];
  weaponEffectsActiveByRole:readonly string[];weaponEffectsInactiveByRole:readonly string[];
  bodyEffectsActiveByRole:readonly string[];bodyEffectsInactiveByRole:readonly string[];
  roleEffectApplicability:readonly OptimizationEffectRoleRow[];
  bodiesRejectedAsInactiveInCurrentRole:number;bodyCombinationsRejectedAsInactiveInCurrentRole:number;afterRoleApplicability:number;
  inactiveBodySkillsInCurrentRole:readonly SkillRoleApplicability[];
  /** Category counts before the HEAD-only server-stage filter. R/SR have no S generation. */
  serverGeneration:number;rHeroCount:number;srHeroCount:number;sHeroCount:number;
  registryCategoryCounts:{rHeroCount:number;srHeroCount:number;sHeroCount:number};
  enabledPoolCategoryCounts:{rHeroCount:number;srHeroCount:number;sHeroCount:number};
  excludedRByServerStage:number;excludedSRByServerStage:number;optimizerHeadHeroCount:number;
  sHeroCountByGeneration:Record<string,number>;
  heroCountByTroopTypeAfterHeadFilter:Record<TroopType,number>;
  maxEnabledSGeneration:number;recentSGenerationWindow:readonly [number,number];
  optimizationPoolVisibleHeroCount:number;excludedPostGen3RCount:number;excludedPostGen3SRCount:number;
  heroCountByTroopTypeAfterRarityFilter:Record<TroopType,number>;heroCountByGenerationAfterRarityFilter:Record<string,number>;
  allLegalHeadCountBeforeRecentRule:number;headsBeforeC0:number;
  retainedByMainTheory:number;retainedByUncertainty:number;retainedBySpecialMechanism:number;retainedByDisagreement:number;retainedByDiversity:number;
  rejectedDuringGenerationBySameEffectFamily:number;afterSameEffectMax2:number;rejectedByStrictDominance:number;finalPreprocessedBodyCount:number;
  afterStrictDominance:number;afterProbabilityDominance:number;rejectedBySemanticEquivalence:number;semanticBodyCombinationCount:number;
  afterPareto:number;afterMarginalStacking:number;sourceSkillCount:number;sourcesAfterStrictDominance:number;sourcesAfterProbabilityDominance:number;
  /** Joint HeadRatio/body soft cuts in C1; not global body preprocessing removals. */
  rejectedJointByLowMarginalStacking:number;
  m1bCandidateCount:number;m1bAdvancedCount:number;
  allLegalHeadCount:number; effectiveHeroGeneration:number; recentGenerationWindow:readonly [number,number];
  recentEligibleHeadCount:number; rejectedByRecentGenerationCount:number;
  rawHeadRatioCount:number; retainedHeadRatioCount:number; headsAfterC0:number; headsFullyEliminatedAtC0:number;
  c0Cutoff:number|null; c0MainPotentialCutoff:number|null; eliminatedByTheoryPotential:{headKey:string;bestPotential:number;cutoff:number|null;reason:"belowMainPotentialCutoff"|"theoreticalGlobalQuota"}[];
  rawBodyCombinationCount:number; rejectedBySameEffectFamily:number; rejectedBySkillDominance:number;
  rejectedByProbabilityDominance:number; rejectedByParetoDominance:number; rejectedByLowMarginalStacking:number; preprocessedBodyCount:number;
  roughJointEvaluations:number; matrixCriterionCandidates:number; deterministicTheoryCandidates:number; battleEngineCandidates:number;
  battleRunsRequested:number; battleRunsExecuted:number; battleRunsReused:number;
  finalCandidates:number; uniqueFinalHeads:number; uniqueFinalBodies:number; known89StructureReachedFinal:boolean;
  headGenerationTime:number; headRatioCriterionTime:number; bodyPreprocessTime:number; bodyRoughScanTime:number;
  matrixCriterionTime:number; deterministicTheoryTime:number; battleEngineTime:number; totalWallTime:number;
  warnings:{code:"SEARCH_SPACE_EXPLOSION_WARNING";stage:string;actual:number;threshold:number}[];
  protectedTheoryReferences:number; exactBaselineException:boolean;
  legalHeads: number; ratiosPerHead: number; criterionEvaluations: number;
  representativesPerHead: Record<string, number>; uniqueHeads: number;
  headsEnteredBodySearch: number; ratiosEnteredBodySearch: number; bodyCombosScanned: number;
  perHeadBodyCandidateCount: Record<string, number>;
  legalBodyCount: number; roughBodyEvaluations: number; matrixBodyEvaluations: number; theoryBodyEvaluations: number;
  stageCoverage: Record<string, { candidates: number; uniqueHeads: number; uniqueBodies: number }>;
  protection: Record<string, number>; eliminations: CriterionElimination[];
  actualWeaponLevels: Record<string, number | null>;
  finalists: { headHeroIds: Readonly<Partial<Record<string, string | null>>>; headWeaponLevels: Readonly<Record<string, number>>; weaponLevelSource:"exactBaseline"|"optimizerHeroPool"|"fixedCurrentHead";bodySkillLevels:readonly number[];bodySkillIds: readonly string[];bodySlots:readonly CriterionFinalBodySlot[]; ratios: RallyTroopRatios; trials:number; wins:number; winRate:number; winRateConfidenceInterval:readonly [number,number];selectionReasons:readonly string[]; theoryScore?:number; uncertainty:number; criterion?: CriterionBattleResult }[];
  knownScenario: { status: "notSupplied" | "supplied"; reason: string };
  defaultTargetPriority: readonly string[];
}
export function emptyCriterionAudit(): CriterionSearchAudit {
  return { ...emptyM1aProbeAudit(),battleScenario:"rally",candidateSide:"A",candidateRole:"attacker",fixedOpponentSide:"B",optimizationObjective:"candidateSideWinRate",
    headEffectsActiveByRole:[],headEffectsInactiveByRole:[],weaponEffectsActiveByRole:[],weaponEffectsInactiveByRole:[],bodyEffectsActiveByRole:[],bodyEffectsInactiveByRole:[],roleEffectApplicability:[],
    bodiesRejectedAsInactiveInCurrentRole:0,bodyCombinationsRejectedAsInactiveInCurrentRole:0,afterRoleApplicability:0,inactiveBodySkillsInCurrentRole:[],
    serverGeneration:0,rHeroCount:0,srHeroCount:0,sHeroCount:0,
    registryCategoryCounts:{rHeroCount:0,srHeroCount:0,sHeroCount:0},enabledPoolCategoryCounts:{rHeroCount:0,srHeroCount:0,sHeroCount:0},
    excludedRByServerStage:0,excludedSRByServerStage:0,optimizerHeadHeroCount:0,
    sHeroCountByGeneration:{},heroCountByTroopTypeAfterHeadFilter:{shield:0,lancer:0,marksman:0},maxEnabledSGeneration:0,recentSGenerationWindow:[1,0],
    optimizationPoolVisibleHeroCount:0,excludedPostGen3RCount:0,excludedPostGen3SRCount:0,
    heroCountByTroopTypeAfterRarityFilter:{shield:0,lancer:0,marksman:0},heroCountByGenerationAfterRarityFilter:{},
    allLegalHeadCountBeforeRecentRule:0,headsBeforeC0:0,retainedByMainTheory:0,retainedByUncertainty:0,retainedBySpecialMechanism:0,retainedByDisagreement:0,retainedByDiversity:0,
    rejectedDuringGenerationBySameEffectFamily:0,afterSameEffectMax2:0,rejectedByStrictDominance:0,finalPreprocessedBodyCount:0,m1bCandidateCount:0,m1bAdvancedCount:0,
    afterStrictDominance:0,afterProbabilityDominance:0,rejectedBySemanticEquivalence:0,semanticBodyCombinationCount:0,
    afterPareto:0,afterMarginalStacking:0,sourceSkillCount:0,sourcesAfterStrictDominance:0,sourcesAfterProbabilityDominance:0,rejectedJointByLowMarginalStacking:0,
    allLegalHeadCount:0,effectiveHeroGeneration:0,recentGenerationWindow:[1,1],recentEligibleHeadCount:0,rejectedByRecentGenerationCount:0,
    rawHeadRatioCount:0,retainedHeadRatioCount:0,headsAfterC0:0,headsFullyEliminatedAtC0:0,c0Cutoff:null,c0MainPotentialCutoff:null,eliminatedByTheoryPotential:[],
    rawBodyCombinationCount:0,rejectedBySameEffectFamily:0,rejectedBySkillDominance:0,rejectedByProbabilityDominance:0,rejectedByParetoDominance:0,rejectedByLowMarginalStacking:0,preprocessedBodyCount:0,
    roughJointEvaluations:0,matrixCriterionCandidates:0,deterministicTheoryCandidates:0,battleEngineCandidates:0,battleRunsRequested:0,battleRunsExecuted:0,battleRunsReused:0,
    finalCandidates:0,uniqueFinalHeads:0,uniqueFinalBodies:0,known89StructureReachedFinal:false,
    headGenerationTime:0,headRatioCriterionTime:0,bodyPreprocessTime:0,bodyRoughScanTime:0,matrixCriterionTime:0,deterministicTheoryTime:0,battleEngineTime:0,totalWallTime:0,
    warnings:[],protectedTheoryReferences:0,exactBaselineException:true,
    legalHeads: 0, ratiosPerHead: 0, criterionEvaluations: 0, representativesPerHead: {}, uniqueHeads: 0,
    headsEnteredBodySearch: 0, ratiosEnteredBodySearch: 0, bodyCombosScanned: 0, perHeadBodyCandidateCount: {}, legalBodyCount: 0,
    roughBodyEvaluations: 0, matrixBodyEvaluations: 0, theoryBodyEvaluations: 0, stageCoverage: {}, protection: {}, eliminations: [],
    actualWeaponLevels: {}, finalists: [], knownScenario: { status: "notSupplied", reason: "89.8%摘要缺少完整双方配置；合成回归不冒充真实战报复现。" }, defaultTargetPriority: [] };
}

/** Milliseconds, observational only; zero when profiling is disabled. */
export function checkCriterionSpaceWarnings(audit:CriterionSearchAudit):void {
  audit.warnings=[];
  for(const [stage,actual,threshold] of [
    ["C0 retainedHeadRatio",audit.retainedHeadRatioCount,5000],
    ["B0 preprocessedBody",audit.preprocessedBodyCount,1500],
    ["C2 MatrixCriterion",audit.matrixCriterionCandidates,100000],
    ["C3 DeterministicTheory",audit.deterministicTheoryCandidates,15000],
    ["M1 BattleEngine initial",audit.battleEngineCandidates,5000],
  ] as const)if(actual>threshold)audit.warnings.push({code:"SEARCH_SPACE_EXPLOSION_WARNING",stage,actual,threshold});
}
export function scaledGlobalBudget(count:number,limit:number,fraction:number,floor:number):number {
  return Math.min(count,limit,Math.max(floor,Math.ceil(count*fraction)));
}
