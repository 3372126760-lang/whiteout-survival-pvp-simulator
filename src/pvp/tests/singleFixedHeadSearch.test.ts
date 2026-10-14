import { describe, expect, it } from "vitest";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { TROOP_TYPES, type SideId } from "../types";
import type { FastBattleResult } from "../battle/fastBattleMode";
import { toEngineScenario, type ValidationBattleInput } from "../validationUi";
import { createSimpleOptimizationWorkflow, defaultSimpleScenarioOptimizationOptions,
  generateScenarioHeroFormations, applySimpleScenarioCandidate } from "../optimizer/scenarioOptimizer";
import { createEmptyHeadCandidate, currentHeadWeaponLevels, resolveSearchDimensions } from "../optimizer/searchDimensions";
import { emptyOptimizationPerformance, runOptimizationWorkflow,
  type EvaluationJob, type EvaluationJobResult } from "../optimizer/execution";
import { defaultTheoryOptions } from "../optimizer/theory";

function fixture(mode: "finalReport" | "prediction", side: SideId,
  withHero = false): ValidationBattleInput {
  const base = createDefaultValidationInput(), own = side === "A" ? base.sideA : base.sideB;
  return { ...base, scenarioType: "SINGLE", attributeInputMode: mode, maxRounds: 2,
    ownedHeroIds: [], optimizerHeroPool: { A: {}, B: {} },
    [side === "A" ? "sideA" : "sideB"]: { ...own,
      leaderHeroId: null, leaderHeroIds: withHero ? { shield: "hero.s1.nataliya", lancer: null, marksman: null }
        : createEmptyHeadCandidate().leaderHeroIds,
      simulationWeaponLevels: withHero ? { "hero.s1.nataliya": 6 } : {},
      troops: Object.fromEntries(TROOP_TYPES.map((troop, i) => [troop, { ...own.troops[troop],
        count: i === 0 ? 10_000 : 0, attack: 2612.8 + i, defense: 2200 + i,
        penetration: 1500 + i, life: 2000 + i }])) } };
}
const options = (side: SideId) => ({ ...defaultSimpleScenarioOptimizationOptions(51), side,
  theory: { ...defaultTheoryOptions(), deterministicRounds: 2 },
  basinSearch: { fineBasins: 1, fineRadius: 1 } });
function fakeExecute(jobs: EvaluationJob[], original: ValidationBattleInput, side: SideId) {
  return (job: EvaluationJob): EvaluationJobResult => {
    jobs.push(job);
    const own = side === "A" ? job.input.sideA : job.input.sideB;
    const originalOwn = side === "A" ? original.sideA : original.sideB;
    for (const troop of TROOP_TYPES) for (const stat of ["attack", "defense", "penetration", "life"] as const)
      expect(own.troops[troop][stat]).toBe(originalOwn.troops[troop][stat]);
    expect(job.side).toBe(side);
    const total = TROOP_TYPES.reduce((sum, troop) => sum + own.troops[troop].count, 0);
    const win = own.troops.shield.count / total === .5 && own.troops.lancer.count / total === .1;
    const outcome = win ? side : side === "A" ? "B" : "A";
    const remaining = { A: { shield: 0, lancer: 0, marksman: 0 }, B: { shield: 0, lancer: 0, marksman: 0 } };
    remaining[outcome].shield = 1;
    const result: FastBattleResult = { outcome, winner: outcome, failed: false, rounds: 1, roundCount: 1,
      remaining, aRemaining: remaining.A, bRemaining: remaining.B, winnerRemaining: remaining[outcome] };
    return { samples: { trials: job.seeds.length, requestedTrials: job.seeds.length,
      wins: win ? job.seeds.length : 0, losses: win ? 0 : job.seeds.length,
      failedTrials: 0, pruned: false, outcomes: job.seeds.map(() => result) },
      performance: { ...emptyOptimizationPerformance(), simulatedTrials: job.seeds.length } };
  };
}

