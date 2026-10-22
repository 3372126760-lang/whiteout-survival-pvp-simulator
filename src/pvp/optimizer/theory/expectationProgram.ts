import { CONFIRMED_HERO_SKILL_DEFINITIONS, type HeroSkillDefinition, type HeroSkillEffect } from "../../heroSkills";
import { CONFIRMED_TROOP_SKILL_DEFINITIONS, type TroopSkillDefinition, type TroopSkillEffect } from "../../troopSkills";
import { createActiveEffect, resolveTroopAttribute, matchesEffectScope, computeGroupedMultiplier } from "../../effects";
import { calculateBaseTroopDamage, calculateTroopHp } from "../../formulas";
import { createDamageEvent } from "../../damage";
import { DEFAULT_ACTION_ORDER, DEFAULT_TARGET_PRIORITY } from "../../constants";
import { isBattleContextAllowedForSide, TROOP_TYPES, sideFromState, type BattleState, type SideId,
  type ActiveEffect, type EffectDefinition } from "../../types";
import type { TheoryOptions, ProbabilityEquivalent } from "./types";
import { targetMarkSourceGroups } from "../../heroSkills/targetMarkStacking";

type Skill = HeroSkillDefinition | TroopSkillDefinition;
type Effect = HeroSkillEffect | TroopSkillEffect;
interface Binding { skill: Skill; level: Skill["levelValues"][number]; side: number; troop?: number; key: string; }
interface Applied { key: string; side: number; holder: number; effect: ActiveEffect; end: number; }
interface Shield { key: string; side: number; troop: number; hp: number; start: number; end: number; }
interface PendingMark { key: string; side: number; troop: number; target: number; due: number; coefficient: number; weight: number; }
export interface ExpectationRuntime {
  counts: number[][]; effects: Applied[]; shields: Shield[]; blocked: number[][]; nextBlocked: number[][];
  lastTriggered: Record<string, number>; triggeredPassive: Set<string>;
  marks: PendingMark[];
}
export interface ExpectedOutput { matrix: readonly [readonly number[], readonly number[]]; total: readonly [number, number]; }
export interface ExpectationProgram {
  readonly probabilityEquivalents: readonly ProbabilityEquivalent[]; readonly omittedMechanisms: readonly string[];
  readonly uncertainty: readonly [number, number];
  readonly cacheStatistics: () => { coefficientFrames: number; compiledEffects: number; roundPlans: number };
  readonly createRuntime: () => ExpectationRuntime;
  readonly runRound: (round: number, counts: readonly (readonly number[])[], fixed: number, runtime: ExpectationRuntime) =>
    { damage: number[][]; hp: number[][]; output: ExpectedOutput };
  readonly nextOutput: (round: number, counts: readonly (readonly number[])[], fixed: number, runtime: ExpectationRuntime) => ExpectedOutput;
}
const numericKinds = new Set(["attributeModifier", "attributeReduction", "damageIncrease", "damageReduction",
  "outgoingDamageReduction", "incomingDamageIncrease", "defenseModifier", "defenseReduction", "baseDamageMultiplier",
  "baseDefenseMultiplier", "directDamageCancellation"]);
export function damageDependencyPolicy(skill: Skill): { affectedByDodge: boolean; affectedByStun: boolean; requiresMainHit: boolean } {
  const timing = "triggerTiming" in skill ? skill.triggerTiming : undefined;
  const attempt = timing === "mainAttackAttempt" || skill.metadata.tags?.includes("preDodge") ||
    skill.metadata.tags?.includes("mainAttackAttempt") || skill.trigger === "beforeAttack";
  return { affectedByDodge: !attempt, affectedByStun: true, requiresMainHit: !attempt };
}
/** Independent expectation propagation. It shares formula/effect functions, never calls BattleEngine or RNG.
 * Probability-state correlations are an explicit approximation, not a claimed exact joint distribution. */
