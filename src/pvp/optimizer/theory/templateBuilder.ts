import { isBattleContextAllowedForSide } from "../../types";
import { createValidationPreviewState, type ValidationBattleInput } from "../../validationUi";
import { targetMarkSourceGroups } from "../../heroSkills/targetMarkStacking";
import { stateBindings } from "../criterion/signatures";
import { CONFIRMED_HERO_SKILL_DEFINITIONS, createHeroSkillSystem,
  type HeroSkillDefinition, type HeroSkillEffect } from "../../heroSkills";
import { CONFIRMED_TROOP_SKILL_DEFINITIONS, createTroopSkillSystem,
  type TroopSkillDefinition, type TroopSkillEffect } from "../../troopSkills";
import { calculateBaseTroopDamage, calculateTroopHp } from "../../formulas";
import { createDamageEvent } from "../../damage";
import { resolveTroopAttribute, matchesEffectScope, computeGroupedMultiplier } from "../../effects";
import { TROOP_TYPES, sideFromState, type BattleState, type SideId } from "../../types";
import type { ProbabilityEquivalent, TheoryOptions, TheoryTemplate, TheoryTemplateBuilder } from "./types";

import { createExpectationProgram } from "./expectationProgram";

type Skill = HeroSkillDefinition | TroopSkillDefinition;
type Effect = HeroSkillEffect | TroopSkillEffect;
const heroById = new Map(CONFIRMED_HERO_SKILL_DEFINITIONS.map((skill) => [skill.id, skill]));
const troopById = new Map(CONFIRMED_TROOP_SKILL_DEFINITIONS.map((skill) => [skill.id, skill]));
const NO_RANDOM = { next: (): number => { throw new Error("Theory estimation must not roll random skills."); } };

function complexSkill(skill: Skill, level: Skill["levelValues"][number]): boolean {
  return ("actionMechanic" in skill && skill.actionMechanic !== undefined) ||
    level.periodRounds !== undefined || (level.durationRounds ?? skill.durationRounds ?? 1) > 1 ||
    (level.cooldownRounds ?? skill.cooldownRounds ?? 0) > 0 ||
    ("activationTiming" in skill && skill.activationTiming !== undefined && skill.activationTiming !== "immediate");
}
function simpleEffect(effect: Effect): boolean {
  const lifecycle = effect.lifecycle;
  if (lifecycle !== undefined && ((lifecycle.durationRounds ?? 1) > 1 ||
    lifecycle.periodRounds !== undefined || lifecycle.activeRounds !== undefined ||
    lifecycle.firstActiveRound !== undefined || lifecycle.activeWindowRounds !== undefined ||
    lifecycle.refreshMode === "stack" ||
    lifecycle.maxStacks !== undefined || (lifecycle.activationTiming ?? "immediate") !== "immediate")) return false;
  if ("linkedToSkillId" in effect && effect.linkedToSkillId !== undefined) return false;
  if ("recipient" in effect && effect.recipient === "enemyArmy" && effect.scope.target === "currentTarget") return false;
  switch (effect.kind) {
    case "attributeModifier": case "attributeReduction": case "damageIncrease":
    case "damageReduction": case "outgoingDamageReduction": case "incomingDamageIncrease":
    case "defenseReduction": case "baseDefenseMultiplier": case "baseDamageMultiplier":
    case "directDamageCancellation": return true;
    case "extraDamage": return effect.scope.target === undefined || effect.scope.target === "currentTarget";
    default: return false;
  }
}
function numericValue(effect: Effect): number {
  return effect.kind === "extraDamage" ? effect.coefficient : "value" in effect ? effect.value : 0;
}
function equivalent(skill: Skill, effect: Effect, probability: number, options: TheoryOptions): ProbabilityEquivalent {
  const mathematicalExpectation = probability * numericValue(effect);
  const calibratedEquivalent = options.calibratedEquivalents[effect.id];
  return { skillId: skill.id, effectId: effect.id, mathematicalExpectation,
    ...(calibratedEquivalent === undefined ? {} : { calibratedEquivalent }),
    usedEquivalent: calibratedEquivalent ?? mathematicalExpectation * (probability < 1 ? options.probabilityEquivalentCoefficient : 1) };
}
/** Copies used only by the estimator. Original registered skill data is never changed. */
function approximateDefinition<T extends Skill>(skill: T, options: TheoryOptions): T {
  // This private passive estimator copy no longer describes a proc family.
  // Keep the marker on the registered skill and its formal runtime only.
  const { procEffectFamilyId, ...numericDefinition } = skill as Skill & Pick<HeroSkillDefinition, "procEffectFamilyId">;
  void procEffectFamilyId;
  return { ...numericDefinition, trigger: "passive", probability: 1,
    levelValues: Object.fromEntries(Object.entries(skill.levelValues).map(([key, level]) => {
      const effects = complexSkill(skill, level) ? [] : level.effects.filter((effect: Effect) => simpleEffect(effect) && effect.kind !== "extraDamage")
        .map((effect: Effect) => ({ ...effect, value: equivalent(skill, effect,
          level.probability ?? skill.probability ?? 1, options).usedEquivalent }));
      return [key, { effects, probability: 1 }];
    })),
  } as T;
}
function contextAllows(skill: HeroSkillDefinition, state: BattleState, side: SideId): boolean {
  return isBattleContextAllowedForSide(skill.battleContexts, state.battleContext, side);
}

