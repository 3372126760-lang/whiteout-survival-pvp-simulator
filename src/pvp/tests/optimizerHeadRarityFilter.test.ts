import { describe, expect, it } from "vitest";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { EXPEDITION_HERO_DATA } from "../heroSkills";
import { getValidationCatalog, createValidationPreviewState, heroCategory, heroCategoryLabel,
  heroCategoryMetadata, heroSGeneration, heroRegistryCategoryCounts } from "../validationUi";
import { generateAllHeadFormations, generateBodyFormations } from "../optimizer/candidateGenerator";
import { generateScenarioHeroFormations } from "../optimizer/scenarioOptimizer";
import { buildHeroPoolAudit, optimizerGeneration, optimizerRecentHeadEligible, satisfiesRecentGeneration } from "../optimizer/heroSearchPolicy";
import { initializeOptimizationHeroPool, optimizationHeroIds, optimizationHeroPoolFilterAudit,
  optimizerHeadHeroAllowed, ownedHeroIds, ownedOptimizationHeroIds, serverHeroIds,
  setOptimizationPoolEnabled, visibleOptimizationHeroIds } from "../optimizer/heroPools";
import type { ServerStageId } from "../progression";

const catalog = getValidationCatalog();
const inputFor = (ids?: readonly string[], serverStage: ServerStageId = "s11") => ({
  ...createDefaultValidationInput(), serverStage, attributeInputMode: "prediction" as const,
  sideA: { ...createDefaultValidationInput().sideA, leaderHeroIds: { shield: "hero.s1.nataliya" } },
  ...(ids === undefined ? {} : { ownedHeroIds: ids, availableHeroIds: ids }),
});
const baseR = "hero.r.youjin", baseSr = "hero.body.shuyun";

