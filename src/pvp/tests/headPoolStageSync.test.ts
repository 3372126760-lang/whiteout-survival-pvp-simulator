import { describe, expect, it } from "vitest";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { createPersistedEnvelope, restorePersistedConfig } from "../../storage";
import { getValidationCatalog, toEngineScenario, type ValidationBattleInput } from "../validationUi";
import { sanitizeConfigForStage } from "../validationUi/stageConfig";
import { heroCategory } from "../validationUi/heroCategory";
import { createHeadPoolAudit } from "../optimizer/headPoolAudit";
import { generateAllHeadFormations, headFormationGenerationAudit } from "../optimizer/candidateGenerator";
import { generateBodyEnumerationDomain } from "../optimizer/criterion/bodyEnumeration";
import { optimizerGeneration, optimizerRecentHeadEligible, recentGenerations } from "../optimizer/heroSearchPolicy";
import { defaultOptimizationConfig } from "../optimizer";
import { freezeOptimizerBenchmarkFixture } from "../../../scripts/optimizer-benchmark-fixture";
import { heroOwnershipScope, initializeOptimizationHeroPool, optimizationHeroIds, ownedHeroIds,
  reconcileLegacyHeroOwnership, serverHeroIds, setHeroOwnershipScope, setOptimizationPoolEnabled,
  setOwnedHero } from "../optimizer/heroPools";

const s12 = ["hero.s12.hervor", "hero.s12.karol", "hero.s12.ligeia"];
const emptyBody = { fixedBodyExact: true, fixedMemberSkillIds: [] };
const fixture = (): ValidationBattleInput => {
  const base = createDefaultValidationInput();
  return { ...base, serverStage: "s12", scenarioType: "RALLY", battleContext: "rally", attributeInputMode: "prediction",
    sideA: { ...base.sideA, leaderHeroIds: { shield: "hero.s11.eleonora", lancer: "hero.s11.lloyd", marksman: "hero.s11.rufus" } } };
};
const upgrade = (input: ValidationBattleInput) => initializeOptimizationHeroPool(sanitizeConfigForStage(input, "s12").input);

