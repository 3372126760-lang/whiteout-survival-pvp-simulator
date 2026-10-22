import { describe, expect, it } from "vitest";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { createPersistedEnvelope, restorePersistedConfig } from "../../storage";
import { getValidationCatalog, sanitizeConfigForStage, toEngineScenario, type ValidationBattleInput } from "../validationUi";
import { heroCategory, heroSGeneration } from "../validationUi/heroCategory";
import { generateAllHeadFormations, headHeroPoolAudit } from "../optimizer/candidateGenerator";
import { createHeadPoolAudit } from "../optimizer/headPoolAudit";
import { optimizerGeneration } from "../optimizer/heroSearchPolicy";
import { initializeOptimizationHeroPool, optimizationHeroIds, optimizerHeadHeroAllowed, serverHeroIds,
  setOptimizationPoolEnabled, syncOptimizationHeroPoolForStage } from "../optimizer/heroPools";
import { defaultOptimizationConfig, runRallyOptimizationAsync } from "../optimizer";
import { createEvaluationExecutor, type EvaluationJob } from "../optimizer/execution";
import type { ServerStageId } from "../progression";

const catalog = getValidationCatalog().leaderHeroes;
const gen = (n: number) => catalog.filter((h) => heroSGeneration(h) === n).map((h) => h.heroId);
const emptyBody = { fixedBodyExact: true, fixedMemberSkillIds: [] };
const fixture = (serverStage: ServerStageId = "s12"): ValidationBattleInput => {
  const input = createDefaultValidationInput();
  return { ...input, serverStage, scenarioType: "RALLY", battleContext: "rally", attributeInputMode: "prediction",
    sideA: { ...input.sideA, leaderHeroIds: { shield: "hero.s1.nataliya", lancer: "hero.s1.moli", marksman: "hero.s1.jinman" } } };
};
const changeStage = (input: ValidationBattleInput, stage: ServerStageId) =>
  syncOptimizationHeroPoolForStage(input, sanitizeConfigForStage(input, stage).input);

