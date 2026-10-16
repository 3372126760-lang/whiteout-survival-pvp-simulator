import { getValidationCatalog, validationStageId, type ValidationBattleInput } from "../validationUi";
import { heroSGeneration } from "../validationUi/heroCategory";
import { configuredHeadHeroIds, heroOwnershipScope, optimizationHeroIds, ownedHeroIds,
  ownedOptimizationHeroIds, serverHeroIds, optimizerHeadHeroAllowed } from "./heroPools";
import { headFormationGenerationAudit, headHeroPoolAudit } from "./candidateGenerator";
import { optimizerGeneration, recentGenerations } from "./heroSearchPolicy";
import type { SearchConstraint } from "./types";
import { TROOP_TYPES, type SideId } from "../types";
import { resolveSearchDimensions } from "./searchDimensions";

const catalog = getValidationCatalog().leaderHeroes;
const byId = new Map(catalog.map((hero) => [hero.heroId, hero]));
const maxGeneration = (ids: readonly string[]) => Math.max(0, ...ids.map((id) => heroSGeneration(byId.get(id)!) ?? 0));

/** Read-only H0 inspection. No J/criterion/theory evaluations or formal battles. */
export function createHeadPoolAudit(input: ValidationBattleInput, constraints: SearchConstraint = {}, side: SideId = "A") {
  const server = serverHeroIds(input), owned = ownedHeroIds(input), enabled = optimizationHeroIds(input, side);
  const headAudit = headHeroPoolAudit(input, constraints, undefined, side);
  const eligible = headAudit.optimizerHeroPoolAfterFilter.map((hero) => hero.heroId);
  const rejectedHeadHeroes = catalog.flatMap((hero) => {
    const id = hero.heroId;
    const reason = !server.includes(id) ? "serverStageNotUnlocked" :
      !owned.includes(id) ? "notOwned" :
      !optimizerHeadHeroAllowed(hero, maxGeneration(server)) ? "headRarityRule" :
      !enabled.includes(id) ? "optimizationDisabled" :
      constraints.forbiddenHeroIds?.includes(id) ? "forbiddenHero" :
      constraints.heroPoolIds !== undefined && !constraints.heroPoolIds.includes(id) ? "searchHeroPool" :
      constraints.minGeneration !== undefined && (hero.generation ?? 0) < constraints.minGeneration ? "minimumGeneration" :
      !(constraints.allowedPositions?.[id]?.includes("leader") ?? true) ? "leaderPositionNotAllowed" :
      constraints.fixedLeaders?.[hero.troopType] !== undefined && constraints.fixedLeaders[hero.troopType] !== id ? "differentFixedLeader" :
      !eligible.includes(id) ? "strictDominance" : undefined;
    return reason === undefined ? [] : [{ heroId: id, generation: heroSGeneration(hero) ?? null, reason }];
  });
  const s12 = (ids: readonly string[]) => ids.filter((id) => heroSGeneration(byId.get(id)!) === 12);
  const effectiveN = optimizerGeneration(input, side);
  const h0 = headFormationGenerationAudit(input, constraints, undefined, side);
  const dimensions = resolveSearchDimensions(input, { side,
    fixedHead: TROOP_TYPES.every((troop) => constraints.fixedLeaders?.[troop] !== undefined) });
  const warning = validationStageId(input) === "s12" && s12(eligible).length === 0
    ? "S12 server stage but no S12 SSR is eligible for Head optimization" : null;
  const canonicalSelectedHeroesExcluded = configuredHeadHeroIds(input).flatMap((id) => {
    const rejection = rejectedHeadHeroes.find((hero) => hero.heroId === id);
    return rejection === undefined ? [] : [rejection];
  });
  return {
    serverStage: validationStageId(input), side, ownershipMode: heroOwnershipScope(input),
    serverUnlockedHeroCount: server.length, serverUnlockedSSRHeadCount: server.filter((id) => optimizerHeadHeroAllowed(byId.get(id)!, 0)).length,
    ownedHeroCount: owned.length, availableSSRHeadHeroCount: ownedOptimizationHeroIds(input).length,
    optimizationEnabledHeroCount: enabled.length, eligibleHeadHeroCount: eligible.length,
    maxServerGeneration: maxGeneration(server), maxOwnedGeneration: maxGeneration(owned),
    maxOptimizationGeneration: maxGeneration(enabled), effectiveN,
    serverUnlockedS12HeroIds: s12(server), ownedS12HeroIds: s12(owned),
    optimizationEnabledS12HeroIds: s12(enabled), eligibleS12HeadHeroIds: s12(eligible),
    rejectedHeadHeroes, canonicalSelectedHeroesExcluded, warning,
    recentGenerationWindow: effectiveN < 3 ? [] : recentGenerations(effectiveN),
    heroCountByTroop: headAudit.counts.afterDominance,
    headSearchEnabled: dimensions.headSearchEnabled, headFixedReason: dimensions.headFixedReason,
    h0, finalLegalHeadCount: h0.recentEligibleHeadCount,
  };
}
