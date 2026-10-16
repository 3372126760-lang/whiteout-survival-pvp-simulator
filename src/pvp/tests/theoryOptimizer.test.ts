import { describe, expect, it, vi } from "vitest";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { candidateToInput,
  generateRatioGrid, optimizeSimpleScenario, applySimpleScenarioCandidate } from "../optimizer";
import { createRatioAdjacency, createTheoryTemplateBuilder, defaultTheoryOptions,
  detectRatioLocalPeaks, estimateDeterministicBattle, estimateTheoryCandidate,
  ratioKey, ratioNeighbors, ratioRegion, scanLineupRatios,
  type TheoryEstimate } from "../optimizer/theory";
import { CONFIRMED_HERO_SKILL_DEFINITIONS } from "../heroSkills";
import { CONFIRMED_TROOP_SKILL_DEFINITIONS } from "../troopSkills";
import { calculateBaseTroopDamage, calculateTroopHp } from "../formulas";
import { createDamageEvent } from "../damage";
import { createValidationPreviewState } from "../validationUi";
import { resolveTroopAttribute } from "../effects";
import { TROOP_TYPES } from "../types";
import { opponentCandidate, rallyHeadSearchFixture } from "./fixtures/rallyHeadSearch";

const options = defaultTheoryOptions();
const grid = generateRatioGrid(5);
const adjacency = createRatioAdjacency(grid, 5);
const estimate = (theoryScore: number, uncertainty = 0): TheoryEstimate => ({
  theoryScore, uncertainty, staticTheoryScore: theoryScore, deterministicScore: theoryScore,
  metrics: { initialDps: [1, 1], ehp: [1, 1], firstTargetTtk: [1, 1],
    shieldSurvivalRounds: [1, 1], marksmanOutputWindow: [1, 1] },
});

