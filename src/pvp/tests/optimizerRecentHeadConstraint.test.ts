import { describe, expect, it } from "vitest";
import { generateAllHeadFormations, generateFormations, headFormationGenerationAudit } from "../optimizer/candidateGenerator";
import { optimizerGeneration, optimizerRecentHeadEligible, recentHeadCandidateAudit } from "../optimizer/heroSearchPolicy";
import { generateScenarioHeroFormations, optimizeSimpleScenario } from "../optimizer/scenarioOptimizer";
import { getValidationCatalog } from "../validationUi";
import { TROOP_TYPES, type TroopType } from "../types";
import { rallyHeadSearchFixture, OLD_HEAD } from "./fixtures/rallyHeadSearch";
import { createSingleWaveSearchWorkflow } from "../optimizer/singleWaveSearch";
import { createEvaluationExecutor } from "../optimizer/execution";
import { defaultOptimizationConfig } from "../optimizer";

const catalog = getValidationCatalog();
function generationHead(generation: number): Record<TroopType, string> {
  return Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
    catalog.leaderHeroes.find((hero) => hero.generation === generation && hero.troopType === troop)!.heroId])) as Record<TroopType, string>;
}
function inputWithEnabledMaximum(generation: 8 | 11) {
  const ids = [...Object.values(OLD_HEAD), ...Object.values(generationHead(8)), ...Object.values(generationHead(11))];
  return { ...rallyHeadSearchFixture(), serverStage: "s11" as const, ownedHeroIds: ids, availableHeroIds: ids,
    optimizerHeroPool: { A: Object.fromEntries(ids.map((id) => [id, {
      enabled: (catalog.leaderHeroes.find((hero) => hero.heroId === id)!.generation ?? 0) <= generation, weaponLevel: 10 }])),
    B: Object.fromEntries(ids.map((id) => [id, { enabled: true, weaponLevel: 10 }])) } };
}

