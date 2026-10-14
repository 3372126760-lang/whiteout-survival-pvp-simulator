import { describe, expect, it } from "vitest";
import type { FastBattleResult } from "../battle/fastBattleMode";
import { DEFAULT_ADAPTIVE_SEARCH, emptySearchIntegrityReport, raceCandidates } from "../optimizer/adaptiveSampling";
import { candidateKey } from "../optimizer/candidateGenerator";
import { minimumConfidenceSamples, pairedProbeEvidence, selectFiveRunProbe } from "../optimizer/criterion/probeRacing";
import type { CriterionBattleResult } from "../optimizer/criterion/types";
import { evaluateSingleCandidate } from "../optimizer/singleWaveSearch";
import { defaultOptimizationConfig } from "../optimizer";
import { resolveCriterionSearchOptions } from "../optimizer/criterion/searchTypes";
import type { RallyCandidate } from "../optimizer/types";

const seeds = [101, 202, 303, 404, 505];
const battle = (win: boolean, survivors = 10): FastBattleResult => {
  const a = { shield: win ? survivors : 0, lancer: 0, marksman: 0 };
  const b = { shield: win ? 0 : survivors, lancer: 0, marksman: 0 };
  return { outcome: win ? "A" : "B", winner: win ? "A" : "B", failed: false, rounds: 1, roundCount: 1,
    remaining: { A: a, B: b }, aRemaining: a, bRemaining: b, winnerRemaining: win ? a : b };
};
const candidate = (i: number, uncertainty = 0, special = false): RallyCandidate => {
  const criterion: CriterionBattleResult = { predictedWinner: "A", margin: 1500 - i,
    estimatedBattleTime: 1, aRemaining: { shield: 1, lancer: 1, marksman: 1 }, bRemaining: { shield: 0, lancer: 0, marksman: 0 },
    lifetimeOutputPotentialA: 1, lifetimeOutputPotentialB: 1, frontlineProtectionValue: [1, 1], rearExposureLoss: [0, 0],
    crossTargetDamageShare: 0, uncertainty, eventCount: 1, omittedMechanisms: [],
    flags: { probabilityApproximation: false, roundSkillApproximation: false, targetRedirect: special, hardToStaticize: false } };
  return { leaderHeroIds: { shield: `head-${String(i).padStart(4, "0")}` }, memberSkillIds: [`body-${i % 20}`],
    ratios: { shield: 34, lancer: 33, marksman: 33 }, criterionEstimate: criterion,
    theoryEstimate: { theoryScore: 1500 - i, staticTheoryScore: 0, deterministicScore: 0, uncertainty,
      metrics: { initialDps: [1, 1], ehp: [1, 1], firstTargetTtk: [1, 1], shieldSurvivalRounds: [1, 1], marksmanOutputWindow: [1, 1] } } };
};
const evaluate = (c: RallyCandidate, samples: readonly FastBattleResult[]) => evaluateSingleCandidate(c, 1000, seeds,
  () => samples.map((r) => ({ outcome: r.outcome, self: r.remaining.A, enemy: r.remaining.B, rounds: r.roundCount })));

