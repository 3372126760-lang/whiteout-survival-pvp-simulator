import { optimizerWeaponLevel, optimizerPoolAudit, optimizationHeroIds, optimizerHeadHeroAllowed,
  optimizationHeroPoolFilterAudit, optimizerServerGeneration } from "./heroPools";
import type { OptimizerProfiler } from "./profiling";
import { CONFIRMED_HERO_SKILL_DEFINITIONS, EXPEDITION_HERO_DATA, getExclusiveWeaponSkillTier, type HeroSkillDefinition } from "../heroSkills";
import { getServerStage } from "../progression";
import { getValidationCatalog, validationStageId, type ValidationBattleInput } from "../validationUi";
import { TROOP_TYPES, type SideId, type TroopType } from "../types";
import { heroSGeneration, type HeroCategorySource } from "../validationUi/heroCategory";

export interface OptimizerHeroMetadata extends HeroCategorySource {
  readonly heroId: string; readonly troopType: TroopType;
  readonly rarity: string; readonly generation?: number | null;
}
export type DominanceStatus = "strictlyDominated" | "likelyDominated" | "nonDominated";
export interface SignatureEffect { readonly semantic: string; readonly value: number; readonly probability: number; }
export interface HeroEffectSignature {
  readonly heroId: string; readonly troopType: TroopType; readonly conditions: string;
  readonly complete: boolean; readonly proofBarriers: readonly string[];
  readonly effects: readonly SignatureEffect[];
}
export interface DominanceRelation {
  readonly dominatedHero: string; readonly dominatingHero: string; readonly status: DominanceStatus;
  readonly reasons: readonly string[]; readonly comparedEffects: readonly { semantic: string; weaker: number; stronger: number }[];
}
export interface HeroPoolAudit extends ReturnType<typeof optimizationHeroPoolFilterAudit> {
  readonly serverGeneration: number;
  readonly effectiveSearchGeneration: number;
  readonly optimizerHeroPool: ReturnType<typeof optimizerPoolAudit>;
  readonly optimizerHeroPoolBeforeFilter: readonly OptimizerHeroMetadata[];
  readonly rarityFilteredHeroes: readonly string[];
  readonly recentGenerationConstraint: readonly number[];
  readonly preferredRecentWindow: readonly number[];
  readonly dominanceRelations: readonly DominanceRelation[];
  readonly heroClassifications: readonly { readonly heroId: string; readonly status: DominanceStatus; readonly reasons: readonly string[] }[];
  readonly optimizerHeroPoolAfterFilter: readonly OptimizerHeroMetadata[];
  readonly counts: { readonly before: Record<TroopType, number>; readonly afterRarity: Record<TroopType, number>;
    readonly afterDominance: Record<TroopType, number>; readonly originalCombinations: number;
    readonly afterRarityCombinations: number; readonly afterRecentCombinations: number; readonly legalCombinations: number };
  readonly exclusions: readonly { readonly heroId?: string; readonly count?: number;
    readonly exclusionReason: "rarityRule" | "recentGenerationRule" | "strictDominance" }[];
}
export function recentGenerations(n: number): readonly number[] {
  return Array.from({ length: Math.max(0, Math.min(3, n)) }, (_, i) => n - i).reverse();
}
export function satisfiesRecentGeneration(head: Readonly<Partial<Record<TroopType, string | null>>>, n: number,
  heroes: readonly OptimizerHeroMetadata[] = getValidationCatalog().leaderHeroes): boolean {
  const recent = recentGenerations(n);
  return TROOP_TYPES.some((troop) => {
    const hero = heroes.find((entry) => entry.heroId === head[troop]);
    const generation = hero === undefined ? undefined : heroSGeneration(hero);
    return generation !== undefined && recent.includes(generation);
  });
}
export function optimizerRarityAllowed(hero: HeroCategorySource, serverGeneration: number): boolean {
  return optimizerHeadHeroAllowed(hero, serverGeneration);
}
const safeKinds = new Set(["attributeModifier", "attributeReduction", "damageIncrease", "damageReduction",
  "outgoingDamageReduction", "incomingDamageIncrease", "defenseModifier", "defenseReduction"]);
