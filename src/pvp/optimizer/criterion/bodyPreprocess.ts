import { CONFIRMED_HERO_SKILL_DEFINITIONS, type HeroSkillDefinition, type HeroSkillEffect } from "../../heroSkills";
import { targetMarkSourceGroups } from "../../heroSkills/targetMarkStacking";
import { TROOP_TYPES, type BattleState, type EffectDefinition, type SideId } from "../../types";
import type { RallyTroopRatios } from "../../validationUi";
import type { CriterionTemplate, Triple } from "./types";
import { bodySignature, createEffectSignature, type BodyEffectSignature, type NumericEffect } from "./signatures";

/** Optimizer descriptors only: formal skill definitions and runtime effects are untouched. */
export type BodyMetric = "attackBuff" | "defenseBuff" | "penetrationBuff" | "lifeBuff" |
  "damageBuff" | "normalDamageBuff" | "skillDamageBuff" | "ordinaryReceivedReduction" |
  "normalReceivedReduction" | "skillReceivedReduction" | "enemyAttackDebuff" |
  "enemyDefenseDebuff" | "enemyPenetrationDebuff" | "vulnerability";
type BodyValues = Readonly<Record<BodyMetric, number>>;
type DimensionValues = Readonly<Record<string, number>>;
const metrics: readonly BodyMetric[] = ["attackBuff", "defenseBuff", "penetrationBuff", "lifeBuff", "damageBuff",
  "normalDamageBuff", "skillDamageBuff", "ordinaryReceivedReduction", "normalReceivedReduction",
  "skillReceivedReduction", "enemyAttackDebuff", "enemyDefenseDebuff", "enemyPenetrationDebuff", "vulnerability"];
