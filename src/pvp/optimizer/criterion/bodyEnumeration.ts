import { CONFIRMED_HERO_SKILL_DEFINITIONS, type HeroSkillDefinition } from "../../heroSkills";
import { isHeroAvailableAtStage } from "../../progression";
import { getValidationCatalog } from "../../validationUi";
import { validationStageId } from "../../validationUi/stageConfig";
import type { OptimizationInput, RallyCandidate, SearchConstraint } from "../types";
import type { SideId } from "../../types";
import { createOptimizationContext, skillRoleApplicability, type OptimizationContext, type SkillRoleApplicability } from "../optimizationContext";
import { createEffectSignature } from "./signatures";
import { canonicalSkillFamilies, probabilityBodyDominatedBy } from "../jointPipeline/bodyPolicy";
import type { CanonicalBodyAudit } from "../jointPipeline/canonicalBodies";
import { canonicalBodySemanticKey } from "../../bodyEffects/canonicalRegistry";
import { createBodySkillSignature, createBodyComboSignature, dominatesBodySkill, paretoBodyRows,
  type BodySkillEffectSignature, type BodySkillDominance, type PreprocessedBodyRow } from "./bodyPreprocess";

export interface BodyEnumerationSource { readonly heroId: string; readonly skillId: string; readonly effectKey: string; }
export interface OptimizerBodySlot {
  readonly heroDefinitionId: string;
  readonly runtimeInstanceId: string;
  readonly effectFamily: string;
  readonly skillId: string;
  readonly level: number;
}
export interface BodyEnumerationDomain {
  readonly sources: readonly BodyEnumerationSource[];
  readonly fixedMemberSkillIds: readonly string[];
  readonly fixedBodyExact: boolean;
  readonly requiredBodyHeroIds: readonly string[];
  /** Deprecated input retained for callers; ignored by enumeration. */
  readonly allowDuplicateMembers: boolean;
  readonly equivalentMemberPositions: boolean;
  readonly disabledSkillIds: readonly string[];
  readonly levelForSlot: (skillId: string, slot: number) => number;
  /** Omitted only by context-free numeric test fixtures. Production always supplies it. */
  readonly optimizationContext?: OptimizationContext;
}
export interface BodyEnumerationOptions {
  readonly jointPolicy?: boolean;
  readonly preprocess?: boolean;
  /** Numeric aliases/permutations are optimizer template lanes, never formal runtime IDs. */
  readonly semanticRepresentatives?: boolean;
  readonly protectedBodyKeys?: readonly string[];
  readonly definitions?: readonly HeroSkillDefinition[];
  /** For a legal example seed only; production preprocessing does not set a row limit. */
  readonly limit?: number;
  readonly candidateSide?: SideId;
}
export interface BodyEnumerationAudit {
  canonical?: CanonicalBodyAudit;
  legacyTrace?: { bodyHeroCount: number; canonicalEffectCount: number; numericAliasRepresentativeCount: number; rawOrderedCombinationCount: number; rawUnorderedCombinationCount: number;
    rejectedByProbabilityDominance: number; rejectedByExplicitOptimizerExclusion: number; rejectedByMultiplicityLimit: number;
    deduplicatedByCanonicalEffect: number; deduplicatedByPermutation: number; deduplicatedBySemanticIdentity: number;
    orderedAfterNumericAliases: number; finalBodyCount: number; traceAppliesToUnconstrainedFourSlots: boolean };
  rawBodyCombinationCount: number;
  rejectedDuringGenerationBySameEffectFamily: number;
  rejectedBySameEffectFamily: number;
  afterSameEffectMax2: number;
  rejectedByStrictDominance: number;
  rejectedBySkillDominance: number;
  rejectedByProbabilityDominance: number;
  afterStrictDominance: number;
  afterProbabilityDominance: number;
  rejectedBySemanticEquivalence: number;
  semanticBodyCombinationCount: number;
  rejectedByParetoDominance: number;
  afterPareto: number;
  afterMarginalStacking: number;
  finalPreprocessedBodyCount: number;
  preprocessedBodyCount: number;
  sourceSkillCount: number;
  sourcesAfterStrictDominance: number;
  sourcesAfterProbabilityDominance: number;
  semanticMergeReasons: readonly string[];
  formalSeedOrderEquivalenceClaimed: false;
  bodiesRejectedAsInactiveInCurrentRole:number;
  bodyCombinationsRejectedAsInactiveInCurrentRole:number;
  afterRoleApplicability:number;
  bodyEffectsActiveByRole:readonly string[];
  bodyEffectsInactiveByRole:readonly string[];
  inactiveBodySkillsInCurrentRole:readonly SkillRoleApplicability[];
}
export interface EnumeratedBodyRow { readonly memberSkillIds: readonly string[]; readonly bodySlots: readonly OptimizerBodySlot[]; }
interface Choice { source: BodyEnumerationSource; descriptor: BodySkillEffectSignature; ordinal: number; commutable: boolean; families: readonly string[]; }
export interface BodyEnumerationResult {
  readonly rows: readonly EnumeratedBodyRow[];
  readonly bodies: readonly PreprocessedBodyRow[];
  readonly audit: BodyEnumerationAudit;
  readonly skillDominance: readonly { skillId: string; skillLevel: number; dominatedBy: string; reason: BodySkillDominance; slot: number }[];
}