describe("five-run global paired probe", () => {
  it("keeps about 300 of 1500 without treating a 1/5 theory leader as confidence-dominated", () => {
    const candidates = Array.from({ length: 1500 }, (_, i) => candidate(i, i === 1498 ? 1 : 0, i === 1499));
    const reference = candidate(2000), referenceOutcomes = seeds.map(() => battle(true));
    const outcomes = new Map(candidates.map((c, i) => [candidateKey(c), seeds.map((_, j) => battle(j < (i === 0 ? 1 : 3)))]));
    outcomes.set(candidateKey(reference), referenceOutcomes);
    const rows = candidates.map((c) => evaluate(c, outcomes.get(candidateKey(c))!));
    const settings = { keep: 300, seeds, referenceCandidate: reference,
      outcomes: (c: RallyCandidate) => outcomes.get(candidateKey(c))! };
    const first = selectFiveRunProbe(rows, settings);
    expect(first.retained).toHaveLength(300);
    expect(first.retained.some((row) => candidateKey(row.candidate) === candidateKey(candidates[0]!))).toBe(true);
    expect(first.retained.some((row) => candidateKey(row.candidate) === candidateKey(candidates[1498]!))).toBe(true);
    expect(first.retained.some((row) => candidateKey(row.candidate) === candidateKey(candidates[1499]!))).toBe(true);
    expect(first.audit).toMatchObject({ m1aCandidateCount: 1500, m1aBattlePerCandidate: 5, m1aAdvancedCount: 300,
      candidatesEliminatedWith5Samples: 1200, candidatesEliminatedByConfidenceWith5Samples: 0,
      headsEliminatedByConfidenceWithLessThan20Samples: 0, highUncertaintyEliminatedWithLessThan40Samples: 0,
      uniqueHeadsAtM1a: 1500, uniqueHeadsAfterM1a: 300 });
    expect(first.audit.m1aRejectedByTheoryBudget + first.audit.m1aRejectedByFiveRunProbe).toBe(1200);
    expect(first.audit.m1aProtectedByTheory).toBe(120);
    expect(selectFiveRunProbe([...rows].reverse(), settings)).toEqual(first);
  });
  it("uses common-seed comparisons including troop differences and records an explicit reference", () => {
    const a = candidate(1), b = candidate(2);
    const left = [true, false, true, false, true].map((win) => battle(win));
    const right = [false, true, false, false, true].map((win) => battle(win));
    const evidence = pairedProbeEvidence(a, b, left, right, seeds);
    expect(evidence).toMatchObject({ candidateKey: candidateKey(a), referenceCandidateKey: candidateKey(b),
      seeds, pairedWins: 2, pairedLosses: 1, pairedDraws: 2, deltaRemainingTroops: 4 });
    expect(evidence.deltaOutcome).toBeCloseTo(.2);
    expect(evidence.pairedScore).toBeCloseTo(.22);
    expect(pairedProbeEvidence(a, b, left, right, seeds)).toEqual(evidence);
    expect(() => pairedProbeEvidence(a, b, left.slice(1), right, seeds)).toThrow(/common-seed/);
    expect(() => pairedProbeEvidence(a, b, left, right, [1, 1, 2, 3, 4])).toThrow(/common-seed/);
  });
  it("can remove a whole weak head by global theory budget without any per-head floor", () => {
    const strong = [candidate(1), candidate(2)], weak = candidate(1499);
    const outcomes = seeds.map(() => battle(true));
    const result = selectFiveRunProbe([...strong, weak].map((c) => evaluate(c, outcomes)), {
      keep: 2, seeds, referenceCandidate: strong[0]!, outcomes: () => outcomes,
      shares: { theory: 1, matrix: 0, paired: 0, uncertainty: 0, special: 0, disagreement: 0 },
    });
    expect(result.retained.map((row) => candidateKey(row.candidate))).not.toContain(candidateKey(weak));
    expect(result.decisions.find((row) => row.candidateKey === candidateKey(weak))!.reason).toBe("eliminatedByTheoryBudget");
  });
  it("adds only explicit baseline/reference exceptions after the global quota and audits actual counts", () => {
    const all = [candidate(1), candidate(2), candidate(1499)], outcomes = seeds.map(() => battle(true));
    const ref = candidateKey(all[2]!);
    const result = selectFiveRunProbe(all.map((c) => evaluate(c, outcomes)), { keep: 1, seeds,
      referenceCandidate: all[0]!, outcomes: () => outcomes, protectedKeys: new Set([ref]),
      shares: { theory: 1, matrix: 0, paired: 0, uncertainty: 0, special: 0, disagreement: 0 } });
    expect(result.retained).toHaveLength(2);
    expect(result.audit).toMatchObject({ m1aAdvancedCount: 2, m1aRejectedByTheoryBudget: 1, retainedByReference: 1 });
    expect(result.decisions.find((row) => row.candidateKey === ref)!.reason).toBe("protectedReference");
  });
});

