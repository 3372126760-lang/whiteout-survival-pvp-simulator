import type { CriterionSearchOptions, CriterionSearchAudit } from "./criterion/searchTypes";
import type { BodyEnumerationAudit } from "./criterion/bodyEnumeration";
import type { CriterionBattleResult } from "./criterion/types";
import type { optimizerPoolAudit } from "./heroPools";
import type { BasinSearchOptions, RatioSearchAudit } from "./basinSearch";
import type { AdaptiveSearchOptions, SearchIntegrityReport } from "./adaptiveSampling";
import type { SearchPerformanceReport } from "./profiling";
import type { HeroPoolAudit } from "./heroSearchPolicy";
import type { SideId, TroopType } from "../types";
import type { OptimizationContext } from "./optimizationContext";
import type { SearchDimensionsAudit } from "./searchDimensions";
import type { BatchMetricDistribution } from "../validationUi";
import type { RallyTroopRatios, ValidationBattleInput } from "../validationUi";
import type { OptimizationPerformance } from "./execution";
import type { TheoryOptions, TheoryCoverage, TheoryEstimate, SelectionReason } from "./theory";
import type { JointPipelineOptions, JointPipelineAudit, JointJLineage } from "./jointPipeline/types";

export interface SearchConstraint {
  readonly minGeneration?: number;
  readonly requiredHeroIds?: readonly string[];
  readonly forbiddenHeroIds?: readonly string[];
  readonly heroPoolIds?: readonly string[];
  readonly fixedLeaders?: Readonly<Partial<Record<TroopType, string | null>>>;
  readonly fixedMemberSkillIds?: readonly string[];
  readonly fixedBodyExact?: boolean;
  readonly allowedPositions?: Readonly<Record<string, readonly ("leader" | "member")[]>>;
  /** @deprecated Persisted for old configurations only. Body enumeration always allows distinct heroes sharing a family up to the two-copy family limit. */
  readonly allowDuplicateMembers?: boolean;
  /** Only enable after confirming that member slots have no order-dependent semantics. */
  readonly equivalentMemberPositions?: boolean;
}

export interface OptimizationStage {
  readonly ratioStep: number;
  readonly trials: number;
  readonly keep: number;
  readonly maxCandidates: number;
}

export interface OptimizationConfig {
  readonly jointPipeline?: Partial<JointPipelineOptions>;
  /** Observational only; these candidates receive ranks, never protected promotion. */
  readonly jointDebugCandidates?: readonly RallyCandidate[];
  /** Formal rally inputs retain A=attacker, B=defender. */
  readonly candidateSide?: SideId;
  readonly adaptiveSearch?: Partial<AdaptiveSearchOptions>;
  readonly profiling?: boolean;
  readonly criterion?: Partial<CriterionSearchOptions>;
  readonly objectiveMode: "singleWin" | "enemyAttrition" | "minRallies" | "auto";
  readonly constraints: SearchConstraint;
  readonly stages: readonly [OptimizationStage, OptimizationStage, OptimizationStage];
  readonly verificationTrials: number;
  readonly verificationTop: number;
  readonly topN: number;
  readonly firstSeed: number;
  readonly theory?: TheoryOptions;
  readonly initialBattleTrials?: number;
  readonly basinSearch?: Partial<BasinSearchOptions>;
  /** Optional explicit successive-halving schedule, before final verification. */
  readonly monteCarloStages?: readonly { readonly trials: number; readonly keep: number }[];
  /** Known manual candidates receive formal evaluation even when theory ranks them poorly. */
  readonly protectedCandidates?: readonly RallyCandidate[];
  readonly targetDefeatProbability: number;
  readonly maxWaves: number;
  readonly beamWidth: number;
  readonly branchWidth: number;
  readonly beamTrials: number;
  readonly singleFightThresholdLow: number;
  readonly singleFightThresholdHigh: number;
}

export interface RallyCandidate extends JointJLineage {
  readonly bodySkillLevels?: readonly number[];
  readonly troopLevels?: Readonly<Record<TroopType, string>>;
  readonly headMode?: SearchDimensionsAudit["headMode"];
  /** Criterion's numerical a/b lanes are candidate/opponent for joint search. */
  readonly criterionPerspectiveSide?: SideId;
  readonly headWeaponLevels?: Readonly<Record<string, number>>;
  readonly criterionEstimate?: CriterionBattleResult;
  readonly leaderHeroIds: Readonly<Partial<Record<TroopType, string | null>>>;
  readonly memberSkillIds: readonly string[];
  readonly ratios: RallyTroopRatios;
  readonly theoryEstimate?: TheoryEstimate;
  readonly selectionReasons?: readonly SelectionReason[];
}

export interface TroopSurvivors {
  readonly shield: number;
  readonly lancer: number;
  readonly marksman: number;
}