describe("hero category and server-stage head boundary", () => {
  it("gives R/SR no S generation even if legacy metadata claims one", () => {
    for (const rarity of ["R", "SR"] as const) {
      const legacy = { rarity, generation: 16, sGeneration: 11 };
      expect(heroCategory(legacy)).toBe(rarity);
      expect(heroSGeneration(legacy)).toBeUndefined();
      expect(heroCategoryMetadata(legacy)).toEqual({ category: rarity });
      expect(heroCategoryLabel(legacy)).toBe(rarity);
      expect(satisfiesRecentGeneration({ shield: "legacy" }, 11,
        [{ ...legacy, heroId: "legacy", troopType: "shield" }])).toBe(false);
    }
    expect(heroCategoryMetadata({ rarity: "SSR", generation: 11 })).toEqual({ category: "S", sGeneration: 11 });
    expect(heroCategoryLabel({ rarity: "SSR", generation: 11 })).toBe("S11");
    for (const hero of catalog.leaderHeroes) {
      if (hero.category === "S") expect(hero.sGeneration).toBe(hero.generation);
      else { expect(hero.generation).toBeNull(); expect(hero.sGeneration).toBeUndefined(); }
    }
  });
  it("excludes R/SR at every generation without removing manual heroes", () => {
    for (const rarity of ["R", "SR"] as const) {
      for (const generation of [null, 1, 3, 11, 16]) {
        expect(optimizerHeadHeroAllowed({ rarity, generation }, 2)).toBe(false);
        expect(optimizerHeadHeroAllowed({ rarity, generation }, 3)).toBe(false);
        expect(optimizerHeadHeroAllowed({ rarity, generation }, 11)).toBe(false);
      }
    }
    expect(optimizerHeadHeroAllowed({ rarity: "SSR", generation: 1 }, 11)).toBe(true);
    for (const stage of ["s2_fc3", "s3_fc3", "s11"] as const) {
      const input = inputFor(undefined, stage), allowed = false;
      for (const id of [baseR, baseSr]) {
        expect(visibleOptimizationHeroIds(input).includes(id)).toBe(allowed);
        expect(ownedOptimizationHeroIds(input).includes(id)).toBe(allowed);
        expect(optimizationHeroIds(input).includes(id)).toBe(allowed);
      }
    }
  });
  it("preserves registry, manual R/SR formations and the independent SR body pool", () => {
    const input = inputFor([baseR, baseSr, "hero.s11.eleonora"]);
    for (const id of [baseR, baseSr]) {
      expect(serverHeroIds(input)).toContain(id); expect(ownedHeroIds(input)).toContain(id);
      expect(EXPEDITION_HERO_DATA.find((hero) => hero.id === id)).toBeDefined();
      expect(catalog.leaderHeroes.find((hero) => hero.heroId === id)).toBeDefined();
      expect(optimizationHeroIds(input)).not.toContain(id);
    }
    const manual = { ...input, sideA: { ...input.sideA, leaderHeroIds: {
      shield: baseR, lancer: "hero.sr.patelike", marksman: baseSr,
    } } };
    expect(createValidationPreviewState(manual).sideA.heroStates.map((hero) => hero.heroId))
      .toEqual(expect.arrayContaining([baseR, "hero.sr.patelike", baseSr]));
    const bodies = generateBodyFormations({ ...input, scenarioType: "RALLY", battleContext: "rally",
      rallyBodyPoolIds: [baseSr, "hero.s5.nuola"] }, {}, input.sideA.leaderHeroIds!);
    expect(bodies).toHaveLength(6);
    expect(bodies.every((body) => body.memberSkillIds.filter((id) => id === "hero-skill.shuyun.attack").length === 2)).toBe(true);
  });
  it("derives recent S6–S8 from enabled owned legal S heroes and filters Rally/Single heads", () => {
    const ids = [baseR, baseSr, "hero.s1.nataliya", "hero.s3.miya", "hero.s8.hengdelike", "hero.s11.rufus", "hero.s16.hank"];
    let input = initializeOptimizationHeroPool(inputFor(ids));
    input = setOptimizationPoolEnabled(input, "A", false, "hero.s11.rufus");
    expect(optimizerGeneration(input)).toBe(8); expect(optimizerGeneration(input, "B")).toBe(11);
    expect(optimizationHeroIds(input)).not.toContain("hero.s16.hank");
    const rally = generateAllHeadFormations(input, { fixedBodyExact: true, fixedMemberSkillIds: [] });
    const simple = generateScenarioHeroFormations(input, "A", false);
    expect(rally).toHaveLength(1); expect(simple).toHaveLength(1);
    for (const head of [...rally.map((row) => row.leaderHeroIds), ...simple]) {
      expect(Object.values(head).every((id) => id === null || optimizationHeroIds(input).includes(id!))).toBe(true);
      expect(optimizerRecentHeadEligible(input, head)).toBe(true);
    }
    expect(optimizerRecentHeadEligible(input, { shield: "hero.s1.nataliya", lancer: "hero.s3.miya", marksman: baseSr })).toBe(false);
    const audit = buildHeroPoolAudit(input, catalog.leaderHeroes.filter((hero) => ids.includes(hero.heroId) && hero.heroId !== "hero.s16.hank"));
    expect(audit).toMatchObject({ effectiveSearchGeneration: 8, recentGenerationConstraint: [6, 7, 8],
      optimizerHeadHeroCount: 3, excludedRByServerStage: 1, excludedSRByServerStage: 1,
      heroCountByTroopTypeAfterHeadFilter: { shield: 1, lancer: 1, marksman: 1 },
      sHeroCountByGeneration: { 1: 1, 3: 1, 8: 1 }, maxEnabledSGeneration: 8,
      recentSGenerationWindow: [6, 8], allLegalHeadCountBeforeRecentRule: 1 });
    expect([...audit.rarityFilteredHeroes].sort()).toEqual([baseR, baseSr].sort());
    expect(audit.sHeroCountByGeneration).not.toHaveProperty("0");
  });
  it("audits dynamic S2/S3/S11 counts and uses only S generations for the recent window", () => {
    const registryCounts = heroRegistryCategoryCounts(catalog.leaderHeroes);
    expect(registryCounts).toEqual({ rHeroCount: 4, srHeroCount: 9, sHeroCount: 49 });
    for (const stage of ["s2_fc3", "s3_fc3", "s11"] as const) {
      const input = inputFor(undefined, stage), audit = optimizationHeroPoolFilterAudit(input);
      const enabled = catalog.leaderHeroes.filter((hero) => optimizationHeroIds(input).includes(hero.heroId));
      const all = ["shield", "lancer", "marksman"].reduce((product, troop) => product * enabled.filter((hero) => hero.troopType === troop).length, 1);
      const [minimum, maximum] = audit.recentSGenerationWindow;
      const old = ["shield", "lancer", "marksman"].reduce((product, troop) => product * enabled.filter((hero) => {
        const generation = heroSGeneration(hero);
        return hero.troopType === troop && (generation === undefined || generation < minimum || generation > maximum);
      }).length, 1);
      expect(audit.optimizerHeadHeroCount).toBe(enabled.length);
      expect(audit.allLegalHeadCountBeforeRecentRule).toBe(all);
      expect(audit.recentEligibleHeadCount).toBe(all - old);
      expect(audit.rawHeadRatioCount).toBe((all - old) * 231);
      expect(audit.registryCategoryCounts).toEqual(registryCounts);
      expect(generateAllHeadFormations(input, { fixedBodyExact: true, fixedMemberSkillIds: [] })).toHaveLength(all - old);
      expect(generateScenarioHeroFormations(input, "A", false)).toHaveLength(all - old);
    }
    const audit = optimizationHeroPoolFilterAudit(inputFor());
    expect(audit).toMatchObject({ serverGeneration: 11, rHeroCount: 4, srHeroCount: 9, sHeroCount: 34,
      excludedRByServerStage: 4, excludedSRByServerStage: 9, optimizerHeadHeroCount: 34,
      heroCountByTroopTypeAfterHeadFilter: { shield: 12, lancer: 11, marksman: 11 },
      maxEnabledSGeneration: 11, recentSGenerationWindow: [9, 11] });
  });
  it("does not add or enable excluded pool entries and does preserve them across stage changes", () => {
    let input = initializeOptimizationHeroPool(inputFor([baseR, baseSr, "hero.s11.eleonora"]));
    expect(input.optimizerHeroPool!.A![baseR]).toBeUndefined(); expect(input.optimizerHeroPool!.A![baseSr]).toBeUndefined();
    input = setOptimizationPoolEnabled(input, "A", true);
    expect(optimizationHeroIds(input)).toEqual(["hero.s11.eleonora"]);
    const early = initializeOptimizationHeroPool(inputFor([baseR, baseSr, "hero.s2.alongsuo"], "s2_fc3"));
    const later = initializeOptimizationHeroPool({ ...early, serverStage: "s11" });
    expect(later.optimizerHeroPool!.A![baseSr]).toEqual(early.optimizerHeroPool!.A![baseSr]);
    expect(optimizationHeroIds(later)).not.toContain(baseSr);
    expect(optimizationHeroIds({ ...later, serverStage: "s2_fc3" })).not.toContain(baseSr);
  });
});
