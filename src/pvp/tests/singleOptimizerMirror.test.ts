import { describe, expect, it } from "vitest";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { CONFIRMED_HERO_SKILL_DEFINITIONS } from "../heroSkills";
import { CONFIRMED_TROOP_SKILL_DEFINITIONS } from "../troopSkills";
import { TROOP_TYPES } from "../types";
import { createSimpleOptimizationWorkflow, defaultSimpleScenarioOptimizationOptions,
  type SimpleScenarioOptimizationResult } from "../optimizer/scenarioOptimizer";
import { createEvaluationExecutor, runOptimizationWorkflow } from "../optimizer/execution";
import { defaultTheoryOptions } from "../optimizer/theory";
import type { ValidationBattleInput } from "../validationUi";

const candidateHeads = ["hero.s10.gregory", "hero.s11.eleonora", "hero.s11.lloyd", "hero.s11.rufus"];
const fixedHead = { shield: "hero.s1.nataliya", lancer: "hero.s1.moli", marksman: "hero.s1.jinman" };
function fixture(): ValidationBattleInput {
  const base = createDefaultValidationInput();
  const configure = (side: ValidationBattleInput["sideA"], counts: readonly number[], stat: number) => ({ ...side,
    selectedMemberSkillIds: [], bodySkills: [], reportHeroByTroop: {}, reportHeroIds: [],
    troops: Object.fromEntries(TROOP_TYPES.map((troop, index) => [troop, { ...side.troops[troop], count: counts[index]!,
      attack: stat, defense: stat, penetration: stat, life: stat, troopLevel: "T10" as const }])) as ValidationBattleInput["sideA"]["troops"] });
  return { ...base, scenarioType: "SINGLE", attributeInputMode: "prediction", serverStage: "s11", battleContext: "challenge", maxRounds: 400,
    ownedHeroIds: [...candidateHeads, ...Object.values(fixedHead)],
    optimizerHeroPool: { A: Object.fromEntries(candidateHeads.map((id) => [id, { enabled: true, weaponLevel: 0 }])),
      B: Object.fromEntries(Object.values(fixedHead).map((id) => [id, { enabled: true, weaponLevel: 0 }])) },
    disabledSkillIds: [...CONFIRMED_HERO_SKILL_DEFINITIONS, ...CONFIRMED_TROOP_SKILL_DEFINITIONS].map((skill) => skill.id),
    sideA: { ...configure(base.sideA, [3600, 1200, 1200], 200),
      leaderHeroIds: { shield: candidateHeads[0]!, lancer: candidateHeads[2]!, marksman: candidateHeads[3]! } },
    sideB: { ...configure(base.sideB, [1200, 1200, 3600], 230), leaderHeroIds: fixedHead } };
}
function mirror(input: ValidationBattleInput): ValidationBattleInput {
  return { ...input, sideA: input.sideB, sideB: input.sideA,
    optimizerHeroPool: { A: input.optimizerHeroPool!.B!, B: input.optimizerHeroPool!.A! } };
}
const candidateKey = (row: SimpleScenarioOptimizationResult["topCandidates"][number]) =>
  JSON.stringify([row.candidate.leaderHeroIds, row.candidate.ratios, row.candidate.headWeaponLevels, row.isCurrent ?? false]);