describe("exhaustive fixed-head Single search", () => {
  it.each([ ["finalReport", "A"], ["finalReport", "B"], ["prediction", "A"], ["prediction", "B"] ] as const)(
  "evaluates all231 EMPTY_HEAD ratios and finds an alternative in %s side%s", (mode, side) => {
    const input = fixture(mode, side), before = JSON.stringify(input), jobs: EvaluationJob[] = [];
    expect(generateScenarioHeroFormations(input, side, false)).toEqual([createEmptyHeadCandidate().leaderHeroIds]);
    const result = runOptimizationWorkflow(createSimpleOptimizationWorkflow(input, options(side)), fakeExecute(jobs, input, side));
    expect(result).toMatchObject({ headMode: "EMPTY_HEAD", headSearchEnabled: false, headTemplateCount: 1,
      ratioCount: 231, theoreticalEvaluationCount: 231, searchDimensions: ["ratio"] });
    expect(result.criterionAudit).toMatchObject({ matrixEvaluations: 231, roundTheoryEvaluations: 231, legalHeads: 1 });
    expect(result.searchIntegrityReport!.perStage[0]).toMatchObject({ candidatesEntered: 231, requestedBattles: 4620 });
    const coarseJobs = jobs.slice(0, 231);
    expect(coarseJobs.every((job) => job.seeds.length === 20)).toBe(true);
    expect(new Set(coarseJobs.map((job) => {
      const own = side === "A" ? job.input.sideA : job.input.sideB;
      return TROOP_TYPES.map((troop) => own.troops[troop].count).join("/");
    })).size).toBe(231);
    const initial = jobs.filter((job) => job.seeds.length === 20);
    const visited = new Set(initial.map((job) => {
      const own = side === "A" ? job.input.sideA : job.input.sideB;
      return TROOP_TYPES.map((troop) => own.troops[troop].count).join("/");
    }));
    expect(visited.size).toBeGreaterThanOrEqual(231);
    expect(visited.has("5000/1000/4000")).toBe(true); // User's514 ratio enters the real search.
    expect(result.current.winRate).toBe(0);
    expect(result.topCandidates[0]!.candidate.ratios).toEqual({ shield: 50, lancer: 10, marksman: 40 });
    expect(result.topCandidates[0]!.winRate).toBe(1);
    expect(result.topCandidates.every((row) => row.trials === 1000)).toBe(true);
    expect(result.topCandidates.every((row) => row.candidate.headMode === "EMPTY_HEAD")).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
  }, 20_000);

  it("keeps a current old hero and actual Lv6 despite a disabled ownership pool and configured Lv10", () => {
    const original = fixture("finalReport", "A", true);
    const input = { ...original, optimizerHeroPool: { A: { "hero.s1.nataliya": { enabled: false, weaponLevel: 10 } }, B: {} } };
    const jobs: EvaluationJob[] = [];
    const result = runOptimizationWorkflow(createSimpleOptimizationWorkflow(input, options("A")), fakeExecute(jobs, input, "A"));
    expect(result).toMatchObject({ headMode: "FIXED_HEAD", headFixedReason: "finalReportAttributes",
      headSearchEnabled: false, searchDimensions: ["ratio"] });
    expect(jobs.every((job) => JSON.stringify(job.input.sideA.leaderHeroIds) === JSON.stringify(input.sideA.leaderHeroIds))).toBe(true);
    expect(jobs.every((job) => job.input.sideA.simulationWeaponLevels?.["hero.s1.nataliya"] === 6)).toBe(true);
    expect(result.topCandidates.every((row) => row.candidate.headWeaponLevels?.["hero.s1.nataliya"] === 6)).toBe(true);
    expect(result.topCandidates.every((row) => row.candidate.headMode === "FIXED_HEAD")).toBe(true);
    const applied = applySimpleScenarioCandidate(input, "A", { ...result.topCandidates[0]!.candidate,
      leaderHeroIds: { shield: "hero.s11.eleonora" }, headWeaponLevels: { "hero.s1.nataliya": 10 } });
    expect(applied.sideA.leaderHeroIds).toEqual(input.sideA.leaderHeroIds);
    expect(applied.sideA.simulationWeaponLevels).toEqual(input.sideA.simulationWeaponLevels);
    expect(applied.sideB).toEqual(input.sideB);
  }, 20_000);

  it("uses the formal current weapon Lv0 default rather than the optimizer Lv10 default", () => {
    const original = fixture("finalReport", "A", true);
    const input = { ...original, sideA: { ...original.sideA, simulationWeaponLevels: {} } };
    expect(currentHeadWeaponLevels(input)).toEqual({ "hero.s1.nataliya": 0 });
    expect(toEngineScenario(input).sideA.heroes?.[0]?.weaponLevel).toBe(0);
  });

  it("preserves333's fixed allocation with one legal empty head", () => {
    const input = { ...fixture("finalReport", "B"), scenarioType: "THREE_THREE_THREE" as const };
    const jobs: EvaluationJob[] = [];
    const result = runOptimizationWorkflow(createSimpleOptimizationWorkflow(input, { ...options("B"),
      coarseTrials: 2, verificationTrials: 3 }), fakeExecute(jobs, input, "B"));
    expect(result).toMatchObject({ headTemplateCount: 1, ratioCount: 1, theoreticalEvaluationCount: 1,
      searchDimensions: [], ratioSearchEnabled: false });
    expect(result.criterionAudit!.matrixEvaluations).toBe(1);
    expect(jobs.every((job) => JSON.stringify(job.input.sideB.troops) === JSON.stringify(input.sideB.troops))).toBe(true);
  });

  it("keeps an existing prediction head when no new heroes are enabled", () => {
    const input = fixture("prediction", "A", true);
    expect(resolveSearchDimensions(input)).toMatchObject({ headMode: "FIXED_HEAD",
      headFixedReason: "noEnabledHeroPool", searchDimensions: ["ratio"] });
    expect(generateScenarioHeroFormations(input, "A", false)).toEqual([input.sideA.leaderHeroIds]);
  });

  it("bypasses the hero pool entirely for final-report dimensions", () => {
    const original = fixture("finalReport", "A", true);
    const input = { ...original, get optimizerHeroPool(): never { throw new Error("pool should not be read"); } };
    expect(resolveSearchDimensions(input)).toMatchObject({ attributeInputMode: "FINAL_REPORT", headSearchEnabled: false });
    expect(generateScenarioHeroFormations(input, "A", false)).toHaveLength(1);
  });
});