const registry = new Map(CONFIRMED_HERO_SKILL_DEFINITIONS.map((skill) => [skill.id, skill]));
const epsilon = 1e-10;
export interface BodySkillEffectSignature extends BodyValues {
  readonly delayedSkillCoefficient?: number;
  readonly averageDelayedSkillPerAttack?: number;
  readonly skillId: string;
  readonly skillLevel: number;
  readonly heroDefinitionId: string;
  readonly effectFamily: string;
  readonly targetSide: string;
  readonly troopScope: string;
  readonly triggerType: string;
  readonly probability: number;
  readonly value: number;
  readonly multiplierGroup: string;
  readonly targetRedirect: boolean;
  readonly crossTargetEffect: boolean;
  readonly uncertainty: number;
  readonly specialMechanismFlags: readonly string[];
  readonly hasSpecialMechanisms: boolean;
  readonly stabilityRisk: number;
  readonly dimensions: DimensionValues;
  readonly ordinaryReductionDenominator: number;
  readonly definition: HeroSkillDefinition;
}
export interface BodyMarginalTerm {
  readonly key: string;
  readonly metric: BodyMetric;
  readonly kind: EffectDefinition["kind"];
  readonly group: string;
  readonly enemy: boolean;
  readonly troop: number;
  readonly damageType: "normalAttack" | "skillDamage";
  readonly value: number;
}
export interface BodyComboSignature extends BodyValues {
  readonly delayedSkillCoefficient?: number;
  readonly averageDelayedSkillPerAttack?: number;
  readonly key: string;
  readonly skills: readonly BodySkillEffectSignature[];
  readonly dimensions: DimensionValues;
  readonly terms: readonly BodyMarginalTerm[];
  readonly uncertainty: number;
  readonly stabilityRisk: number;
  readonly specialMechanismFlags: readonly string[];
  readonly hasSpecialMechanisms: boolean;
  readonly ordinaryReductionDenominator: number;
  readonly ordinaryReductionDenominators: Readonly<Record<"shield" | "lancer" | "marksman", number>>;
  readonly channels: BodyEffectSignature["channels"];
  readonly channelCoefficients: Triple;
}
export interface PreprocessedBodyRow {
  readonly ids: readonly string[];
  readonly signature: BodyEffectSignature;
  readonly semantic: BodyComboSignature;
}
export interface BodyPreprocessAudit {
  rawBodyCombinationCount: number;
  rejectedBySameEffectFamily: number;
  rejectedBySkillDominance: number;
  rejectedByProbabilityDominance: number;
  rejectedByParetoDominance: number;
  preprocessedBodyCount: number;
}
export interface BodyPreprocessOptions {
  readonly protectedSkillIds?: readonly string[];
  readonly protectedBodyKeys?: readonly string[];
  /** Injection is useful for mathematical regression fixtures; production uses the actual registry. */
  readonly definitions?: readonly HeroSkillDefinition[];
}
function emptyValues(): Record<BodyMetric, number> { return Object.fromEntries(metrics.map((metric) => [metric, 0])) as Record<BodyMetric, number>; }
function metricFor(effect: { readonly kind: string; readonly attribute?: string; readonly group?: string }, enemy: boolean): BodyMetric | undefined {
  if (effect.kind === "attributeModifier" && !enemy) return ({ attack: "attackBuff", defense: "defenseBuff", penetration: "penetrationBuff", life: "lifeBuff" } as const)[effect.attribute as "attack"];
  if (effect.kind === "attributeReduction" && enemy) return ({ attack: "enemyAttackDebuff", defense: "enemyDefenseDebuff", penetration: "enemyPenetrationDebuff" } as const)[effect.attribute as "attack"];
  if (effect.kind === "defenseReduction" && enemy) return "enemyDefenseDebuff";
  if (effect.kind === "defenseModifier" && !enemy) return "defenseBuff";
  if (effect.kind === "damageIncrease" && !enemy) return effect.group === "normalAttackDamageIncrease" ? "normalDamageBuff" : effect.group === "skillDamageIncrease" ? "skillDamageBuff" : "damageBuff";
  if (effect.kind === "damageReduction" && !enemy) return effect.group === "receivedNormalAttackReduction" ? "normalReceivedReduction" : effect.group === "receivedSkillDamageReduction" ? "skillReceivedReduction" : "ordinaryReceivedReduction";
  if (effect.kind === "incomingDamageIncrease" && enemy) return "vulnerability";
  return undefined;
}
function heroEffectKey(effect: HeroSkillEffect, contexts: readonly string[] = []): string {
  return JSON.stringify([effect.kind, "attribute" in effect ? effect.attribute : "", "group" in effect ? effect.group : "",
    effect.recipient, effect.scope.source, effect.scope.target ?? "all", effect.scope.incomingSourceTroop ?? "all", effect.scope.damageType ?? "all", [...contexts].sort()]);
}
/** Value/probability/hero identity deliberately do not distinguish the primary effect family. */
function primaryFamily(definition: HeroSkillDefinition, level: number): string {
  const effect = definition.levelValues[level]?.effects[0];
  return effect ? heroEffectKey(effect) : `unknown:${definition.id}`;
}
export function bodyPrimaryEffectFamily(skillId: string, level = 5): string {
  const definition = registry.get(skillId); return definition ? primaryFamily(definition, level) : `unknown:${skillId}`;
}
export function hasLegalBodyEffectFamilies(skillIds: readonly string[], maxPerFamily = 2): boolean {
  const counts = new Map<string, number>();
  for (const id of skillIds) { const key = bodyPrimaryEffectFamily(id), count = (counts.get(key) ?? 0) + 1; if (count > maxPerFamily) return false; counts.set(key, count); }
  return true;
}
export function createBodySkillSignature(definition: HeroSkillDefinition, level = 5): BodySkillEffectSignature {
  const atLevel = definition.levelValues[level], probability = atLevel?.probability ?? definition.probability ?? 1;
  const values = emptyValues(), dimensions: Record<string, number> = {}, special = new Set<string>();
  const interval = atLevel?.periodRounds ?? (definition.actionMechanic?.kind === "attackCountTrigger" ? definition.actionMechanic.schedule.interval : 1);
  const weight = probability / Math.max(1, interval);
  if (!atLevel) special.add("missingLevel");
  if (definition.metadata.ruleStatus !== "supported") special.add("unverified");
  if (definition.actionMechanic) special.add(`action:${definition.actionMechanic.kind}`);
  if (interval > 1) special.add("periodic");
  if ((definition.activationTiming ?? "immediate") !== "immediate") special.add("delayedActivation");
  if ((atLevel?.cooldownRounds ?? definition.cooldownRounds ?? 0) > 0) special.add("cooldown");
  if (definition.procEffectFamilyId) special.add(`procAggregation:${definition.procEffectFamilyId}`);
  if (definition.battleContexts) special.add("scenarioContext");
  let rawValue = 0, stabilityRisk = 0;
  for (const effect of atLevel?.effects ?? []) {
    const metric = metricFor(effect, effect.recipient === "enemyArmy");
    if (!metric || !("value" in effect) || effect.value < 0) { special.add(effect.kind); continue; }
    const value = effect.value * weight;
    values[metric] += value; rawValue += effect.value;
    const key = heroEffectKey(effect, definition.battleContexts); dimensions[key] = (dimensions[key] ?? 0) + value;
    stabilityRisk += probability * (1 - probability) * effect.value ** 2;
    if (effect.recipient === "enemyArmy" && effect.scope.target === "currentTarget") special.add("targetBound");
    const lifecycle = effect.lifecycle;
    if (lifecycle && ((lifecycle.activationTiming ?? "immediate") !== "immediate" || lifecycle.refreshMode === "stack" ||
      lifecycle.activeRounds || lifecycle.periodRounds || (lifecycle.durationRounds ?? 1) > 1)) special.add("lifecycleOrRefresh");
  }
  const targetRedirect = atLevel?.effects.some((effect) => effect.kind === "targetingOverride") ?? false;
  const crossTargetEffect = atLevel?.effects.some((effect) => effect.kind === "extraDamage" && effect.scope.target !== "currentTarget") ?? false;
  const scopes = [...new Set(atLevel?.effects.map((effect) => JSON.stringify(effect.scope)) ?? [])].sort().join("|");
  const groups = [...new Set(atLevel?.effects.flatMap((effect) => "group" in effect ? [effect.group] : []) ?? [])].sort().join("|");
  const mark = definition.actionMechanic?.kind === "targetBoundMark" ? definition.actionMechanic : undefined;
  return { ...values, ...(mark ? { delayedSkillCoefficient: mark.damageCoefficient,
    averageDelayedSkillPerAttack: mark.damageCoefficient / mark.schedule.interval } : {}),
    skillId: definition.id, skillLevel: level, heroDefinitionId: definition.heroId,
    effectFamily: primaryFamily(definition, level), targetSide: [...new Set(atLevel?.effects.map((effect) => effect.recipient) ?? [])].sort().join("|"),
    troopScope: scopes, triggerType: definition.trigger, probability, value: rawValue, multiplierGroup: groups, targetRedirect, crossTargetEffect,
    uncertainty: Math.min(.95, (probability < 1 ? .08 : 0) + special.size * .1), specialMechanismFlags: [...special],
    hasSpecialMechanisms: special.size > 0, stabilityRisk, dimensions, ordinaryReductionDenominator: 1 + values.ordinaryReceivedReduction, definition };
}
export type BodySkillDominance = "skillDominance" | "probabilityDominance";
/** Returned reason proves A can be removed; equality alone never deletes a permanent identity. */
export function dominatesBodySkill(a: BodySkillEffectSignature, b: BodySkillEffectSignature): BodySkillDominance | undefined {
  if (a.skillId === b.skillId && a.skillLevel === b.skillLevel || a.hasSpecialMechanisms || b.hasSpecialMechanisms ||
    a.effectFamily !== b.effectFamily || a.targetSide !== b.targetSide || a.troopScope !== b.troopScope || a.multiplierGroup !== b.multiplierGroup) return undefined;
  const keys = new Set([...Object.keys(a.dimensions), ...Object.keys(b.dimensions)]);
  if (!keys.size) return undefined;
  let strict = false;
  for (const key of keys) { const av = a.dimensions[key] ?? 0, bv = b.dimensions[key] ?? 0; if (av > bv + epsilon) return undefined; if (av < bv - epsilon) strict = true; }
  if (a.probability < 1 && b.probability === 1 && (strict || b.stabilityRisk < a.stabilityRisk - epsilon)) return "probabilityDominance";
  if (strict && b.stabilityRisk <= a.stabilityRisk + epsilon && b.uncertainty <= a.uncertainty + epsilon) return "skillDominance";
  return undefined;
}
function numericDimension(effect: NumericEffect): string {
  const definition = effect.effect.definition;
  return JSON.stringify([definition.kind, "attribute" in definition ? definition.attribute : "", "group" in definition ? definition.group : "",
    effect.enemy, effect.holder, definition.scope?.sourceTroops ?? "all", definition.scope?.targetTroops ?? "all",
    definition.scope?.damageTypes ?? "all", definition.scope?.damageSubtypes ?? "all"]);
}
function reductionMetric(metric: BodyMetric): boolean { return metric === "ordinaryReceivedReduction" || metric === "normalReceivedReduction" || metric === "skillReceivedReduction" || metric === "defenseBuff" || metric === "lifeBuff"; }
function termsFor(signature: BodyEffectSignature): BodyMarginalTerm[] {
  const terms = new Map<string, BodyMarginalTerm>();
  for (const effect of signature.effects) {
    const definition = effect.effect.definition, metric = metricFor(definition, effect.enemy);
    if (!metric || !("value" in definition) || !("group" in definition)) continue;
    const incoming = definition.kind === "damageReduction" || definition.kind === "defenseModifier" || definition.kind === "defenseReduction" || definition.kind === "incomingDamageIncrease";
    const troops = incoming ? definition.scope?.targetTroops : definition.scope?.sourceTroops;
    for (const troop of troops ?? TROOP_TYPES) for (const damageType of definition.scope?.damageTypes ?? ["normalAttack", "skillDamage"] as const) {
      const index = TROOP_TYPES.indexOf(troop), key = JSON.stringify([metric, definition.kind, definition.group, effect.enemy, index, damageType]);
      const old = terms.get(key); terms.set(key, { key, metric, group: definition.group, kind: definition.kind, enemy: effect.enemy,
        troop: index, damageType, value: (old?.value ?? 0) + definition.value * effect.effect.stackCount });
    }
  }
  return [...terms.values()];
}
export function createBodyComboSignature(ids: readonly string[], skills: readonly BodySkillEffectSignature[], signature: BodyEffectSignature): BodyComboSignature {
  const dimensions: Record<string, number> = {}, values = emptyValues(), special = new Set(skills.flatMap((skill) => skill.specialMechanismFlags));
  for (const effect of signature.effects) {
    const metric = metricFor(effect.effect.definition, effect.enemy), definition = effect.effect.definition;
    if (metric && "value" in definition) { const key = numericDimension(effect); dimensions[key] = (dimensions[key] ?? 0) + definition.value * effect.effect.stackCount; values[metric] += definition.value * effect.effect.stackCount; }
  }
  if (signature.channels.length) special.add("independentDamageChannel");
  if (signature.redirects.length) special.add("targetRedirect");
  if (signature.flags.hardToStaticize) special.add("unquantifiedMechanism");
  const ordinaryReductionDenominators = Object.fromEntries(TROOP_TYPES.map((troop) => [troop, 1 + signature.effects.reduce((sum, effect) => {
    const definition = effect.effect.definition;
    return metricFor(definition, effect.enemy) === "ordinaryReceivedReduction" && "value" in definition &&
      (!definition.scope?.targetTroops || definition.scope.targetTroops.includes(troop)) &&
      (!definition.scope?.damageTypes || definition.scope.damageTypes.includes("normalAttack")) ? sum + definition.value * effect.effect.stackCount : sum;
  }, 0)])) as Record<"shield" | "lancer" | "marksman", number>;
  const commonOrdinaryReduction = signature.effects.reduce((sum, effect) => {
    const definition = effect.effect.definition;
    return metricFor(definition, effect.enemy) === "ordinaryReceivedReduction" && "value" in definition && !definition.scope?.targetTroops && !definition.scope?.damageTypes ? sum + definition.value * effect.effect.stackCount : sum;
  }, 0);
  const channelCoefficients = [0, 0, 0]; for (const channel of signature.channels) channelCoefficients[channel.source]! += channel.coefficient;
  const marks = targetMarkSourceGroups(skills.map((s) => ({ skill: s.definition })));
  return { ...values, key: ids.join("|"), skills, dimensions, terms: termsFor(signature), uncertainty: signature.uncertainty,
    ...(marks.length ? { delayedSkillCoefficient: marks.reduce((sum, g) => sum + g.coefficient, 0),
      averageDelayedSkillPerAttack: marks.reduce((sum, g) => sum + g.coefficient / g.mechanic.schedule.interval, 0) } : {}),
    stabilityRisk: skills.reduce((sum, skill) => sum + skill.stabilityRisk, 0), specialMechanismFlags: [...special],
    hasSpecialMechanisms: special.size > 0, ordinaryReductionDenominator: 1 + commonOrdinaryReduction, ordinaryReductionDenominators, channels: signature.channels,
    channelCoefficients: channelCoefficients as unknown as Triple };
}
export function dominatesBodyCombo(a: BodyComboSignature, b: BodyComboSignature): boolean {
  if (a.hasSpecialMechanisms || b.hasSpecialMechanisms || a.uncertainty < b.uncertainty - epsilon || a.stabilityRisk < b.stabilityRisk - epsilon) return false;
  const keys = new Set([...Object.keys(a.dimensions), ...Object.keys(b.dimensions)]);
  if (!keys.size) return false;
  let strict = false;
  for (const key of keys) { const av = a.dimensions[key] ?? 0, bv = b.dimensions[key] ?? 0; if (av > bv + epsilon) return false; if (av < bv - epsilon) strict = true; }
  return strict;
}
/** Index supported positive dimensions before comparison; special mechanisms never enter proof. */
export function paretoBodyRows(bodies: readonly PreprocessedBodyRow[], protectedBodies: ReadonlySet<string> = new Set()) {
  const supported = bodies.flatMap((body, index) => body.semantic.hasSpecialMechanisms ? [] : [{ body, index }]);
  const byDimension = new Map<string, typeof supported>();
  const keys = new Map<BodyComboSignature, readonly string[]>();
  for (const row of supported) {
    const active = Object.keys(row.body.semantic.dimensions).filter((key) => row.body.semantic.dimensions[key]! > epsilon);
    keys.set(row.body.semantic, active);
    for (const key of active) { const bucket = byDimension.get(key) ?? []; bucket.push(row); byDimension.set(key, bucket); }
  }
  const rejected = new Set<number>();
  for (const { body, index } of supported) {
    if (protectedBodies.has(body.semantic.key)) continue;
    const active = keys.get(body.semantic)!; if (!active.length) continue;
    let candidates = byDimension.get(active[0]!) ?? [];
    for (const key of active) { const bucket = byDimension.get(key) ?? []; if (bucket.length < candidates.length) candidates = bucket; }
    const a = body.semantic;
    for (const candidate of candidates) {
      if (candidate.index === index) continue;
      const b = candidate.body.semantic;
      if (a.uncertainty < b.uncertainty - epsilon || a.stabilityRisk < b.stabilityRisk - epsilon) continue;
      let strict = false, inferior = true;
      for (const key of active) { const av = a.dimensions[key] ?? 0, bv = b.dimensions[key] ?? 0;
        if (av > bv + epsilon) { inferior = false; break; } if (av < bv - epsilon) strict = true; }
      if (!inferior) continue;
      if (!strict) for (const key of keys.get(b)!) if ((b.dimensions[key] ?? 0) > (a.dimensions[key] ?? 0) + epsilon) { strict = true; break; }
      if (strict) { rejected.add(index); break; }
    }
  }
  return { bodies: bodies.filter((_, index) => !rejected.has(index)), rejected: rejected.size };
}
export function preprocessBodyCombinations(rawRows: readonly { readonly memberSkillIds: readonly string[] }[],
  levelsFor: (ids: readonly string[]) => readonly number[], disabledSkillIds: readonly string[] = [], options: BodyPreprocessOptions = {}) {
  const definitions = options.definitions ? new Map(options.definitions.map((skill) => [skill.id, skill])) : registry;
  const raw = [...new Map(rawRows.map((row) => [row.memberSkillIds.join("|"), row])).values()];
  const audit: BodyPreprocessAudit = { rawBodyCombinationCount: raw.length, rejectedBySameEffectFamily: 0,
    rejectedBySkillDominance: 0, rejectedByProbabilityDominance: 0, rejectedByParetoDominance: 0, preprocessedBodyCount: 0 };
  const skills = new Map<string, BodySkillEffectSignature>(), protectedSkills = new Set(options.protectedSkillIds), protectedBodies = new Set(options.protectedBodyKeys);
  const skillRows = raw.map((row) => {
    const levels = levelsFor(row.memberSkillIds);
    return { ids: row.memberSkillIds, levels, descriptors: row.memberSkillIds.flatMap((id, index) => {
      const definition = definitions.get(id); if (!definition) return [];
      const key = `${id}:${levels[index] ?? 5}`; let value = skills.get(key);
      if (!value) { value = createBodySkillSignature(definition, levels[index] ?? 5); skills.set(key, value); }
      return [value];
    }) };
  });
  const skillDominance: { skillId: string; skillLevel: number; dominatedBy: string; reason: BodySkillDominance }[] = [], dominated = new Map<string, { by: BodySkillEffectSignature; reason: BodySkillDominance }[]>();
  for (const a of skills.values()) {
    if (protectedSkills.has(a.skillId) || disabledSkillIds.includes(a.skillId)) continue;
    for (const b of skills.values()) {
      if (disabledSkillIds.includes(b.skillId)) continue;
      const reason = dominatesBodySkill(a, b); if (!reason) continue;
      const key = `${a.skillId}:${a.skillLevel}`, proofs = dominated.get(key) ?? []; proofs.push({ by: b, reason }); dominated.set(key, proofs);
      skillDominance.push({ skillId: a.skillId, skillLevel: a.skillLevel, dominatedBy: b.skillId, reason });
    }
  }
  const bodies: PreprocessedBodyRow[] = [], rowByKey = new Map(skillRows.map((row) => [row.ids.join("|"), row]));
  for (const row of skillRows) {
    const families = new Map<string, number>(); let illegalFamily = false;
    for (const skill of row.descriptors) { const count = (families.get(skill.effectFamily) ?? 0) + 1; families.set(skill.effectFamily, count); if (count > 2) illegalFamily = true; }
    if (illegalFamily) { audit.rejectedBySameEffectFamily++; continue; }
    // A theoretical skill comparison is not sufficient: the improved replacement must
    // actually exist in this slot/level/required-hero/fixed-prefix search lane.
    const reasons: BodySkillDominance[] = [];
    if (!protectedBodies.has(row.ids.join("|"))) for (const skill of row.descriptors) {
      for (const proof of dominated.get(`${skill.skillId}:${skill.skillLevel}`) ?? []) {
        const positions = row.descriptors.flatMap((value, index) => value.skillId === skill.skillId && value.skillLevel === skill.skillLevel ? [index] : []);
        const replacementIds = row.ids.map((id, index) => positions.includes(index) ? proof.by.skillId : id), replacement = rowByKey.get(replacementIds.join("|"));
        if (!replacement || !positions.every((index) => replacement.descriptors[index] && dominatesBodySkill(row.descriptors[index]!, replacement.descriptors[index]!))) continue;
        const replacementFamilies = new Map<string, number>();
        for (const descriptor of replacement.descriptors) replacementFamilies.set(descriptor.effectFamily, (replacementFamilies.get(descriptor.effectFamily) ?? 0) + 1);
        if ([...replacementFamilies.values()].some((count) => count > 2)) continue;
        reasons.push(proof.reason); break;
      }
      if (reasons.length) break;
    }
    if (reasons.length) { if (reasons.includes("probabilityDominance")) audit.rejectedByProbabilityDominance++; else audit.rejectedBySkillDominance++; continue; }
    const signature = options.definitions ? createEffectSignature(row.descriptors.filter((skill) => !disabledSkillIds.includes(skill.skillId)).map((skill, index) => ({ skill: skill.definition, level: skill.skillLevel, runtimeId: `body-${index}` })), row.ids.join("|") + ":" + row.levels.join(",")) : bodySignature(row.ids, row.levels, disabledSkillIds);
    bodies.push({ ids: row.ids, signature, semantic: createBodyComboSignature(row.ids, row.descriptors, signature) });
  }
  const pareto = paretoBodyRows(bodies, protectedBodies), retained = pareto.bodies;
  audit.rejectedByParetoDominance = pareto.rejected;
  audit.preprocessedBodyCount = retained.length;
  return { bodies: retained, audit, skillDominance };
}

