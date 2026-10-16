import { describe, expect, it } from "vitest";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { BattleSampleLedger, adaptiveSeedPools, normalizedBattleConfigKey, emptySearchIntegrityReport,
  raceCandidates, DEFAULT_ADAPTIVE_SEARCH, resolveAdaptiveSearchOptions, boundedCheckpoints,
  pairedBattleImprovement, racingZ, type AdaptiveStageAudit } from "../optimizer/adaptiveSampling";
import { runOptimizationWorkflow, emptyOptimizationPerformance, createEvaluationExecutor,
  type EvaluationJob, type EvaluationJobResult, type OptimizationWorkflow } from "../optimizer/execution";
import type { FastBattleResult } from "../battle/fastBattleMode";
import { searchAdaptiveRatioBasins } from "../optimizer/adaptiveBasinSearch";
import { emptyRatioSearchAudit, DEFAULT_BASIN_SEARCH } from "../optimizer/basinSearch";
import { candidateKey, defaultOptimizationConfig, searchSingleWave } from "../optimizer";
import { rallyHeadSearchFixture, OPPONENT_HEAD, opponentCandidate } from "./fixtures/rallyHeadSearch";
import type { RallyTroopRatios } from "../validationUi";

const result = (win = true, self = 10): FastBattleResult => {
  const a = { shield: win ? self : 0, lancer: 0, marksman: 0 };
  const b = { shield: win ? 0 : 10, lancer: 0, marksman: 0 };
  return { outcome: win ? "A" : "B", winner: win ? "A" : "B", failed: false, rounds: 1, roundCount: 1,
    remaining: { A: a, B: b }, aRemaining: a, bRemaining: b, winnerRemaining: win ? a : b };
};
const audit = (stage = "test"): AdaptiveStageAudit => ({ stage, candidatesEntered: 1, candidatesEliminated: 0,
  candidatesAdvanced: 1, requestedBattles: 0, executedBattles: 0, reusedBattles: 0, cacheHitRate: 0, elapsedMs: 0 });