export function generateBodyEnumerationDomain(input: OptimizationInput, constraints: SearchConstraint,
  head: RallyCandidate["leaderHeroIds"], candidateSide:SideId="A"): BodyEnumerationDomain {
  if (input.scenarioType === "CITY_DEFENSE" && candidateSide === "A") constraints = { ...constraints, fixedBodyExact: true, fixedMemberSkillIds: [] };
  const catalog = getValidationCatalog(), stage = validationStageId(input);
  const sources = catalog.memberSkills.flatMap((entry) => entry.sourceHeroIds.map((heroId, index) => ({
    heroId, skillId: entry.sourceSkillIds[index]!, effectKey: entry.effectKey,
  }))).filter((source) => isHeroAvailableAtStage(source.heroId, stage) &&
    !constraints.forbiddenHeroIds?.includes(source.heroId) &&
    (input.rallyBodyPoolIds === undefined || input.rallyBodyPoolIds.includes(source.heroId)) &&
    (constraints.allowedPositions?.[source.heroId]?.includes("member") ?? true));
  const own=candidateSide==="A"?input.sideA:input.sideB;
  const fixedMemberSkillIds = constraints.fixedMemberSkillIds ?? (constraints.fixedBodyExact
    ? own.bodySkills?.map((body) => body.skillId) ?? own.selectedMemberSkillIds : []);
  if (fixedMemberSkillIds.length > 4) throw new RangeError("At most four member skills can be fixed.");
  for (const id of fixedMemberSkillIds) if (!sources.some((source) => source.skillId === id))
    throw new RangeError(`Fixed member skill ${id} is not eligible at server stage ${stage}.`);
  const headIds = Object.values(head);
  return { sources, fixedMemberSkillIds, fixedBodyExact: constraints.fixedBodyExact ?? false,
    requiredBodyHeroIds: (constraints.requiredHeroIds ?? []).filter((id) => !headIds.includes(id)),
    allowDuplicateMembers: true, // Deprecated persisted flag no longer restricts the optimizer domain.
    equivalentMemberPositions: constraints.equivalentMemberPositions ?? false,
    disabledSkillIds: input.disabledSkillIds,
    optimizationContext:createOptimizationContext(input,candidateSide),
    levelForSlot: (id, slot) => own.bodySkills?.[slot]?.skillId === id ? own.bodySkills[slot]!.skillLevel :
      own.bodySkills?.find((body) => body.skillId === id)?.skillLevel ?? 5 };
}

function sameNumericSkillKey(descriptor: BodySkillEffectSignature): string {
  // Identity aliases are grouped only for supported permanent effects with no
  // extra channels, context, links, refreshes or control. All mathematical fields remain.
  const definition = descriptor.definition, level = definition.levelValues[descriptor.skillLevel];
  const effects = level?.effects.map((effect) => Object.fromEntries(Object.entries(effect).filter(([key]) => key !== "id" && key !== "name")));
  return JSON.stringify([descriptor.effectFamily, descriptor.triggerType, descriptor.probability,
    definition.activationTiming ?? "immediate", definition.metadata.ruleStatus, effects]);
}