describe("hard recent generation head candidate constraint", () => {
  it("uses enabled pool maximum8 on server11 and filters only complete old-only heads", () => {
    const input = inputWithEnabledMaximum(8), constraints = { fixedBodyExact: true, fixedMemberSkillIds: [] };
    expect(optimizerGeneration(input)).toBe(8);
    expect(optimizerGeneration(input, "B")).toBe(11);
    expect(headFormationGenerationAudit(input, constraints)).toMatchObject({ allLegalHeadCount: 8,
      effectiveHeroGeneration: 8, recentGenerationWindow: [6, 8], recentEligibleHeadCount: 7,
      rejectedByRecentGenerationCount: 1 });
    const heads = generateAllHeadFormations(input, constraints);
    expect(heads).toHaveLength(7);
    expect(heads.every((row) => optimizerRecentHeadEligible(input, row.leaderHeroIds))).toBe(true);
    expect(heads.some((row) => Object.values(row.leaderHeroIds).some((id) => Object.values(OLD_HEAD).includes(id ?? "")))).toBe(true);
    expect(heads.some((row) => JSON.stringify(row.leaderHeroIds) === JSON.stringify(OLD_HEAD))).toBe(false);
    expect(generateFormations(input, constraints, 100).every((row) => optimizerRecentHeadEligible(input, row.leaderHeroIds))).toBe(true);
    expect(generateAllHeadFormations(input, { ...constraints, fixedLeaders: OLD_HEAD }))
      .toEqual([{ leaderHeroIds: OLD_HEAD, memberSkillIds: [] }]);
  });

  it("moves the recent window to9–11 only when the enabled pool reaches11", () => {
    const input = inputWithEnabledMaximum(11);
    expect(recentHeadCandidateAudit(input, [OLD_HEAD, generationHead(8), generationHead(11)])).toEqual({
      allLegalHeadCount: 3, effectiveHeroGeneration: 11, recentGenerationWindow: [9, 11],
      recentEligibleHeadCount: 1, rejectedByRecentGenerationCount: 2 });
    expect(optimizerRecentHeadEligible(input, generationHead(8))).toBe(false);
    expect(optimizerRecentHeadEligible(input, { ...generationHead(8), marksman: generationHead(11).marksman })).toBe(true);
  });

  it("filters generated Single/333 heads while admitting a fixed old head independently of the pool", () => {
    const original = inputWithEnabledMaximum(8);
    const input = { ...original, scenarioType: "THREE_THREE_THREE" as const, battleContext: "challenge" as const, maxRounds: 1 };
    expect(generateScenarioHeroFormations(input, "A", false)).toHaveLength(7);
    expect(generateScenarioHeroFormations(input, "A", true)).toEqual([OLD_HEAD]);
    const before = JSON.stringify(input);
    const result = optimizeSimpleScenario(input, { side: "A", coarseTrials: 1, middleTrials: 1,
      verificationTrials: 2, topN: 1, seed: 91, fixedHeroes: true, fixedRatio: true });
    expect(result.criterionAudit?.matrixEvaluations).toBe(1);
    expect(result.current.isCurrent).toBe(true);
    expect(result.current.candidate.leaderHeroIds).toEqual(OLD_HEAD);
    expect(result.current.candidate.headWeaponLevels).toEqual(Object.fromEntries(Object.values(OLD_HEAD).map((id) => [id, 0])));
    expect(result.topCandidates).toHaveLength(1);
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each([true, false])("searches all ratios for an old-only fixed head even with legacy switches (adaptive=%s)", (adaptive) => {
    const original = inputWithEnabledMaximum(11), input = { ...original, maxRounds: 1,
      sideA: { ...original.sideA, simulationWeaponLevels: { [OLD_HEAD.shield]: 2, [OLD_HEAD.lancer]: 6 } } };
    const config = { ...defaultOptimizationConfig(101),
      adaptiveSearch: { enabled: adaptive }, objectiveMode: "singleWin" as const,
      constraints: { fixedLeaders: OLD_HEAD, fixedBodyExact: true, fixedMemberSkillIds: [] },
      theory: { ...defaultOptimizationConfig().theory!, deterministicRounds: 1 },
      criterion: { enabled: false, fineRadius: 0, c0TheoryRounds: 1 },
      monteCarloStages: [{ trials: 1, keep: 1 }, { trials: 2, keep: 1 }, { trials: 3, keep: 1 }],
      verificationTrials: 3, verificationTop: 1, topN: 1 };
    const workflow = createSingleWaveSearchWorkflow(input, config), execute = createEvaluationExecutor();
    let next = workflow.next(), requests = 0;
    while (!next.done) {
      for (const job of next.value) {
        expect(job.input.sideA.leaderHeroIds).toEqual(OLD_HEAD);
        expect(job.input.sideA.simulationWeaponLevels?.[OLD_HEAD.shield]).toBe(2);
        expect(job.input.sideA.simulationWeaponLevels?.[OLD_HEAD.lancer]).toBe(6);
        requests++;
      }
      next = workflow.next(next.value.map(execute));
    }
    expect(requests).toBeGreaterThan(0);
    expect(next.value.searchDiagnostics.jointPipeline!.peak).toMatchObject({ headCount: 1, bodyCount: 1, evaluatedHeadBodyCount: 1 });
    expect(next.value.searchDiagnostics.legalHeadCandidateCount).toBe(1);
    expect(next.value.searchDiagnostics.jointPipeline!.recallAudit).toMatchObject({ perHeadProtectedK: 1, mergedRecallCount: 1 });
    expect(next.value.searchDiagnostics.jointPipeline!.criterionEvaluations).toBeGreaterThan(0);
    expect(next.value.searchDiagnostics.bodyCandidateCount).toBe(1);
    expect(next.value.current.candidate.leaderHeroIds).toEqual(OLD_HEAD);
  });
});