export interface CandidateEvaluation {
  /** Fixed-reference weighted enemy survivors, pre-battle=100, lower is better. */
  readonly enemyRemainingQuality?: BatchMetricDistribution;
  readonly candidate: RallyCandidate;
  readonly actualCounts: TroopSurvivors;
  readonly trials: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly timeouts: number;
  readonly winRate: number;
  /** Wilson 95% confidence interval for win probability, not a troop distribution. */
  readonly wilson95: readonly [number, number];
  readonly selfRemaining: Readonly<Record<"total" | TroopType, BatchMetricDistribution>>;
  readonly enemyRemaining: Readonly<Record<"total" | TroopType, BatchMetricDistribution>>;
  readonly rounds: BatchMetricDistribution;
}

export interface WaveEvaluation {
  readonly wave: number;
  readonly defeatProbability: number;
  readonly enemyRemaining: Readonly<Record<"total" | TroopType, BatchMetricDistribution>>;
}

export interface MultiWaveEvaluation {
  readonly sequence: readonly RallyCandidate[];
  readonly trials: number;
  readonly targetWaves: number | null;
  readonly waves: readonly WaveEvaluation[];
}

export interface OptimizationProgress {
  readonly performanceReport?: SearchPerformanceReport;
  readonly stage: string;
  readonly completed: number;
  readonly total: number;
}

export interface RallySearchDiagnostics {
  readonly jointPipeline?: JointPipelineAudit;
  readonly searchDimensionAudit?: SearchDimensionsAudit;
  /** Criterion-disabled workflows still use B0 template preprocessing; raw ordered counts remain separate. */
  readonly bodyEnumerationAudit?: BodyEnumerationAudit;
  readonly criterionAudit?: CriterionSearchAudit;
  readonly weaponAudit?: ReturnType<typeof optimizerPoolAudit>;
  readonly searchIntegrityReport?: SearchIntegrityReport;
  readonly theoryCoverage?: TheoryCoverage;
  readonly theoryOptions?: TheoryOptions;
  readonly theoryLineups?: readonly { readonly head: RallyCandidate["leaderHeroIds"];
    readonly scannedRatios: number; readonly localPeaks: number; readonly selectedRatios: number }[];
  readonly battleSelections?: readonly { readonly candidateKey: string;
    readonly selectionReasons: readonly SelectionReason[] }[];
  readonly monteCarloStages?: readonly { readonly stage: string; readonly candidates: number;
    readonly trials: number; readonly retained: number; readonly simulatedTrials: number }[];
  readonly localExpansionCount?: number;
  readonly heroPoolAudit?: HeroPoolAudit;
  readonly ratioSearchAudit?: RatioSearchAudit;
  readonly legalHeadCandidateCount: number;
  readonly evaluatedUniqueHeadCandidateCount: number;
  /** Stage 1 actual engine visits divided by legal heads, expressed as a percentage. */
  readonly headCoverageRate: number;
  readonly fixedBody: boolean;
  readonly availableBodyCandidateCount: number;
  readonly stage1Trials: number;
  readonly stage1CandidateCount: number;
  readonly retainedHeadCandidateCount: number;
  readonly stage2RatioCandidateCount: number;
  readonly fixedHead: boolean;
  readonly searchDimensions: { readonly headShield: boolean; readonly headLancer: boolean;
    readonly headMarksman: boolean; readonly body: boolean; readonly troopRatio: boolean };
  readonly availableHeadHeroesByTroop: Readonly<Record<TroopType, readonly (string | null)[]>>;
  readonly shieldCandidateCount: number;
  readonly lancerCandidateCount: number;
  readonly marksmanCandidateCount: number;
  /** Eligible Cartesian head space; actual visits are listed separately below. */
  readonly headCandidateCount: number;
  readonly bodyCandidateCount: number;
  readonly ratioCandidateCount: number;
  /** Upper bound from eligible heads × generated bodies × full ratio grid. */
  readonly totalCandidateCount: number;
  readonly coarseRatioCandidateCount: number;
  readonly coarseCandidateCount: number;
  readonly generatedFormationCount: number;
  readonly evaluatedHeadLineups: readonly RallyCandidate["leaderHeroIds"][];
  readonly bestHeadLineup: RallyCandidate["leaderHeroIds"];
  readonly optimizationTargetSide: SideId;
  readonly candidateChangedSide: SideId;
}

export interface OptimizationResult {
  readonly searchDimensionAudit?: SearchDimensionsAudit;
  readonly optimizationContext?: OptimizationContext;
  readonly searchPerformanceReport?: SearchPerformanceReport;
  readonly searchDiagnostics?: RallySearchDiagnostics;
  readonly status: "success" | "target_not_met";
  readonly seed: number;
  readonly currentEvaluation: CandidateEvaluation;
  readonly requestedMode: OptimizationConfig["objectiveMode"];
  readonly selectedMode: "singleWin" | "enemyAttrition" | "minRallies";
  readonly singleWaveTop: readonly CandidateEvaluation[];
  readonly multiWaveTop: readonly MultiWaveEvaluation[];
  readonly evaluatedCandidates: number;
  /** Single battles plus full multi-wave trajectories evaluated during search. */
  readonly performance: OptimizationPerformance;
  readonly approximation: string | null;
}

export type OptimizationInput = ValidationBattleInput;