/** Full formal definitions, including weapons. Unknown/nonlinear semantics block proof. */
export function deriveHeroEffectSignature(heroId: string, levels: Readonly<Record<string, number>> = {},
  definitions: readonly HeroSkillDefinition[] = CONFIRMED_HERO_SKILL_DEFINITIONS, weaponLevel = 10): HeroEffectSignature {
  const hero = EXPEDITION_HERO_DATA.find((entry) => entry.id === heroId);
  const skills = definitions.filter((skill) => skill.heroId === heroId);
  const barriers = new Set<string>();
  const complete = hero !== undefined && hero.expeditionSkills.filter((skill) => skill.combatRelevant)
    .every((skill) => skills.some((definition) => definition.id === skill.combatSkillDefinitionId));
  if (!complete || !skills.length) barriers.add("incomplete formal PVP skill coverage");
  const effects: SignatureEffect[] = [];
  for (const skill of skills) {
    if (skill.positionRule.kind === "exclusiveWeapon" && getExclusiveWeaponSkillTier(weaponLevel) === 0) continue;
    const level = skill.levelValues[skill.positionRule.kind === "exclusiveWeapon" ? getExclusiveWeaponSkillTier(weaponLevel) : levels[skill.id] ?? 5];
    if (level === undefined) { barriers.add("unknown configured level"); continue; }
    if (skill.metadata.ruleStatus !== "supported") barriers.add("unverified formal rule");
    if (skill.actionMechanic || skill.trigger !== "passive" || skill.triggerTiming ||
      level.periodRounds || skill.cooldownRounds || level.cooldownRounds) barriers.add("action/timing/control semantics");
    for (const effect of level.effects) {
      if (!safeKinds.has(effect.kind) || effect.scope.source !== "army" ||
        (effect.scope.target !== undefined && effect.scope.target !== "all") || effect.scope.incomingSourceTroop ||
        effect.lifecycle !== undefined) barriers.add("scope/lifecycle/nonlinear semantics");
      const beneficialRecipient = ["attributeReduction", "outgoingDamageReduction", "incomingDamageIncrease", "defenseReduction"].includes(effect.kind) ? "enemyArmy" : "selfArmy";
      if (effect.recipient !== beneficialRecipient) barriers.add("benefit direction / side effect not proven");
      const value = "value" in effect ? effect.value : 0;
      if (value < 0 || value >= 1 && effect.kind.includes("Reduction")) barriers.add("non-monotone value domain");
      // Groups, recipients, scopes, contexts, operations and all restrictions must match exactly.
      const { id: _id, name: _name, ...semanticEffect } = effect; void _id; void _name;
      const semantic = JSON.stringify({ ...semanticEffect, value: undefined,
        trigger: skill.trigger, timing: skill.triggerTiming, activation: skill.activationTiming,
        duration: level.durationRounds ?? skill.durationRounds, contexts: skill.battleContexts,
        position: skill.positionRule.kind, slot: skill.positionRule.expeditionSkillSlot });
      effects.push({ semantic, value, probability: level.probability ?? skill.probability ?? 1 });
    }
  }
  return { heroId, troopType: hero?.stats.troopType ?? "shield", complete, proofBarriers: [...barriers],
    // Require equal static data as well as equal weapon/external conditions; do not guess a safe rebase.
    conditions: JSON.stringify({ stats: hero?.stats, weapon: hero?.exclusiveWeapon, weaponLevel, levels }),
    effects: effects.sort((a, b) => a.semantic.localeCompare(b.semantic) || a.value - b.value) };
}
export function compareHeroDominance(a: HeroEffectSignature, b: HeroEffectSignature): DominanceRelation {
  const comparedEffects: { semantic: string; weaker: number; stronger: number }[] = [];
  const no = (reason: string): DominanceRelation => ({ dominatedHero: a.heroId, dominatingHero: b.heroId,
    status: "nonDominated", reasons: [reason], comparedEffects });
  if (a.troopType !== b.troopType) return no("different troop positions");
  if (!a.complete || !b.complete || a.effects.length !== b.effects.length || !a.effects.length)
    return no("all PVP effects must be covered, not just one equivalent skill");
  let strict = false;
  for (let i = 0; i < a.effects.length; i += 1) {
    const x = a.effects[i]!, y = b.effects[i]!;
    if (x.semantic !== y.semantic || y.value < x.value || y.probability < x.probability)
      return no("full semantic correspondence / monotone dimensions not established");
    comparedEffects.push({ semantic: x.semantic, weaker: x.value, stronger: y.value });
    strict ||= y.value > x.value || y.probability > x.probability;
  }
  if (!strict) return no("no strictly stronger dimension; generation is not evidence");
  const barriers = [...a.proofBarriers, ...b.proofBarriers];
  if (barriers.length) return no(`proof blocked: ${[...new Set(barriers)].join(", ")}`);
  if (a.conditions !== b.conditions) return { dominatedHero: a.heroId, dominatingHero: b.heroId,
    status: "likelyDominated", reasons: ["numeric effects match, but static / weapon conditions differ; retained"], comparedEffects };
  // A higher trigger probability for an overlapping refreshing effect is not a universal proof.
  if (a.effects.some((effect, i) => effect.probability !== b.effects[i]!.probability || effect.probability !== 1))
    return { dominatedHero: a.heroId, dominatingHero: b.heroId, status: "likelyDominated",
      reasons: ["probability distribution not pathwise proven; retained"], comparedEffects };
  return { dominatedHero: a.heroId, dominatingHero: b.heroId, status: "strictlyDominated",
    reasons: ["all deterministic passive positive effects correspond; equal scope/timing/groups/conditions; at least one strict value"], comparedEffects };
}
function computeHeroPoolAudit(input: ValidationBattleInput, heroes: readonly OptimizerHeroMetadata[], sideId: SideId, profiler?: OptimizerProfiler): HeroPoolAudit {
  const n = getServerStage(validationStageId(input)).maxHeroGeneration;
  profiler?.begin("英雄合法性 / 稀有度 / 代数过滤", heroes.length, heroes.length, false);
  const afterRarity = heroes.filter((hero) => optimizerHeadHeroAllowed(hero, n));
  const effectiveGeneration = optimizerGeneration(input, sideId);
  profiler?.end(false);
  profiler?.begin("严格支配检测", afterRarity.length, afterRarity.length, false);
  const side = sideId === "A" ? input.sideA : input.sideB;
  const signatures = afterRarity.map((hero) => deriveHeroEffectSignature(hero.heroId, side.leaderSkillLevels, CONFIRMED_HERO_SKILL_DEFINITIONS, optimizerWeaponLevel(input, hero.heroId, sideId) ?? 0));
  const recent = recentGenerations(effectiveGeneration);
  const relations: DominanceRelation[] = [];
  for (const a of signatures) for (const b of signatures) if (a.heroId !== b.heroId && a.troopType === b.troopType) {
    const relation = compareHeroDominance(a, b);
    if (relation.status !== "nonDominated") relations.push(relation);
  }
  // Only complete semantic dominance can remove an enabled owned hero.
  const removed = new Set(relations.filter((relation) => relation.status === "strictlyDominated")
    .map((relation) => relation.dominatedHero));
  const after = afterRarity.filter((hero) => !removed.has(hero.heroId));
  profiler?.end(false);
  const counts = (pool: readonly OptimizerHeroMetadata[]) => Object.fromEntries(TROOP_TYPES.map((troop) =>
    [troop, pool.filter((hero) => hero.troopType === troop).length])) as Record<TroopType, number>;
  const combinations = (pool: readonly OptimizerHeroMetadata[], recentOnly: boolean) => {
    const c = counts(pool), all = TROOP_TYPES.reduce((v, troop) => v * c[troop], 1);
    const old = counts(pool.filter((hero) => !recent.includes(heroSGeneration(hero) ?? -1)));
    return recentOnly ? all - TROOP_TYPES.reduce((v, troop) => v * old[troop], 1) : all;
  };
  const rarityFilteredHeroes = heroes.filter((hero) => !afterRarity.includes(hero)).map((hero) => hero.heroId);
  return { ...optimizationHeroPoolFilterAudit(input, sideId), serverGeneration: n, effectiveSearchGeneration: effectiveGeneration, optimizerHeroPool: optimizerPoolAudit(input, sideId), optimizerHeroPoolBeforeFilter: heroes, rarityFilteredHeroes,
    recentGenerationConstraint: recent, preferredRecentWindow: recent, dominanceRelations: relations,
    heroClassifications: signatures.map((signature) => {
      const relation = relations.find((entry) => entry.dominatedHero === signature.heroId && entry.status === "strictlyDominated") ??
        relations.find((entry) => entry.dominatedHero === signature.heroId);
      return { heroId: signature.heroId, status: relation?.status ?? "nonDominated",
        reasons: relation?.reasons ?? (signature.proofBarriers.length ? signature.proofBarriers : ["no complete dominating signature found"]) };
    }), optimizerHeroPoolAfterFilter: after,
    counts: { before: counts(heroes), afterRarity: counts(afterRarity), afterDominance: counts(after),
      originalCombinations: combinations(heroes, false), afterRarityCombinations: combinations(afterRarity, false),
      afterRecentCombinations: combinations(afterRarity, true), legalCombinations: combinations(after, true) },
    exclusions: [...rarityFilteredHeroes.map((heroId) => ({ heroId, exclusionReason: "rarityRule" as const })),
      ...(combinations(after, false) > combinations(after, true) ? [{ count: combinations(after, false) - combinations(after, true), exclusionReason: "recentGenerationRule" as const }] : []),
      ...[...removed].map((heroId) => ({ heroId, exclusionReason: "strictDominance" as const }))] };
}
const generationCache = new WeakMap<ValidationBattleInput, Map<SideId, number>>();
const catalogHeroesById = new Map(getValidationCatalog().leaderHeroes.map((hero) => [hero.heroId, hero]));
const generationByHero = new Map(getValidationCatalog().leaderHeroes.map((hero) => [hero.heroId, heroSGeneration(hero) ?? 0]));
export function optimizerGeneration(input: ValidationBattleInput, side: SideId = "A"): number {
  let cache = generationCache.get(input);
  if (!cache) { cache = new Map(); generationCache.set(input, cache); }
  const previous = cache.get(side); if (previous !== undefined) return previous;
  const generation = Math.max(0, ...optimizationHeroIds(input, side).map((id) => generationByHero.get(id) ?? 0));
  cache.set(side, generation); return generation;
}