describe("single optimizer candidate-side mirror semantics", () => {
  it("uses matching candidates, theory direction, candidate-facing Criterion scores and official wins after swapping A/B", () => {
    const original = fixture(), swapped = mirror(original), before = JSON.stringify(original);
    const options = { ...defaultSimpleScenarioOptimizationOptions(445), coarseTrials: 3, middleTrials: 3,
      verificationTrials: 5, topN: 10, fixedRatio: true, theory: { ...defaultTheoryOptions(), deterministicRounds: 4 },
      monteCarloStages: [{ trials: 3, keep: 10 }] };
    const executeA = createEvaluationExecutor(), executeB = createEvaluationExecutor();
    const testedSidesA = new Set<string>(), testedSidesB = new Set<string>();
    const first = runOptimizationWorkflow(createSimpleOptimizationWorkflow(original, { ...options, side: "A" }), (job) => {
      testedSidesA.add(job.side); return executeA(job);
    });
    const second = runOptimizationWorkflow(createSimpleOptimizationWorkflow(swapped, { ...options, side: "B" }), (job) => {
      testedSidesB.add(job.side); return executeB(job);
    });
    expect([...testedSidesA]).toEqual(["A"]); expect([...testedSidesB]).toEqual(["B"]);
    expect(first.optimizationContext).toMatchObject({ battleScenario: "single", candidateSide: "A", rallyRole: null,
      fixedOpponentSide: "B", optimizationObjective: "candidateSideWinRate" });
    expect(second.optimizationContext).toMatchObject({ battleScenario: "single", candidateSide: "B", rallyRole: null,
      fixedOpponentSide: "A", optimizationObjective: "candidateSideWinRate" });
    expect(first.criterionAudit).toMatchObject({ candidateSide: "A", candidateRole: null });
    expect(second.criterionAudit).toMatchObject({ candidateSide: "B", candidateRole: null });
    expect(first.criterionAudit!.bodyEffectsActiveByRole).toEqual([]);
    expect(second.criterionAudit!.bodiesRejectedAsInactiveInCurrentRole).toBe(0);
    expect(first.criterionAudit!.headEffectsActiveByRole).toEqual([]);
    expect(second.criterionAudit!.headEffectsInactiveByRole).toEqual(first.criterionAudit!.headEffectsInactiveByRole);
    expect(second.criterionAudit!.roleEffectApplicability.every((row)=>!row.activeInCurrentRole)).toBe(true);
    expect(first.theoryCoverage).toEqual(second.theoryCoverage);
    expect(first.criterionAudit!.matrixEvaluations).toBeGreaterThan(0);
    expect(first.topCandidates.some((row) => row.candidate.criterionEstimate && row.candidate.theoryEstimate)).toBe(true);
    const mirrored = new Map(second.topCandidates.map((row) => [candidateKey(row), row]));
    expect(mirrored.size).toBe(first.topCandidates.length);
    for (const row of first.topCandidates) {
      const other = mirrored.get(candidateKey(row))!; expect(other).toBeDefined();
      expect(other.winRate).toBe(row.winRate); expect(other.wins).toBe(row.wins); expect(other.trials).toBe(row.trials);
      if (row.candidate.criterionEstimate) {
        expect(other.candidate.candidateCriterionScore).toBeCloseTo(row.candidate.candidateCriterionScore!, 12);
        expect(other.candidate.criterionEstimate!.margin).toBeCloseTo(-row.candidate.criterionEstimate.margin, 12);
        expect(row.candidate.criterionPerspectiveSide).toBe("A"); expect(other.candidate.criterionPerspectiveSide).toBe("B");
      }
      if (row.candidate.theoryEstimate) expect(other.candidate.theoryEstimate!.theoryScore).toBeCloseTo(row.candidate.theoryEstimate.theoryScore, 12);
    }
    expect(first.current.winRate).toBe(second.current.winRate);
    expect(JSON.stringify(original)).toBe(before);
  }, 20_000);

  it("keeps 333 optimization identities role-free in the nonadaptive result path", () => {
    const input = { ...fixture(), scenarioType: "THREE_THREE_THREE" as const, maxRounds: 1 };
    const result = runOptimizationWorkflow(createSimpleOptimizationWorkflow(input, {
      ...defaultSimpleScenarioOptimizationOptions(447), side: "B", coarseTrials: 1, middleTrials: 1,
      verificationTrials: 2, topN: 2, adaptiveSearch: { enabled: false },
      monteCarloStages: [{ trials: 1, keep: 2 }], fixedHeroes: true, fixedRatio: true }));
    expect(result).toMatchObject({ battleScenario: "333", candidateSide: "B", candidateRole: null,
      fixedOpponentSide: "A", optimizationObjective: "candidateSideWinRate" });
    expect(result.optimizationContext.rallyRole).toBeNull(); expect(result.criterionAudit?.candidateRole).toBeNull();
  }, 20_000);
});
