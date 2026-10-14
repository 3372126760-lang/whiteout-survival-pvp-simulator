import type { FastBattleResult } from "../../battle/fastBattleMode";
import { TROOP_TYPES, type SideId } from "../../types";
import { candidateKey } from "../candidateGenerator";
import { headLineupKey } from "../theory";
import type { CandidateEvaluation, RallyCandidate } from "../types";

export type ProbeLane = "theory" | "matrix" | "paired" | "uncertainty" | "special" | "disagreement";
/** Global quotas only: no Head, hero, or body receives a minimum allocation. */
export const DEFAULT_PROBE_LANE_SHARES: Readonly<Record<ProbeLane, number>> = {
  theory: .40, matrix: .20, paired: .20, uncertainty: .08, special: .04, disagreement: .08,
};
export interface PairedProbeEvidence {
  readonly candidateKey: string;
  readonly referenceCandidateKey: string;
  readonly seeds: readonly number[];
  readonly pairedWins: number;
  readonly pairedLosses: number;
  readonly pairedDraws: number;
  /** Mean common-seed outcome difference: win = 1, draw/timeout = .5, loss = 0. */
  readonly deltaOutcome: number;
  /** Mean difference in (self survivors - enemy survivors), in actual troops. */
  readonly deltaRemainingTroops: number;
  /** Outcome difference plus a bounded .1 survivor tie-break. This is not confidence. */
  readonly pairedScore: number;
}
export interface ProbeDecision {
  readonly candidateKey: string;
  readonly retained: boolean;
  readonly lanes: readonly ProbeLane[];
  readonly reason: "globalProbeLane" | "protectedReference" | "eliminatedByTheoryBudget" | "eliminatedByFiveRunProbe";
  readonly samples: number;
}
export interface M1aProbeAudit {
  m1aCandidateCount: number;
  m1aBattlePerCandidate: number;
  m1aAdvancedCount: number;
  m1aRejectedByTheoryBudget: number;
  m1aRejectedByFiveRunProbe: number;
  m1aProtectedByTheory: number;
  m1aProtectedByUncertainty: number;
  m1aProtectedBySpecialMechanism: number;
  uniqueHeadsAtM1a: number;
  uniqueHeadsAfterM1a: number;
  uniqueBodiesAtM1a: number;
  uniqueBodiesAfterM1a: number;
  candidatesEliminatedWith5Samples: number;
  candidatesEliminatedByConfidenceWith5Samples: number;
  headsEliminatedByConfidenceWithLessThan20Samples: number;
  /** Confidence eliminations only; theory budget exits are reported separately. */
  highUncertaintyEliminatedWithLessThan40Samples: number;
  highUncertaintyBudgetEliminationsWithLessThan40Samples: number;
  retainedByProbeLane: Record<ProbeLane, number>;
  retainedByCombinedRanking: number;
  retainedByReference: number;
  pairedProbeEvidence: PairedProbeEvidence[];
}
export interface ProbeSelectionSettings {
  readonly keep: number;
  /** Identical ordered seed list for every candidate and the reference. */
  readonly seeds: readonly number[];
  readonly referenceCandidate: RallyCandidate;
  readonly outcomes: (candidate: RallyCandidate, seeds: readonly number[]) => readonly FastBattleResult[];
  readonly side?: SideId;
  readonly shares?: Partial<Record<ProbeLane, number>>;
  readonly uncertaintyThreshold?: number;
  /** Exact baseline and explicit references only; never generated Head quotas. */
  readonly protectedKeys?: ReadonlySet<string>;
}
export function emptyM1aProbeAudit(): M1aProbeAudit {
  return { m1aCandidateCount: 0, m1aBattlePerCandidate: 0, m1aAdvancedCount: 0,
    m1aRejectedByTheoryBudget: 0, m1aRejectedByFiveRunProbe: 0, m1aProtectedByTheory: 0,
    m1aProtectedByUncertainty: 0, m1aProtectedBySpecialMechanism: 0,
    uniqueHeadsAtM1a: 0, uniqueHeadsAfterM1a: 0, uniqueBodiesAtM1a: 0, uniqueBodiesAfterM1a: 0,
    candidatesEliminatedWith5Samples: 0, candidatesEliminatedByConfidenceWith5Samples: 0,
    headsEliminatedByConfidenceWithLessThan20Samples: 0, highUncertaintyEliminatedWithLessThan40Samples: 0,
    highUncertaintyBudgetEliminationsWithLessThan40Samples: 0,
    retainedByProbeLane: { theory: 0, matrix: 0, paired: 0, uncertainty: 0, special: 0, disagreement: 0 },
    retainedByCombinedRanking: 0, retainedByReference: 0, pairedProbeEvidence: [] };
}
export function candidateProbeUncertainty(candidate: RallyCandidate): number {
  return Math.max(candidate.theoryEstimate?.uncertainty ?? 0, candidate.criterionEstimate?.uncertainty ?? 0,
    candidate.theoryEstimate || candidate.criterionEstimate ? 0 : 1);
}
export function candidateHardToStaticize(candidate: RallyCandidate): boolean {
  return candidate.criterionEstimate?.flags.hardToStaticize ?? false;
}
export function minimumConfidenceSamples(candidate: RallyCandidate, threshold = .35, ordinary = 20, uncertain = 40): number {
  return candidateProbeUncertainty(candidate) >= threshold || candidateHardToStaticize(candidate)
    ? Math.max(40, uncertain) : Math.max(20, ordinary);
}
const specialCandidate = (candidate: RallyCandidate) => {
  const flags = candidate.criterionEstimate?.flags;
  return Boolean(flags && (flags.hardToStaticize || flags.targetRedirect || flags.roundSkillApproximation));
};
const finite = (value: number | undefined, fallback = 0) => value !== undefined && Number.isFinite(value) ? value : fallback;
const troopTotal = (row: FastBattleResult, side: SideId) => TROOP_TYPES.reduce((n, type) => n + row.remaining[side][type], 0);

