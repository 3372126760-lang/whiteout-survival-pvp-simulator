import { describe, expect, it } from "vitest";
import {
  applySimpleScenarioCandidate, candidateToInput, generateFormations,
  generateScenarioHeroFormations, generateWholePercentRatios, getServerStage,
  getValidationCatalog, isHeroAvailableAtStage, optimizeSimpleScenario,
  createValidationPreviewState, sanitizeConfigForStage,
  toEngineScenario,
} from "../../pvp";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { optimizerRoute } from "../../ui/optimizerRoute";
import { LocalStorageConfigStorage, type KeyValueStorage } from "../../storage";

const options = { side: "A" as const, coarseTrials: 1, middleTrials: 1,
  verificationTrials: 2, topN: 2, seed: 77,
  fixedHeroes: false, fixedRatio: false };

describe("scenario optimizer routing and candidate semantics", () => {
  it("routes all four scenarios without a rally guard", () => {
    expect(optimizerRoute("SINGLE")).toBe("single");
    expect(optimizerRoute("THREE_THREE_THREE")).toBe("333");
    expect(optimizerRoute("THREE_QUEUE")).toBe("threeQueue");
    expect(optimizerRoute("RALLY")).toBe("rally");
  });

  it("generates only 1% ratio candidates summing to 100%", () => {
    const ratios = generateWholePercentRatios();
    expect(ratios).toHaveLength(5_151);
    for (const row of ratios) {
      expect(row.shield + row.lancer + row.marksman).toBe(100);
      expect([row.shield, row.lancer, row.marksman].every(Number.isSafeInteger))
        .toBe(true);
    }
  });

  it("limits hero formations to the current server stage", () => {
    const base = createDefaultValidationInput();
    const input = { ...base, serverStage: "s5_fc8" as const,
      scenarioType: "SINGLE" as const, attributeInputMode: "prediction" as const,
      sideA: { ...base.sideA, leaderHeroIds: { shield: "hero.s1.nataliya", lancer: "hero.s1.moli", marksman: "hero.s1.jinman" } } };
    const formations = generateScenarioHeroFormations(input, "A", false);
    expect(formations.length).toBeGreaterThan(1);
    for (const formation of formations) {
      for (const hero of Object.values(formation)) {
        if (hero !== null && hero !== undefined) {
          expect(isHeroAvailableAtStage(hero, input.serverStage)).toBe(true);
          const generation = getValidationCatalog().leaderHeroes.find((entry) =>
            entry.heroId === hero)?.generation ?? 0;
          expect(generation).toBeLessThanOrEqual(getServerStage(input.serverStage).maxHeroGeneration);
        }
      }
    }
  });

  it("keeps 333 allocation fixed while searching heroes reproducibly", () => {
    const base = sanitizeConfigForStage(createDefaultValidationInput(), "s1_t10").input;
    const input = { ...base, scenarioType: "THREE_THREE_THREE" as const, maxRounds: 1,
      attributeInputMode: "prediction" as const,
      sideA: { ...base.sideA, leaderHeroIds: { shield: "hero.s1.nataliya", lancer: "hero.s1.moli", marksman: "hero.s1.jinman" } } };
    const first = optimizeSimpleScenario(input, options);
    const second = optimizeSimpleScenario(input, options);
    expect(first).toEqual(second);
    expect(first.topCandidates.length).toBeGreaterThan(0);
    expect(first.topCandidates.every((row) => row.candidate.ratios === undefined)).toBe(true);
    expect(first.topCandidates.every((row) => row.trials === options.verificationTrials)).toBe(true);
    expect(first.topCandidates[0]!.winRate).toBeGreaterThanOrEqual(first.current.winRate);
    expect(first.theoryCoverage).toMatchObject({ theoryHeroCoverage: 100,
      ratiosPerHeroLineup: 1, battleHeroCoverage: 100 });
    expect(first.theoryCoverage?.legalHeroLineupCount).toBe(generateScenarioHeroFormations(input, "A", false).length);
  }, 20_000);

  it("searches single ratios with fixed heroes and preserves the other side", () => {
    const input = { ...sanitizeConfigForStage(createDefaultValidationInput(),
      "s1_t10").input, scenarioType: "SINGLE" as const, maxRounds: 1 };
    const result = optimizeSimpleScenario(input, { ...options, fixedHeroes: true });
    expect(() => optimizeSimpleScenario(input, { ...options,
      fixedRatio: true })).toThrow(/整数百分比/);
    expect(result.topCandidates.length).toBeGreaterThan(0);
    for (const row of result.topCandidates) {
      expect(row.candidate.leaderHeroIds).toEqual(input.sideA.leaderHeroIds);
      if (!row.isCurrent) {
        expect(Object.values(row.candidate.ratios!).every(Number.isSafeInteger)).toBe(true);
      }
    }
    const applied = applySimpleScenarioCandidate(input, "A", {
      leaderHeroIds: result.topCandidates[0]!.candidate.leaderHeroIds,
      ratios: { shield: 20, lancer: 30, marksman: 50 },
    });
    expect(applied.sideA.troops.shield.count).toBe(7_200);
    expect(applied.sideA.troops.lancer.count).toBe(10_800);
    expect(applied.sideA.troops.marksman.count).toBe(18_000);
    expect(applied.sideB).toEqual(input.sideB);
    expect(createValidationPreviewState(applied).sideA.troops.shield.aliveCount)
      .toBe(7_200);
    expect(() => applySimpleScenarioCandidate(input, "A", {
      leaderHeroIds: {}, ratios: { shield: 33.33, lancer: 33.33, marksman: 33.34 },
    })).toThrow(/整数百分比/);
  });

  it("applied candidate reaches autosave through the existing storage adapter", () => {
    const data = new Map<string, string>();
    const backend: KeyValueStorage = {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => { data.set(key, value); },
      removeItem: (key) => { data.delete(key); },
    };
    const input = { ...createDefaultValidationInput(), scenarioType: "SINGLE" as const };
    const applied = applySimpleScenarioCandidate(input, "A", {
      leaderHeroIds: {}, ratios: { shield: 25, lancer: 25, marksman: 50 },
    });
    const store = new LocalStorageConfigStorage(backend);
    store.saveAutosave(applied, 20, {
      objectiveMode: "auto", constraints: {}, stages: [
        { ratioStep: 5, trials: 20, keep: 12, maxCandidates: 300 },
        { ratioStep: 2, trials: 60, keep: 8, maxCandidates: 100 },
        { ratioStep: 1, trials: 150, keep: 5, maxCandidates: 60 },
      ], verificationTrials: 500, verificationTop: 5, topN: 5,
      firstSeed: 12345, targetDefeatProbability: .9, maxWaves: 3,
      beamWidth: 3, branchWidth: 3, beamTrials: 50,
      singleFightThresholdLow: .05, singleFightThresholdHigh: .95,
    });
    expect(new LocalStorageConfigStorage(backend).loadAutosave()?.input.sideA.troops)
      .toEqual(applied.sideA.troops);
  });

  it("rally candidate conversion replaces stale body skills and retains locked skill levels", () => {
    const sources = getValidationCatalog().memberSkills.flatMap((group) =>
      group.sourceSkillIds.map((skillId, index) => ({ skillId,
        heroId: group.sourceHeroIds[index]! }))).filter((source) =>
      isHeroAvailableAtStage(source.heroId, "s11"));
    const first = sources[0]!;
    const second = sources.find((source) => source.heroId !== first.heroId)!;
    const base = createDefaultValidationInput();
    const input = { ...base, scenarioType: "RALLY" as const,
      battleContext: "rally" as const,
      sideA: { ...base.sideA, selectedMemberSkillIds: [first.skillId],
        bodySkills: [{ ...first, expeditionSkillSlot: 1 as const, skillLevel: 4 }] } };
    const fixed = generateFormations(input, { fixedMemberSkillIds: [first.skillId],
      fixedLeaders: { shield: "hero.s11.eleonora", lancer: "hero.s11.lloyd", marksman: "hero.s11.rufus" } }, 12);
    expect(fixed.length).toBeGreaterThan(0);
    expect(fixed.every((formation) => formation.memberSkillIds[0] === first.skillId)).toBe(true);
    expect(fixed.some((formation) => formation.memberSkillIds.length > 1)).toBe(true);
    const oldRemoved = candidateToInput(input, { leaderHeroIds: {},
      memberSkillIds: [second.skillId], ratios: { shield: 34, lancer: 33, marksman: 33 } });
    expect(oldRemoved.sideA.bodySkills?.map((body) => body.skillId)).toEqual([second.skillId]);
    expect(toEngineScenario(oldRemoved).sideA.heroes?.some((hero) =>
      hero.heroId === first.heroId && hero.position === "member")).toBe(false);
    const locked = candidateToInput(input, { leaderHeroIds: {},
      memberSkillIds: [first.skillId, second.skillId],
      ratios: { shield: 34, lancer: 33, marksman: 33 } });
    expect(locked.sideA.bodySkills?.[0]?.skillLevel).toBe(4);
    expect(locked.sideA.bodySkills?.[1]?.skillLevel).toBe(5);
  });
});
