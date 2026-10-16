import { CanonicalBodyEffectRegistry, canonicalBodySemanticKey } from "../../bodyEffects/canonicalRegistry";
import { validationStageId } from "../../validationUi/stageConfig";
import { CONFIRMED_HERO_SKILL_DEFINITIONS } from "../../heroSkills";
import { generateBodyEnumerationDomain, enumerateBodyCombinations, type BodyEnumerationResult, type BodyEnumerationAudit, type EnumeratedBodyRow } from "../criterion/bodyEnumeration";
import { createBodySkillSignature, createBodyComboSignature, type PreprocessedBodyRow } from "../criterion/bodyPreprocess";
import { createEffectSignature } from "../criterion/signatures";
import type { OptimizationInput, RallyCandidate, SearchConstraint } from "../types";
import type { SideId } from "../../types";
import { skillRoleApplicability } from "../optimizationContext";

export interface CanonicalBodyAudit {
  bodyHeroCount: number; canonicalEffectCount: number; automaticEffectCount: number;
  canonicalEffectCountBefore: number; canonicalEffectCountAfter: number;
  rawOrderedCombinationCount: number; rawUnorderedCombinationCount: number;
  rejectedByProbabilityDominance: number; rejectedByExplicitOptimizerExclusion: number;
  rejectedByMultiplicityLimit: number; deduplicatedByPermutation: number;
  deduplicatedByCanonicalEffect: number; deduplicatedBySemanticIdentity: number;
  rejectedByAdditionalConstraints: number; additionalConstraints: readonly string[];
  finalBodyCount: number;
  stages: readonly { stage: string; count: number; unit: string }[];
}
export function unorderedBodyCount(n: number): number { return n * (n + 1) * (n + 2) * (n + 3) / 24; }
export function maxTwoBodyCount(n: number): number { return unorderedBodyCount(n) - n - n * (n - 1); }

/** Unordered canonical effect multisets are an explicit optimizer search policy,
 * never a claim of seed-by-seed equality between formal runtime slot orders. */