/** Search-domain constraint only: the exact manual baseline remains evaluable separately. */
export function optimizerRecentHeadEligible(input: ValidationBattleInput,
  head: Readonly<Partial<Record<TroopType, string | null>>>, side: SideId = "A"): boolean {
  if (TROOP_TYPES.some((troop) => {
    const hero = catalogHeroesById.get(head[troop] ?? "");
    return hero !== undefined && !optimizerHeadHeroAllowed(hero, optimizerServerGeneration(input));
  })) return false;
  const generation = optimizerGeneration(input, side), minimum = Math.max(1, generation - 2);
  if (generation < 3) return true;
  return TROOP_TYPES.some((troop) => {
    const value = generationByHero.get(head[troop] ?? "") ?? 0;
    return value >= minimum && value <= generation;
  });
}

export function recentHeadCandidateAudit(input: ValidationBattleInput,
  heads: readonly Readonly<Partial<Record<TroopType, string | null>>>[], side: SideId = "A") {
  const effectiveHeroGeneration = optimizerGeneration(input, side);
  const recentEligibleHeadCount = heads.filter((head) => optimizerRecentHeadEligible(input, head, side)).length;
  return { allLegalHeadCount: heads.length, effectiveHeroGeneration,
    recentGenerationWindow: [Math.max(1, effectiveHeroGeneration - 2), effectiveHeroGeneration] as const, recentEligibleHeadCount,
    rejectedByRecentGenerationCount: heads.length - recentEligibleHeadCount };
}

const auditCache = new WeakMap<ValidationBattleInput, Map<string, HeroPoolAudit>>();
export function buildHeroPoolAudit(input: ValidationBattleInput, heroes: readonly OptimizerHeroMetadata[], sideId: SideId = "A", profiler?: OptimizerProfiler): HeroPoolAudit {
  let cache = auditCache.get(input); if (!cache) { cache = new Map(); auditCache.set(input, cache); }
  const key = `${sideId}:${heroes.map((hero) => hero.heroId).join("|")}`;
  const previous = cache.get(key); if (previous) { profiler?.cacheHits(1); return previous; }
  const result = computeHeroPoolAudit(input, heroes, sideId, profiler); cache.set(key, result); return result;
}

/** Compatibility scheduling tie-breaker; generators enforce the hard recent head constraint. */
export function heroSearchPriority(input:ValidationBattleInput,head:Readonly<Partial<Record<TroopType,string|null>>>,side:SideId="A"):number {
  const heroes=getValidationCatalog().leaderHeroes,generation=optimizerGeneration(input,side);
  return satisfiesRecentGeneration(head,generation,heroes)?.001:0;
}