function fakeExecutor(calls: Map<string, number>) {
  return (job: EvaluationJob): EvaluationJobResult => {
    const key = normalizedBattleConfigKey(job.input);
    const outcomes = job.seeds.map((seed) => { const id = `${key}:${seed}`; calls.set(id, (calls.get(id) ?? 0) + 1); return result(); });
    return { samples: { trials: outcomes.length, requestedTrials: outcomes.length, wins: outcomes.length,
      losses: 0, failedTrials: 0, pruned: false, outcomes },
      performance: { ...emptyOptimizationPerformance(), simulatedTrials: outcomes.length } };
  };
}
describe("complete config/seed cumulative ledger", () => {
  it("executes 5 + 25 + 20 + 100 + 850, never replays a previous seed", () => {
    const base = createDefaultValidationInput(), pools = adaptiveSeedPools(91, 150, 1000);
    const ledger = new BattleSampleLedger((c: string) => c, () => base, "A");
    const calls = new Map<string, number>(), stages: AdaptiveStageAudit[] = [];
    function* flow(): OptimizationWorkflow<void> {
      for (const n of [5, 30, 50, 150, 1000]) {
        const row = audit(`runs-${n}`); stages.push(row);
        yield* ledger.sample(["one"], (n === 1000 ? pools.final : pools.screening).slice(0, n), row);
      }
    }
    runOptimizationWorkflow(flow(), fakeExecutor(calls));
    expect(stages.map((row) => row.executedBattles)).toEqual([5, 25, 20, 100, 850]);
    expect(calls.size).toBe(1000); expect([...calls.values()].every((n) => n === 1)).toBe(true);
    expect(ledger.outcomes("one", pools.final)).toHaveLength(1000);
  });
  it("reuses identical configurations across aliases in the same batch and later stages", () => {
    const base = createDefaultValidationInput(), ledger = new BattleSampleLedger((c: string) => c, () => base, "A");
    const calls = new Map<string, number>(), first = audit(), second = audit();
    function* flow(): OptimizationWorkflow<void> {
      yield* ledger.sample(["5%-candidate", "1%-alias"], [1, 2, 3], first);
      yield* ledger.sample(["returning-candidate"], [1, 2, 3], second);
    }
    runOptimizationWorkflow(flow(), fakeExecutor(calls));
    expect(first).toMatchObject({ requestedBattles: 6, executedBattles: 3, reusedBattles: 3, cacheHitRate: .5 });
    expect(second).toMatchObject({ executedBattles: 0, reusedBattles: 3, cacheHitRate: 1 });
    expect(calls.size).toBe(3);
  });
  it("normalizes object ordering while covering every result-relevant configuration family", () => {
    const base = createDefaultValidationInput(), key = normalizedBattleConfigKey(base);
    expect(normalizedBattleConfigKey({ ...base, randomSeed: 2, simulationMode: "random" })).toBe(key);
    expect(normalizedBattleConfigKey(Object.fromEntries(Object.entries(base).reverse()) as typeof base)).toBe(key);
    const variants = [
      { ...base, sideA: { ...base.sideA, leaderHeroIds: OPPONENT_HEAD } },
      { ...base, sideB: { ...base.sideB, leaderHeroIds: OPPONENT_HEAD } },
      { ...base, sideA: { ...base.sideA, simulationWeaponLevels: { "hero.s11.rufus": 10 } } },
      { ...base, sideA: { ...base.sideA, selectedMemberSkillIds: ["hero-skill.shuyun.attack"] } },
      { ...base, sideA: { ...base.sideA, troops: { ...base.sideA.troops, lancer: { ...base.sideA.troops.lancer,
        count: base.sideA.troops.lancer.count + 1 } } } },
      { ...base, sideA: { ...base.sideA, troops: { ...base.sideA.troops, shield: { ...base.sideA.troops.shield, troopLevel: "T12-FC7" } } } },
      { ...base, sideA: { ...base.sideA, troops: { ...base.sideA.troops, shield: { ...base.sideA.troops.shield, t12Level: 5 } } } },
      { ...base, sideA: { ...base.sideA, troops: { ...base.sideA.troops, marksman: { ...base.sideA.troops.marksman,
        attack: base.sideA.troops.marksman.attack + 1 } } } },
      { ...base, maxRounds: base.maxRounds + 1 }, { ...base, battleContext: "rally" as const },
      { ...base, serverStage: "s10_t12" as const }, { ...base, disabledSkillIds: ["lancer-ambush"] },
      { ...base, attributeInputMode: "prediction" as const },
      { ...base, sideA: { ...base.sideA, reportAttributeBasis: "historicalReport" as const } },
      { ...base, sideA: { ...base.sideA, bodySkills: [{ heroId: "hero.sr.shuyun", runtimeInstanceId: "A-body-1",
        skillId: "hero-skill.shuyun.attack", expeditionSkillSlot: 1 as const, skillLevel: 4 }] } },
      { ...base, sideA: { ...base.sideA, externalBuffs: { ...base.sideA.externalBuffs!,
        town: { ...base.sideA.externalBuffs!.town, attack: "large" as const } } } },
    ];
    expect(variants.every((input) => normalizedBattleConfigKey(input) !== key)).toBe(true);
    const future = { ...base, futureResultRelevantConfig: { office: 5, t12Skill: 10, afterBattle: "custom" } };
    expect(normalizedBattleConfigKey(future)).not.toBe(key);
  });
  it("does not reuse same-seed results for different heroes, weapons, counts or body definitions", () => {
    const base = createDefaultValidationInput();
    const inputs = [base, { ...base, sideA: { ...base.sideA, leaderHeroIds: OPPONENT_HEAD } },
      { ...base, sideA: { ...base.sideA, simulationWeaponLevels: { "hero.s11.rufus": 10 } } },
      { ...base, sideA: { ...base.sideA, troops: { ...base.sideA.troops, shield: { ...base.sideA.troops.shield, count: 999 } } } },
      { ...base, sideA: { ...base.sideA, bodySkills: [{ heroId: "hero.s3.miya", runtimeInstanceId: "A-body-1",
        skillId: "hero-skill.mia.doom-entanglement", expeditionSkillSlot: 1 as const, skillLevel: 5 }] } }];
    const ledger = new BattleSampleLedger((index: number) => String(index), (index) => inputs[index]!, "A");
    const row = audit(), calls = new Map<string, number>();
    function* flow(): OptimizationWorkflow<void> { yield* ledger.sample([0, 1, 2, 3, 4], [91], row); }
    runOptimizationWorkflow(flow(), fakeExecutor(calls));
    expect(calls.size).toBe(5); expect(row.executedBattles).toBe(5); expect(row.reusedBattles).toBe(0);
  });
  it("keeps independent final draws disjoint, with the cumulative screening prefix retained", () => {
    const first = adaptiveSeedPools(91, 150, 1000);
    expect(first).toEqual(adaptiveSeedPools(91, 150, 1000));
    expect(first.final.slice(0, 150)).toEqual(first.screening);
    expect(first.independent.every((seed) => !first.screeningSet.has(seed))).toBe(true);
    expect(new Set(first.final).size).toBe(1000);
  });
  it("does not change a real single battle when reusing its sample", () => {
    const input = { ...rallyHeadSearchFixture(), maxRounds: 3 }, seeds = [91, 92];
    const fresh = createEvaluationExecutor()({ kind: "battle", input, seeds, side: "A", collectOutcomes: true });
    const ledger = new BattleSampleLedger((c: string) => c, () => input, "A");
    function* flow(): OptimizationWorkflow<void> { yield* ledger.sample(["one"], seeds, audit()); yield* ledger.sample(["alias"], seeds, audit()); }
    runOptimizationWorkflow(flow());
    expect(ledger.outcomes("one", seeds)).toEqual(fresh.samples.outcomes);
    expect(ledger.outcomes("alias", seeds)).toEqual(fresh.samples.outcomes);
  });
});
describe("conservative staged racing", () => {
  interface Row { id: string; trials: number; wins: number; winRate: number; uncertainty: number; }
  const rows = (n: number): Row[] => [{ id: "best", trials: n, wins: n, winRate: 1, uncertainty: 0 },
    { id: "bad", trials: n, wins: 0, winRate: 0, uncertainty: 0 }];
  const settings = (topK = 1) => ({ candidate: (row: Row) => row, key: (row: Row) => row.id,
    uncertainty: (row: Row) => row.uncertainty, compare: (a: Row, b: Row) => b.winRate - a.winRate,
    protected: () => false, topK, stage: "M4", looks: 3, comparisons: 2, maxRuns: 150, options: DEFAULT_ADAPTIVE_SEARCH });
  it("eliminates only statistically separated rows and records bounds/reasons reproducibly", () => {
    const run = () => { const report = emptySearchIntegrityReport(150); return { kept: raceCandidates(rows(50), settings(), report), report }; };
    const first = run(); expect(run()).toEqual(first); expect(first.kept.map((row) => row.id)).toEqual(["best"]);
    expect(first.report.racing.decisions.find((row) => row.candidateKey === "bad")!.eliminationReason).toBe("confidenceDominated");
  });
  it("protects high uncertainty below 100 samples even when its early point estimate is poor", () => {
    const report = emptySearchIntegrityReport(150), candidates = rows(50).map((row) => ({ ...row, uncertainty: 1 }));
    expect(raceCandidates(candidates, settings(), report)).toHaveLength(2);
    expect(report.racing.protectedByUncertainty).toBe(1);
    expect(raceCandidates(rows(100).map((row) => ({ ...row, uncertainty: 1 })), settings(), report)).toHaveLength(1);
  });
  it("protects Top-K and explicit baseline/manual references", () => {
    expect(raceCandidates(rows(50), settings(2), emptySearchIntegrityReport(150))).toHaveLength(2);
    expect(raceCandidates(rows(50), { ...settings(), protected: (row) => row.id === "bad" }, emptySearchIntegrityReport(150))).toHaveLength(2);
  });
  it("does not force an obvious Final loser to 1000, but overlapping leaders reach every checkpoint", () => {
    const options = { ...settings(), stage: "Final", maxRuns: 1000 };
    expect(raceCandidates(rows(300), options, emptySearchIntegrityReport(150))).toHaveLength(1);
    let candidates = [{ ...rows(300)[0]!, wins: 240, winRate: .8 }, { ...rows(300)[1]!, wins: 239, winRate: 239 / 300 }];
    for (const n of [300, 500, 1000]) {
      candidates = candidates.map((row, i) => ({ ...row, trials: n, wins: Math.round(n * .8) - i, winRate: (Math.round(n * .8) - i) / n }));
      candidates = raceCandidates(candidates, options, emptySearchIntegrityReport(150)); expect(candidates).toHaveLength(2);
    }
    expect(candidates.every((row) => row.trials === 1000)).toBe(true);
  });
  it("bounds custom budgets and rejects invalid racing configuration", () => {
    expect(boundedCheckpoints([50, 100, 150], 120)).toEqual([50, 100, 120]);
    expect(() => resolveAdaptiveSearchOptions({ finalCheckpoints: [500, 300] })).toThrow();
    expect(() => resolveAdaptiveSearchOptions({ highUncertaintyMinimumRuns: 0 })).toThrow();
  });
  it("uses paired outcome evidence, rather than equal-rate noise, for local improvements", () => {
    expect(pairedBattleImprovement(Array.from({ length: 100 }, () => result(true)),
      Array.from({ length: 100 }, () => result(false)), "A", racingZ(24, 1, .01))).toBe(true);
    expect(pairedBattleImprovement([result(true), result(false)], [result(false), result(true)], "A", 3)).toBe(false);
    expect(pairedBattleImprovement([result(true, 11)], [result(true, 10)], "A", 3)).toBe(true);
  });
});
describe("bounded independent adaptive basins", () => {
  it("enters 2% for multiple basins, opens 1% only for the improving basin, and stops a flat basin", () => {
    interface Candidate { head: string; ratios: RallyTroopRatios; }
    interface Evaluation { candidate: Candidate; score: number; }
    const candidates = ["gradient", "flat"].map((head) => ({ head, ratios: { shield: 20, lancer: 20, marksman: 60 } }));
    const evaluate = (candidate: Candidate): Evaluation => ({ candidate, score: candidate.head === "flat" ? 0 :
      -Math.abs(candidate.ratios.shield - 28) - Math.abs(candidate.ratios.lancer - 20) });
    const run = () => {
      const audit = emptyRatioSearchAudit(), integrity = emptySearchIntegrityReport(150), visits: string[] = [];
      const workflow = searchAdaptiveRatioBasins(candidates.map(evaluate), {
        candidate: (row) => row.candidate, ratios: (candidate) => candidate.ratios, head: (candidate) => candidate.head,
        key: (candidate) => `${candidate.head}:${Object.values(candidate.ratios).join("/")}`,
        child: (candidate, ratios) => ({ ...candidate, ratios }), compare: (a, b) => b.score - a.score,
        confidenceImproves: (a, b) => a.score > b.score,
        evaluate: function* (pool, step) { visits.push(`${step}:${pool.map((row) => row.head).join(",")}`); yield []; return pool.map(evaluate); },
      }, { ...DEFAULT_BASIN_SEARCH, maxClimbRounds: 1 }, DEFAULT_ADAPTIVE_SEARCH, audit, integrity);
      let step = workflow.next(); while (!step.done) step = workflow.next([]);
      return { audit, integrity, visits };
    };
    const first = run(); expect(run()).toEqual(first);
    expect(first.integrity.fineSearch.basin2PercentEntered).toBe(2);
    expect(first.integrity.fineSearch.basin1PercentEntered).toBe(1);
    expect(first.visits.filter((row) => row.startsWith("1:")).every((row) => !row.includes("flat"))).toBe(true);
    expect(first.audit.basins.find((row) => row.head === "flat")!.stopReason).toBe("flat2Percent");
    expect(first.audit.basins.every((row) => row.expansionRounds! <= 7)).toBe(true);
  });
});
describe("joint rally seed reuse", () => {
  it("retains known strong references, ranks formal wins, and never executes a candidate seed twice", () => {
    const calls = new Map<string, number>(), config = { ...defaultOptimizationConfig(91),
      constraints: { fixedBodyExact: true, fixedMemberSkillIds: [] }, protectedCandidates: [opponentCandidate()],
      monteCarloStages: [{ trials: 2, keep: 12 }, { trials: 3, keep: 12 }, { trials: 4, keep: 5 }, { trials: 5, keep: 3 }],
      basinSearch: { maxBasins: 2, maxClimbRounds: 1 }, verificationTrials: 12, verificationTop: 3, topN: 2 };
    const run = () => searchSingleWave(rallyHeadSearchFixture(), config, undefined, (candidate, seeds) => seeds.map((seed) => {
      const id = `${candidateKey(candidate)}:${seed}`; calls.set(id, (calls.get(id) ?? 0) + 1);
      const won = candidateKey(candidate) === candidateKey(opponentCandidate());
      return { outcome: won ? "A" : "B", self: { shield: won ? 100 : 0, lancer: 0, marksman: 0 },
        enemy: { shield: won ? 0 : 100, lancer: 0, marksman: 0 }, rounds: 1 };
    }));
    const first = run(); expect([...calls.values()].every((n) => n === 1)).toBe(true);
    calls.clear(); expect(run().top).toEqual(first.top);
    expect(candidateKey(first.top[0]!.candidate)).toBe(candidateKey(opponentCandidate()));
    expect(first.top[0]!.trials).toBe(1000); expect(first.top[0]!.winRate).toBe(1);
    const stages = first.searchDiagnostics.searchIntegrityReport!.perStage;
    expect(stages.every((row) => row.requestedBattles === row.executedBattles + row.reusedBattles)).toBe(true);
  }, 20_000);
});