/** Count ordered identity lanes exactly, including pruned leaves, without creating raw combinations. */
function countDomain(lanes: readonly (readonly Choice[])[], required: readonly string[], maxFamily: number): number {
  if (required.length > lanes.length) return 0;
  const requiredBits = new Map(required.map((id, index) => [id, 2 ** index])), completeMask = 2 ** required.length - 1;
  const families = new Map<string, number>(), memo = new Map<string, number>();
  const groups = lanes.map((lane) => {
    const grouped = new Map<string, { choice: Choice; count: number; bit: number }>();
    for (const choice of lane) {
      const bit = requiredBits.get(choice.source.heroId) ?? 0;
      const key = JSON.stringify([maxFamily < lanes.length ? choice.families : "", bit]);
      const old = grouped.get(key); if (old) old.count++; else grouped.set(key, { choice, count: 1, bit });
    }
    return [...grouped.values()];
  });
  const walk = (slot: number, mask: number): number => {
    if (slot === lanes.length) return mask === completeMask ? 1 : 0;
    const key = `${slot}:${mask}:` + [...families].sort().map(([family, count]) => `${family}:${count}`).join("|");
    const cached = memo.get(key); if (cached !== undefined) return cached;
    let total = 0;
    for (const { choice, count, bit } of groups[slot]!) {
      const oldCounts = choice.families.map((family) => families.get(family) ?? 0);
      if (oldCounts.some((n) => n >= maxFamily)) continue;
      if (maxFamily < lanes.length) choice.families.forEach((family, i) => families.set(family, oldCounts[i]! + 1));
      total += count * walk(slot + 1, mask | bit);
      if (maxFamily < lanes.length) choice.families.forEach((family, i) => { if (oldCounts[i]) families.set(family, oldCounts[i]!); else families.delete(family); });
    }
    memo.set(key, total); return total;
  };
  return walk(0, 0);
}