/** Uses actual results from the same ordered seeds. Independent win rates never
 * substitute for paired observations, and five samples never imply significance. */
export function pairedProbeEvidence(candidate: RallyCandidate, reference: RallyCandidate,
  left: readonly FastBattleResult[], right: readonly FastBattleResult[], seeds: readonly number[], side: SideId = "A"): PairedProbeEvidence {
  if (!seeds.length || new Set(seeds).size !== seeds.length || left.length !== seeds.length || right.length !== seeds.length)
    throw new RangeError("Paired probe requires complete, unique, identical common-seed samples.");
  const enemy = side === "A" ? "B" : "A";
  const utility = (row: FastBattleResult) => row.outcome === side ? 1 : row.outcome === enemy ? 0 : .5;
  let pairedWins = 0, pairedLosses = 0, pairedDraws = 0, deltaOutcome = 0, deltaRemainingTroops = 0, normalizedRemaining = 0;
  for (let i = 0; i < seeds.length; i++) {
    const a = left[i]!, b = right[i]!;
    const outcome = utility(a) - utility(b);
    const survivors = troopTotal(a, side) - troopTotal(a, enemy) - troopTotal(b, side) + troopTotal(b, enemy);
    const direction = Math.sign(outcome || survivors);
    if (direction > 0) pairedWins++; else if (direction < 0) pairedLosses++; else pairedDraws++;
    deltaOutcome += outcome;
    deltaRemainingTroops += survivors;
    const denominator = troopTotal(a, side) + troopTotal(a, enemy) + troopTotal(b, side) + troopTotal(b, enemy);
    normalizedRemaining += denominator ? survivors / denominator : 0;
  }
  deltaOutcome /= seeds.length;
  deltaRemainingTroops /= seeds.length;
  return { candidateKey: candidateKey(candidate), referenceCandidateKey: candidateKey(reference), seeds: [...seeds],
    pairedWins, pairedLosses, pairedDraws, deltaOutcome, deltaRemainingTroops,
    pairedScore: deltaOutcome + .1 * normalizedRemaining / seeds.length };
}

/** Strong theory and independent global rescue lanes survive a poor five-run
 * observation. Unfilled or overlapping quotas are filled by a combined global
 * ranking, never by retaining one candidate for every Head. */