export function createExpectationProgram(initial: BattleState, options: TheoryOptions, disabled: ReadonlySet<string>): ExpectationProgram {
  const bindings: Binding[] = [], omitted = new Set<string>(), equivalents: ProbabilityEquivalent[] = [];
  const uncertainty: [number, number] = [0, 0];
  const heroes = new Map(CONFIRMED_HERO_SKILL_DEFINITIONS.map((skill) => [skill.id, skill]));
  const troops = new Map(CONFIRMED_TROOP_SKILL_DEFINITIONS.map((skill) => [skill.id, skill]));
  for (const [side, sideId] of (["A", "B"] as const).entries()) {
    const own = sideFromState(initial, sideId);
    const add = (skill: Skill | undefined, levelNumber: number, enabled: boolean, key: string, troop?: number) => {
      if (!skill || !enabled || disabled.has(skill.id) || ("heroId" in skill &&
        !isBattleContextAllowedForSide(skill.battleContexts, initial.battleContext, sideId))) return;
      const level = skill.levelValues[levelNumber]; if (!level) return;
      bindings.push({ skill, level, side, key, ...(troop === undefined ? {} : { troop }) });
      const p = level.probability ?? skill.probability ?? 1;
      if (p < 1) uncertainty[side]! += .035;
      if (skill.metadata.ruleStatus !== "supported") uncertainty[side]! += .04;
      if ("actionMechanic" in skill && (skill.actionMechanic?.kind === "targetBoundMark" || skill.actionMechanic?.kind === "skipMainAttack")) {
        omitted.add(`${skill.id}:correlated action/mark state`); uncertainty[side]! += .08;
      }
      for (const effect of level.effects) {
        if (p < 1 && ("value" in effect || "coefficient" in effect)) {
          const mathematicalExpectation = p * ("value" in effect ? effect.value : "coefficient" in effect ? effect.coefficient : 0);
          const calibratedEquivalent = options.calibratedEquivalents[effect.id];
          equivalents.push({ skillId: skill.id, effectId: effect.id, mathematicalExpectation,
            ...(calibratedEquivalent === undefined ? {} : { calibratedEquivalent }),
            usedEquivalent: calibratedEquivalent ?? mathematicalExpectation * options.probabilityEquivalentCoefficient });
        }
        if (effect.kind === "targetBoundMark" || effect.kind === "oneUseIncomingDamageIncrease" ||
          effect.kind === "markedTargetDamageIncrease" || effect.kind === "decayingDamageIncrease") {
          omitted.add(`${skill.id}:${effect.kind}`); uncertainty[side]! += .045;
        }
        if (p < 1 && (effect.lifecycle?.durationRounds ?? level.durationRounds ?? skill.durationRounds ?? 1) > 1) {
          omitted.add(`${skill.id}:multi-round probability correlation approximated`); uncertainty[side]! += .045;
        }
        if (effect.kind === "skipNextRoundAction") {
          omitted.add(`${skill.id}:stun/attack-counter joint distribution approximated`); uncertainty[side]! += .045;
        }
        if ("recipient" in effect && effect.recipient === "enemyArmy" && effect.scope.target === "currentTarget" && numericKinds.has(effect.kind)) {
          omitted.add(`${skill.id}:target-bound debuff correlation`); uncertainty[side]! += .045;
        }
      }
    };
    for (const [i, hero] of own.heroStates.entries()) for (const runtime of hero.skillStates)
      add(heroes.get(runtime.skillId), runtime.level, runtime.enabled, `${side}:hero:${i}:${runtime.skillId}`);
    for (const [troop, type] of TROOP_TYPES.entries()) for (const runtime of own.troops[type].skillStates)
      add(troops.get(runtime.skillId), runtime.level, runtime.enabled, `${side}:troop:${troop}:${runtime.skillId}`, troop);
  }
  const probability = (binding: Binding) => binding.level.probability ?? binding.skill.probability ?? 1;
  const expected = (binding: Binding, effect: Effect, value: number) => options.calibratedEquivalents[effect.id] ??
    value * ("linkedToSkillId" in effect && effect.linkedToSkillId ? (() => { const linked = bindings.find((entry) => entry.side === binding.side && entry.skill.id === effect.linkedToSkillId); return linked ? probability(linked) : 0; })() : probability(binding)) * (probability(binding) < 1 ? options.probabilityEquivalentCoefficient : 1);
  const sourceMatches = (binding: Binding, effect: Effect, troop: number) => effect.scope.source === "army" ||
    (effect.scope.source === "self" ? binding.troop : TROOP_TYPES.indexOf(effect.scope.source)) === troop;
  const due = (binding: Binding, round: number, troop: number, runtime: ExpectationRuntime) => {
    const skill = binding.skill, level = binding.level;
    const period = level.periodRounds;
    if (period && (round < (level.periodStartRound ?? 1) || (round - (level.periodStartRound ?? 1)) % period !== 0)) return false;
    if ((level.cooldownRounds ?? skill.cooldownRounds ?? 0) > round - (runtime.lastTriggered[binding.key] ?? -10000)) return false;
    if (!binding.level.effects.some((effect) => sourceMatches(binding, effect, troop)) &&
      !("actionMechanic" in skill && skill.actionMechanic?.kind === "dodgeNormalAttack")) return false;
    if (!("actionMechanic" in skill) || !skill.actionMechanic) return true;
    const mechanic = skill.actionMechanic;
    if (mechanic.kind === "skipMainAttack" || mechanic.kind === "dodgeNormalAttack") return false;
    if (mechanic.kind === "naturalRoundTrigger") return TROOP_TYPES.indexOf(mechanic.source) === troop;
    const schedule = mechanic.schedule;
    if (schedule.source !== "army" && TROOP_TYPES.indexOf(schedule.source) !== troop) return false;
    const count = runtime.counts[binding.side]![troop]!; // Formal runtime has per-troop private counters, even for army-scoped skills.
    const current = count + (schedule.mode === "onCompleted" ? 1 : 0);
    return current > 0 && current % schedule.interval === 0;
  };
  const appliedCache = new Map<string, Applied>();
  function applyNumeric(binding: Binding, effect: Effect, round: number, runtime: ExpectationRuntime, actionTroop?: number, occurrence = 1): void {
    if (!numericKinds.has(effect.kind) || !("value" in effect) ||
      ("recipient" in effect && effect.recipient === "enemyArmy" && effect.scope.target === "currentTarget")) return;
    const cacheKey = `${binding.key}:${effect.id}:${round}:${actionTroop ?? "army"}:${effect.value}:${occurrence}`;
    const cached = appliedCache.get(cacheKey);
    if (cached && effect.lifecycle?.refreshMode !== "stack") {
      runtime.effects = runtime.effects.filter((entry) => entry.key !== cached.key); runtime.effects.push(cached); return;
    }
    const source = effect.scope.source === "army" ? undefined : effect.scope.source === "self" ? binding.troop : TROOP_TYPES.indexOf(effect.scope.source);
    const defensive = ["damageReduction", "defenseModifier", "defenseReduction", "baseDefenseMultiplier", "directDamageCancellation"].includes(effect.kind);
    const scope = {
      ...(defensive ? effect.scope.incomingSourceTroop ? { sourceTroops: [effect.scope.incomingSourceTroop] } : {}
        : source === undefined ? {} : { sourceTroops: [TROOP_TYPES[source]!] }),
      ...(effect.scope.target === undefined || effect.scope.target === "all" || effect.scope.target === "currentTarget"
        ? {} : { targetTroops: [effect.scope.target] }),
      ...(effect.scope.damageType === undefined || effect.scope.damageType === "all" ? {} : { damageTypes: [effect.scope.damageType] }),
    };
    if (effect.kind === "attributeModifier" && effect.attribute === "defense" && effect.scope.incomingSourceTroop && binding.troop !== undefined) {
      scope.sourceTroops = [TROOP_TYPES[binding.troop]!]; scope.targetTroops = [effect.scope.incomingSourceTroop];
    }
    const duration = effect.lifecycle?.durationRounds ?? binding.level.durationRounds ?? binding.skill.durationRounds;
    const lifecycle = { ...effect.lifecycle,
      ...(duration === undefined ? {} : { durationRounds: duration }),
      activationTiming: effect.lifecycle?.activationTiming ?? ("activationTiming" in binding.skill ? binding.skill.activationTiming : undefined) ?? "immediate" as const };
    let definition = { ...effect, value: expected(binding, effect, effect.value) * occurrence, scope, lifecycle,
      ruleStatus: binding.skill.metadata.ruleStatus } as EffectDefinition;
    const side = "recipient" in effect && effect.recipient === "enemyArmy" ? 1 - binding.side : binding.side;
    const holder = "heroId" in binding.skill || source === undefined ? -1 : source;
    // Attack-local modifiers are scoped to that action; they cannot buff every troop after one proc.
    if (actionTroop !== undefined && !defensive && lifecycle.activationTiming !== "nextRound" && binding.skill.trigger !== "roundStart")
      definition = { ...definition, scope: { ...definition.scope, sourceTroops: [TROOP_TYPES[actionTroop]!] } };
    const key = `${binding.key}:${effect.id}:${actionTroop ?? "army"}`;
    let active = createActiveEffect({ identity: { sourceId: binding.key, sourceSkillId: binding.skill.id, effectId: effect.id }, definition, appliedRound: round });
    const end = duration === undefined ? binding.skill.trigger === "passive" ? Infinity : round : active.activeFromRound + duration - 1;
    const existing = runtime.effects.find((entry) => entry.key === key);
    if (existing && effect.lifecycle?.refreshMode === "stack") {
      const limit = effect.lifecycle.maxStacks ?? Number.MAX_SAFE_INTEGER;
      active = { ...active, stackCount: Math.min(limit, existing.effect.stackCount + 1) };
    }
    runtime.effects = runtime.effects.filter((entry) => entry.key !== key);
    const applied = { key, side, holder, effect: active, end };
    appliedCache.set(cacheKey, applied); runtime.effects.push(applied);
  }
  interface Frame { state: BattleState; base: number[][]; baseMultiplier: number[][]; normal: number[][]; skill: number[][]; hp: number[][]; }
  const frames = new Map<string, Frame>();
  function frame(round: number, runtime: ExpectationRuntime): Frame {
    const applicable = runtime.effects.filter((entry) => {
      const lifecycle = entry.effect.definition.lifecycle;
      return entry.effect.definition.ruleStatus !== "RULE_UNKNOWN" && entry.effect.activeFromRound <= round && round <= entry.end &&
        (!lifecycle?.activeRounds || lifecycle.activeRounds.includes(round)) && (!lifecycle?.periodRounds ||
          round >= lifecycle.firstActiveRound! && (round - lifecycle.firstActiveRound!) % lifecycle.periodRounds < lifecycle.activeWindowRounds!);
    });
    const key = applicable.map((entry) => `${entry.key}:${entry.effect.stackCount}:${"value" in entry.effect.definition ? entry.effect.definition.value : 0}`).sort().join("|");
    const prior = frames.get(key); if (prior) return prior;
    const sideStates = (["A", "B"] as const).map((sideId, side) => {
      const own = sideFromState(initial, sideId);
      const active = applicable.filter((entry) => entry.side === side);
      return { ...own, armyEffects: [...own.armyEffects, ...active.filter((e) => e.holder < 0).map((e) => e.effect)],
        troops: Object.fromEntries(TROOP_TYPES.map((troop, i) => [troop, { ...own.troops[troop],
          buffs: [...own.troops[troop].buffs, ...active.filter((e) => e.holder === i).map((e) => e.effect)] }])) as unknown as BattleState["sideA"]["troops"] };
    });
    const state = { ...initial, round, sideA: sideStates[0]!, sideB: sideStates[1]! };
    const result: Frame = { state, base: [[], []], baseMultiplier: [[], []], normal: [[], []], skill: [[], []], hp: [[], []] };
    for (const [side, own] of sideStates.entries()) {
      const sideId: SideId = side === 0 ? "A" : "B", enemy: SideId = side === 0 ? "B" : "A";
      for (const troop of TROOP_TYPES) for (const target of TROOP_TYPES) {
        const context = { targetTroop: target, damageType: "normalAttack" as const };
        const stack = own.troops[troop];
        const baseEffects = [...own.armyEffects, ...stack.buffs].filter((effect) => effect.definition.kind === "baseDamageMultiplier" &&
          matchesEffectScope(effect.definition.scope, { sourceSide: sideId, targetSide: enemy, sourceTroop: troop, targetTroop: target,
            damageType: "normalAttack", damageSubtype: "normalAttack", round, actionOrder: 0 }));
        const multiplier = computeGroupedMultiplier(baseEffects.map((effect) => ({ ...effect,
          definition: { ...effect.definition, kind: "damageIncrease" as const, group: "group" in effect.definition ? effect.definition.group : "base",
            value: "value" in effect.definition ? effect.definition.value : 0 } }))).combined;
        const base = calculateBaseTroopDamage({ fixedInitialMinTroops: 1, aliveCount: 1,
          damageCoefficient: stack.damageCoefficient, troopConstant: stack.troopConstant,
          attack: resolveTroopAttribute(own, troop, "attack", round, context).effectiveValue,
          penetration: resolveTroopAttribute(own, troop, "penetration", round, context).effectiveValue }).damage * multiplier;
        const input = { id: "theory-unit", round, actionOrder: 0, sourceSide: sideId, targetSide: enemy, sourceTroop: troop, targetTroop: target, baseDamage: base };
        result.base[side]!.push(base);
        result.baseMultiplier[side]!.push(multiplier);
        result.normal[side]!.push(createDamageEvent({ ...input, damageType: "normalAttack", damageSubtype: "normalAttack" }, state).modifiedDamage);
        result.skill[side]!.push(createDamageEvent({ ...input, damageType: "skillDamage", damageSubtype: "extraDamage" }, state).modifiedDamage);
      }
      result.hp[side] = TROOP_TYPES.map((troop) => calculateTroopHp({ troopConstant: own.troops[troop].troopConstant,
        troopHpCoefficient: own.troops[troop].troopHpCoefficient,
        life: resolveTroopAttribute(own, troop, "life", round, { targetTroop: "shield", damageType: "normalAttack" }).effectiveValue }).effectiveHpPerUnit);
    }
    frames.set(key, result); return result;
  }
  function propagateRound(round: number, counts: readonly (readonly number[])[], fixed: number, runtime: ExpectationRuntime) {
    runtime.marks = runtime.marks.filter((mark) => mark.due >= round);
    runtime.effects = runtime.effects.filter((entry) => entry.end >= round);
    runtime.shields = runtime.shields.filter((entry) => entry.end >= round);
    runtime.blocked = runtime.nextBlocked; runtime.nextBlocked = [[0, 0, 0], [0, 0, 0]];
    for (const binding of bindings) if (binding.skill.trigger === "passive" || binding.skill.trigger === "roundStart" || binding.skill.trigger === "beforeDamage") {
      if (binding.skill.id === "marksman-blazing-star-t12") {
        const stacks = round < 6 ? 0 : 1 + Math.floor((round - 6) / 5);
        for (const effect of binding.level.effects) if ("value" in effect && stacks > 0) applyNumeric(binding, { ...effect, value: effect.value * stacks }, round, runtime);
        continue;
      }
      if (binding.skill.trigger === "passive" && runtime.triggeredPassive.has(binding.key)) continue;
      if (binding.level.periodRounds && (round < (binding.level.periodStartRound ?? 1) || (round - (binding.level.periodStartRound ?? 1)) % binding.level.periodRounds !== 0)) continue;
      for (const effect of binding.level.effects) applyNumeric(binding, effect, round, runtime);
      runtime.triggeredPassive.add(binding.key);
    }
    const hp = frame(round, runtime).hp;
    const contributions = [Array<number>(9).fill(0), Array<number>(9).fill(0)];
    const damage = [[0, 0, 0], [0, 0, 0]], matrix = [Array<number>(9).fill(0), Array<number>(9).fill(0)], total = [0, 0];
    for (const action of DEFAULT_ACTION_ORDER) {
      const side = action.side === "A" ? 0 : 1, troop = TROOP_TYPES.indexOf(action.troop), enemy = 1 - side;
      const n = counts[side]![troop]!; if (n <= 1e-8 || counts[enemy]!.every((n) => n <= 1e-8)) continue;
      const availability = 1 - runtime.blocked[side]![troop]!;
      if (availability <= 1e-8) continue;
      const eligible = bindings.filter((binding) => binding.side === side && due(binding, round, troop, runtime));
      for (const binding of eligible.filter((b) => b.skill.trigger === "beforeAttack"))
        for (const effect of binding.level.effects) if (sourceMatches(binding, effect, troop)) applyNumeric(binding, effect, round, runtime, troop, availability);
      const coefficients = frame(round, runtime), scale = fixed * Math.sqrt(n);
      const dodge = bindings.filter((binding) => binding.side === enemy && "actionMechanic" in binding.skill && binding.skill.actionMechanic?.kind === "dodgeNormalAttack")
        .reduce((survival, binding) => survival * (1 - probability(binding)), 1);
      let priorities = [{ weight: 1, priority: DEFAULT_TARGET_PRIORITY.map((type) => TROOP_TYPES.indexOf(type)) }];
      for (const binding of eligible) for (const effect of binding.level.effects) if (effect.kind === "targetingOverride" && sourceMatches(binding, effect, troop)) {
        const p = probability(binding);
        priorities = priorities.map((branch) => ({ ...branch, weight: branch.weight * (1 - p) }));
        priorities.push({ weight: p, priority: effect.priority.map((type) => TROOP_TYPES.indexOf(type)) });
      }
      const explicitExtras = [Array<number>(3).fill(0), Array<number>(3).fill(0), Array<number>(3).fill(0)];
      const actionEffects = eligible.filter((binding) => binding.skill.trigger === "beforeAttack" || binding.skill.trigger === "afterNormalAttack");
      const markGroups = targetMarkSourceGroups(actionEffects);
      for (let target = 0; target < 3; target++) {
        const index = troop * 3 + target;
        let unit = coefficients.normal[side]![index]! * dodge;
        for (const binding of actionEffects) for (const effect of binding.level.effects) {
          if (!sourceMatches(binding, effect, troop) || (effect.scope.target !== undefined && effect.scope.target !== "all" &&
            effect.scope.target !== "currentTarget" && TROOP_TYPES.indexOf(effect.scope.target) !== target)) continue;
          const dependency = damageDependencyPolicy(binding.skill), hit = dependency.requiresMainHit || dependency.affectedByDodge ? dodge : 1;
          if (effect.kind === "extraDamage") {
            const link = bindings.filter((b) => b.side === side).flatMap<Effect>((b) => b.level.effects).reduce((sum, linked) =>
              linked.kind === "extraDamageContribution" && linked.linkedToSkillId === binding.skill.id && sourceMatches(binding, linked, troop) ? sum + linked.coefficient : sum, 0);
            const coefficient = expected(binding, effect, effect.coefficient + link);
            const basis = effect.basis === "parentModifiedDamage" || effect.basis === "parentFinalDamage"
              ? coefficients.normal[side]![index]! : coefficients.base[side]![index]!;
            const extra = coefficient * basis * coefficients.skill[side]![index]! / Math.max(1e-12, coefficients.base[side]![index]!) * hit;
            unit += extra;
            if (effect.scope.target !== undefined && effect.scope.target !== "currentTarget") explicitExtras[troop]![target]! += extra;
          } else if (effect.kind === "sameMainAttackSegment") unit += probability(binding) * effect.damageScale * coefficients.normal[side]![index]! * dodge;
        }
        matrix[side]![index] = scale * unit * availability;
      }
      for (const branch of priorities) {
        const target = branch.priority.find((target) => counts[enemy]![target]! > 1e-8);
        if (target === undefined || branch.weight <= 0) continue;
        for (const group of markGroups) {
          const key = `${side}:${troop}:${group.key}:${target}:R${round}`;
          const weight = availability * branch.weight;
          const existing = runtime.marks.find((mark) => mark.key === key);
          if (existing) existing.weight = Math.min(1, existing.weight + weight);
          else runtime.marks.push({ key, side, troop, target, due: round + group.mechanic.damageDelayRounds,
            coefficient: group.coefficient, weight });
          // A condition is boolean; additional mark sources do not repeat the leader's conditional bonuses.
          const related = bindings.filter((binding) => binding.side === side && binding.level.effects.some((effect) =>
            effect.kind === "markedTargetDamageIncrease" && effect.markId === group.mechanic.markId));
          for (const binding of [...new Map(related.map((b) => [b.skill.id, b])).values()]) for (const effect of binding.level.effects) {
            if (effect.kind !== "markedTargetDamageIncrease" || effect.markId !== group.mechanic.markId) continue;
            applyNumeric(binding, { ...effect, id: `${effect.id}:target:${target}`, kind: "incomingDamageIncrease",
              scope: { ...effect.scope, target: TROOP_TYPES[target]! },
              lifecycle: { activationTiming: "nextRound", durationRounds: group.mechanic.markDurationRounds, refreshMode: "replace" } }, round, runtime, undefined, existing?.weight ?? weight);
          }
        }
        const amount = (matrix[side]![troop * 3 + target]! - scale * explicitExtras[troop]![target]! * availability) * branch.weight;
        let net = amount;
        for (const shield of runtime.shields) if (shield.side === enemy && shield.troop === target && shield.start <= round && shield.end >= round) {
          const absorbed = Math.min(shield.hp, net); shield.hp -= absorbed; net -= absorbed;
        }
        damage[enemy]![target]! += net; total[side]! += net;
        contributions[side]![troop * 3 + target]! += net / scale;
        // All-target and fixed-target extras are independent events, with each target's own skill mitigation.
        for (const binding of actionEffects) for (const effect of binding.level.effects) {
          if (effect.kind !== "extraDamage" || !sourceMatches(binding, effect, troop) ||
            effect.scope.target === undefined || effect.scope.target === "currentTarget") continue;
          const targets = effect.scope.target === "all" ? [0, 1, 2] : [TROOP_TYPES.indexOf(effect.scope.target)];
          for (const concrete of targets) {
            if (counts[enemy]![concrete]! <= 1e-8) continue;
            const parentIndex = troop * 3 + target, concreteIndex = troop * 3 + concrete;
            let basis = effect.basis === "parentModifiedDamage" || effect.basis === "parentFinalDamage"
              ? coefficients.normal[side]![parentIndex]! : coefficients.base[side]![parentIndex]!;
            // The formal all-target B child recomputes attack/penetration for a different target,
            // but retains its parent's base-damage multiplier. Raw-basis children retain the parent B.
            if (effect.scope.target === "all" && effect.basis === "parentBaseDamage" && concrete !== target) {
              const own = sideFromState(coefficients.state, action.side), source = own.troops[action.troop];
              const context = { targetTroop: TROOP_TYPES[concrete]!, damageType: "skillDamage" as const };
              basis = calculateBaseTroopDamage({ fixedInitialMinTroops: 1, aliveCount: 1,
                damageCoefficient: source.damageCoefficient, troopConstant: source.troopConstant,
                attack: resolveTroopAttribute(own, action.troop, "attack", round, context).effectiveValue,
                penetration: resolveTroopAttribute(own, action.troop, "penetration", round, context).effectiveValue,
              }).damage * coefficients.baseMultiplier[side]![parentIndex]!;
            }
            const hit = damageDependencyPolicy(binding.skill).requiresMainHit ? dodge : 1;
            let extra = scale * expected(binding, effect, effect.coefficient) * basis *
              coefficients.skill[side]![concreteIndex]! / Math.max(1e-12, coefficients.base[side]![concreteIndex]!) * hit * availability * branch.weight;
            for (const shield of runtime.shields) if (shield.side === enemy && shield.troop === concrete && shield.start <= round && shield.end >= round) {
              const absorbed = Math.min(shield.hp, extra); shield.hp -= absorbed; extra -= absorbed;
            }
            damage[enemy]![concrete]! += extra; total[side]! += extra; contributions[side]![concreteIndex]! += extra / scale;
          }
        }
        for (const binding of actionEffects) for (const effect of binding.level.effects) if (sourceMatches(binding, effect, troop)) {
          if (effect.kind === "skipNextRoundAction") {
            const p = probability(binding) * availability * branch.weight * (damageDependencyPolicy(binding.skill).requiresMainHit ? dodge : 1);
            runtime.nextBlocked[enemy]![target] = 1 - (1 - runtime.nextBlocked[enemy]![target]!) * (1 - p);
          }
          if (effect.kind === "temporaryShield") {
            const own = sideFromState(initial, action.side).troops[action.troop];
            const basis = effect.basis === "gatotReportAttackPower" ? 100 * own.troopConstant * Math.sqrt(n) * (1 + own.attack)
              : scale * coefficients.base[side]![troop * 3 + target]!;
            const start = round + (effect.lifecycle?.activationTiming === "nextRound" ? 1 : 0);
            const key = `${binding.key}:${effect.id}`;
            runtime.shields = runtime.shields.filter((shield) => shield.key !== key || (start > round && shield.start < start));
            runtime.shields.push({ key, side, troop, hp: basis * expected(binding, effect, effect.coefficient) * availability * (damageDependencyPolicy(binding.skill).requiresMainHit ? dodge : 1),
              start, end: start + (effect.lifecycle?.durationRounds ?? binding.level.durationRounds ?? binding.skill.durationRounds ?? 1) - 1 });
          }
        }
      }
      // Settle yesterday's locked target even when today's main chooses another target or is dodged.
      for (const mark of runtime.marks.filter((mark) => mark.side === side && mark.troop === troop && mark.due === round)) {
        if (counts[enemy]![mark.target]! <= 1e-8) continue;
        const parentBase = priorities.reduce((sum, branch) => {
          const target = branch.priority.find((t) => counts[enemy]![t]! > 1e-8);
          return sum + (target === undefined ? 0 : coefficients.base[side]![troop * 3 + target]! * branch.weight);
        }, 0);
        const index = troop * 3 + mark.target;
        let net = scale * parentBase * mark.coefficient * mark.weight * availability *
          coefficients.skill[side]![index]! / Math.max(1e-12, coefficients.base[side]![index]!);
        matrix[side]![index]! += net;
        for (const shield of runtime.shields) if (shield.side === enemy && shield.troop === mark.target && shield.start <= round && shield.end >= round) {
          const absorbed = Math.min(shield.hp, net); shield.hp -= absorbed; net -= absorbed;
        }
        damage[enemy]![mark.target]! += net; total[side]! += net; contributions[side]![index]! += net / scale;
      }
      for (const binding of actionEffects) {
        if (binding.skill.trigger === "afterNormalAttack") for (const effect of binding.level.effects)
          if (sourceMatches(binding, effect, troop)) applyNumeric(binding, effect, round, runtime, troop, availability * (damageDependencyPolicy(binding.skill).requiresMainHit ? dodge : 1));
        runtime.lastTriggered[binding.key] = round;
      }
      runtime.counts[side]![troop]! += 1;
    }
    return { damage, hp, contributions, output: { matrix: matrix as [number[], number[]], total: total as [number, number] } };
  }
  const cloneRuntime = (runtime: ExpectationRuntime): ExpectationRuntime => ({ counts: runtime.counts.map((counts) => [...counts]),
    marks: runtime.marks.map((mark) => ({ ...mark })),
    effects: runtime.effects.map((entry) => ({ ...entry })), shields: runtime.shields.map((entry) => ({ ...entry })),
    blocked: runtime.blocked.map((row) => [...row]), nextBlocked: runtime.nextBlocked.map((row) => [...row]),
    lastTriggered: { ...runtime.lastTriggered }, triggeredPassive: new Set(runtime.triggeredPassive) });
  interface RoundPlan { after: ExpectationRuntime; matrix: number[][]; contributions: number[][]; hp: number[][]; }
  const plans = new Map<string, RoundPlan>();
  const reusable = !bindings.some((binding) => binding.level.effects.some((effect) => effect.kind === "temporaryShield"));
  function runRound(round: number, counts: readonly (readonly number[])[], fixed: number, runtime: ExpectationRuntime) {
    if (!reusable) return propagateRound(round, counts, fixed, runtime);
    const key = `${round}:${counts.map((side) => side.map((n) => n > 1e-8 ? 1 : 0).join("")).join("/")}:${runtime.counts.map((c) => c.join(",")).join("/")}:` +
      runtime.effects.map((e) => `${e.key}:${e.effect.appliedRound}:${e.effect.stackCount}`).join("|") +
      JSON.stringify([runtime.lastTriggered, runtime.nextBlocked, runtime.marks]);
    let plan = plans.get(key);
    if (!plan) {
      // Unit populations make cached coefficients independent of scan order / floating troop counts.
      const unitCounts = counts.map((side) => side.map((n) => n > 1e-8 ? 1 : 0));
      const result = propagateRound(round, unitCounts, 1, runtime);
      plan = { after: cloneRuntime(runtime), matrix: result.output.matrix.map((row) => [...row]), contributions: result.contributions, hp: result.hp };
      plans.set(key, plan);
    }
    Object.assign(runtime, cloneRuntime(plan.after));
    const damage = [[0,0,0],[0,0,0]], total: [number, number] = [0,0];
    const matrix: [number[], number[]] = [[],[]];
    for (let side = 0; side < 2; side++) for (let source = 0; source < 3; source++) {
      const scale = fixed * Math.sqrt(counts[side]![source]!);
      for (let target = 0; target < 3; target++) {
        const index = source * 3 + target;
        matrix[side as 0 | 1].push(scale * plan.matrix[side]![index]!);
        const amount = scale * plan.contributions[side]![index]!;
        damage[1-side]![target]! += amount; total[side as 0 | 1] += amount;
      }
    }
    return { damage, hp: plan.hp, output: { matrix, total } };
  }
  return { probabilityEquivalents: equivalents, omittedMechanisms: [...omitted], uncertainty: uncertainty.map((n) => Math.min(.8, n)) as [number, number],
    cacheStatistics: () => ({ coefficientFrames: frames.size, compiledEffects: appliedCache.size, roundPlans: plans.size }),
    createRuntime: () => ({ counts: [[0, 0, 0], [0, 0, 0]], effects: [], shields: [], marks: [], blocked: [[0, 0, 0], [0, 0, 0]],
      nextBlocked: [[0, 0, 0], [0, 0, 0]], lastTriggered: {}, triggeredPassive: new Set() }), runRound,
    nextOutput: (round, counts, fixed, runtime) => runRound(round, counts, fixed, cloneRuntime(runtime)).output };
}