describe("Head pool follows server stage beyond S12", () => {
  it.each([
    ["s8_fc10", 8, 25, 426],
    ["s11", 11, 34, 876], ["s12", 12, 37, 1062], ["s13", 13, 40, 1266],
    ["s14", 14, 43, 1488], ["s15", 15, 46, 1728], ["s16", 16, 49, 1986],
  ] as const)("%s exposes %i generations, %i Head heroes and %i legal formations", (stage, generation, heroes, formations) => {
    const input = initializeOptimizationHeroPool(fixture(stage)), enabled = optimizationHeroIds(input);
    expect(enabled).toHaveLength(heroes); expect(optimizerGeneration(input)).toBe(generation);
    expect(enabled).toEqual(expect.arrayContaining(gen(generation)));
    for (const id of enabled) {
      const hero = catalog.find((h) => h.heroId === id)!;
      expect(heroCategory(hero)).toBe("S"); expect(heroSGeneration(hero)!).toBeLessThanOrEqual(generation);
    }
    expect(catalog.filter((h) => (heroSGeneration(h) ?? 0) > generation).some((h) => enabled.includes(h.heroId))).toBe(false);
    expect(generateAllHeadFormations(input, emptyBody)).toHaveLength(formations);
    const audit = createHeadPoolAudit(input, emptyBody);
    expect(audit.eligibleCurrentGenerationHeadHeroIds).toEqual(expect.arrayContaining(gen(generation)));
    expect(audit).toMatchObject({ eligibleHeadHeroCount: heroes, maxServerGeneration: generation, warning: null });
    // A structured-cloned Worker payload resolves the same effective pool.
    expect(optimizationHeroIds(structuredClone(input))).toEqual(enabled);
  });
  it("adds newly unlocked Heads to every explicit inventory, without adding missing older heroes or changing combat", () => {
    const previous = initializeOptimizationHeroPool({ ...fixture(), ownedHeroIds: ["hero.s11.eleonora"],
      optimizerHeroPool: { A: { "hero.s13.gisela": { enabled: false, weaponLevel: 6 } } } });
    const next = changeStage(previous, "s13");
    expect(next.ownedHeroIds).toEqual(["hero.s11.eleonora", ...gen(13)]);
    expect(next.ownedHeroIds).not.toContain("hero.s12.hervor");
    expect(optimizationHeroIds(next, "A")).toEqual(expect.arrayContaining(gen(13).filter((id) => id !== "hero.s13.gisela")));
    expect(optimizationHeroIds(next, "A")).not.toContain("hero.s13.gisela");
    expect(optimizationHeroIds(next, "B")).toEqual(expect.arrayContaining(gen(13)));
    expect(next.optimizerHeroPool!.A!["hero.s13.gisela"]).toEqual({ enabled: false, weaponLevel: 6 });
    expect(toEngineScenario(next)).toEqual(toEngineScenario(sanitizeConfigForStage(previous, "s13").input));
    expect(previous.ownedHeroIds).toEqual(["hero.s11.eleonora"]);
  });
  it("upgrades a complete S12 owned snapshot through S16, then removes and restores future candidates immediately", () => {
    let input = initializeOptimizationHeroPool({ ...fixture(), ownedHeroIds: serverHeroIds(fixture()) });
    for (const [stage, count] of [["s13", 40], ["s14", 43], ["s15", 46], ["s16", 49]] as const) {
      input = changeStage(input, stage); expect(optimizationHeroIds(input)).toHaveLength(count);
    }
    input = setOptimizationPoolEnabled(input, "A", false, "hero.s13.flora");
    const future = input.optimizerHeroPool!.A!["hero.s13.flora"];
    input = changeStage(input, "s12"); expect(optimizationHeroIds(input)).toHaveLength(37);
    expect(optimizationHeroIds(input).some((id) => (heroSGeneration(catalog.find((h) => h.heroId === id)!) ?? 0) > 12)).toBe(false);
    input = changeStage(input, "s13"); expect(optimizationHeroIds(input)).toHaveLength(39);
    expect(input.optimizerHeroPool!.A!["hero.s13.flora"]).toEqual(future);
    const restored = restorePersistedConfig(createPersistedEnvelope(input, 1000)).input;
    expect(optimizationHeroIds(restored)).toEqual(optimizationHeroIds(input));
  });
  it("does not expand a frozen/imported inventory just by reading it, and supports legacy available lists on upgrades", () => {
    const old = { ...fixture(), availableHeroIds: ["hero.s11.eleonora"] };
    expect(optimizationHeroIds(old)).toEqual(["hero.s11.eleonora"]);
    const next = changeStage(old, "s14");
    expect(next.ownedHeroIds).toEqual(["hero.s11.eleonora", ...gen(13), ...gen(14)]);
    expect(next.ownedHeroIds!.every((id) => heroCategory(catalog.find((h) => h.heroId === id)!) === "S")).toBe(true);
  });
  it("also unlocks the new generation for an explicitly empty owned list", () => {
    const previous = { ...fixture(), ownedHeroIds: [] };
    const next = changeStage(previous, "s13");
    expect(next.ownedHeroIds).toEqual(gen(13)); expect(optimizationHeroIds(next)).toEqual(gen(13));
    expect(previous.ownedHeroIds).toEqual([]);
  });
  it("keys generation/audit memoization by stage, even when an input object is reused", () => {
    const input = { ...fixture(), serverStage: "s12" as ServerStageId };
    expect(optimizerGeneration(input)).toBe(12);
    input.serverStage = "s13"; expect(optimizerGeneration(input)).toBe(13);
    input.serverStage = "s12"; expect(optimizerGeneration(input)).toBe(12);
    const owned = { ...fixture(), ownedHeroIds: ["hero.s11.eleonora"], serverStage: "s12" as ServerStageId };
    expect(headHeroPoolAudit(owned, {}).serverGeneration).toBe(12);
    owned.serverStage = "s14"; expect(headHeroPoolAudit(owned, {}).serverGeneration).toBe(14);
    expect(optimizerHeadHeroAllowed(catalog.find((h) => h.heroId === "hero.s13.gisela")!, 12)).toBe(false);
    expect(optimizerHeadHeroAllowed(catalog.find((h) => h.heroId === "hero.s13.gisela")!, 13)).toBe(true);
  });
  it("carries a freely searched S13 Head through J, Criterion, Theory and actual Formal1000", async () => {
    const base = fixture("s13"), input = { ...base, maxRounds: 5, sideA: { ...base.sideA,
      troops: Object.fromEntries(Object.entries(base.sideA.troops).map(([troop, t]) => [troop, { ...t, attack: 1e6, penetration: 1e6 }])),
    } } as ValidationBattleInput;
    const config = { ...defaultOptimizationConfig(20261018), constraints: { ...emptyBody, heroPoolIds: gen(13) },
      jointPipeline: { criterionKeep: 1, criterionFineKeep: 1, theoryKeep: 1, formalRatioKeep: 1,
        formalStages: [{ trials: 20, keep: 1 }, { trials: 50, keep: 1 }, { trials: 100, keep: 1 }, { trials: 300, keep: 1 }] } };
    const execute = createEvaluationExecutor(); let formalS13Battles = 0, peakJobs = 0;
    const result = await runRallyOptimizationAsync(input, config, async (jobs: readonly EvaluationJob[]) => jobs.map((job) => {
      if (job.kind === "jointPeak") peakJobs++;
      if (job.kind === "battle" && Object.values(job.input.sideA.leaderHeroIds ?? {}).some((id) => gen(13).includes(id!))) formalS13Battles += job.seeds.length;
      return execute(job);
    }));
    expect(peakJobs).toBeGreaterThan(0); expect(formalS13Battles).toBeGreaterThanOrEqual(1000);
    expect(result.singleWaveTop.some((row) => row.trials === 1000 && Object.values(row.candidate.leaderHeroIds).every((id) => gen(13).includes(id!)))).toBe(true);
  });
});