export function selectFiveRunProbe(rows: readonly CandidateEvaluation[], settings: ProbeSelectionSettings): {
  retained: CandidateEvaluation[]; audit: M1aProbeAudit; decisions: ProbeDecision[];
} {
  const shares = { ...DEFAULT_PROBE_LANE_SHARES, ...settings.shares }, lanes = Object.keys(shares) as ProbeLane[];
  if (!Number.isSafeInteger(settings.keep) || settings.keep < 1 || !settings.seeds.length ||
    new Set(settings.seeds).size !== settings.seeds.length || Object.values(shares).some((v) => !Number.isFinite(v) || v < 0) ||
    Math.abs(Object.values(shares).reduce((a, b) => a + b, 0) - 1) > 1e-9)
    throw new RangeError("Invalid global probe quotas or shared seeds.");
  const keys = rows.map((row) => candidateKey(row.candidate));
  if (new Set(keys).size !== keys.length || rows.some((row) => row.trials !== settings.seeds.length))
    throw new RangeError("Probe candidates require unique identities and the complete same sample budget.");
  const keep = Math.min(settings.keep, rows.length), uncertaintyThreshold = settings.uncertaintyThreshold ?? .35;
  const referenceResults = settings.outcomes(settings.referenceCandidate, settings.seeds);
  const evidence = new Map(rows.map((row) => {
    const paired = pairedProbeEvidence(row.candidate, settings.referenceCandidate,
      settings.outcomes(row.candidate, settings.seeds), referenceResults, settings.seeds, settings.side);
    return [paired.candidateKey, paired];
  }));
  const stableCompare = (score: (row: CandidateEvaluation) => number) => (a: CandidateEvaluation, b: CandidateEvaluation) =>
    score(b) - score(a) || candidateKey(a.candidate).localeCompare(candidateKey(b.candidate));
  const theory = (row: CandidateEvaluation) => finite(row.candidate.theoryEstimate?.theoryScore, finite(row.candidate.criterionEstimate?.margin));
  const matrix = (row: CandidateEvaluation) => finite(row.candidate.criterionEstimate?.margin, theory(row));
  const rankPercentile = (score: (row: CandidateEvaluation) => number) => {
    const sorted = [...rows].sort(stableCompare(score));
    return new Map(sorted.map((row, i) => [candidateKey(row.candidate), 1 - i / Math.max(1, sorted.length - 1)]));
  };
  const theoryRank = rankPercentile(theory), matrixRank = rankPercentile(matrix);
  const pairedRank = rankPercentile((row) => evidence.get(candidateKey(row.candidate))!.pairedScore);
  const disagreement = (row: CandidateEvaluation) => {
    const key = candidateKey(row.candidate), t = theoryRank.get(key)!, m = matrixRank.get(key)!, p = pairedRank.get(key)!;
    // Preserve potential theory misses as well as surprising good paired results.
    return Math.max(Math.abs(t - m), Math.abs(t - p), Math.abs(m - p));
  };
  const ranked: Record<ProbeLane, CandidateEvaluation[]> = {
    theory: [...rows].sort(stableCompare(theory)), matrix: [...rows].sort(stableCompare(matrix)),
    paired: [...rows].sort(stableCompare((row) => evidence.get(candidateKey(row.candidate))!.pairedScore)),
    uncertainty: rows.filter((row) => candidateProbeUncertainty(row.candidate) >= uncertaintyThreshold || candidateHardToStaticize(row.candidate))
      .sort(stableCompare((row) => candidateProbeUncertainty(row.candidate))),
    special: rows.filter((row) => specialCandidate(row.candidate)).sort(stableCompare(theory)),
    disagreement: [...rows].sort(stableCompare(disagreement)),
  };
  const selected = new Set<string>(), selectedLanes = new Map<string, ProbeLane[]>();
  const retain = (row: CandidateEvaluation, lane: ProbeLane) => {
    const key = candidateKey(row.candidate), origins = selectedLanes.get(key) ?? [];
    if (!origins.includes(lane)) origins.push(lane);
    selectedLanes.set(key, origins); selected.add(key);
  };
  for (const lane of lanes) for (const row of ranked[lane].slice(0, Math.floor(keep * shares[lane]))) retain(row, lane);
  const combined = (row: CandidateEvaluation) => {
    const key = candidateKey(row.candidate);
    return .5 * theoryRank.get(key)! + .25 * matrixRank.get(key)! + .20 * pairedRank.get(key)! + .05 * disagreement(row);
  };
  for (const row of [...rows].sort(stableCompare(combined))) {
    if (selected.size >= keep) break;
    if (!selected.has(candidateKey(row.candidate))) selected.add(candidateKey(row.candidate));
  }
  for (const row of rows) if (settings.protectedKeys?.has(candidateKey(row.candidate))) selected.add(candidateKey(row.candidate));
  const retained = rows.filter((row) => selected.has(candidateKey(row.candidate))).sort(stableCompare(combined));
  const decisions: ProbeDecision[] = rows.map((row): ProbeDecision => {
    const key = candidateKey(row.candidate), retained = selected.has(key);
    // A negative paired probe is additional budget evidence only where theory
    // could otherwise justify the global target. It is never a CI decision.
    const negativeProbe = evidence.get(key)!.pairedScore < 0 && theoryRank.get(key)! >= 1 - keep / Math.max(1, rows.length);
    return { candidateKey: key, retained, lanes: selectedLanes.get(key) ?? [], samples: row.trials,
      reason: settings.protectedKeys?.has(key) ? "protectedReference" : retained ? "globalProbeLane" : negativeProbe ? "eliminatedByFiveRunProbe" : "eliminatedByTheoryBudget" };
  }).sort((a, b) => a.candidateKey.localeCompare(b.candidateKey));
  const headCount = (list: readonly CandidateEvaluation[]) => new Set(list.map((row) => headLineupKey(row.candidate.leaderHeroIds))).size;
  const bodyCount = (list: readonly CandidateEvaluation[]) => new Set(list.map((row) => row.candidate.memberSkillIds.join("|"))).size;
  const laneCount = (lane: ProbeLane) => [...selectedLanes.values()].filter((origins) => origins.includes(lane)).length;
  const rejected = rows.filter((row) => !selected.has(candidateKey(row.candidate)));
  return { retained, decisions, audit: {
    m1aCandidateCount: rows.length, m1aBattlePerCandidate: settings.seeds.length, m1aAdvancedCount: retained.length,
    m1aRejectedByTheoryBudget: decisions.filter((row) => row.reason === "eliminatedByTheoryBudget").length,
    m1aRejectedByFiveRunProbe: decisions.filter((row) => row.reason === "eliminatedByFiveRunProbe").length,
    m1aProtectedByTheory: laneCount("theory"), m1aProtectedByUncertainty: laneCount("uncertainty"),
    m1aProtectedBySpecialMechanism: laneCount("special"), uniqueHeadsAtM1a: headCount(rows), uniqueHeadsAfterM1a: headCount(retained),
    uniqueBodiesAtM1a: bodyCount(rows), uniqueBodiesAfterM1a: bodyCount(retained),
    candidatesEliminatedWith5Samples: settings.seeds.length === 5 ? rejected.length : 0,
    candidatesEliminatedByConfidenceWith5Samples: 0, headsEliminatedByConfidenceWithLessThan20Samples: 0,
    highUncertaintyEliminatedWithLessThan40Samples: 0,
    highUncertaintyBudgetEliminationsWithLessThan40Samples: rejected.filter((row) => row.trials < 40 &&
      (candidateProbeUncertainty(row.candidate) >= uncertaintyThreshold || candidateHardToStaticize(row.candidate))).length,
    retainedByProbeLane: Object.fromEntries(lanes.map((lane) => [lane, laneCount(lane)])) as Record<ProbeLane, number>,
    retainedByCombinedRanking: retained.filter((row) => !selectedLanes.has(candidateKey(row.candidate))).length,
    retainedByReference: retained.filter((row) => settings.protectedKeys?.has(candidateKey(row.candidate))).length,
    pairedProbeEvidence: [...evidence.values()].sort((a, b) => a.candidateKey.localeCompare(b.candidateKey)),
  } };
}