interface MarginalHeadData { readonly baseline: Float64Array; readonly aNormal: readonly number[]; readonly aHp: readonly number[]; readonly bOutput: Triple; readonly bSurvival: Triple; readonly normalShare: number; }
interface PreparedComboVector { readonly indices: Uint32Array; readonly values: Float64Array; }
export interface BodyMarginalModel {
  readonly terms: readonly BodyMarginalTerm[];
  readonly optimisticMaxima: Float64Array;
  readonly optimisticChannels: Float64Array;
  readonly vectors: WeakMap<BodyComboSignature, PreparedComboVector>;
  readonly headCache: WeakMap<BattleState, Partial<Record<SideId,MarginalHeadData>>>;
  /** One active head only: avoid retaining head-count × body-count dense score vectors. */
  scoreHead?: MarginalHeadData;
  scoreVectors: WeakMap<BodyComboSignature, Float64Array>;
}
export interface PreparedBodyMarginalContext {
  readonly model: BodyMarginalModel;
  readonly head: MarginalHeadData;
  readonly ownOutput: Triple;
  readonly ownSurvival: Triple;
}
export function createBodyMarginalModel(bodies: readonly PreprocessedBodyRow[]): BodyMarginalModel {
  const terms = [...new Map(bodies.flatMap((body) => body.semantic.terms).map((term) => [term.key, term])).values()], indices = new Map(terms.map((term, index) => [term.key, index]));
  const optimisticMaxima = new Float64Array(terms.length), optimisticChannels = new Float64Array(3), vectors = new WeakMap<BodyComboSignature, PreparedComboVector>();
  for (const body of bodies) {
    const vector: PreparedComboVector = { indices: Uint32Array.from(body.semantic.terms.map((term) => indices.get(term.key)!)), values: Float64Array.from(body.semantic.terms.map((term) => term.value)) };
    vectors.set(body.semantic, vector);
    for (let i = 0; i < 3; i++) optimisticChannels[i] = Math.max(optimisticChannels[i]!, body.semantic.channelCoefficients[i]!);
    for (let i = 0; i < vector.indices.length; i++) { const index = vector.indices[i]!; optimisticMaxima[index] = Math.max(optimisticMaxima[index]!, vector.values[i]!); }
  }
  return { terms, optimisticMaxima, optimisticChannels, vectors, headCache: new WeakMap(), scoreVectors: new WeakMap() };
}
function normalize(values: readonly number[]): Triple { const total = values.reduce((sum, value) => sum + value, 0); return values.map((value) => total > 0 ? value / total : 0) as unknown as Triple; }
function termMatches(effect: NumericEffect, term: BodyMarginalTerm): boolean {
  const definition = effect.effect.definition, metric = metricFor(definition, effect.enemy);
  if (metric !== term.metric || definition.kind !== term.kind || !("group" in definition) || definition.group !== term.group || effect.enemy !== term.enemy || effect.holder >= 0 && effect.holder !== term.troop) return false;
  const incoming = definition.kind === "damageReduction" || definition.kind === "defenseModifier" || definition.kind === "defenseReduction" || definition.kind === "incomingDamageIncrease";
  const troops = incoming ? definition.scope?.targetTroops : definition.scope?.sourceTroops;
  return (!troops || troops.includes(TROOP_TYPES[term.troop]!)) && (!definition.scope?.damageTypes || definition.scope.damageTypes.includes(term.damageType));
}
/** The effect walk and same-group B calculation run once per head, never once per ratio/body. */
export function prepareBodyMarginalContext(state: BattleState, ratios: RallyTroopRatios, model: BodyMarginalModel, template?: CriterionTemplate,candidateSide:SideId="A"): PreparedBodyMarginalContext {
  const cached=model.headCache.get(state),own=candidateSide==="A"?state.sideA:state.sideB,enemy=candidateSide==="A"?state.sideB:state.sideA;
  const ownTemplate=candidateSide==="A"?template?.a:template?.b,enemyTemplate=candidateSide==="A"?template?.b:template?.a;
  let head = cached?.[candidateSide];
  if (!head) {
    const effects: NumericEffect[] = ([own, enemy] as const).flatMap((side, index) => [
      ...side.armyEffects.map((effect) => ({ effect, enemy: index === 1, holder: -1 })),
      ...TROOP_TYPES.flatMap((troop, holder) => [...side.troops[troop].buffs, ...side.troops[troop].debuffs].map((effect) => ({ effect, enemy: index === 1, holder }))) ]);
    const baseline = Float64Array.from(model.terms.map((term) => {
      const seen = new Set<string>(); let value = 0;
      for (const effect of effects) if (termMatches(effect, term) && !seen.has(effect.effect.instanceId)) {
        seen.add(effect.effect.instanceId); if ("value" in effect.effect.definition) value += effect.effect.definition.value * effect.effect.stackCount;
      }
      const attribute = term.metric === "attackBuff" ? "attack" : term.metric === "defenseBuff" ? "defense" : term.metric === "penetrationBuff" ? "penetration" : term.metric === "lifeBuff" ? "life" : undefined;
      if (attribute && !term.enemy && term.group === `buff${attribute[0]!.toUpperCase()}${attribute.slice(1)}`)
        value += own.troops[TROOP_TYPES[term.troop]!].reportAttributeContext?.[attribute]?.targetBuff ?? 0;
      return value;
    }));
    const aNormal = ownTemplate?.normal ?? [1, 1, 1, 3, 3, 3, 4, 4, 4], aHp = ownTemplate?.hp ?? [300, 100, 75];
    const bCounts = enemyTemplate?.counts ?? TROOP_TYPES.map((troop) => enemy.troops[troop].aliveCount);
    const bNormal = enemyTemplate?.normal ?? [1, 1, 1, 3, 3, 3, 4, 4, 4], bHp = enemyTemplate?.hp ?? [300, 100, 75];
    const extra = ownTemplate?.channels.filter((channel) => channel.kind !== "normalAttack").reduce((sum, channel) => sum + channel.coefficient, 0) ?? 0;
    head = { baseline, aNormal, aHp, bOutput: normalize(bCounts.map((count, index) => Math.sqrt(count) * bNormal[index * 3]!)),
      bSurvival: normalize(bCounts.map((count, index) => count * bHp[index]!)), normalShare: 1 / (1 + extra / 3) };
    model.headCache.set(state, {...cached,[candidateSide]:head});
  }
  const counts = TROOP_TYPES.map((troop) => ratios[troop]);
  return { model, head, ownOutput: normalize(counts.map((count, index) => Math.sqrt(count) * head.aNormal[index * 3]!)),
    ownSurvival: normalize(counts.map((count, index) => count * head.aHp[index]!)) };
}
function termWeight(term: BodyMarginalTerm, context: PreparedBodyMarginalContext): number {
  const survival = reductionMetric(term.metric) || term.metric === "enemyDefenseDebuff" || term.metric === "vulnerability";
  const shares = term.enemy ? survival ? context.head.bSurvival : context.head.bOutput : survival ? context.ownSurvival : context.ownOutput;
  return shares[term.troop]! * (term.damageType === "normalAttack" ? context.head.normalShare : 1 - context.head.normalShare);
}
export function roughBodyMarginalScore(semantic: BodyComboSignature, context: PreparedBodyMarginalContext): number {
  const vector = context.model.vectors.get(semantic); if (!vector) throw new Error("Body signature was not prepared in the current marginal model.");
  const model = context.model;
  if (model.scoreHead !== context.head) { model.scoreHead = context.head; model.scoreVectors = new WeakMap(); }
  let coefficients = model.scoreVectors.get(semantic);
  if (!coefficients) {
    coefficients = new Float64Array(7);
    for (let i = 0; i < vector.indices.length; i++) {
      const index = vector.indices[i]!, term = model.terms[index]!, baseline = Math.max(-.99, context.head.baseline[index]!);
      const marginal = Math.log((1 + baseline + vector.values[i]!) / (1 + baseline));
      if (term.enemy) coefficients[6]! += termWeight(term, context) * marginal;
      else {
        const survival = reductionMetric(term.metric) || term.metric === "enemyDefenseDebuff" || term.metric === "vulnerability";
        const share = term.damageType === "normalAttack" ? context.head.normalShare : 1 - context.head.normalShare;
        coefficients[(survival ? 3 : 0) + term.troop]! += marginal * share;
      }
    }
    for (let i = 0; i < 3; i++) coefficients[i]! += Math.log1p(semantic.channelCoefficients[i]!);
    model.scoreVectors.set(semantic, coefficients);
  }
  return coefficients[6]! + context.ownOutput[0] * coefficients[0]! + context.ownOutput[1] * coefficients[1]! +
    context.ownOutput[2] * coefficients[2]! + context.ownSurvival[0] * coefficients[3]! +
    context.ownSurvival[1] * coefficients[4]! + context.ownSurvival[2] * coefficients[5]!;
}
/** Independent per-group maxima are an optimistic envelope, not a realizable four-slot combo. */
export function optimisticBodyPotential(context: PreparedBodyMarginalContext, model: BodyMarginalModel = context.model): number {
  let score = 0;
  for (let i = 0; i < model.terms.length; i++) { const baseline = Math.max(-.99, context.head.baseline[i]!);
    score += termWeight(model.terms[i]!, context) * Math.log((1 + baseline + model.optimisticMaxima[i]!) / (1 + baseline)); }
  for (let i = 0; i < 3; i++) score += context.ownOutput[i]! * Math.log1p(model.optimisticChannels[i]!);
  return score;
}