/** Hard family pruning happens while appending each slot; invalid rows never materialize. */
export function enumerateBodyCombinations(domain: BodyEnumerationDomain, options: BodyEnumerationOptions = {}): BodyEnumerationResult {
  const definitions = new Map((options.definitions ?? CONFIRMED_HERO_SKILL_DEFINITIONS).map((definition) => [definition.id, definition]));
  const sources = [...new Map(domain.sources.map((source) => [source.skillId, source])).values()];
  const fixed = domain.fixedMemberSkillIds, slots = domain.fixedBodyExact || fixed.length === 4 ? fixed.length : sources.length ? 4 : fixed.length;
  const protectedBodies = new Set(options.protectedBodyKeys), protectedSkills = new Set(fixed);
  for (const key of protectedBodies) for (const id of key.split("|")) protectedSkills.add(id);
  for (const source of sources) if (domain.requiredBodyHeroIds.includes(source.heroId)) protectedSkills.add(source.skillId);
  const descriptors = new Map<string, BodySkillEffectSignature>();
  const descriptorFor = (source: BodyEnumerationSource, slot: number) => {
    const level = domain.levelForSlot(source.skillId, slot), key = `${source.skillId}:${level}`;
    let descriptor = descriptors.get(key); if (descriptor) return descriptor;
    const definition = definitions.get(source.skillId); if (!definition) throw new RangeError(`Unknown optimizer body skill ${source.skillId}.`);
    descriptor = createBodySkillSignature(definition, level); descriptors.set(key, descriptor); return descriptor;
  };
  const lanes: Choice[][] = Array.from({ length: slots }, (_, slot) => {
    const choices = slot < fixed.length ? sources.filter((source) => source.skillId === fixed[slot]) : sources;
    return choices.map((source, ordinal) => {
      const descriptor = descriptorFor(source, slot);
      return { source, descriptor, ordinal, commutable: false,
        families: options.jointPolicy ? canonicalSkillFamilies(descriptor.definition, descriptor.skillLevel) : [descriptor.effectFamily] };
    });
  });
  const maximumFamily = options.jointPolicy && domain.fixedBodyExact ? Math.max(4, slots) : 2;
  const count = (choices: readonly (readonly Choice[])[], family = maximumFamily) => countDomain(choices, domain.requiredBodyHeroIds, family);
  const rawBodyCombinationCount = count(lanes, Math.max(4, slots));
  const afterSameEffectMax2 = count(lanes);
  const roleRows=domain.optimizationContext?lanes.flatMap((lane)=>lane.map((choice)=>
    skillRoleApplicability(choice.descriptor.definition,choice.descriptor.skillLevel,domain.optimizationContext!))):[];
  const inactiveByKey=new Map(roleRows.filter((row)=>!row.activeInCurrentRole).map((row)=>[row.skillId,row]));
  const roleLanes=domain.optimizationContext?lanes.map((lane)=>lane.filter((choice)=>{
    const applicability=skillRoleApplicability(choice.descriptor.definition,choice.descriptor.skillLevel,domain.optimizationContext!);
    // Empty/unknown behavior does not prove an inactive combat effect. Only the
    // formal context mismatch is safe to remove from this role's search domain.
    return !["inactiveInCurrentRallyRole","inactiveInCurrentScenario"].includes(applicability.reason);
  })):lanes;
  const afterRoleApplicability=count(roleLanes);
  const skillDominance: { skillId: string; skillLevel: number; dominatedBy: string; reason: BodySkillDominance; slot: number }[] = [];
  const preprocess = options.preprocess ?? false;
  const filterDominance = (input: readonly (readonly Choice[])[], reason: BodySkillDominance) => input.map((lane, slot) => lane.filter((choice) => {
    if (!preprocess || slot < fixed.length || protectedSkills.has(choice.source.skillId) || domain.disabledSkillIds.includes(choice.source.skillId)) return true;
    if (options.jointPolicy && reason === "skillDominance") return true;
    const proof = lane.find((other) => !domain.disabledSkillIds.includes(other.source.skillId) &&
      (options.jointPolicy ? probabilityBodyDominatedBy(choice.descriptor, other.descriptor) : dominatesBodySkill(choice.descriptor, other.descriptor) === reason));
    if (!proof) return true;
    if (!skillDominance.some((row) => row.skillId === choice.source.skillId && row.skillLevel === choice.descriptor.skillLevel && row.dominatedBy === proof.source.skillId && row.reason === reason && row.slot === slot))
      skillDominance.push({ skillId: choice.source.skillId, skillLevel: choice.descriptor.skillLevel, dominatedBy: proof.source.skillId, reason, slot });
    return false;
  }));
  const strict = filterDominance(roleLanes, "skillDominance"), afterStrictDominance = count(strict);
  const probability = filterDominance(strict, "probabilityDominance"), afterProbabilityDominance = count(probability);
  const semantic = options.semanticRepresentatives ?? preprocess;
  const ordinalKeys = new Map<string, number>();
  const procFamilies = new Map<string, Set<string>>();
  for (const lane of probability.slice(fixed.length)) for (const choice of lane) {
    const proc = choice.descriptor.definition.procEffectFamilyId;
    if (proc) { const keys = procFamilies.get(proc) ?? new Set<string>(); keys.add(`${choice.source.skillId}:${choice.descriptor.skillLevel}`); procFamilies.set(proc, keys); }
  }
  const selected = probability.map((lane, slot) => {
    const unique = new Map<string, Choice>();
    for (const choice of lane) {
      const stableLevel = probability.slice(fixed.length).every((otherLane) => otherLane.find((other) => other.source.skillId === choice.source.skillId)?.descriptor.skillLevel === choice.descriptor.skillLevel);
      const simple = semantic && choice.descriptor.specialMechanismFlags.every((flag) => flag === "unverified") &&
        choice.descriptor.probability === 1 && stableLevel && !domain.disabledSkillIds.includes(choice.source.skillId);
      const proc = choice.descriptor.definition.procEffectFamilyId;
      // Numeric effects and independent damage channels commute in Criterion.
      // Redirects overwrite and mixed proc-family bindings choose a last source,
      // therefore those slot orders remain explicit. Formal seed-by-seed results
      // are never equated: the selected identity order is materialized unchanged.
      const templateCommutes = semantic && stableLevel && !choice.descriptor.targetRedirect &&
        (!proc || (procFamilies.get(proc)?.size ?? 0) <= 1);
      const aliasKey = simple && slot >= fixed.length && !protectedSkills.has(choice.source.skillId) ?
        sameNumericSkillKey(choice.descriptor) : `identity:${choice.source.skillId}:${choice.descriptor.skillLevel}`;
      if (!ordinalKeys.has(aliasKey)) ordinalKeys.set(aliasKey, ordinalKeys.size);
      const key = aliasKey;
      if (!unique.has(key)) unique.set(key, { ...choice, ordinal: ordinalKeys.get(key)!, commutable: templateCommutes && slot >= fixed.length });
    }
    return [...unique.values()];
  });
  const rows: EnumeratedBodyRow[] = [], bodies: PreprocessedBodyRow[] = [], seen = new Set<string>();
  const combo: Choice[] = [], familyCounts = new Map<string, number>();
  const add = (choices: readonly Choice[]) => {
    if (domain.requiredBodyHeroIds.some((id) => !choices.some((choice) => choice.source.heroId === id))) return;
    const ids = choices.map((choice) => choice.source.skillId), levels = choices.map((choice) => choice.descriptor.skillLevel);
    const key = (domain.equivalentMemberPositions ? ids.slice().sort() : ids).join("|"); if (seen.has(key)) return;
    seen.add(key);
    const bodySlots = choices.map((choice, slot) => ({ heroDefinitionId: choice.source.heroId, runtimeInstanceId: `${domain.optimizationContext?.candidateSide??"A"}-body-${slot}`,
      effectFamily: choice.descriptor.effectFamily, skillId: choice.source.skillId, level: choice.descriptor.skillLevel }));
    rows.push({ memberSkillIds: ids, bodySlots });
    if (preprocess) {
      const signature = createEffectSignature(choices.flatMap((choice, index) => domain.disabledSkillIds.includes(choice.source.skillId) ? [] :
        [{ skill: choice.descriptor.definition, level: levels[index]!, runtimeId: `body-${index}` }]), ids.join("|") + ":" + levels.join(","));
      bodies.push({ ids, signature, semantic: createBodyComboSignature(ids, choices.map((choice) => choice.descriptor), signature) });
    }
  };
  const walk = (slot: number, minimumSimpleOrdinal: number) => {
    if (options.limit !== undefined && rows.length >= options.limit) return;
    if (slot === selected.length) { add(combo); return; }
    for (const choice of selected[slot]!) {
      const oldCounts = choice.families.map((family) => familyCounts.get(family) ?? 0);
      if (oldCounts.some((n) => n >= maximumFamily)) continue;
      if (choice.commutable && choice.ordinal < minimumSimpleOrdinal) continue;
      choice.families.forEach((family, i) => familyCounts.set(family, oldCounts[i]! + 1)); combo.push(choice);
      walk(slot + 1, choice.commutable ? choice.ordinal : minimumSimpleOrdinal);
      combo.pop(); choice.families.forEach((family, i) => { if (oldCounts[i]) familyCounts.set(family, oldCounts[i]!); else familyCounts.delete(family); });
    }
  };
  if (afterSameEffectMax2) walk(0, -1);
  // Preserve explicitly protected identities and slot orders, rather than rewriting them as aliases.
  for (const key of protectedBodies) {
    const ids = key ? key.split("|") : []; if (ids.length !== slots) continue;
    const choices = ids.map((id, slot) => probability[slot]?.find((choice) => choice.source.skillId === id));
    if (choices.some((choice) => !choice)) continue;
    const complete = choices as Choice[], counts = new Map<string, number>();
    for (const choice of complete) counts.set(choice.descriptor.effectFamily, (counts.get(choice.descriptor.effectFamily) ?? 0) + 1);
    if ([...counts.values()].some((value) => value > 2)) continue;
    add(complete);
  }
  const pareto = preprocess && !options.jointPolicy ? paretoBodyRows(bodies, protectedBodies) : { bodies, rejected: 0 };
  const finalBodies = pareto.bodies, retainedKeys = new Set(finalBodies.map((body) => body.ids.join("|")));
  const finalRows = preprocess ? rows.filter((row) => retainedKeys.has(row.memberSkillIds.join("|"))) : rows;
  const finalCount = finalRows.length, semanticCount = rows.length;
  const orderedAfterNumericAliases = count(selected);
  const audit: BodyEnumerationAudit = { rawBodyCombinationCount,
    legacyTrace: { bodyHeroCount: sources.length,
      canonicalEffectCount: new Set(lanes.flatMap((lane) => lane.map((c) => canonicalBodySemanticKey(c.descriptor.definition, c.descriptor.skillLevel)))).size,
      numericAliasRepresentativeCount: selected[0]?.length ?? 0, rawOrderedCombinationCount: rawBodyCombinationCount,
      rawUnorderedCombinationCount: sources.length * (sources.length + 1) * (sources.length + 2) * (sources.length + 3) / 24,
      rejectedByProbabilityDominance: afterStrictDominance - afterProbabilityDominance, rejectedByExplicitOptimizerExclusion: 0,
      rejectedByMultiplicityLimit: rawBodyCombinationCount - afterSameEffectMax2,
      deduplicatedByCanonicalEffect: afterProbabilityDominance - orderedAfterNumericAliases,
      orderedAfterNumericAliases, deduplicatedByPermutation: orderedAfterNumericAliases - semanticCount,
      deduplicatedBySemanticIdentity: pareto.rejected, finalBodyCount: finalCount,
      traceAppliesToUnconstrainedFourSlots: slots === 4 && !fixed.length && !domain.requiredBodyHeroIds.length },
    rejectedDuringGenerationBySameEffectFamily: rawBodyCombinationCount - afterSameEffectMax2,
    rejectedBySameEffectFamily: rawBodyCombinationCount - afterSameEffectMax2, afterSameEffectMax2,
    rejectedByStrictDominance: afterRoleApplicability - afterStrictDominance,
    rejectedBySkillDominance: afterRoleApplicability - afterStrictDominance,
    rejectedByProbabilityDominance: afterStrictDominance - afterProbabilityDominance,
    afterStrictDominance, afterProbabilityDominance,
    rejectedBySemanticEquivalence: Math.max(0, afterProbabilityDominance - semanticCount), semanticBodyCombinationCount: semanticCount,
    rejectedByParetoDominance: pareto.rejected, afterPareto: finalCount, afterMarginalStacking: finalCount,
    finalPreprocessedBodyCount: finalCount, preprocessedBodyCount: finalCount, sourceSkillCount: sources.length,
    sourcesAfterStrictDominance: new Set(strict.flatMap((lane) => lane.map((choice) => choice.source.skillId))).size,
    sourcesAfterProbabilityDominance: new Set(probability.flatMap((lane) => lane.map((choice) => choice.source.skillId))).size,
    semanticMergeReasons: semantic ? ["identical current numeric Criterion templates share an identity representative",
      "free equal-level slot permutations commute in Criterion except redirect and mixed proc last-binding lanes",
      "protected complete identities and orders are restored; selected formal runtime slot order is unchanged"] : [],
    formalSeedOrderEquivalenceClaimed: false,
    bodiesRejectedAsInactiveInCurrentRole:inactiveByKey.size,
    bodyCombinationsRejectedAsInactiveInCurrentRole:afterSameEffectMax2-afterRoleApplicability,
    afterRoleApplicability,
    bodyEffectsActiveByRole:[...new Set(roleRows.flatMap((row)=>row.activeEffectIds))].sort(),
    bodyEffectsInactiveByRole:[...new Set(roleRows.flatMap((row)=>row.inactiveEffectIds))].sort(),
    inactiveBodySkillsInCurrentRole:[...inactiveByKey.values()] };
  return { rows: finalRows, bodies: finalBodies, audit, skillDominance };
}

export function enumeratePreprocessedBodyPool(input: OptimizationInput, constraints: SearchConstraint,
  head: RallyCandidate["leaderHeroIds"], options: Omit<BodyEnumerationOptions, "preprocess"> = {}): BodyEnumerationResult {
  return enumerateBodyCombinations(generateBodyEnumerationDomain(input, constraints, head,options.candidateSide), { ...options, preprocess: true });
}

/** Older search workflows use the same B0 domain, rather than materializing millions
 * of ordered identity permutations only to sample a bounded body refinement later.
 * This is an explicit theoretical-template search policy, not formal seed equality.
 * No arbitrary body count ceiling is applied. Heavy Criterion signatures can be
 * released immediately after this helper returns the lightweight identity rows. */
export function createLegacyBodySearchPool(input: OptimizationInput, constraints: SearchConstraint,
  head: RallyCandidate["leaderHeroIds"]) {
  const { rows, audit, skillDominance } = enumeratePreprocessedBodyPool(input, constraints, head);
  return { rows, audit, skillDominance };
}