describe("Head pool stage sync (H0 only; no battles)", () => {
  it("A/B: expands an initialized S11 theoretical pool to all S12 SSR, without changing BattleConfig", () => {
    const previous = initializeOptimizationHeroPool({ ...fixture(), serverStage: "s11" });
    expect(optimizationHeroIds(previous)).toHaveLength(34);
    // Both direct Worker input and UI initialization must agree on missing entries.
    const direct = { ...previous, serverStage: "s12" as const }, initialized = upgrade(previous);
    const audit = createHeadPoolAudit(initialized, emptyBody);
    for (const input of [direct, initialized]) expect(optimizationHeroIds(input)).toEqual(expect.arrayContaining(s12));
    expect(audit).toMatchObject({ ownershipMode: "allAvailable", serverUnlockedSSRHeadCount: 37,
      availableSSRHeadHeroCount: 37, eligibleHeadHeroCount: 37, effectiveN: 12,
      recentGenerationWindow: [10, 11, 12], heroCountByTroop: { shield: 13, lancer: 12, marksman: 12 },
      finalLegalHeadCount: 1062, warning: null });
    for (const key of ["serverUnlockedS12HeroIds", "ownedS12HeroIds", "optimizationEnabledS12HeroIds", "eligibleS12HeadHeroIds"] as const)
      expect(audit[key]).toEqual(expect.arrayContaining(s12));
    expect(generateAllHeadFormations(initialized, emptyBody)).toHaveLength(audit.finalLegalHeadCount);
    expect(toEngineScenario(initialized)).toEqual(toEngineScenario(direct));
  });
  it("C/D: n12 needs at least one S10/11/12, and does not require S12", () => {
    const input = fixture();
    expect(optimizerRecentHeadEligible(input, { shield: "hero.s1.nataliya", lancer: "hero.s3.miya", marksman: "hero.s7.bradley" })).toBe(false);
    expect(optimizerRecentHeadEligible(input, { shield: "hero.s10.gregory", lancer: "hero.s3.miya", marksman: "hero.s7.bradley" })).toBe(true);
  });
  it("freezing a new benchmark preserves the actual eligible pool, including uninitialized new heroes", () => {
    const old = initializeOptimizationHeroPool({ ...fixture(), serverStage: "s11" });
    const current = { ...old, serverStage: "s12" as const };
    const frozen = freezeOptimizerBenchmarkFixture(current, defaultOptimizationConfig(current.randomSeed));
    expect(optimizationHeroIds(frozen.input)).toEqual(optimizationHeroIds(current));
    expect(createHeadPoolAudit(frozen.input, emptyBody).finalLegalHeadCount).toBe(1062);
    expect(toEngineScenario(frozen.input)).toEqual(toEngineScenario(current));
  });
  it("E: preserves true ownership at S11 on an S12 server and explains all three rejections", () => {
    const owned = serverHeroIds({ ...fixture(), serverStage: "s11" });
    const input = upgrade({ ...fixture(), ownedHeroIds: owned });
    const audit = createHeadPoolAudit(input, emptyBody);
    expect(audit).toMatchObject({ availableSSRHeadHeroCount: 34, effectiveN: 11,
      recentGenerationWindow: [9, 10, 11], eligibleS12HeadHeroIds: [], finalLegalHeadCount: 876,
      warning: "S12 server stage but no S12 SSR is eligible for Head optimization" });
    for (const heroId of s12) expect(audit.rejectedHeadHeroes).toContainEqual({ heroId, generation: 12, reason: "notOwned" });
    expect(input.ownedHeroIds).toEqual(owned);
  });
  it("F/G: excludes every R/SR Head while leaving supported R/SR Body sources untouched", () => {
    const input = initializeOptimizationHeroPool(fixture());
    const nonS = getValidationCatalog().leaderHeroes.filter((hero) => heroCategory(hero) !== "S");
    for (const hero of nonS) expect(optimizationHeroIds(input)).not.toContain(hero.heroId);
    const domain = generateBodyEnumerationDomain(input, {}, {});
    const supported = getValidationCatalog().memberSkills.flatMap((group) => group.sourceHeroIds)
      .filter((id) => nonS.some((hero) => hero.heroId === id) && serverHeroIds(input).includes(id));
    expect(supported.length).toBeGreaterThan(0);
    for (const id of supported) expect(domain.sources.map((source) => source.heroId)).toContain(id);
  });
  it("H: restores old S11 localStorage, then expands the implicit all-available pool at S12", () => {
    const old = initializeOptimizationHeroPool({ ...fixture(), serverStage: "s11" });
    const restored = restorePersistedConfig(JSON.parse(JSON.stringify(createPersistedEnvelope(old, 1000)))).input;
    const next = upgrade(restored);
    expect(heroOwnershipScope(next)).toBe("allAvailable");
    expect(createHeadPoolAudit(next).eligibleS12HeadHeroIds).toEqual(expect.arrayContaining(s12));
    expect(optimizationHeroIds(restored)).toHaveLength(34);
  });
  it("H/I: migrates a legacy S11 available list using only current canonical selected S12 leaders", () => {
    const base = fixture(), ids = serverHeroIds({ ...base, serverStage: "s11" });
    const source = { ...base, availableHeroIds: ids,
      sideA: { ...base.sideA, leaderHeroIds: { shield: s12[0]!, lancer: s12[1]!, marksman: s12[2]! } } };
    const before = toEngineScenario(source);
    const restored = restorePersistedConfig(createPersistedEnvelope(source, 1000));
    expect(restored.adjusted).toBe(true);
    expect(restored.headPoolOwnershipMigrated).toBe(true);
    expect(ownedHeroIds(restored.input)).toEqual(expect.arrayContaining(s12));
    expect(createHeadPoolAudit(restored.input).canonicalSelectedHeroesExcluded).toEqual([]);
    expect(toEngineScenario(restored.input)).toEqual(before);
    expect(reconcileLegacyHeroOwnership(restored.input)).toBe(restored.input);
    const onlyOne = reconcileLegacyHeroOwnership({ ...source, sideA: { ...base.sideA, leaderHeroIds: { shield: s12[0]! } } });
    expect(ownedHeroIds(onlyOne)).toContain(s12[0]);
    expect(ownedHeroIds(onlyOne)).not.toContain(s12[1]);
    expect(ownedHeroIds(onlyOne)).not.toContain(s12[2]);
  });
  it("I: never silently overrides explicit ownership or participation exclusions for selected leaders", () => {
    const base = fixture(), selected = { ...base, ownedHeroIds: ["hero.s11.eleonora"],
      sideA: { ...base.sideA, leaderHeroIds: { shield: s12[0]! } } };
    expect(reconcileLegacyHeroOwnership(selected)).toBe(selected);
    expect(createHeadPoolAudit(selected).canonicalSelectedHeroesExcluded).toContainEqual({ heroId: s12[0], generation: 12, reason: "notOwned" });
    const disabled = setOptimizationPoolEnabled(initializeOptimizationHeroPool(base), "A", false, s12[0]);
    const changed = upgrade(disabled);
    expect(changed.optimizerHeroPool!.A![s12[0]!]).toEqual(disabled.optimizerHeroPool!.A![s12[0]!]);
    expect(createHeadPoolAudit(changed).rejectedHeadHeroes).toContainEqual({ heroId: s12[0], generation: 12, reason: "optimizationDisabled" });
    expect(optimizationHeroIds(changed, "B")).toContain(s12[0]);
  });
  it("preserves future-stage toggles and weapons when switching S12 → S11 → S12", () => {
    let source = initializeOptimizationHeroPool(fixture());
    source = { ...source, optimizerHeroPool: { ...source.optimizerHeroPool,
      A: { ...source.optimizerHeroPool!.A, [s12[1]!]: { enabled: true, weaponLevel: 6 } } } };
    source = setOptimizationPoolEnabled(source, "A", false, s12[2]);
    const returned = upgrade(initializeOptimizationHeroPool(sanitizeConfigForStage(source, "s11").input));
    for (const id of s12) expect(returned.optimizerHeroPool!.A![id]).toEqual(source.optimizerHeroPool!.A![id]);
  });
  it("keeps n8 / S1-S2 policy, and uses actual enabled ownership rather than the stage", () => {
    const owned = getValidationCatalog().leaderHeroes.filter((hero) => (hero.generation ?? 0) <= 8).map((hero) => hero.heroId);
    expect(recentGenerations(optimizerGeneration({ ...fixture(), ownedHeroIds: owned }))).toEqual([6, 7, 8]);
    for (const serverStage of ["s1_t10", "s2_t10"] as const) {
      const stage = sanitizeConfigForStage(fixture(), serverStage).input;
      const input = { ...stage, sideA: { ...stage.sideA, leaderHeroIds: Object.fromEntries(
        (["shield", "lancer", "marksman"] as const).map((troop) => [troop, getValidationCatalog().leaderHeroes.find((hero) => hero.generation === 1 && hero.troopType === troop)!.heroId])) } };
      const audit = headFormationGenerationAudit(input, emptyBody);
      expect(audit.allLegalHeadCount).toBeGreaterThan(1);
      expect(audit.rejectedByRecentGenerationCount).toBe(0);
    }
    const restricted = setHeroOwnershipScope(fixture(), "owned");
    const unowned = setOwnedHero(restricted, s12[0]!, false);
    expect(ownedHeroIds(upgrade(unowned))).not.toContain(s12[0]);
  });
});
