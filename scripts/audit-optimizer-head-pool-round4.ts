import { writeFileSync } from "node:fs";
import { createDefaultValidationInput } from "../src/ui/defaultInput";
import { getValidationCatalog, heroCategory, heroCategoryLabel, heroSGeneration, heroRegistryCategoryCounts,
  type ValidationBattleInput } from "../src/pvp/validationUi";
import { optimizationHeroIds, optimizationHeroPoolFilterAudit, optimizerHeadHeroAllowed,
  optimizerServerGeneration, serverHeroIds } from "../src/pvp/optimizer/heroPools";
import { TROOP_TYPES } from "../src/pvp/types";

const catalog = getValidationCatalog(), base = createDefaultValidationInput();
function describe(input: ValidationBattleInput) {
  const allowed = new Set(optimizationHeroIds(input));
  const server = new Set(serverHeroIds(input));
  const stageHeroes = catalog.leaderHeroes.filter((hero) => server.has(hero.heroId));
  return {
    ...optimizationHeroPoolFilterAudit(input),
    selectedHeadHeroIds: catalog.leaderHeroes.filter((hero) => allowed.has(hero.heroId)).map((hero) => hero.heroId),
    excludedHeroes: stageHeroes.filter((hero) => !optimizerHeadHeroAllowed(hero, optimizerServerGeneration(input))).map((hero) => ({
      heroId: hero.heroId, name: hero.name, category: heroCategory(hero), categoryLabel: heroCategoryLabel(hero),
      ...(heroSGeneration(hero) === undefined ? {} : { sGeneration: heroSGeneration(hero) }), troopType: hero.troopType,
    })),
  };
}
const oldLargeSsrIds = TROOP_TYPES.flatMap((troop) => catalog.leaderHeroes
  .filter((hero) => hero.troopType === troop && hero.category === "S")
  .sort((a, b) => (heroSGeneration(b) ?? 0) - (heroSGeneration(a) ?? 0))
  .slice(0, troop === "shield" ? 15 : 16).map((hero) => hero.heroId));
const enabledUntilS8 = catalog.leaderHeroes.filter((hero) => hero.category !== "S" || (heroSGeneration(hero) ?? 0) <= 8).map((hero) => hero.heroId);
const report = {
  recordedAt: new Date().toISOString(),
  rule: "R/SR have no S generation; server S3+ excludes all R/SR from optimizer HEAD only. Recent window uses enabled owned stage-legal S heroes.",
  ratioScan: { stepPercent: 5, unrestrictedRatioCount: 231 },
  globalRegistry: heroRegistryCategoryCounts(catalog.leaderHeroes),
  defaultUi: describe(base),
  allCatalogS2: describe({ ...base, serverStage: "s2_fc3" }),
  allCatalogS3: describe({ ...base, serverStage: "s3_fc3" }),
  allCatalogS11: describe({ ...base, serverStage: "s11" }),
  allCatalogS16: describe({ ...base, serverStage: "s16" }),
  serverS11EnabledThroughS8: describe({ ...base, ownedHeroIds: enabledUntilS8, availableHeroIds: enabledUntilS8 }),
  oldLargeSsrFixture: describe({ ...base, serverStage: "s16", ownedHeroIds: oldLargeSsrIds, availableHeroIds: oldLargeSsrIds }),
  preservedManualAndBodyCategories: {
    manualRegistryRCount: catalog.leaderHeroes.filter((hero) => hero.category === "R").length,
    manualRegistrySRCount: catalog.leaderHeroes.filter((hero) => hero.category === "SR").length,
    bodySRHeroIds: catalog.memberSkills.flatMap((skill) => skill.sourceHeroIds).filter((id, index, ids) =>
      ids.indexOf(id) === index && catalog.leaderHeroes.some((hero) => hero.heroId === id && hero.category === "SR")),
  },
  countScope: "Unrestricted unique complete shield/lancer/marksman heads, before fixed locks or baselines. No measured user config JSON was supplied; default UI and prior SSR fixture are separate audits.",
};
writeFileSync("examples/criterion-round4-head-pool-audit.json", JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify({
  globalRegistry: report.globalRegistry,
  scenarios: Object.fromEntries(Object.entries(report).filter(([key]) => key.startsWith("allCatalog") || key === "defaultUi" || key === "oldLargeSsrFixture" || key === "serverS11EnabledThroughS8")
    .map(([key, value]) => { const row = value as ReturnType<typeof describe>; return [key, {
      serverGeneration: row.serverGeneration, excludedRByServerStage: row.excludedRByServerStage,
      excludedSRByServerStage: row.excludedSRByServerStage, optimizerHeadHeroCount: row.optimizerHeadHeroCount,
      heroCountByTroopTypeAfterHeadFilter: row.heroCountByTroopTypeAfterHeadFilter,
      allLegalHeadCountBeforeRecentRule: row.allLegalHeadCountBeforeRecentRule,
      maxEnabledSGeneration: row.maxEnabledSGeneration, recentSGenerationWindow: row.recentSGenerationWindow,
      recentEligibleHeadCount: row.recentEligibleHeadCount, rawHeadRatioCount: row.rawHeadRatioCount,
    }]; })),
}, null, 2));