export function enumerateCanonicalBodyPool(input: OptimizationInput, constraints: SearchConstraint,
  head: RallyCandidate["leaderHeroIds"], side: SideId): BodyEnumerationResult {
  const domain = generateBodyEnumerationDomain(input, constraints, head, side);
  const registry = new CanonicalBodyEffectRegistry(undefined, validationStageId(input));
  if (domain.fixedBodyExact || domain.fixedMemberSkillIds.length === 4) {
    const result = enumerateBodyCombinations({ ...domain, fixedBodyExact: true }, { preprocess: true, jointPolicy: true });
    result.audit.canonical = { bodyHeroCount: domain.sources.length, canonicalEffectCount: registry.effects.length,
      canonicalEffectCountBefore: domain.sources.length, canonicalEffectCountAfter: registry.effects.length,
      automaticEffectCount: registry.automaticEffects.length, rawOrderedCombinationCount: 1, rawUnorderedCombinationCount: 1,
      rejectedByProbabilityDominance: 0, rejectedByExplicitOptimizerExclusion: 0, rejectedByMultiplicityLimit: 0,
      deduplicatedByPermutation: 0, deduplicatedByCanonicalEffect: 0, deduplicatedBySemanticIdentity: 0,
      rejectedByAdditionalConstraints: 0, additionalConstraints: ["fixed manual Body: preserve identity, levels, order and four-copy configurations"],
      finalBodyCount: result.rows.length, stages: [{ stage: "fixed manual Body", count: result.rows.length, unit: "constant" }] };
    return result;
  }
  const definitions = new Map(CONFIRMED_HERO_SKILL_DEFINITIONS.map((s) => [s.id, s]));
  const available = new Set(domain.sources.map((s) => s.skillId));
  // Locked slots keep exact identities/levels. Free slots search one eligible
  // representative per complete selected-level effect (including disabled state).
  type Choice = { definition: (typeof CONFIRMED_HERO_SKILL_DEFINITIONS)[number]; canonicalId: string; excluded: boolean; level: number; semanticKey: string };
  const sourceVariants = new Set<string>(), variants = new Map<string, Choice>();
  const choiceFor = (id: string, level: number): Choice => {
    const definition = definitions.get(id)!, effect = registry.forSkill(id)!;
    return { definition, canonicalId: effect.canonicalBodyEffectId, excluded: effect.optimizerExcluded, level,
      semanticKey: canonicalBodySemanticKey(definition, level) + `:disabled=${domain.disabledSkillIds.includes(id)}` };
  };
  for (const effect of registry.effects) for (const alias of effect.aliases) if (available.has(alias.id)) {
    for (let slot = domain.fixedMemberSkillIds.length; slot < 4; slot++) {
      const choice = choiceFor(alias.id, domain.levelForSlot(alias.id, slot)); sourceVariants.add(`${alias.id}:${choice.level}`);
      if (!variants.has(choice.semanticKey)) variants.set(choice.semanticKey, choice);
    }
  }
  const choices = [...variants.values()], automatic = choices.filter((s) => !s.excluded);
  const fixed = domain.fixedMemberSkillIds.map((id, slot) => choiceFor(id, domain.levelForSlot(id, slot)));
  // Required manual identities become constants ahead of the unordered free
  // slots. They never disappear merely because their canonical alias is older.
  for (const hero of domain.requiredBodyHeroIds) if (!fixed.some((s) => s.definition.heroId === hero)) {
    const source = domain.sources.find((s) => s.heroId === hero);
    if (source) fixed.push(choiceFor(source.skillId, domain.levelForSlot(source.skillId, fixed.length)));
  }
  const rows: EnumeratedBodyRow[] = [], bodies: PreprocessedBodyRow[] = [];
  const descriptors = new Map<string, ReturnType<typeof createBodySkillSignature>>();
  const descriptor = (id: string, level: number) => {
    const key = `${id}:${level}`;
    if (!descriptors.has(key)) descriptors.set(key, createBodySkillSignature(definitions.get(id)!, level));
    return descriptors.get(key)!;
  };
  let additionalRejected = 0;
  const selected: typeof automatic = [], counts = new Map<string, number>();
  const walk = (slot: number, minimum: number) => {
    if (slot === 4) {
      if (domain.requiredBodyHeroIds.some((id) => !selected.some((s) => s.definition.heroId === id))) { additionalRejected++; return; }
      const ds = selected.map((s) => descriptor(s.definition.id, s.level));
      if (domain.optimizationContext && ds.some((d) => ["inactiveInCurrentRallyRole", "inactiveInCurrentScenario"].includes(
        skillRoleApplicability(d.definition, d.skillLevel, domain.optimizationContext!).reason))) { additionalRejected++; return; }
      const ids = selected.map((s) => s.definition.id);
      const signature = createEffectSignature(ds.flatMap((d, i) => domain.disabledSkillIds.includes(d.skillId) ? [] : [{ skill: d.definition, level: d.skillLevel, runtimeId: `body-${i}` }]), ids.join("|") + ":" + ds.map((d) => d.skillLevel).join(","));
      rows.push({ memberSkillIds: ids, bodySlots: ds.map((d, i) => ({ heroDefinitionId: d.heroDefinitionId, runtimeInstanceId: `${side}-body-${i}`, effectFamily: selected[i]!.canonicalId, skillId: d.skillId, level: d.skillLevel })) });
      bodies.push({ ids, signature, semantic: createBodyComboSignature(ids, ds, signature) }); return;
    }
    const lane = slot < fixed.length ? [fixed[slot]!] : automatic;
    for (let i = slot < fixed.length ? 0 : minimum; i < lane.length; i++) {
      const s = lane[i]!, key = s.semanticKey, n = counts.get(key) ?? 0;
      if (n >= 2) continue;
      counts.set(key, n + 1); selected.push(s); walk(slot + 1, slot < fixed.length ? 0 : i); selected.pop();
      if (n) counts.set(key, n); else counts.delete(key);
    }
  };
  if (fixed.length <= 4) walk(0, 0);
  const n = sourceVariants.size, c = choices.length, a = automatic.length;
  const raw = n ** 4, unordered = unorderedBodyCount(n), canonicalCount = unorderedBodyCount(c), beforeMultiplicity = unorderedBodyCount(a), afterMultiplicity = maxTwoBodyCount(a);
  const additionalConstraints = [
    ...(input.rallyBodyPoolIds ? ["explicit rallyBodyPoolIds"] : []),
    ...(constraints.forbiddenHeroIds?.length ? ["forbidden heroes"] : []),
    ...(constraints.allowedPositions ? ["allowed member positions"] : []),
    ...(domain.requiredBodyHeroIds.length ? ["required Body hero identities"] : []),
    ...(fixed.length ? ["partially locked Body slots"] : []),
    ...(sourceVariants.size !== domain.sources.length || choices.some((s) => s.level !== 5) ? ["selected-level Body variants"] : []),
    ...(additionalRejected ? ["required identities / inactive battle role"] : []),
    ...(bodies.length !== afterMultiplicity && !fixed.length && !additionalRejected ? ["slot-dependent selected skill levels"] : [])];
  const canonical: CanonicalBodyAudit = { bodyHeroCount: domain.sources.length, canonicalEffectCount: c, automaticEffectCount: a,
    canonicalEffectCountBefore: n, canonicalEffectCountAfter: c,
    rawOrderedCombinationCount: raw, rawUnorderedCombinationCount: unordered, rejectedByProbabilityDominance: 0,
    rejectedByExplicitOptimizerExclusion: canonicalCount - beforeMultiplicity, rejectedByMultiplicityLimit: beforeMultiplicity - afterMultiplicity,
    deduplicatedByPermutation: raw - unordered, deduplicatedByCanonicalEffect: unordered - canonicalCount,
    deduplicatedBySemanticIdentity: 0, rejectedByAdditionalConstraints: afterMultiplicity - bodies.length,
    additionalConstraints, finalBodyCount: bodies.length,
    stages: [{ stage: "eligible hero ordered universe", count: raw, unit: "ordered four slots before constraints" },
      { stage: "unordered hero multisets", count: unordered, unit: "multisets" },
      { stage: "complete semantic canonicalization", count: canonicalCount, unit: "canonical multisets" },
      { stage: "four explicit optimizer exclusions", count: beforeMultiplicity, unit: "canonical multisets" },
      { stage: "canonical multiplicity <=2", count: afterMultiplicity, unit: "canonical multisets" },
      { stage: "actual constraints", count: bodies.length, unit: "materialized legal Bodies" }] };
  const audit: BodyEnumerationAudit = { canonical, rawBodyCombinationCount: raw, rejectedDuringGenerationBySameEffectFamily: canonical.rejectedByMultiplicityLimit,
    rejectedBySameEffectFamily: canonical.rejectedByMultiplicityLimit, afterSameEffectMax2: afterMultiplicity,
    rejectedByStrictDominance: 0, rejectedBySkillDominance: 0, rejectedByProbabilityDominance: 0,
    afterStrictDominance: afterMultiplicity, afterProbabilityDominance: afterMultiplicity,
    rejectedBySemanticEquivalence: canonical.deduplicatedByCanonicalEffect, semanticBodyCombinationCount: bodies.length,
    rejectedByParetoDominance: 0, afterPareto: bodies.length, afterMarginalStacking: bodies.length,
    finalPreprocessedBodyCount: bodies.length, preprocessedBodyCount: bodies.length, sourceSkillCount: n,
    sourcesAfterStrictDominance: c, sourcesAfterProbabilityDominance: a,
    semanticMergeReasons: ["complete battle semantic identity; earliest eligible representative", "unordered canonical four-slot multisets; max two copies; no formal permutation equivalence claim"],
    formalSeedOrderEquivalenceClaimed: false, bodiesRejectedAsInactiveInCurrentRole: 0,
    bodyCombinationsRejectedAsInactiveInCurrentRole: additionalRejected, afterRoleApplicability: bodies.length,
    bodyEffectsActiveByRole: [], bodyEffectsInactiveByRole: [], inactiveBodySkillsInCurrentRole: [] };
  return { rows, bodies, audit, skillDominance: [] };
}
