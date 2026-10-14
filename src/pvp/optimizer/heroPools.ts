import { getValidationCatalog, validationStageId, type ValidationBattleInput } from "../validationUi";
import { getServerStage, isHeroAvailableAtStage } from "../progression";
import { TROOP_TYPES, type SideId, type TroopType } from "../types";
import { heroCategory, heroSGeneration, heroRegistryCategoryCounts, type HeroCategorySource } from "../validationUi/heroCategory";

const catalog = getValidationCatalog();
const heroById = new Map(catalog.leaderHeroes.map((hero) => [hero.heroId, hero]));

/** Head search policy only. Registry, manual formations and teammate body pools stay intact. */
export function optimizerHeadHeroAllowed(hero: HeroCategorySource, serverGeneration: number): boolean {
  return serverGeneration < 3 || heroCategory(hero) === "S";
}
export function optimizerServerGeneration(input: ValidationBattleInput): number {
  return getServerStage(validationStageId(input)).maxHeroGeneration;
}
export function serverHeroIds(input: ValidationBattleInput): string[] {
  return catalog.leaderHeroes.filter((hero) => isHeroAvailableAtStage(hero, validationStageId(input))).map((hero) => hero.heroId);
}
export function ownedHeroIds(input: ValidationBattleInput): string[] {
  const owned = input.ownedHeroIds ?? input.availableHeroIds ?? serverHeroIds(input);
  return serverHeroIds(input).filter((id) => owned.includes(id));
}
/** UI, owned range and enabled candidates all use the same server-stage Head filter. */
export function visibleOptimizationHeroIds(input: ValidationBattleInput): string[] {
  const generation = optimizerServerGeneration(input);
  return serverHeroIds(input).filter((id) => optimizerHeadHeroAllowed(heroById.get(id)!, generation));
}
export function ownedOptimizationHeroIds(input: ValidationBattleInput): string[] {
  const generation = optimizerServerGeneration(input);
  return ownedHeroIds(input).filter((id) => optimizerHeadHeroAllowed(heroById.get(id)!, generation));
}
function enabledOwnedHeroIds(input: ValidationBattleInput, side: SideId): string[] {
  const pool = input.optimizerHeroPool?.[side];
  return ownedHeroIds(input).filter((id) => {
    const entry = pool?.[id];
    if (entry !== undefined) return entry.enabled;
    const legacyEnabled = input.availableHeroIds === undefined || input.availableHeroIds.includes(id);
    // Hidden R/SR entries are intentionally not materialized by pool initialization.
    // Preserve their legacy enabled status in the pre-filter audit so initialization
    // cannot erase the reason/count of a server-stage exclusion. The Head filter
    // below still rejects them; missing visible S entries remain disabled.
    return legacyEnabled && (pool === undefined ||
      !optimizerHeadHeroAllowed(heroById.get(id)!, optimizerServerGeneration(input)));
  });
}
export function optimizationHeroIds(input: ValidationBattleInput, side: SideId = "A"): string[] {
  const generation = optimizerServerGeneration(input);
  return enabledOwnedHeroIds(input, side).filter((id) => optimizerHeadHeroAllowed(heroById.get(id)!, generation));
}
export function optimizationHeroPoolFilterAudit(input: ValidationBattleInput, side: SideId = "A") {
  const before = enabledOwnedHeroIds(input, side).map((id) => heroById.get(id)!);
  const serverGeneration = optimizerServerGeneration(input);
  const after = before.filter((hero) => optimizerHeadHeroAllowed(hero, serverGeneration));
  const byTroop = Object.fromEntries(TROOP_TYPES.map((troop) =>
    [troop, after.filter((hero) => hero.troopType === troop).length])) as Record<TroopType, number>;
  const byGeneration: Record<string, number> = {};
  for (const hero of after) {
    const value = heroSGeneration(hero);if (value === undefined) continue;
    const generation = String(value);
    byGeneration[generation] = (byGeneration[generation] ?? 0) + 1;
  }
  const maxEnabledSGeneration = Math.max(0, ...after.map((hero) => heroSGeneration(hero) ?? 0));
  const minimum = Math.max(1, maxEnabledSGeneration - 2);
  const inRecent = (hero: HeroCategorySource) => {
    const generation = heroSGeneration(hero);
    return generation !== undefined && generation >= minimum && generation <= maxEnabledSGeneration;
  };
  const allLegalHeadCountBeforeRecentRule = TROOP_TYPES.reduce((product, troop) => product * byTroop[troop], 1);
  const oldHeads = TROOP_TYPES.reduce((product, troop) => product * after.filter((hero) => hero.troopType === troop && !inRecent(hero)).length, 1);
  const excludedRByServerStage = before.filter((hero) => serverGeneration >= 3 && heroCategory(hero) === "R").length;
  const excludedSRByServerStage = before.filter((hero) => serverGeneration >= 3 && heroCategory(hero) === "SR").length;
  return {
    serverGeneration,
    // These category counts describe the stage-available registry. Exclusions and
    // candidate counts below describe the enabled owned pool, not hidden UI options.
    ...heroRegistryCategoryCounts(serverHeroIds(input).map((id) => heroById.get(id)!)),
    enabledPoolCategoryCounts: heroRegistryCategoryCounts(before),
    registryCategoryCounts: heroRegistryCategoryCounts(catalog.leaderHeroes),
    excludedRByServerStage, excludedSRByServerStage,
    optimizerHeadHeroCount: after.length,
    sHeroCountByGeneration: byGeneration,
    heroCountByTroopTypeAfterHeadFilter: byTroop,
    maxEnabledSGeneration,
    recentSGenerationWindow: [minimum, maxEnabledSGeneration] as const,
    recentEligibleHeadCount: allLegalHeadCountBeforeRecentRule - oldHeads,
    rawHeadRatioCount: (allLegalHeadCountBeforeRecentRule - oldHeads) * 231,
    optimizationPoolVisibleHeroCount: after.length,
    // Compatibility aliases for consumers of earlier audit JSON.
    excludedPostGen3RCount: excludedRByServerStage,
    excludedPostGen3SRCount: excludedSRByServerStage,
    heroCountByTroopTypeAfterRarityFilter: byTroop,
    heroCountByGenerationAfterRarityFilter: byGeneration,
    allLegalHeadCountBeforeRecentRule,
  };
}
export function optimizerWeaponLevel(input: ValidationBattleInput, heroId: string, side: SideId = "A"): number | null {
  const hero = catalog.leaderHeroes.find((row) => row.heroId === heroId);
  if (!hero || hero.weaponMaxStat === null) return null;
  return input.optimizerHeroPool?.[side]?.[heroId]?.weaponLevel ?? 10;
}
export function optimizerHeadWeaponLevels(input: ValidationBattleInput,
  head: Readonly<Partial<Record<TroopType, string | null>>>, side: SideId = "A"): Record<string, number> {
  return Object.fromEntries(TROOP_TYPES.flatMap((troop) => {
    const id = head[troop]; if (!id) return [];
    const level = optimizerWeaponLevel(input, id, side); return level === null ? [] : [[id, level]];
  }));
}
export function initializeOptimizationHeroPool(input: ValidationBattleInput): ValidationBattleInput {
  const ids = ownedOptimizationHeroIds(input);
  const owned = new Set(input.ownedHeroIds ?? input.availableHeroIds ?? serverHeroIds(input));
  const pool = { ...input.optimizerHeroPool };
  let changed = false;
  for (const side of ["A", "B"] as const) {
    const existing = pool[side] ?? {}, next = { ...existing };
    for (const [id, entry] of Object.entries(next)) if (!owned.has(id) && entry.enabled) {
      next[id] = { ...entry, enabled: false };
      changed = true;
    }
    for (const id of ids) if (next[id] === undefined) {
      next[id] = { enabled: input.availableHeroIds === undefined || input.availableHeroIds.includes(id),
        weaponLevel: catalog.leaderHeroes.find((hero) => hero.heroId === id)?.weaponMaxStat === null ? null : 10 };
      changed = true;
    }
    pool[side] = next;
  }
  return changed ? { ...input, optimizerHeroPool: pool } : input;
}
export function setOptimizationPoolEnabled(input: ValidationBattleInput, side: SideId,
  enabled: boolean, heroId?: string): ValidationBattleInput {
  const initialized = initializeOptimizationHeroPool(input), pool = { ...initialized.optimizerHeroPool?.[side] };
  if (!enabled && heroId === undefined) for (const [id, entry] of Object.entries(pool))
    pool[id] = { ...entry, enabled: false };
  for (const id of ownedOptimizationHeroIds(initialized)) if (heroId === undefined || id === heroId)
    pool[id] = { ...pool[id]!, enabled };
  return { ...initialized, optimizerHeroPool: { ...initialized.optimizerHeroPool, [side]: pool } };
}

/** Long-term ownership is edited independently of this run's enabled flags. */
export function setOwnedHero(input: ValidationBattleInput, heroId: string,
  owned: boolean): ValidationBattleInput {
  if (!serverHeroIds(input).includes(heroId)) throw new Error("当前阶段没有此英雄。");
  const ids = new Set(input.ownedHeroIds ?? input.availableHeroIds ?? serverHeroIds(input));
  if (owned) ids.add(heroId); else ids.delete(heroId);
  return initializeOptimizationHeroPool({ ...input, ownedHeroIds: [...ids] });
}
export function optimizerPoolAudit(input: ValidationBattleInput, side: SideId = "A") {
  const enabled = new Set(optimizationHeroIds(input, side));
  return ownedOptimizationHeroIds(input).map((heroDefinitionId) => ({ heroDefinitionId, enabled: enabled.has(heroDefinitionId),
    optimizerWeaponLevel: optimizerWeaponLevel(input, heroDefinitionId, side), weaponLevelSource: "optimizerHeroPool" as const }));
}