describe("standalone multi-peak theory prefilter", () => {
  it("builds the complete simplex and exactly six legal interior neighbors", () => {
    expect(grid).toHaveLength(231);
    const neighbors = ratioNeighbors({ shield: 50, lancer: 40, marksman: 10 }, 5);
    expect(neighbors).toHaveLength(6);
    expect(neighbors.every((row) => row.shield + row.lancer + row.marksman === 100)).toBe(true);
    expect(ratioNeighbors({ shield: 100, lancer: 0, marksman: 0 }, 5)).toHaveLength(2);
    for (const [i, neighborsAtI] of adjacency.entries())
      for (const n of neighborsAtI) expect(adjacency[n]).toContain(i);
  });
  it("detects and preserves three separated local maxima, rather than global Top1%", () => {
    const peaks = ["60/20/20", "20/60/20", "20/20/60"];
    const scores = grid.map((ratio) => Math.max(...peaks.map((peak) => {
      const values = peak.split("/").map(Number);
      return -TROOP_TYPES.reduce((sum, troop, i) => sum + (ratio[troop] - values[i]!) ** 2, 0);
    })));
    const detected = detectRatioLocalPeaks(scores, adjacency).map((i) => ratioKey(grid[i]!));
    expect(detected.sort()).toEqual([...peaks].sort());
    const scan = scanLineupRatios(grid, adjacency, (ratio) => estimate(scores[grid.indexOf(ratio)]!),
      { ...options, randomExploration: 0, diversityExploration: 0, uncertaintyExploration: 0 }, 17);
    expect(scan.scanned).toBe(231);
    expect(scan.selections.map((row) => ratioKey(row.ratios)).sort()).toEqual([...peaks].sort());
    expect(scan.selections.every((row) => row.selectionReasons.includes("theoryLocalPeak"))).toBe(true);
  });
  it("fills missing peaks and keeps a lineup even when every score is poor", () => {
    const scan = scanLineupRatios(grid, adjacency, (ratio) => estimate(-1000 + ratio.shield),
      { ...options, randomExploration: 0, diversityExploration: 0, uncertaintyExploration: 0 }, 17);
    expect(scan.localPeaksDetected).toBe(1);
    expect(scan.selections).toHaveLength(3);
    expect(scan.selections.filter((row) => row.selectionReasons.includes("theoryTop"))).toHaveLength(2);
  });
  it("protects high uncertainty and structural regions with reproducible seeded exploration", () => {
    const score = (ratio: typeof grid[number]) => estimate(ratio.shield / 100,
      ratioKey(ratio) === "0/100/0" ? 2 : 0);
    const run = () => scanLineupRatios(grid, adjacency, score, options, 17);
    const mathRandom = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("unseeded"); });
    try {
      const first = run();
      expect(run()).toEqual(first);
      expect(first.selections).toHaveLength(6);
      const uncertain = first.selections.find((row) => ratioKey(row.ratios) === "0/100/0");
      expect(uncertain?.selectionReasons).toContain("uncertaintyExploration");
      expect(new Set(first.selections.map((row) => ratioRegion(row.ratios))).size).toBeGreaterThanOrEqual(3);
      expect(first.selections.some((row) => row.selectionReasons.includes("randomExploration"))).toBe(true);
      expect(mathRandom).not.toHaveBeenCalled();
    } finally { mathRandom.mockRestore(); }
  });

  it("materializes final-report ratios into actual Engine counts with fixed total and attributes", () => {
    const base = rallyHeadSearchFixture();
    const input = { ...base, attributeInputMode: "finalReport" as const,
      sideA: { ...base.sideA, leaderHeroIds: opponentCandidate().leaderHeroIds } };
    const candidate = { ...opponentCandidate(), ratios: { shield: 52, lancer: 38, marksman: 10 } };
    const converted = candidateToInput(input, candidate);
    const state = createValidationPreviewState(converted);
    expect(TROOP_TYPES.map((troop) => state.sideA.troops[troop].aliveCount)).toEqual([18720,13680,3600]);
    expect(TROOP_TYPES.reduce((sum, troop) => sum + state.sideA.troops[troop].aliveCount, 0)).toBe(36000);
    expect(converted.sideB).toBe(input.sideB);
    for (const troop of TROOP_TYPES) for (const stat of ["attack", "defense", "penetration", "life"] as const)
      expect(converted.sideA.troops[troop][stat]).toBe(input.sideA.troops[troop][stat]);
  });

  it("covers all seven recent-eligible single lineups on side B while preserving attributes and the opponent", () => {
    const input = { ...rallyHeadSearchFixture(), scenarioType: "SINGLE" as const,
      battleContext: "challenge" as const, maxRounds: 1 };
    const before = JSON.stringify(input);
    const result = optimizeSimpleScenario(input, { side: "B", seed: 17, fixedHeroes: false,
      fixedRatio: false, coarseTrials: 1, middleTrials: 1, verificationTrials: 2, topN: 1,
      monteCarloStages: [{ trials: 1, keep: 1 }] });
    expect(result.theoryCoverage).toMatchObject({ legalHeroLineupCount: 7,
      theoryCandidateCount: 1617, ratiosPerHeroLineup: 231,
      theoryHeroCoverage: 100, heroLineupsEnteringBattleEngine: 7, battleHeroCoverage: 100 });
    const changed = applySimpleScenarioCandidate(input, "B", result.topCandidates[0]!.candidate);
    expect(changed.sideA).toEqual(input.sideA);
    for (const troop of TROOP_TYPES) for (const stat of ["attack", "defense", "penetration", "life"] as const)
      expect(changed.sideB.troops[troop][stat]).toBe(input.sideB.troops[troop][stat]);
    expect(JSON.stringify(input)).toBe(before);
  });
  it("reuses official deterministic damage and HP coefficients without changing registered rules", () => {
    const base = createDefaultValidationInput();
    const input = { ...base, attributeInputMode: "finalReport" as const,
      sideA: { ...base.sideA, leaderHeroIds: {}, selectedMemberSkillIds: [], bodySkills: [] },
      sideB: { ...base.sideB, leaderHeroIds: {}, selectedMemberSkillIds: [], bodySkills: [] },
      disabledSkillIds: [...CONFIRMED_HERO_SKILL_DEFINITIONS, ...CONFIRMED_TROOP_SKILL_DEFINITIONS].map((row) => row.id) };
    const definitionsBefore = JSON.stringify([CONFIRMED_HERO_SKILL_DEFINITIONS, CONFIRMED_TROOP_SKILL_DEFINITIONS]);
    const state = createValidationPreviewState(input);
    const template = createTheoryTemplateBuilder(options)(input);
    for (const [source, troop] of TROOP_TYPES.entries()) {
      const stack = state.sideA.troops[troop];
      const attack = resolveTroopAttribute(state.sideA, troop, "attack", 1,
        { targetTroop: "shield", damageType: "normalAttack" }).effectiveValue;
      const penetration = resolveTroopAttribute(state.sideA, troop, "penetration", 1,
        { targetTroop: "shield", damageType: "normalAttack" }).effectiveValue;
      const damage = calculateBaseTroopDamage({ fixedInitialMinTroops: 1, aliveCount: 1,
        damageCoefficient: stack.damageCoefficient, troopConstant: stack.troopConstant, attack, penetration }).damage;
      const event = createDamageEvent({ id: "test", sourceSide: "A", sourceTroop: troop,
        targetSide: "B", targetTroop: "shield", damageType: "normalAttack", damageSubtype: "normalAttack",
        round: 1, actionOrder: 0, baseDamage: damage }, state);
      expect(template.sideA.normalDamage[source * 3]).toBeCloseTo(event.modifiedDamage, 10);
      expect(template.sideA.damage[source * 3]).toBeCloseTo(event.modifiedDamage, 10);
      expect(template.sideA.hp[source]).toBeCloseTo(calculateTroopHp({ troopConstant: stack.troopConstant,
        troopHpCoefficient: stack.troopHpCoefficient,
        life: resolveTroopAttribute(state.sideA, troop, "life", 1, { targetTroop: "shield", damageType: "normalAttack" }).effectiveValue }).effectiveHpPerUnit, 10);
    }
    expect(JSON.stringify([CONFIRMED_HERO_SKILL_DEFINITIONS, CONFIRMED_TROOP_SKILL_DEFINITIONS])).toBe(definitionsBefore);
  });
  it("keeps Miya's formal proc family while constructing private numeric estimator copies", () => {
    const miya = CONFIRMED_HERO_SKILL_DEFINITIONS.find((skill) =>
      skill.procEffectFamilyId === "miya-doom-entanglement-family")!;
    const before = JSON.stringify(miya);
    const base = createDefaultValidationInput();
    const input = { ...base, attributeInputMode: "finalReport" as const,
      sideA: { ...base.sideA, leaderHeroIds: { lancer: miya.heroId },
        selectedMemberSkillIds: [], bodySkills: [] } };
    const template = createTheoryTemplateBuilder(options)(input);
    expect(template.sideA.damage.every(Number.isFinite)).toBe(true);
    expect(JSON.stringify(miya)).toBe(before);
    expect(miya.procEffectFamilyId).toBe("miya-doom-entanglement-family");
    expect(miya.trigger).toBe("beforeAttack");
    expect(miya.probability).toBe(.5);
  });
  it("uses calibrated pure numeric probability equivalents before mathematical expectation", () => {
    const base = createDefaultValidationInput();
    const input = { ...base, attributeInputMode: "finalReport" as const,
      sideA: { ...base.sideA, leaderHeroIds: { marksman: "hero.sr.baxiti" },
        selectedMemberSkillIds: [], bodySkills: [] } };
    const effectId = "hero-effect.baxiti.unstable-field";
    const uncalibrated = createTheoryTemplateBuilder(options)(input);
    const calibrated = createTheoryTemplateBuilder({ ...options, probabilityEquivalentCoefficient: .8,
      calibratedEquivalents: { [effectId]: .18 } })(input);
    expect(uncalibrated.probabilityEquivalents.find((row) => row.effectId === effectId))
      .toMatchObject({ mathematicalExpectation: .25, usedEquivalent: .25 });
    expect(calibrated.probabilityEquivalents.find((row) => row.effectId === effectId))
      .toMatchObject({ mathematicalExpectation: .25, calibratedEquivalent: .18, usedEquivalent: .18 });
    expect(calibrated.sideA.damage[0]).toBeLessThan(uncalibrated.sideA.damage[0]!);
  });
  it("omits complex timing/control effects, reports uncertainty and never claims a theoretical win rate", () => {
    const input = candidateToInput(rallyHeadSearchFixture(), opponentCandidate());
    const template = createTheoryTemplateBuilder(options)(input);
    expect(template.omittedMechanisms.length).toBeGreaterThan(0);
    const result = estimateTheoryCandidate(template, [50,20,30]);
    expect(result.uncertainty).toBeGreaterThan(0);
    expect(result).not.toHaveProperty("winRate");
    const deterministic = estimateDeterministicBattle(template, [50.01,19.99,30]);
    expect(deterministic).toEqual(estimateDeterministicBattle(template, [50.01,19.99,30]));
    expect(deterministic).not.toHaveProperty("trace");
  });

});