/** Builds just one numeric coefficient template per lineup, not per ratio/trial.
 * Uses official scenario conversion, scoped attribute resolution, damage groups,
 * troop constants, HP and skill effect compilers. No formal rounds are executed. */
export function createTheoryTemplateBuilder(options: TheoryOptions): TheoryTemplateBuilder {
  const heroDefinitions = CONFIRMED_HERO_SKILL_DEFINITIONS.map((skill) => approximateDefinition(skill, options));
  const troopDefinitions = CONFIRMED_TROOP_SKILL_DEFINITIONS.map((skill) => approximateDefinition(skill, options));
  const overrides = Object.fromEntries([...heroDefinitions, ...troopDefinitions].map((skill) => [skill.id, true]));
  const heroSystem = createHeroSkillSystem({ definitions: heroDefinitions, randomSource: NO_RANDOM, triggerOverrides: overrides, recordTrace: false });
  const troopSystem = createTroopSkillSystem({ definitions: troopDefinitions, randomSource: NO_RANDOM, triggerOverrides: overrides, recordTrace: false });
  return (input: ValidationBattleInput, targetSide: SideId = "A"): TheoryTemplate => {
    const initial = createValidationPreviewState(input);
    const disabled = new Set(input.disabledSkillIds);
    const filterSide = (side: BattleState["sideA"]) => ({ ...side,
      heroStates: side.heroStates.map((hero) => ({ ...hero, skillStates: hero.skillStates.filter((runtime) => !disabled.has(runtime.skillId)) })),
      troops: Object.fromEntries(TROOP_TYPES.map((troop) => [troop, { ...side.troops[troop],
        skillStates: side.troops[troop].skillStates.filter((runtime) => !disabled.has(runtime.skillId)) }])) as unknown as BattleState["sideA"]["troops"] });
    const state = heroSystem.prepareRound(troopSystem.prepareRound({ ...initial,
      sideA: filterSide(initial.sideA), sideB: filterSide(initial.sideB) }).state).state;
    const probabilityEquivalents: ProbabilityEquivalent[] = [];
    const omitted = new Set<string>();
    const uncertainties = { A: 0, B: 0 };
    const extras: Record<SideId, { effect: Extract<Effect, { kind: "extraDamage" }>; value: number; troop?: string }[]> = { A: [], B: [] };
    for (const side of ["A", "B"] as const) {
      const before = sideFromState(initial, side);
      for (const group of targetMarkSourceGroups(stateBindings(initial, side).filter((b) => !disabled.has(b.skill.id)))) {
        const mechanic = group.mechanic;
        extras[side].push({ effect: { id: `theory:${group.key}`, name: "delayed marked-target skill proxy",
          kind: "extraDamage", recipient: "selfArmy", coefficient: group.coefficient,
          basis: "parentBaseDamage", scope: { source: mechanic.schedule.source, target: "currentTarget", damageType: "skillDamage" } },
          value: group.coefficient / mechanic.schedule.interval });
        omitted.add(`${group.sources[0]!.skill.id}:merged delayed coefficient=${group.coefficient}; sources=${group.sources.length}; ${mechanic.duplicateSourceStacking?.ruleStatus ?? "additive"}; static delay/target proxy`);
      }
      const inspect = (skill: Skill | undefined, levelNumber: number, enabled: boolean, troop?: string) => {
        if (skill === undefined || !enabled || disabled.has(skill.id) ||
          ("heroId" in skill && !contextAllows(skill, initial, side))) return;
        const level = skill.levelValues[levelNumber]; if (level === undefined) return;
        const probability = level.probability ?? skill.probability ?? 1;
        if (probability < 1) uncertainties[side] += .035;
        if (skill.metadata.ruleStatus !== "supported") uncertainties[side] += .04;
        if (complexSkill(skill, level)) {
          omitted.add(`${skill.id}:schedule/control/lifecycle`); uncertainties[side] += .08; return;
        }
        for (const effect of level.effects) {
          if (!simpleEffect(effect)) { omitted.add(`${skill.id}:${effect.kind}`); uncertainties[side] += .045; continue; }
          const record = equivalent(skill, effect, probability, options);
          if (probability < 1) probabilityEquivalents.push(record);
          if (effect.kind === "extraDamage") extras[side].push({ effect, value: record.usedEquivalent,
            ...(troop === undefined ? {} : { troop }) });
        }
      };
      for (const hero of before.heroStates) for (const runtime of hero.skillStates)
        inspect(heroById.get(runtime.skillId), runtime.level, runtime.enabled);
      for (const troop of TROOP_TYPES) for (const runtime of before.troops[troop].skillStates)
        inspect(troopById.get(runtime.skillId), runtime.level, runtime.enabled, troop);
    }
    const results = (["A", "B"] as const).map((side) => {
      const own = sideFromState(state, side);
      const enemy: SideId = side === "A" ? "B" : "A";
      const damage: number[] = [], normalDamage: number[] = [], mitigation: number[] = [];
      for (const troop of TROOP_TYPES) for (const target of TROOP_TYPES) {
        const context = { targetTroop: target, damageType: "normalAttack" as const };
        const attack = resolveTroopAttribute(own, troop, "attack", 1, context).effectiveValue;
        const penetration = resolveTroopAttribute(own, troop, "penetration", 1, context).effectiveValue;
        const stack = own.troops[troop];
        const baseEffects = [...own.armyEffects, ...stack.buffs].filter((effect) =>
          effect.definition.kind === "baseDamageMultiplier" && matchesEffectScope(effect.definition.scope,
            { sourceSide: side, targetSide: enemy, sourceTroop: troop, targetTroop: target,
              damageType: "normalAttack", damageSubtype: "normalAttack", round: 1, actionOrder: 0 }));
        const baseMultiplier = computeGroupedMultiplier(baseEffects.map((effect) => ({ ...effect,
          definition: { ...effect.definition, kind: "damageIncrease" as const,
            group: "group" in effect.definition ? effect.definition.group : "base", value: "value" in effect.definition ? effect.definition.value : 0 } }))).combined;
        const baseDamage = calculateBaseTroopDamage({ fixedInitialMinTroops: 1, aliveCount: 1,
          damageCoefficient: stack.damageCoefficient, troopConstant: stack.troopConstant,
          attack, penetration }).damage * baseMultiplier;
        const eventInput = { id: `theory:${side}:${troop}:${target}`, round: 1, actionOrder: 0,
          sourceSide: side, sourceTroop: troop, targetSide: enemy, targetTroop: target, baseDamage: 1 };
        const normal = createDamageEvent({ ...eventInput, damageType: "normalAttack", damageSubtype: "normalAttack" }, state);
        const skill = createDamageEvent({ ...eventInput, damageType: "skillDamage", damageSubtype: "extraDamage" }, state);
        const normalUnit = baseDamage * normal.modifiedDamage;
        const extra = extras[side].reduce((sum, entry) => {
          const source = entry.effect.scope.source === "self" ? entry.troop : entry.effect.scope.source;
          if (source !== "army" && source !== troop) return sum;
          const basis = entry.effect.basis === "parentModifiedDamage" || entry.effect.basis === "parentFinalDamage" ? normalUnit : baseDamage;
          return sum + entry.value * basis * skill.modifiedDamage;
        }, 0);
        normalDamage.push(normalUnit); damage.push(normalUnit + extra);
        mitigation.push(normal.targetDefenseMultiplier * normal.reductionMultiplier /
          Math.max(1e-9, normal.defenseReductionMultiplier * normal.directCancellationMultiplier));
      }
      const hp = TROOP_TYPES.map((troop) => calculateTroopHp({ troopConstant: own.troops[troop].troopConstant,
        troopHpCoefficient: own.troops[troop].troopHpCoefficient,
        life: resolveTroopAttribute(own, troop, "life", 1, { targetTroop: "shield", damageType: "normalAttack" }).effectiveValue }).effectiveHpPerUnit);
      const counts = TROOP_TYPES.map((troop) => own.troops[troop].aliveCount);
      return { counts, total: counts.reduce((sum, n) => sum + n, 0), hp, normalDamage, damage, mitigation,
        uncertainty: Math.min(.8, uncertainties[side]), priorities: [[0, 1, 2], [0, 1, 2], [0, 1, 2]] };
    });
    const sides = results.map((side, index) => ({ ...side, ehp: side.hp.map((hp, troop) => {
      const opponent = results[1 - index]!;
      const total = Math.max(1, opponent.total);
      return hp * opponent.counts.reduce((sum, n, source) => sum + n / total * opponent.mitigation[source * 3 + troop]!, 0);
    }) }));
    const expectationProgram = createExpectationProgram(initial, options, disabled);
    const initialCounts = sides.map((side) => side.counts);
    const fixed = Math.sqrt(Math.min(sides[0]!.total, sides[1]!.total));
    const first = expectationProgram.runRound(1, initialCounts, fixed, expectationProgram.createRuntime());
    const enriched = sides.map((side, i) => ({ ...side, hp: first.hp[i]!,
      damage: first.output.matrix[i as 0 | 1].map((damage, index) => damage / Math.max(1e-12, fixed * Math.sqrt(side.counts[Math.floor(index / 3)]!))),
      uncertainty: expectationProgram.uncertainty[i as 0 | 1] }));
    return { sideA: enriched[0]!, sideB: enriched[1]!, targetSide, expectationProgram,
      maxRounds: Math.min(input.maxRounds, options.deterministicRounds),
      probabilityEquivalents: expectationProgram.probabilityEquivalents, omittedMechanisms: expectationProgram.omittedMechanisms };
  };
}
