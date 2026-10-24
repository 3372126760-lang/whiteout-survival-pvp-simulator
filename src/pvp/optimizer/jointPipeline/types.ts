import type { RallyTroopRatios } from "../../validationUi";
import type { CanonicalBodyAudit } from "./canonicalBodies";

export interface JointPipelineOptions {
  perHeadProtectedK: number;
  criterionKeep: number;
  criterionFineKeep: number;
  theoryKeep: number;
  criterionRadius: number;
  theoryRadius: number;
  formalRatioRadius: 1 | 2;
  formalRatioTrials: number;
  formalRatioKeep: number;
  formalStages: readonly { trials: number; keep: number }[];
}
export const JOINT_TOP_K = 10_000;
export function resolveJointPipelineOptions(value: Partial<JointPipelineOptions> = {}): JointPipelineOptions {
  const result: JointPipelineOptions = { perHeadProtectedK: 1, criterionKeep: 1500,
    criterionFineKeep: Math.min(Math.max(500, value.theoryKeep ?? 200), value.criterionKeep ?? 1500), theoryKeep: 200,
    criterionRadius: 10, theoryRadius: 5, formalRatioRadius: 1, formalRatioTrials: 100,
    formalRatioKeep: Math.max(value.formalStages?.[3]?.keep ?? 0, Math.min(8, value.formalStages?.[2]?.keep ?? value.theoryKeep ?? 200)),
    formalStages: [{ trials: 20, keep: Math.min(80, value.theoryKeep ?? 200) }, { trials: 50, keep: Math.min(30, value.theoryKeep ?? 200) },
      { trials: 100, keep: Math.min(15, value.theoryKeep ?? 200) }, { trials: 300, keep: Math.min(5, value.theoryKeep ?? 200) }], ...value };
  if (!Number.isSafeInteger(result.perHeadProtectedK) || result.perHeadProtectedK < 1 ||
      !Number.isSafeInteger(result.criterionKeep) || result.criterionKeep < 1 ||
      !Number.isSafeInteger(result.theoryKeep) || result.theoryKeep < 1 ||
      result.criterionKeep > JOINT_TOP_K || !Number.isSafeInteger(result.criterionFineKeep) || result.criterionFineKeep < 1 ||
      result.criterionFineKeep > result.criterionKeep || result.theoryKeep > result.criterionFineKeep ||
      result.criterionRadius !== 10 || !Number.isSafeInteger(result.theoryRadius) || result.theoryRadius < 1 || result.theoryRadius > 10 ||
      result.formalRatioRadius !== 1 || result.formalRatioTrials !== 100 || result.formalStages.length !== 4 ||
      !Number.isSafeInteger(result.formalRatioKeep) || result.formalRatioKeep < 1 || result.formalRatioKeep > result.formalStages[2]!.keep)
    throw new RangeError("Invalid joint search budgets/radii.");
  if (result.formalStages.length !== 4 || result.formalStages.some((s, i) =>
    s.trials !== [20, 50, 100, 300][i] || !Number.isSafeInteger(s.keep) || s.keep < 1 ||
    s.keep > (i ? result.formalStages[i - 1]!.keep : result.theoryKeep)))
    throw new RangeError("Formal stages must use cumulative 20/50/100/300 trials with decreasing keeps.");
  if (result.formalStages[3]!.keep > result.formalRatioKeep) throw new RangeError("Final optimizer keep exceeds the pre-300 keep.");
  return result;
}
export interface JointPeakRow { head: number; body: number; score: number; ratio: RallyTroopRatios; }
export interface JointPeakProfile {
  rankCheckpoints?: readonly JointRankCheckpoint[];
  headCount: number; bodyCount: number; evaluatedHeadBodyCount: number;
  objectiveEvaluationCount: number; avgObjectiveCallsPerHeadBody: number;
  kktEvaluationCount: number;
  elapsedMs: number; preparationElapsedMs: number; evaluatedHeadBodyPerSecond: number;
  workerCount: number; retainedCount: number; top10000CutoffJ: number | null;
}
export interface JointRankCheckpoint {
  rank: number; j: number; relativeToBest: number; lossFromBest: number;
  headKey: string; bodyKey: string; peakRatio: RallyTroopRatios;
}
export interface JointJLineage {
  readonly jRankUnavailableReason?: string;
  readonly initialGlobalJRank?: number | null;
  readonly bodyRankWithinHead?: number | null;
  readonly headRankWithinBody?: number | null;
  readonly recalledBy?: readonly RecallSource[];
  readonly initialJRank?: number | null;
  readonly jPeakRatio?: RallyTroopRatios;
  readonly criterionRatio?: RallyTroopRatios;
  readonly theoryRatio?: RallyTroopRatios;
  readonly formalBestRatio?: RallyTroopRatios;
  readonly jMax?: number;
  readonly jAtFormalRatio?: number;
  readonly jRetentionRatio?: number;
  readonly jLoss?: number;
}
export type RecallSource = "globalTopJ" | "perHeadBestJ" | "currentConfig" | "protectedReference" | "localBattleNeighbor";
export interface RecallAudit {
  globalTopJCount: number; perHeadProtectedK: number; perHeadRawCount: number; perHeadUniqueCount: number;
  overlapWithGlobalTopJ: number; mergedRecallCount: number; addedOnlyByPerHeadCount: number;
  finalistRecallSources: readonly { headKey: string; bodyKey: string; recalledBy: readonly RecallSource[]; winRate: number }[];
  bestFormalRecallSource: readonly RecallSource[];
  debugCandidates: readonly (JointJLineage & { headKey: string; bodyKey: string; minimumPerHeadK: number | null; recalledByTop1: boolean;
    bestBodyForHead?: { bodyKey: string; jMax: number; jPeakRatio: RallyTroopRatios } })[];
  addedOnlyCriterionElapsedMs?: number;
  rankDiagnosticPeakEvaluations: number;
}
export interface FormalRatioProfile {
  lineupCount: number; generatedRatioCount: number; stageASamplesPerRatio: number;
  stageARequestedBattles: number; stageAExecutedBattles: number; stageAReusedBattles: number; stageARetainedRatioCount: number;
  stageBSamplesPerRatio: number; stageBRequestedBattles: number; stageBExecutedBattles: number; stageBReusedBattles: number;
  elapsedMs: number;
}
export interface FormalFinalistComparison extends JointJLineage {
  formalRank: number; headKey: string; bodyKey: string; trials: number; winRate: number;
}
export interface FinalCorrelationProfile {
  finalistJRanks: readonly (number | null)[]; finalistJRetentionRatios: readonly (number | null)[];
  bestFormalInitialJRank: number | null; maxInitialJRankAmongTop5: number | null;
  finalists: readonly FormalFinalistComparison[];
}
export interface JointPipelineAudit {
  recallAudit?: RecallAudit;
  body?: CanonicalBodyAudit;
  criterionFinePairs?: number; criterionFineEvaluations?: number;
  formalRatio?: FormalRatioProfile; finalCorrelation?: FinalCorrelationProfile;
  peak: JointPeakProfile;
  criterionPairs: number; criterionEvaluations: number; averageLocal5PercentRatios: number;
  theoryPairs: number; theoryEvaluations: number; formalPairs: number;
  formalRatioCandidates: number; finalOptimizerCandidates: number; comparisonCandidates: number;
  finalTrials: number;
}
