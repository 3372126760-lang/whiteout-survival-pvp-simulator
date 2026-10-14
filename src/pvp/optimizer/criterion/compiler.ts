import { createValidationPreviewState, type ValidationBattleInput } from "../../validationUi";
import { calculateBaseTroopDamage, calculateTroopHp } from "../../formulas";
import { createDamageEvent } from "../../damage";
import { resolveTroopAttribute, computeGroupedMultiplier, matchesEffectScope } from "../../effects";
import { TROOP_TYPES, type BattleState, type SideId } from "../../types";
import { DEFAULT_TARGET_PRIORITY } from "../../constants";
import { stateBindings, createEffectSignature, applyEffectSignature, type BodyEffectSignature } from "./signatures";
import type { CriterionSide, CriterionTemplate, Triple, AttackChannel } from "./types";
export interface CriterionHeadTemplate { readonly state: BattleState; readonly signatures: readonly [BodyEffectSignature, BodyEffectSignature]; }
export function prepareCriterionHead(input: ValidationBattleInput): CriterionHeadTemplate {
  return prepareCriterionState(createValidationPreviewState(input), input.disabledSkillIds);
}
export function prepareCriterionState(initial: BattleState, disabledSkillIds: readonly string[] = []): CriterionHeadTemplate {
  let state = initial;
  const signatures = (["A", "B"] as const).map((side) => createEffectSignature(stateBindings(state, side).filter((b) => !disabledSkillIds.includes(b.skill.id)), "criterion:" + side)) as [BodyEffectSignature, BodyEffectSignature];
  for (const [i, side] of (["A", "B"] as const).entries()) state = applyEffectSignature(state, signatures[i]!, side);
  return { state, signatures };
}

function compileSide(state: BattleState, side: SideId, signatures: readonly BodyEffectSignature[]): CriterionSide {
  const own = side === "A" ? state.sideA : state.sideB, enemy: SideId = side === "A" ? "B" : "A";
  const normal: number[] = [], skill: number[] = [], hp: number[] = [];
  const priorities = TROOP_TYPES.map(() => DEFAULT_TARGET_PRIORITY.map((t) => TROOP_TYPES.indexOf(t)));
  const channels: AttackChannel[] = TROOP_TYPES.map((_, source) => ({ source, kind: "normalAttack", coefficient: 1, target: "priority" }));
  for (const signature of signatures) {
    channels.push(...signature.channels);
    for (const redirect of signature.redirects) {
      const main = channels.findIndex((c) => c.kind === "normalAttack" && c.source === redirect.source);
      if (main >= 0) channels[main] = { ...channels[main]!, redirectProbability: redirect.probability, redirectPriority: redirect.priority };
    }
  }
  for (const type of TROOP_TYPES) for (const target of TROOP_TYPES) {
    const context = { targetTroop: target, damageType: "normalAttack" as const };
    const troop = own.troops[type];
    const baseEffects = [...own.armyEffects, ...troop.buffs].filter((e) => e.definition.kind === "baseDamageMultiplier" &&
      matchesEffectScope(e.definition.scope, { sourceSide: side, targetSide: enemy, sourceTroop: type, targetTroop: target, damageType: "normalAttack", damageSubtype: "normalAttack", round: 1, actionOrder: 0 }));
    const baseMultiplier = computeGroupedMultiplier(baseEffects.map((effect) => ({ ...effect,
      definition: { ...effect.definition, kind: "damageIncrease" as const, group: "group" in effect.definition ? effect.definition.group : "base", value: "value" in effect.definition ? effect.definition.value : 0 } }))).combined;
    const baseDamage = calculateBaseTroopDamage({ fixedInitialMinTroops: 1, aliveCount: 1,
      damageCoefficient: troop.damageCoefficient, troopConstant: troop.troopConstant,
      attack: resolveTroopAttribute(own, type, "attack", 1, context).effectiveValue,
      penetration: resolveTroopAttribute(own, type, "penetration", 1, context).effectiveValue }).damage * baseMultiplier;
    const event = { id: "criterion-unit", round: 1, actionOrder: 0, sourceSide: side, sourceTroop: type, targetSide: enemy, targetTroop: target, baseDamage };
    normal.push(createDamageEvent({ ...event, damageType: "normalAttack", damageSubtype: "normalAttack" }, state).modifiedDamage);
    skill.push(createDamageEvent({ ...event, damageType: "skillDamage", damageSubtype: "extraDamage" }, state).modifiedDamage);
  }
  for (const type of TROOP_TYPES) hp.push(calculateTroopHp({ troopConstant: own.troops[type].troopConstant,
    troopHpCoefficient: own.troops[type].troopHpCoefficient, life: resolveTroopAttribute(own, type, "life", 1, { targetTroop: "shield", damageType: "normalAttack" }).effectiveValue }).effectiveHpPerUnit);
  return { counts: TROOP_TYPES.map((t) => own.troops[t].aliveCount) as unknown as Triple, normal, skill, hp: hp as unknown as Triple, priorities, channels,
    flags: { probabilityApproximation: signatures.some((s) => s.flags.probabilityApproximation), roundSkillApproximation: signatures.some((s) => s.flags.roundSkillApproximation), targetRedirect: signatures.some((s) => s.flags.targetRedirect), hardToStaticize: signatures.some((s) => s.flags.hardToStaticize) },
    uncertainty: Math.min(.95, signatures.reduce((n, s) => n + s.uncertainty, 0)), omittedMechanisms: signatures.flatMap((s) => s.omittedMechanisms) };
}
export function compileCriterionTemplate(head: CriterionHeadTemplate, body?: BodyEffectSignature, side: SideId = "A"): CriterionTemplate {
  const state = body ? applyEffectSignature(head.state, body, side) : head.state;
  return { a: compileSide(state, "A", [head.signatures[0], ...(body && side === "A" ? [body] : [])]),
    b: compileSide(state, "B", [head.signatures[1], ...(body && side === "B" ? [body] : [])]) };
}
export function createCriterionTemplate(input: ValidationBattleInput): CriterionTemplate { return compileCriterionTemplate(prepareCriterionHead(input)); }
