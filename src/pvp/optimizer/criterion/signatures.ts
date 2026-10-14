import { CONFIRMED_HERO_SKILL_DEFINITIONS, type HeroSkillDefinition } from "../../heroSkills";
import { CONFIRMED_TROOP_SKILL_DEFINITIONS, type TroopSkillDefinition } from "../../troopSkills";
import { createActiveEffect } from "../../effects";
import { TROOP_TYPES, isBattleContextAllowedForSide, type ActiveEffect, type BattleState, type EffectDefinition, type SideId } from "../../types";
import type { AttackChannel, CriterionFlags } from "./types";
type Definition = HeroSkillDefinition | TroopSkillDefinition;
export interface SignatureBinding { skill: Definition; level: number; source?: number; runtimeId: string; }
export interface NumericEffect { effect: ActiveEffect; enemy: boolean; holder: number; }
export interface BodyEffectSignature {
  readonly key: string;
  readonly effects: readonly NumericEffect[];
  readonly channels: readonly AttackChannel[];
  readonly redirects: readonly { source: number; probability: number; priority: readonly number[] }[];
  readonly uncertainty: number;
  readonly flags: CriterionFlags;
  readonly omittedMechanisms: readonly string[];
  readonly structure: string;
  /** Rough first-order projection only; full C2 uses official scoped effect resolution. */
  readonly rough: Float64Array;
}
const heroes = new Map(CONFIRMED_HERO_SKILL_DEFINITIONS.map((s) => [s.id, s]));
const troops = new Map(CONFIRMED_TROOP_SKILL_DEFINITIONS.map((s) => [s.id, s]));
const numericKinds = new Set(["attributeModifier", "attributeReduction", "damageIncrease", "damageReduction", "outgoingDamageReduction", "incomingDamageIncrease", "defenseModifier", "defenseReduction", "baseDamageMultiplier", "baseDefenseMultiplier", "directDamageCancellation"]);
export function stateBindings(state: BattleState, side: SideId): SignatureBinding[] {
  const own = side === "A" ? state.sideA : state.sideB;
  return [...own.heroStates.flatMap((hero) => hero.skillStates.filter((r) => r.enabled).flatMap((r) => {
    const skill = heroes.get(r.skillId); return skill && isBattleContextAllowedForSide(skill.battleContexts,state.battleContext,side)
      ? [{ skill, level: r.level, runtimeId: hero.runtimeInstanceId ?? hero.heroId }] : [];
  })), ...TROOP_TYPES.flatMap((type, source) => own.troops[type].skillStates.filter((r) => r.enabled).flatMap((r) => {
    const skill = troops.get(r.skillId); return skill ? [{ skill, level: r.level, source, runtimeId: type }] : [];
  }))];
}
export function createEffectSignature(bindings: readonly SignatureBinding[], key: string): BodyEffectSignature {
  const effects: NumericEffect[] = [], channels: AttackChannel[] = [], redirects: { source: number; probability: number; priority: readonly number[] }[] = [];
  const omitted = new Set<string>(), rough = new Float64Array(6);
  const flags: CriterionFlags = { probabilityApproximation: false, roundSkillApproximation: false, targetRedirect: false, hardToStaticize: false };
  let uncertainty = 0;
  const families = new Map<string, { skill: HeroSkillDefinition; probability: number; binding: SignatureBinding }>();
  const compile = (binding: SignatureBinding, pOverride?: number) => {
    const { skill } = binding, level = skill.levelValues[binding.level]; if (!level) return;
    const p = pOverride ?? level.probability ?? skill.probability ?? 1;
    const periodic = level.periodRounds !== undefined || ("actionMechanic" in skill && skill.actionMechanic !== undefined);
    const interval = "actionMechanic" in skill && skill.actionMechanic?.kind === "attackCountTrigger" ? skill.actionMechanic.schedule.interval : level.periodRounds ?? 1;
    const weight = p / Math.max(1, interval);
    if (p < 1) { flags.probabilityApproximation = true; uncertainty += .08; }
    if (periodic) { flags.roundSkillApproximation = true; uncertainty += .15; }
    if (skill.metadata.ruleStatus !== "supported") { flags.hardToStaticize = true; uncertainty += .15; omitted.add(`${skill.id}:unverified`); }
    if ("actionMechanic" in skill && skill.actionMechanic && !["attackCountTrigger", "naturalRoundTrigger"].includes(skill.actionMechanic.kind)) {
      flags.hardToStaticize = true; uncertainty += .15; omitted.add(`${skill.id}:${skill.actionMechanic.kind}`);
    }
    for (const effect of level.effects) {
      const source = effect.scope.source === "army" ? -1 : effect.scope.source === "self" ? binding.source ?? -1 : TROOP_TYPES.indexOf(effect.scope.source);
      const sources = source < 0 ? [0, 1, 2] : [source];
      if (effect.kind === "targetingOverride") {
        flags.targetRedirect = true;
        for (const source of sources) redirects.push({ source, probability: p, priority: effect.priority.map((t) => TROOP_TYPES.indexOf(t)) });
        continue;
      }
      if (effect.kind === "sameMainAttackSegment") {
        for (const source of sources) channels.push({ source, kind: "additionalAttack", coefficient: weight * effect.damageScale, target: "current" });
        continue;
      }
      if (effect.kind === "extraDamage") {
        for (const source of sources) channels.push({ source, kind: "extraDamage", coefficient: weight * effect.coefficient,
          target: effect.scope.target === "all" ? "all" : effect.scope.target === undefined || effect.scope.target === "currentTarget" ? "current" : TROOP_TYPES.indexOf(effect.scope.target) });
        rough[0]! += weight * effect.coefficient * .5;
        if (effect.basis !== "parentBaseDamage") { flags.hardToStaticize = true; omitted.add(`${skill.id}:extra damage basis/correlation`); uncertainty += .08; }
        continue;
      }
      if (!numericKinds.has(effect.kind) || !("value" in effect)) {
        flags.hardToStaticize = true; uncertainty += .1; omitted.add(`${skill.id}:${effect.kind}`); continue;
      }
      if (effect.lifecycle && ((effect.lifecycle.activationTiming ?? "immediate") !== "immediate" || effect.lifecycle.activeRounds || effect.lifecycle.periodRounds || effect.lifecycle.refreshMode === "stack")) {
        flags.roundSkillApproximation = true; flags.hardToStaticize = true; uncertainty += .1;
        omitted.add(`${skill.id}:lifecycle/refresh proxy`);
      }
      const enemy = "recipient" in effect && effect.recipient === "enemyArmy";
      if (enemy && effect.scope.target === "currentTarget") {
        flags.hardToStaticize = true; uncertainty += .15; omitted.add(`${skill.id}:target-bound debuff`); continue;
      }
      if ("linkedToSkillId" in effect && effect.linkedToSkillId) {
        flags.hardToStaticize = true; uncertainty += .1; omitted.add(`${skill.id}:linked proc dependency`); continue;
      }
      const defensive = ["damageReduction", "defenseModifier", "baseDefenseMultiplier", "directDamageCancellation"].includes(effect.kind);
      const scope = {
        ...(defensive ? effect.scope.incomingSourceTroop ? { sourceTroops: [effect.scope.incomingSourceTroop] } : {} : source >= 0 ? { sourceTroops: [TROOP_TYPES[source]!] } : {}),
        ...(effect.scope.target && !["all", "currentTarget"].includes(effect.scope.target) ? { targetTroops: [effect.scope.target as typeof TROOP_TYPES[number]] } : {}),
        ...(effect.scope.damageType && effect.scope.damageType !== "all" ? { damageTypes: [effect.scope.damageType] } : {}),
      };
      const definition = { ...effect, value: effect.value * weight, scope, lifecycle: undefined, ruleStatus: skill.metadata.ruleStatus } as unknown as EffectDefinition;
      effects.push({ enemy, holder: "heroId" in skill ? -1 : binding.source ?? -1, effect: createActiveEffect({
        identity: { sourceId: key + ":" + binding.runtimeId, sourceSkillId: skill.id, effectId: effect.id }, definition, appliedRound: 1 }) });
      const v = effect.value * weight;
      if (effect.kind === "attributeModifier") rough[effect.attribute === "attack" || effect.attribute === "penetration" ? 0 : 1]! += v;
      else if (effect.kind === "attributeReduction") rough[effect.attribute === "attack" || effect.attribute === "penetration" ? 3 : 2]! += v;
      else if (effect.kind === "damageIncrease" || effect.kind === "incomingDamageIncrease" || effect.kind === "defenseReduction") rough[0]! += v;
      else rough[1]! += v;
    }
  };
  for (const binding of bindings) {
    const skill = binding.skill;
    if ("procEffectFamilyId" in skill && skill.procEffectFamilyId) {
      const p = skill.levelValues[binding.level]?.probability ?? skill.probability ?? 1;
      const old = families.get(skill.procEffectFamilyId);
      families.set(skill.procEffectFamilyId, { skill, binding, probability: 1 - (1 - (old?.probability ?? 0)) * (1 - p) });
    } else compile(binding);
  }
  for (const { binding, probability } of families.values()) compile(binding, probability);
  return { key, effects, channels, redirects, uncertainty: Math.min(.95, uncertainty), flags, omittedMechanisms: [...omitted], rough,
    structure: [...new Set(bindings.flatMap((b) => b.skill.levelValues[b.level]?.effects.map((e) => e.kind + ("group" in e ? ":" + e.group : "")) ?? []))].sort().join("|") };
}
export function bodySignature(skillIds: readonly string[], levels: Readonly<Record<string, number>> | readonly number[] = {}, disabledSkillIds:readonly string[]=[]): BodyEffectSignature {
  const selected=skillIds.map((id,i)=>Array.isArray(levels)?levels[i]??5:(levels as Readonly<Record<string,number>>)[id]??5);
  return createEffectSignature(skillIds.flatMap((id, i) => { const skill = heroes.get(id); return skill&&!disabledSkillIds.includes(id) ? [{ skill, level: selected[i]!, runtimeId: `body-${i}` }] : []; }), skillIds.join("|")+":"+selected.join(",")+":off:"+skillIds.filter((id)=>disabledSkillIds.includes(id)).join(","));
}
export function applyEffectSignature(state: BattleState, signature: BodyEffectSignature, side: SideId): BattleState {
  const key = side === "A" ? "sideA" : "sideB", other = side === "A" ? "sideB" : "sideA";
  const apply = (own: BattleState["sideA"], enemy: boolean) => ({ ...own,
    armyEffects: [...own.armyEffects, ...signature.effects.filter((e) => e.enemy === enemy && e.holder < 0).map((e) => e.effect)],
    troops: Object.fromEntries(TROOP_TYPES.map((type, i) => [type, { ...own.troops[type], buffs: [...own.troops[type].buffs,
      ...signature.effects.filter((e) => e.enemy === enemy && e.holder === i).map((e) => e.effect)] }])) as unknown as BattleState["sideA"]["troops"] });
  return { ...state, [key]: apply(state[key], false), [other]: apply(state[other], true) };
}