describe("version 3 global racing defaults", () => {
  it("uses explicit cumulative 5/20/50/100/300 budgets and five final candidates", () => {
    const config = defaultOptimizationConfig();
    expect(config.criterion).toMatchObject({ racingVersion: 3, screeningTrials: [5, 20, 50, 100, 300],
      screeningKeep: [300, 80, 25, 10, 5], minimumHeadRuns: 20, uncertainHeadRuns: 40 });
    expect(config.verificationTop).toBe(5);
    expect(config.verificationTrials).toBe(1000);
  });
  it("preserves explicit custom cumulative budgets and ignores the removed saved per-head field", () => {
    const options = resolveCriterionSearchOptions({ screeningTrials: [5, 25, 70], screeningKeep: [250, 60, 8] });
    expect(options.screeningTrials).toEqual([5, 25, 70]);
    expect(options.screeningKeep).toEqual([250, 60, 8]);
    const saved = { ...options, formalCandidatesPerHead: 1 };
    expect(resolveCriterionSearchOptions(saved)).not.toHaveProperty("formalCandidatesPerHead");
    expect(() => resolveCriterionSearchOptions({ probeLaneShares: { theory: 1, matrix: 1,
      paired: 0, uncertainty: 0, special: 0, disagreement: 0 } })).toThrow(/sum to one/);
  });
});

describe("candidate confidence exposure instead of Head survival quotas", () => {
  const options = { ...DEFAULT_ADAPTIVE_SEARCH, minimumRunsBeforeElimination: 20, highUncertaintyMinimumRuns: 40 };
  interface Row { id: string; trials: number; wins: number; winRate: number; uncertainty: number; hard: boolean; }
  const race = (n: number, uncertainty = 0, hard = false) => {
    const rows: Row[] = [{ id: "best", trials: n, wins: n, winRate: 1, uncertainty: 0, hard: false },
      { id: "bad", trials: n, wins: 0, winRate: 0, uncertainty, hard }];
    const audit = emptySearchIntegrityReport(0);
    return { kept: raceCandidates(rows, { candidate: (row) => row, key: (row) => row.id,
      uncertainty: (row) => row.uncertainty, hardToStaticize: (row) => row.hard,
      compare: (a, b) => b.winRate - a.winRate, protected: () => false, topK: 1, stage: "test", looks: 1,
      comparisons: 2, maxRuns: n, options }, audit), audit };
  };
  it("never clamps the minimum exposure down to a 5-run stage budget", () => {
    const result = race(5);
    expect(result.kept).toHaveLength(2);
    expect(result.audit.racing.eliminatedByConfidence).toBe(0);
    expect(race(20).kept).toHaveLength(1);
  });
  it("cannot confidence-eliminate high uncertainty at 30 samples, even when maxRuns is 30", () => {
    const result = race(30, 1);
    expect(result.kept).toHaveLength(2);
    expect(result.audit.racing.eliminatedByConfidence).toBe(0);
    expect(race(40, 1).kept).toHaveLength(1);
  });
  it("also requires 40 samples for hard-to-staticize candidates with low numeric uncertainty", () => {
    expect(race(30, 0, true).kept).toHaveLength(2);
    const hard = candidate(1);
    expect(minimumConfidenceSamples(hard)).toBe(20);
    expect(minimumConfidenceSamples(candidate(1, 1))).toBe(40);
    expect(minimumConfidenceSamples({ ...hard, criterionEstimate: { ...hard.criterionEstimate!,
      flags: { ...hard.criterionEstimate!.flags, hardToStaticize: true } } })).toBe(40);
  });
});
